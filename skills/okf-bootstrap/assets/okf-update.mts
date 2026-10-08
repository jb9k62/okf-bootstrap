#!/usr/bin/env node
/**
 * Bring a project's generated OKF tools up to a release of okf-bootstrap.
 *
 * Runs only when someone runs it: no background check, no polling. Run from the project root.
 *
 *   node scripts/okf-update.mts [--apply] [--ref vX.Y.Z] [--source <dir>] [--allow-dirty]
 *
 *   (no flags)     Dry run. Reads files only: prints what would change, writes nothing, and
 *                  runs no code from the release.
 *   --apply        Do it. Runs the release's bootstrap with --tools-only, which refreshes
 *                  scripts/okf-*, and rewrites scripts/.okf-bootstrap.json. Needs a clean git
 *                  tree, so `git diff` is the undo.
 *   --ref vX.Y.Z   The release tag to use (default: the highest vX.Y.Z tag). Tags only; a
 *                  branch such as main is never used.
 *   --source <dir> A local okf-bootstrap checkout instead of a release (for development).
 *   --allow-dirty  Apply on a tree with uncommitted changes.
 *
 * What happens to each generated script (scripts/okf-*.mts and scripts/okf-start.mjs):
 *   unchanged          the same as the release: nothing to do
 *   update             untouched since the last install: replaced by the release's copy
 *   edited             changed here since the last install: kept; the release's copy is
 *                      written beside it as <name>.new, and the manifest keeps the old hash so
 *                      the file stays flagged on the next run
 *   new                in the release, not on disk: created
 *   removed-upstream   installed, but not in the release: reported, never deleted
 *
 * Templates (the okf/ skeleton, the memory bundle, the authoring aids) are never overwritten.
 * A template the release changed (its sha256 differs from the one the manifest recorded at the
 * last install) is listed; --apply writes the release's copy under .okf-update/ for a hand diff.
 *
 * Edited scripts are copied to .okf-update/backup/ before the release's bootstrap runs, and the
 * backup is removed once they are back in place, so an interrupted apply loses nothing.
 *
 * Exit codes: 0 up to date, dry run ok, or applied. 1 --apply could not complete (or the tree
 * is dirty, or an earlier apply left a backup). 2 could not run (no manifest, offline, no git,
 * no such tag or source).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The release repository. Tags are fetched from it; package.json has no repository field.
const REPO_URL = 'https://github.com/jb9k62/okf-bootstrap.git';
const TAG = /^v\d+\.\d+\.\d+$/;
const ASSETS = path.join('skills', 'okf-bootstrap', 'assets');
const MANIFEST = path.join('scripts', '.okf-bootstrap.json');
const UPDATE_DIR = '.okf-update';
const BACKUP_DIR = path.join(UPDATE_DIR, 'backup');
// A manifest key names one file directly in scripts/: nothing else is read or kept from it.
const MANIFEST_KEY = /^scripts\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const USAGE =
  'usage: node scripts/okf-update.mts [--apply] [--ref vX.Y.Z] [--source <dir>] [--dir <project>] [--allow-dirty] [--allow-downgrade]';

// Each template and where bootstrap.mts scaffolds it. The mapping is written out here because
// bootstrap.mts copies these inline, not from a table. Only files that exist in the project are
// reported, so a project without the memory bundle is not asked about it.
const TEMPLATE_MAP: ReadonlyArray<readonly [template: string, dest: string]> = [
  ['okf/index.md', 'okf/index.md'],
  ['okf/log.md', 'okf/log.md'],
  ['okf/adr/readme.md', 'okf/adr/readme.md'],
  ['okf/adr/template.md', 'okf/adr/template.md'],
  ['edukai/index.md', 'edukai/index.md'],
  ['edukai/log.md', 'edukai/log.md'],
  ['concept.md', 'okf-concept-template.md'],
  ['explainer.md', 'okf-explainer-template.md'],
];

class UpdateError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type Status = 'unchanged' | 'update' | 'edited' | 'new' | 'removed-upstream';
interface Row {
  rel: string; // scripts/okf-x.mts, the manifest key
  name: string; // okf-x.mts
  status: Status;
}
interface TemplateRow {
  template: string;
  dest: string;
  differs: boolean;
}
interface Manifest {
  version: string;
  name?: string; // the project name it was scaffolded with, for rendering templates
  files: Record<string, string>;
  // sha256 of each template's source at install time, keyed as in TEMPLATE_MAP. Absent in a
  // manifest written by hand; then a template is compared with the project's file instead.
  templates?: Record<string, string>;
}
interface Source {
  version: string;
  label: string;
  root: string;
  assets: string;
}
interface Args {
  apply: boolean;
  allowDirty: boolean;
  allowDowngrade: boolean;
  ref: string | null;
  source: string | null;
  dir: string | null;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'okf';
}

/** Same placeholder rule as bootstrap.mts, so a release template renders as a fresh scaffold would. */
function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `<${k}>`);
}

/** A template matches a project file when the file is the template with its placeholders filled in. */
function matchesTemplate(template: string, text: string): boolean {
  const pattern = template
    .split(/\{\{\w+\}\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*?');
  return new RegExp(`^${pattern}$`).test(text);
}

function compareVersions(a: string, b: string): number {
  const x = a.replace(/^v/, '').split('.').map(Number);
  const y = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function parseArgs(argv: string[]): Args | null {
  const out: Args = { apply: false, allowDirty: false, allowDowngrade: false, ref: null, source: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--apply') out.apply = true;
    else if (a === '--allow-dirty') out.allowDirty = true;
    else if (a === '--allow-downgrade') out.allowDowngrade = true;
    else if (a === '--ref' || a === '--source' || a === '--dir') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UpdateError(2, `${a} needs a value\n${USAGE}`);
      if (a === '--ref') out.ref = value;
      else if (a === '--dir') out.dir = value;
      else out.source = value;
    } else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return null;
    } else throw new UpdateError(2, `Unknown argument: ${a}\n${USAGE}`);
  }
  if (out.ref !== null && !TAG.test(out.ref)) {
    throw new UpdateError(2, `--ref takes a release tag such as v0.5.0 (got "${out.ref}"). Branches are never used.`);
  }
  if (out.ref !== null && out.source !== null) throw new UpdateError(2, '--ref and --source cannot be combined');
  return out;
}

function stderrOf(e: unknown): string {
  const err = e as { stderr?: string | Buffer; message?: string };
  const text = err.stderr ? String(err.stderr).trim() : '';
  return text || err.message || 'unknown error';
}

function git(args: string[], what: string, cwd?: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (e) {
    throw new UpdateError(2, `${what} failed: ${stderrOf(e)}`);
  }
}

function readManifest(target: string): Manifest {
  const file = path.join(target, MANIFEST);
  if (!fs.existsSync(file)) {
    throw new UpdateError(
      2,
      [
        `No ${MANIFEST} here, so this tool cannot tell which scripts you have edited.`,
        'Run the bootstrap once from the newer skill to create it:',
        `  node <skill>/assets/bootstrap.mts ${target} --tools-only`,
      ].join('\n'),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UpdateError(2, `${MANIFEST} is not valid JSON (${(e as Error).message})`);
  }
  const m = parsed as { version?: unknown; files?: unknown; templates?: unknown } | null;
  const files = m?.files;
  const templates = m?.templates;
  const hashes = (o: unknown) =>
    typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every((h) => typeof h === 'string');
  if (
    typeof m !== 'object' ||
    m === null ||
    typeof m.version !== 'string' ||
    !hashes(files) ||
    (templates !== undefined && !hashes(templates))
  ) {
    throw new UpdateError(2, `${MANIFEST} does not have the shape {"version", "files": {path: sha256}}`);
  }
  const bad = Object.keys(files as object).find((k) => !MANIFEST_KEY.test(k));
  if (bad !== undefined) throw new UpdateError(2, `${MANIFEST} lists "${bad}", which is not a file in scripts/`);
  return {
    version: m.version,
    ...(typeof (m as { name?: unknown }).name === 'string' ? { name: (m as { name: string }).name } : {}),
    files: files as Record<string, string>,
    ...(templates !== undefined ? { templates: templates as Record<string, string> } : {}),
  };
}

/** --apply refuses a tree with changes, so the update can be undone with git. */
function requireCleanTree(target: string): void {
  let status: string;
  try {
    status = git(['status', '--porcelain'], 'git status', target);
  } catch {
    throw new UpdateError(
      2,
      '--apply needs a git repository, so git diff can undo the update. Use --allow-dirty to skip this check.',
    );
  }
  // The previous update's own leftovers (.okf-update/ copies, scripts/*.new) are not changes to
  // protect, and would otherwise block every later --apply until someone deleted them.
  status = status
    .split('\n')
    .filter((line) => !/^\?\? (\.okf-update\/|scripts\/[^/]+\.new$)/.test(line))
    .join('\n');
  if (status.trim() !== '') {
    throw new UpdateError(
      1,
      'The git tree has uncommitted changes. --apply needs a clean tree so `git diff` can undo the update.\n' +
        'Commit or stash them, or pass --allow-dirty.\n' +
        status.trimEnd(),
    );
  }
}

function sourceVersion(assets: string): string {
  const text = fs.readFileSync(path.join(assets, 'bootstrap.mts'), 'utf8');
  const m = text.match(/^const VERSION = '([^']+)'/m);
  if (!m) throw new UpdateError(2, `no VERSION in ${path.join(assets, 'bootstrap.mts')}`);
  return m[1]!;
}

function localSource(dir: string): Source {
  const root = path.resolve(dir);
  const assets = path.join(root, ASSETS);
  if (!fs.existsSync(path.join(assets, 'bootstrap.mts'))) {
    throw new UpdateError(2, `--source ${root} has no ${ASSETS}/bootstrap.mts`);
  }
  return { version: sourceVersion(assets), label: `checkout ${root}`, root, assets };
}

/** Fetches one release tag, shallow, into a fresh temp dir the caller removes. */
function releaseSource(ref: string | null, tmp: { dir: string | null }): Source {
  let tag = ref;
  if (tag === null) {
    const tags = git(['ls-remote', '--tags', '--refs', REPO_URL], `Looking up the release tags of ${REPO_URL}`)
      .split('\n')
      .map((line) => (line.split('\t')[1] ?? '').replace(/^refs\/tags\//, ''))
      .filter((t) => TAG.test(t));
    if (tags.length === 0) throw new UpdateError(2, `No vX.Y.Z release tags found at ${REPO_URL}`);
    tag = tags.sort(compareVersions).at(-1)!;
  }
  tmp.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-update-'));
  const dir = path.join(tmp.dir, 'okf-bootstrap');
  // `clone --branch` would also take a branch of the same name; fetching refs/tags/<tag> cannot.
  fs.mkdirSync(dir);
  git(['init', '--quiet'], 'git init', dir);
  git(['fetch', '--quiet', '--depth', '1', REPO_URL, `refs/tags/${tag}`], `Fetching ${tag}`, dir);
  git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD'], `Checking out ${tag}`, dir);
  const assets = path.join(dir, ASSETS);
  if (!fs.existsSync(path.join(assets, 'bootstrap.mts'))) {
    throw new UpdateError(2, `${tag} has no ${ASSETS}/bootstrap.mts`);
  }
  return { version: sourceVersion(assets), label: `release ${tag}`, root: dir, assets };
}

/** The generated scripts: what bootstrap.mts copies to scripts/ (its TOOLS, okf-update, okf-start). */
function upstreamScripts(assets: string): string[] {
  return fs
    .readdirSync(assets)
    .filter((f) => (/^okf-.*\.mts$/.test(f) || f === 'okf-start.mjs') && fs.statSync(path.join(assets, f)).isFile())
    .sort();
}

function classify(target: string, manifest: Manifest, assets: string): Row[] {
  const names = upstreamScripts(assets);
  const rows: Row[] = [];
  for (const name of names) {
    const rel = `scripts/${name}`;
    const local = path.join(target, rel);
    let status: Status;
    if (!fs.existsSync(local)) status = 'new';
    else {
      const here = sha256(fs.readFileSync(local));
      const upstream = sha256(fs.readFileSync(path.join(assets, name)));
      if (here === upstream) status = 'unchanged';
      else if (manifest.files[rel] === here) status = 'update';
      else status = 'edited';
    }
    rows.push({ rel, name, status });
  }
  for (const rel of Object.keys(manifest.files).sort()) {
    const name = path.posix.basename(rel);
    if (!names.includes(name)) rows.push({ rel, name, status: 'removed-upstream' });
  }
  return rows;
}

/** The sha256 of each template the release ships, keyed as in TEMPLATE_MAP (and in bootstrap.mts). */
function templateHashes(assets: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [template] of TEMPLATE_MAP) {
    const file = path.join(assets, 'templates', template);
    if (fs.existsSync(file)) out[template] = sha256(fs.readFileSync(file));
  }
  return out;
}

/**
 * A template is listed when the release changed it since the last install. Authored files are
 * meant to differ from their template, so they are compared only when the manifest has no
 * template hashes to go by.
 */
function templateRows(target: string, manifest: Manifest, assets: string): TemplateRow[] {
  const out: TemplateRow[] = [];
  const upstreamHashes = templateHashes(assets);
  for (const [template, dest] of TEMPLATE_MAP) {
    const local = path.join(target, dest);
    const upstreamHash = upstreamHashes[template];
    if (!fs.existsSync(local) || upstreamHash === undefined) continue;
    const installed = manifest.templates?.[template];
    const differs =
      installed !== undefined
        ? installed !== upstreamHash
        : !matchesTemplate(fs.readFileSync(path.join(assets, 'templates', template), 'utf8'), fs.readFileSync(local, 'utf8'));
    out.push({ template, dest, differs });
  }
  return out;
}

/** The release's CHANGELOG.md sections after the installed version, up to the release's. */
function changelog(root: string, installed: string, version: string): string {
  const file = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return '';
  const out: string[] = [];
  let keep = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const heading = line.match(/^## (\d+\.\d+\.\d+)\b/);
    if (heading) keep = compareVersions(heading[1]!, installed) > 0 && compareVersions(heading[1]!, version) <= 0;
    else if (/^## /.test(line)) keep = false;
    if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

function report(target: string, installed: string, source: Source, rows: Row[], templates: TemplateRow[], apply: boolean): void {
  const order: Status[] = ['update', 'new', 'edited', 'removed-upstream', 'unchanged'];
  const verb: Record<Status, string> = {
    unchanged: 'unchanged',
    update: apply ? 'updated' : 'would update',
    edited: 'kept (edited here)',
    new: apply ? 'created' : 'would create',
    'removed-upstream': 'not in this release (not deleted)',
  };
  const older = compareVersions(installed, source.version) > 0 ? '  (older than the installed version)' : '';
  console.log(`okf-update: installed ${installed}, ${source.label} is ${source.version}${older}`);
  console.log(`  target: ${target}\n`);
  console.log('Scripts:');
  for (const status of order) {
    for (const row of rows.filter((r) => r.status === status)) {
      let note = '';
      if (status === 'edited') note = `   release copy beside it: ${row.rel}.new`;
      console.log(`  ${verb[status].padEnd(34)} ${row.rel}${note}`);
    }
  }
  const changed = templates.filter((t) => t.differs);
  if (changed.length) {
    console.log('\nTemplates (changed in the release; your files are never overwritten):');
    for (const t of changed) {
      const copy = path.posix.join(UPDATE_DIR, t.dest);
      console.log(`  ${apply ? 'hand diff' : 'would write'} ${copy}   vs ${t.dest}`);
    }
    console.log('  The release changed these templates; your files are yours, so merge by hand if useful.');
  }
  const notes = changelog(source.root, installed, source.version);
  if (notes) console.log(`\nChangelog (${source.label}):\n${notes}`);
}

/** Writes the release's copy beside an edited script, and the release's template copies, on --apply. */
function applyUpdate(target: string, manifest: Manifest, source: Source, rows: Row[], templates: TemplateRow[]): void {
  const bootstrap = path.join(source.assets, 'bootstrap.mts');
  const edited = rows.filter((r) => r.status === 'edited');
  // The release's bootstrap overwrites every generated script, so edited ones are copied to disk
  // first: if this process dies before they are put back, the backup is still there.
  const backup = path.join(target, BACKUP_DIR);
  for (const row of edited) {
    const dest = path.join(backup, row.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(target, row.rel), dest);
  }
  const restore = () => {
    for (const row of edited) fs.copyFileSync(path.join(backup, row.rel), path.join(target, row.rel));
  };

  // No --edukai or --widgets: the bootstrap finds both from what the project has, and --edukai
  // would put back an AGENTS.md snippet someone removed.
  console.log(`\nApplying ${source.label} (runs its bootstrap.mts with --tools-only).`);
  try {
    execFileSync(process.execPath, [bootstrap, target, '--tools-only'], {
      cwd: target,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    restore();
    fs.rmSync(backup, { recursive: true, force: true });
    throw new UpdateError(
      1,
      `apply could not complete: the release's bootstrap failed: ${stderrOf(e)}\n` +
        'Edited scripts were restored. `git status` shows what else changed; `git checkout -- scripts` undoes it.',
    );
  }

  // The local bytes back where they were, the release copy beside each, then the backup goes.
  restore();
  for (const row of edited) {
    fs.writeFileSync(path.join(target, `${row.rel}.new`), fs.readFileSync(path.join(source.assets, row.name)));
  }
  fs.rmSync(backup, { recursive: true, force: true });

  // The manifest. A release that writes one (with its own version) is the base, since it knows
  // what its bootstrap generated; an older release does not, so the rows are. On top of that, an
  // edited script keeps its old hash so it stays flagged, and a removed script that is still on
  // disk stays listed with its hash.
  let base: Manifest | null = null;
  try {
    const written = readManifest(target);
    if (written.version === source.version) base = written;
  } catch {
    base = null;
  }
  const files: Record<string, string> = { ...(base?.files ?? {}) };
  for (const row of rows) {
    const local = path.join(target, row.rel);
    delete files[row.rel];
    if (row.status === 'removed-upstream' || row.status === 'edited') {
      if (fs.existsSync(local) && manifest.files[row.rel] !== undefined) files[row.rel] = manifest.files[row.rel]!;
    } else if (fs.existsSync(local)) {
      files[row.rel] = sha256(fs.readFileSync(local));
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const installedTemplates = base?.templates ?? templateHashes(source.assets);
  fs.writeFileSync(
    path.join(target, MANIFEST),
    JSON.stringify({ version: source.version, ...(manifest.name !== undefined ? { name: manifest.name } : {}), files: sorted, templates: installedTemplates }, null, 2) + '\n',
  );

  // The release's copy of each template that differs, for a hand diff. The authored file is untouched.
  const vars: Record<string, string> = {
    PROJECT_NAME: manifest.name ?? path.basename(target),
    PROJECT_SLUG: kebab(manifest.name ?? path.basename(target)),
    TODAY: new Date().toISOString().slice(0, 10),
    NOW: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    VERSION: source.version,
  };
  for (const t of templates.filter((x) => x.differs)) {
    const dest = path.join(target, UPDATE_DIR, t.dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, render(fs.readFileSync(path.join(source.assets, 'templates', t.template), 'utf8'), vars));
  }

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  console.log(`\nDone: ${source.version}. Updated ${count('update')}, created ${count('new')}, kept ${edited.length} edited.`);
  for (const row of edited) console.log(`  edited, kept: ${row.rel}  (release copy: ${row.rel}.new)`);
  for (const row of rows.filter((r) => r.status === 'removed-upstream')) console.log(`  not deleted: ${row.rel}`);
  if (templates.some((t) => t.differs)) console.log(`  template copies for a hand diff: ${UPDATE_DIR}/`);
  console.log('\nNext: npm run okf:validate, then review the changes (git diff) and commit.');
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args === null) return 0;
  const target = path.resolve(args.dir ?? process.cwd());
  const manifest = readManifest(target);
  if (args.apply && !args.allowDirty) requireCleanTree(target);
  if (args.apply && fs.existsSync(path.join(target, BACKUP_DIR))) {
    throw new UpdateError(
      1,
      `${BACKUP_DIR}/ is left from an apply that did not finish: it holds the scripts you edited.\n` +
        'Copy them back into scripts/ if they are not there, then delete it and run again.',
    );
  }

  const tmp: { dir: string | null } = { dir: null };
  try {
    const source = args.source !== null ? localSource(args.source) : releaseSource(args.ref, tmp);
    const rows = classify(target, manifest, source.assets);
    const templates = templateRows(target, manifest, source.assets);
    const upToDate =
      manifest.version === source.version && rows.every((r) => r.status === 'unchanged');
    if (upToDate) {
      console.log(`up to date: ${manifest.version}, the same as ${source.label}`);
      return 0;
    }
    report(target, manifest.version, source, rows, templates, args.apply);
    if (args.apply && !args.allowDowngrade && compareVersions(manifest.version, source.version) > 0) {
      throw new UpdateError(
        1,
        `${source.label} (${source.version}) is older than the installed ${manifest.version}. Pass --allow-downgrade if that is what you want.`,
      );
    }
    if (!args.apply) {
      console.log('\nDry run: nothing was written. Run again with --apply to update.');
      return 0;
    }
    try {
      applyUpdate(target, manifest, source, rows, templates);
    } catch (e) {
      if (e instanceof UpdateError) throw e;
      throw new UpdateError(1, `apply could not complete: ${(e as Error).message}`);
    }
    return 0;
  } finally {
    if (tmp.dir !== null) fs.rmSync(tmp.dir, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UpdateError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    console.error(`okf-update could not run: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}
