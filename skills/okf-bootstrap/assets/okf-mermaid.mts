#!/usr/bin/env node
/**
 * OKF Mermaid parse checker.
 *
 * Extracts every ```mermaid fenced block from the .md files in a bundle and
 * runs it through mermaid-cli (mmdc), the real Mermaid parser + renderer in a
 * headless browser. Catches syntax errors a structural lint cannot (bad
 * keywords, missing statements, invalid node ids, ...). Pair with the
 * client-side gate:
 *
 *   node scripts/okf-view.mts okf --check-render
 *
 * which opens the generated viz.html in headless Chromium and verifies every
 * diagram actually renders in the browser.
 *
 * Only top-level fences count: a ```mermaid block shown as an example inside
 * an outer fence (````markdown ... ````) is part of that outer block, so it is
 * not extracted. Both ``` and ~~~ fences are recognised.
 *
 * Usage:
 *   node scripts/okf-mermaid.mts [bundle] [options]
 *     bundle       OKF bundle directory (default: ./okf)
 *     --json       machine-readable report on stdout
 *     --timeout N  wall-clock seconds per diagram (default: 60, covers mmdc
 *                  startup and its headless browser)
 *     --jobs N     parallel mmdc runs (default: 2; each spawns a browser)
 *
 * Exit codes: 0 = all diagrams parse, 1 = at least one failed,
 *             2 = setup error (bundle missing, mmdc not found, or mmdc cannot
 *                 render at all - checked up front with one trivial diagram so
 *                 a broken browser is never reported as broken content).
 *
 * Requires devDependency @mermaid-js/mermaid-cli (provides the mmdc binary).
 * mmdc is resolved from PATH, else from a node_modules/.bin directory at or
 * above the bundle, so running this directly (not via npm run) works too.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Block {
  line: number;
  code: string;
  unclosed?: boolean;
}
interface Mmdc {
  cmd: string;
  version: string;
}
interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
interface Opts {
  bundle: string;
  json: boolean;
  timeout: number;
  jobs: number;
}

function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Pull ```mermaid fenced blocks out of markdown text with their 1-based line
 * numbers. An unclosed fence is reported as a block with `unclosed: true`.
 *
 * Every fence is tracked, not just the mermaid ones: a fence only closes on a
 * matching run of its own character (CommonMark), so a ```mermaid example
 * nested inside a ````markdown block belongs to that block and is skipped.
 * That keeps this gate in step with the markdown renderer, which shows such an
 * example as code rather than a diagram.
 */
function extractMermaidBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let open: {
    line: number;
    char: string;
    len: number;
    mermaid: boolean;
    code: string[];
  } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (m) {
        const info = m[3]!.trim().toLowerCase();
        open = {
          line: i + 1,
          char: m[2]![0]!,
          len: m[2]!.length,
          mermaid: info === 'mermaid',
          code: [],
        };
      }
    } else if (
      m &&
      m[2]![0] === open.char &&
      m[2]!.length >= open.len &&
      m[3]!.trim() === ''
    ) {
      if (open.mermaid)
        blocks.push({ line: open.line, code: open.code.join('\n') });
      open = null;
    } else {
      open.code.push(lines[i]!);
    }
  }
  if (open && open.mermaid)
    blocks.push({
      line: open.line,
      code: open.code.join('\n'),
      unclosed: true,
    });
  return blocks;
}

/**
 * Resolve mmdc: PATH first, then a node_modules/.bin tree at or above the
 * bundle. Returns { cmd, version } for the binary that answered `--version`,
 * so the caller spawns the same one that was probed, or null if none did.
 * `npm run` puts node_modules/.bin on PATH; a direct `node scripts/...` run
 * does not, which is what the upward walk is for.
 */
function findMmdc(bundleRoot: string): Mmdc | null {
  const probe = (cmd: string): Mmdc | null => {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    return { cmd, version: (r.stdout || '').trim() || 'unknown' };
  };
  const onPath = probe('mmdc');
  if (onPath) return onPath;
  let dir = path.resolve(bundleRoot);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'mmdc');
    if (fs.existsSync(candidate)) {
      const local = probe(candidate);
      if (local) return local;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Detached children are in their own process group, so a Ctrl-C aimed at this
// process no longer reaches them: forward it by hand.
const liveGroups = new Set<number>();
function killGroup(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const pid of liveGroups) killGroup(pid);
    process.exit(130);
  });
}

function spawnP(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    try {
      // Own process group: mmdc starts a browser of its own, and killing only
      // mmdc would leave that browser running.
      child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (e) {
      return resolve({
        code: null,
        stdout: '',
        stderr: String((e as Error).message || e),
        timedOut: false,
      });
    }
    // Spawn failures surface as the 'error' event, before which pid is unset.
    const pid = child.pid ?? -1;
    liveGroups.add(pid);
    const done = (result: SpawnResult) => {
      liveGroups.delete(pid);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (!killGroup(pid)) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      done({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({
        code: null,
        stdout,
        stderr: String(e.message || e),
        timedOut: false,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut: false });
    });
  });
}

/** First few lines of a subprocess's complaint, for a one-line report. */
function detailOf(r: SpawnResult, seconds: number): string {
  if (r.timedOut) return `mmdc timed out after ${seconds}s`;
  const text = (r.stderr || r.stdout || '').trim();
  return (
    text.split('\n').filter(Boolean).slice(0, 3).join(' | ') ||
    `mmdc exited ${r.code}`
  );
}

/**
 * Prove mmdc can render at all before any diagram is blamed for failing, and
 * work out whether this machine needs --no-sandbox.
 *
 * Chromium's sandbox does not start under root, and also does not start on
 * distros that restrict unprivileged user namespaces (Ubuntu 23.10+ with
 * AppArmor). mmdc reports that as a failed render for every diagram, which
 * reads exactly like a bundle full of syntax errors. One trivial render up
 * front tells the two apart, and settles the sandbox flag for the whole run.
 *
 * Returns { puppeteerConfig } (null means "the default is fine") or { error }.
 */
async function probeMmdc(
  mmdc: Mmdc,
  tmp: string,
  timeoutMs: number,
  seconds: number,
): Promise<{ puppeteerConfig: string | null; error?: undefined } | { error: string }> {
  fs.writeFileSync(path.join(tmp, 'probe.mmd'), 'graph TD\n  A[a] --> B[b]\n');
  const noSandbox = path.join(tmp, 'puppeteer-no-sandbox.json');
  fs.writeFileSync(
    noSandbox,
    JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }),
  );
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  // Under root the sandbox can never work, so do not spend a run proving it.
  const attempts = isRoot ? [noSandbox] : [null, noSandbox];
  let detail = '';
  for (const cfg of attempts) {
    const args = [
      '-i',
      path.join(tmp, 'probe.mmd'),
      '-o',
      path.join(tmp, 'probe.svg'),
      '-q',
    ];
    if (cfg) args.push('-p', cfg);
    const r = await spawnP(mmdc.cmd, args, timeoutMs);
    if (!r.timedOut && r.code === 0) return { puppeteerConfig: cfg };
    detail = detailOf(r, seconds);
  }
  return { error: detail || 'mmdc could not render a trivial diagram' };
}

async function runPool<T, R>(
  items: T[],
  jobs: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(jobs, items.length)) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]!, i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { bundle: 'okf', json: false, timeout: 60, jobs: 2 };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') opts.json = true;
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--jobs') opts.jobs = Number(argv[++i]);
    else if (a.startsWith('-')) {
      console.error('Unknown flag: ' + a);
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length) opts.bundle = positional[0]!;
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) {
    console.error('--timeout must be a positive number (seconds)');
    process.exit(2);
  }
  if (!Number.isInteger(opts.jobs) || opts.jobs <= 0) {
    console.error('--jobs must be a positive integer');
    process.exit(2);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bundleRoot = path.resolve(opts.bundle);
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    console.error(`Bundle directory not found: ${bundleRoot}`);
    process.exit(2);
  }

  const files = listMarkdown(bundleRoot);
  const blocks: Array<Block & { file: string }> = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(bundleRoot, f), 'utf8');
    for (const b of extractMermaidBlocks(text)) blocks.push({ file: f, ...b });
  }

  const report: {
    bundle: string;
    mmdc: string | null;
    filesScanned: number;
    diagrams: Array<{ file: string; line: number; ok: boolean; error: string | null }>;
  } = {
    bundle: bundleRoot,
    mmdc: null,
    filesScanned: files.length,
    diagrams: blocks.map((b) => ({
      file: b.file,
      line: b.line,
      ok: false,
      error: null,
    })),
  };

  if (blocks.length === 0) {
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else
      console.log(
        `Mermaid parse check: ${bundleRoot}\n  no mermaid diagrams found in ${files.length} file(s)`,
      );
    process.exit(0);
  }

  const mmdc = findMmdc(bundleRoot);
  if (mmdc === null) {
    const msg =
      'mmdc not found (or not runnable). Install it in the consuming project:\n' +
      '  npm i -D @mermaid-js/mermaid-cli\n' +
      'then re-run. (First mmdc run may download a Chrome build for puppeteer.)';
    if (opts.json) {
      console.log(JSON.stringify({ ...report, error: msg }, null, 2));
    } else console.error(`Mermaid parse check: ${bundleRoot}\n\n${msg}`);
    process.exit(2);
  }
  report.mmdc = mmdc.version;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-mermaid-'));
  const timeoutMs = Math.round(opts.timeout * 1000);

  const probe = await probeMmdc(mmdc, tmp, timeoutMs, opts.timeout);
  if (probe.error) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    const msg =
      'mmdc cannot render on this machine, so no diagram was checked:\n' +
      '  ' +
      probe.error +
      '\n' +
      'That is a setup problem, not a content problem. Usual fixes:\n' +
      '  npx playwright install-deps chromium   # Chromium system libraries\n' +
      '  PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run okf:mermaid';
    if (opts.json)
      console.log(JSON.stringify({ ...report, error: msg }, null, 2));
    else console.error(`Mermaid parse check: ${bundleRoot}\n\n${msg}`);
    process.exit(2);
  }
  const puppeteerConfig = 'puppeteerConfig' in probe ? probe.puppeteerConfig : null;

  const results = await runPool(blocks, opts.jobs, async (block, i) => {
    const inPath = path.join(tmp, `${i}.mmd`);
    const outPath = path.join(tmp, `${i}.svg`);
    fs.writeFileSync(inPath, block.code || '');
    if (block.unclosed) {
      return { ok: false, error: 'unclosed ```mermaid fence' };
    }
    // mmdc has no per-render timeout flag (v11); the cap is enforced
    // externally by spawnP, which SIGKILLs the process group at timeoutMs.
    const args = ['-i', inPath, '-o', outPath, '-q'];
    if (puppeteerConfig) args.push('-p', puppeteerConfig);
    const r = await spawnP(mmdc.cmd, args, timeoutMs);
    if (r.timedOut || r.code !== 0)
      return { ok: false, error: detailOf(r, opts.timeout) };
    return { ok: true, error: null };
  });

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  let failed = 0;
  report.diagrams.forEach((d, i) => {
    d.ok = results[i]!.ok;
    d.error = results[i]!.error;
    if (!d.ok) failed++;
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Mermaid parse check: ${bundleRoot} (mmdc ${mmdc.version}${puppeteerConfig ? ', --no-sandbox' : ''})`,
    );
    console.log(`  files scanned : ${report.filesScanned}`);
    console.log(`  diagrams      : ${report.diagrams.length}`);
    console.log(`  parsed ok     : ${report.diagrams.length - failed}`);
    console.log(`  failed        : ${failed}`);
    if (failed) {
      console.log('');
      for (const d of report.diagrams) {
        if (!d.ok) console.log(`  ✗ ${d.file}:${d.line}   ${d.error}`);
      }
    } else {
      console.log('  ✓ every mermaid diagram parses');
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('okf-mermaid: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
