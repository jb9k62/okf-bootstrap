#!/usr/bin/env node
/**
 * Keep the vendored OKF spec in step with Google's upstream, and help migrate when it moves.
 *
 * The spec is okf/SPEC.md in GoogleCloudPlatform/knowledge-catalog. It reaches this repo two
 * ways, on purpose:
 *   vendor/knowledge-catalog/            a shallow git submodule, pinned to one upstream commit
 *                                        (for maintainers: the pin is visible in git history)
 *   skills/okf-bootstrap/references/okf-spec/
 *                                        SPEC.md + LICENSE.md + UPSTREAM.json, copied from that
 *                                        commit, because installs (pi install git:..., Claude
 *                                        Code plugins, plain clones) do not fetch submodules,
 *                                        and the skill must always be able to read the spec.
 *
 * Usage (from the repo root, or npm run spec -- <command>):
 *   node scripts/okf-spec.mts status            pinned commit vs upstream main; no changes made.
 *                                               exit 0 up to date, 1 the spec moved upstream,
 *                                               2 could not check (offline)
 *   node scripts/okf-spec.mts update [--ref R]  move the submodule to R (default: main), copy the
 *                        [--dry-run]            spec into the skill, write UPSTREAM.json, and
 *                                               print what changed. When the spec's version
 *                                               changed, also print a migration checklist.
 *                                               --dry-run reports without changing anything.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/GoogleCloudPlatform/knowledge-catalog';
const RAW = 'https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog';
const SPEC_PATH = 'okf/SPEC.md';
const LICENSE_PATH = 'okf/LICENSE.md';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUBMODULE = path.join(ROOT, 'vendor', 'knowledge-catalog');
const DEST = path.join(ROOT, 'skills', 'okf-bootstrap', 'references', 'okf-spec');
const UPSTREAM_FILE = path.join(DEST, 'UPSTREAM.json');

interface Upstream {
  repo: string;
  path: string;
  commit: string;
  committed_at: string;
  version: string;
  synced_at: string;
}

function git(args: string[], cwd = ROOT): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout.trim();
}

function specVersion(spec: string): string {
  return spec.match(/\*\*Version (\d+(?:\.\d+)*)\b/)?.[1] ?? 'unknown';
}

function readPinned(): Upstream | null {
  try {
    return JSON.parse(fs.readFileSync(UPSTREAM_FILE, 'utf8')) as Upstream;
  } catch {
    return null;
  }
}

function readVendoredSpec(): string {
  try {
    return fs.readFileSync(path.join(DEST, 'SPEC.md'), 'utf8');
  } catch {
    return '';
  }
}

async function status(): Promise<number> {
  const pinned = readPinned();
  let head: string;
  try {
    head = git(['ls-remote', REPO, 'refs/heads/main']).split(/\s/)[0] ?? '';
  } catch (e) {
    console.error(`Could not reach ${REPO}: ${(e as Error).message}`);
    return 2;
  }
  console.log(`OKF spec: ${REPO}/blob/main/${SPEC_PATH}`);
  console.log(`  pinned   : ${pinned ? `${pinned.commit.slice(0, 12)} (v${pinned.version}, ${pinned.committed_at})` : 'none'}`);
  console.log(`  upstream : ${head.slice(0, 12)} (main)`);
  if (pinned?.commit === head) {
    console.log('  ✓ up to date');
    return 0;
  }
  // The repo moves for many reasons; only a change to the spec itself matters here.
  const res = await fetch(`${RAW}/${head}/${SPEC_PATH}`).catch(() => null);
  if (!res?.ok) {
    console.error(`  could not fetch ${SPEC_PATH} at ${head.slice(0, 12)}`);
    return 2;
  }
  const latest = await res.text();
  if (latest === readVendoredSpec()) {
    console.log('  ✓ the spec is unchanged (other files moved upstream); update only to move the pin');
    return 0;
  }
  const from = pinned?.version ?? 'unknown';
  const to = specVersion(latest);
  console.log(
    from === to
      ? `  ✗ SPEC.md changed upstream (still v${to}). Run: npm run spec -- update`
      : `  ✗ new spec version upstream: v${from} -> v${to}. Run: npm run spec -- update`,
  );
  return 1;
}

function ensureSubmodule(): void {
  if (fs.existsSync(path.join(SUBMODULE, '.git'))) return;
  console.log('Initialising the vendor/knowledge-catalog submodule (shallow)...');
  git(['submodule', 'update', '--init', '--depth', '1', '--', path.relative(ROOT, SUBMODULE)]);
}

/** Files in this repo that name the old version, so a migration does not miss one. */
function mentionsOf(version: string): string[] {
  const escaped = version.replace(/\./g, '\\.');
  const pattern = new RegExp(
    `(OKF_VERSION = '${escaped}'|okf_version: "${escaped}"|OKF v${escaped}|v${escaped}\\b|OKF ${escaped})`,
  );
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'vendor', 'okf-spec', '.cache'].includes(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|mts|ts|tsx|json)$/.test(entry.name)) {
        fs.readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (pattern.test(line)) hits.push(`${path.relative(ROOT, full)}:${i + 1}: ${line.trim()}`);
          });
      }
    }
  };
  walk(ROOT);
  return hits;
}

function update(ref: string, dryRun: boolean): number {
  ensureSubmodule();
  git(['fetch', '--depth', '1', 'origin', ref], SUBMODULE);
  const commit = git(['rev-parse', 'FETCH_HEAD'], SUBMODULE);
  const committedAt = git(['show', '-s', '--format=%cI', 'FETCH_HEAD'], SUBMODULE);
  const spec = git(['show', `FETCH_HEAD:${SPEC_PATH}`], SUBMODULE) + '\n';
  const pinned = readPinned();
  const oldSpec = readVendoredSpec();
  const from = pinned?.version ?? specVersion(oldSpec);
  const to = specVersion(spec);

  console.log(`OKF spec at ${commit.slice(0, 12)} (${committedAt}): v${to}`);
  if (spec === oldSpec) {
    console.log('  SPEC.md is unchanged.');
  } else {
    const oldLines = new Set(oldSpec.split('\n'));
    const newLines = new Set(spec.split('\n'));
    const added = [...newLines].filter((l) => !oldLines.has(l)).length;
    const removed = [...oldLines].filter((l) => !newLines.has(l)).length;
    console.log(`  SPEC.md changed: ~${added} lines added, ~${removed} removed.`);
    console.log(`  Full diff: git -C vendor/knowledge-catalog diff ${pinned?.commit.slice(0, 12) ?? '<old>'} ${commit.slice(0, 12)} -- ${SPEC_PATH}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing changed.');
  } else {
    git(['checkout', '--quiet', '--detach', commit], SUBMODULE);
    fs.mkdirSync(DEST, { recursive: true });
    fs.writeFileSync(path.join(DEST, 'SPEC.md'), spec);
    fs.writeFileSync(
      path.join(DEST, 'LICENSE.md'),
      git(['show', `FETCH_HEAD:${LICENSE_PATH}`], SUBMODULE) + '\n',
    );
    const upstream: Upstream = {
      repo: REPO,
      path: SPEC_PATH,
      commit,
      committed_at: committedAt,
      version: to,
      synced_at: new Date().toISOString().slice(0, 10),
    };
    fs.writeFileSync(UPSTREAM_FILE, JSON.stringify(upstream, null, 2) + '\n');
    console.log(`\nVendored SPEC.md, LICENSE.md and UPSTREAM.json into ${path.relative(ROOT, DEST)}/`);
    console.log('Commit the pin and the copy together:');
    console.log(`  git add vendor/knowledge-catalog ${path.relative(ROOT, DEST)}`);
  }

  // A first vendoring has no old version to migrate from.
  if (oldSpec !== '' && from !== to) {
    const changes = spec.match(new RegExp(`^## .*Changes from v?${from.replace(/\./g, '\\.')}.*$`, 'm'));
    console.log(`\nMigration checklist: v${from} -> v${to}`);
    console.log(
      `  1. Read ${changes ? `"${changes[0].replace(/^## /, '')}"` : 'the "Changes from" section'} in the new SPEC.md,`,
    );
    console.log('     and the versioning rules (a major bump may rename required fields).');
    console.log(`  2. Update the tools: OKF_VERSION in okf-view.mts, and any rule the changes touch`);
    console.log('     (reserved files, required frontmatter, trust tiers, link resolution).');
    console.log('  3. Update the templates (okf_version in templates/okf/index.md), SKILL.md, PLAYBOOK.md');
    console.log('     and the demo bundle. Files that name the old version:');
    const hits = mentionsOf(from);
    for (const hit of hits) console.log(`       ${hit}`);
    if (!hits.length) console.log('       (none found)');
    console.log('  4. npm run check, bump the package version, and note the change in CHANGELOG.md.');
    console.log('  5. Projects then run the skill with --tools-only and follow the playbook\'s');
    console.log('     "Moving a bundle to a new OKF version" section.');
  }
  return 0;
}

const [command = 'status', ...rest] = process.argv.slice(2);
const refIndex = rest.indexOf('--ref');
const ref = refIndex >= 0 ? rest[refIndex + 1] ?? 'main' : 'main';
if (command === 'status') process.exit(await status());
else if (command === 'update') {
  try {
    process.exit(update(ref, rest.includes('--dry-run')));
  } catch (e) {
    // GitHub serves a fetch by full commit hash, or by branch or tag name, but not by a short hash.
    console.error((e as Error).message);
    if (/^[0-9a-f]{4,39}$/.test(ref)) console.error(`  hint: --ref needs the full 40-character commit hash, not ${ref}`);
    process.exit(2);
  }
}
else {
  console.error('usage: okf-spec.mts status | update [--ref <commit|branch>] [--dry-run]');
  process.exit(2);
}
