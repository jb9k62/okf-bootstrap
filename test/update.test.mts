/**
 * okf-update, end to end, offline: a throwaway project scaffolded by bootstrap.mts and committed,
 * and a "release" that is a copy of this repo's assets with a higher VERSION, given with --source.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'okf-bootstrap');
const ASSETS = path.join(SKILL, 'assets');
const BOOTSTRAP = path.join(ASSETS, 'bootstrap.mts');
const CACHE = path.join(ROOT, '.cache', 'test');
fs.mkdirSync(CACHE, { recursive: true });
const scratch = fs.mkdtempSync(path.join(CACHE, 'update-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const read = (file: string) => fs.readFileSync(file, 'utf8');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const manifestOf = (dir: string) => JSON.parse(read(path.join(dir, 'scripts', '.okf-bootstrap.json')));
const pkgScripts = (dir: string) => JSON.parse(read(path.join(dir, 'package.json'))).scripts ?? {};

function run(file: string, args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** A committed project, scaffolded by this repo's bootstrap. */
function scaffold(name: string): string {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, scripts: {} }, null, 2));
  const r = run(BOOTSTRAP, [dir, '--name', name], ROOT);
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(path.join(dir, 'scripts', 'okf-update.mts')), 'bootstrap copies okf-update');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'scaffold');
  return dir;
}

/** A "release": this repo's assets with a higher VERSION, optionally edited by `edit`. */
function release(name: string, edit?: (assets: string) => void): string {
  const root = path.join(scratch, name);
  const assets = path.join(root, 'skills', 'okf-bootstrap', 'assets');
  fs.cpSync(ASSETS, assets, {
    recursive: true,
    filter: (from) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(from),
  });
  const bs = path.join(assets, 'bootstrap.mts');
  fs.writeFileSync(bs, read(bs).replace(/const VERSION = '[^']+'/, "const VERSION = '9.9.9'"));
  edit?.(assets);
  return root;
}

/** Every file in the project except .git, by path. Used to show that a dry run writes nothing. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    if (rel === '.git' || rel.startsWith('.git' + path.sep)) continue;
    const abs = path.join(dir, rel);
    if (fs.statSync(abs).isFile()) out.set(rel, read(abs));
  }
  return out;
}

const update = (dir: string, args: string[]) => run(path.join(dir, 'scripts', 'okf-update.mts'), args, dir);

describe('okf-update', () => {
  it('dry run reports the changes and writes nothing', () => {
    const dir = scaffold('dry-run');
    const src = release('dry-run-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release change\n'),
    );
    const before = snapshot(dir);
    const r = update(dir, ['--source', src]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /would update\s+scripts\/okf-view\.mts/);
    assert.match(r.out, /Dry run: nothing was written/);
    assert.deepEqual(snapshot(dir), before, 'no file added, changed or removed');
    assert.ok(!fs.existsSync(path.join(dir, '.okf-update')));
  });

  it('says up to date when the release is the installed version', () => {
    const dir = scaffold('up-to-date');
    const r = update(dir, ['--source', ROOT]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^up to date/m);
  });

  it('replaces an untouched script on --apply, and records the new version and hashes', () => {
    const dir = scaffold('apply-update');
    const src = release('apply-update-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release change\n'),
    );
    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Next: npm run okf:validate/);
    const upstream = read(path.join(src, 'skills', 'okf-bootstrap', 'assets', 'okf-view.mts'));
    assert.equal(read(path.join(dir, 'scripts', 'okf-view.mts')), upstream);
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'okf-view.mts.new')), 'no .new for an untouched script');
    const manifest = manifestOf(dir);
    assert.equal(manifest.version, '9.9.9');
    assert.equal(manifest.files['scripts/okf-view.mts'], sha(upstream));
    assert.equal(manifest.files['scripts/okf-update.mts'], sha(read(path.join(ASSETS, 'okf-update.mts'))));
  });

  it('keeps an edited script, writes the release copy as .new, and keeps the old hash', () => {
    const dir = scaffold('edited');
    const oldHash = manifestOf(dir).files['scripts/okf-view.mts'];
    fs.appendFileSync(path.join(dir, 'scripts', 'okf-view.mts'), '// my local edit\n');
    git(dir, 'commit', '-q', '-am', 'local edit');
    const src = release('edited-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release change\n'));

    const dry = update(dir, ['--source', src]);
    assert.match(dry.out, /kept \(edited here\)\s+scripts\/okf-view\.mts/);

    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 0, r.out);
    const local = read(path.join(dir, 'scripts', 'okf-view.mts'));
    assert.match(local, /my local edit/);
    assert.doesNotMatch(local, /release change/);
    const upstream = read(path.join(src, 'skills', 'okf-bootstrap', 'assets', 'okf-view.mts'));
    assert.equal(read(path.join(dir, 'scripts', 'okf-view.mts.new')), upstream);
    assert.equal(manifestOf(dir).files['scripts/okf-view.mts'], oldHash, 'old hash, so it stays flagged');
    assert.ok(!fs.existsSync(path.join(dir, '.okf-update', 'backup')), 'backup removed once restored');

    // Still flagged on the next run: the local file is neither the old release nor the new one.
    const again = update(dir, ['--source', src]);
    assert.match(again.out, /kept \(edited here\)\s+scripts\/okf-view\.mts/);
  });

  it('refuses --apply on a dirty tree (exit 1), and --allow-dirty applies', () => {
    const dir = scaffold('dirty');
    const src = release('dirty-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'uncommitted\n');
    const before = snapshot(dir);
    const refused = update(dir, ['--source', src, '--apply']);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /uncommitted changes/);
    assert.deepEqual(snapshot(dir), before, 'nothing written when refused');

    const allowed = update(dir, ['--source', src, '--apply', '--allow-dirty']);
    assert.equal(allowed.code, 0, allowed.out);
    assert.match(read(path.join(dir, 'scripts', 'okf-view.mts')), /release/);
  });

  it('exits 2 with a pointer to bootstrap when the manifest is missing', () => {
    const dir = scaffold('no-manifest');
    fs.rmSync(path.join(dir, 'scripts', '.okf-bootstrap.json'));
    const src = release('no-manifest-src');
    const r = update(dir, ['--source', src]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /--tools-only/);
  });

  it('reports a script removed upstream, and never deletes it', () => {
    const dir = scaffold('removed');
    const retired = '// an old tool no release ships any more\n';
    fs.writeFileSync(path.join(dir, 'scripts', 'okf-retired.mts'), retired);
    const manifest = manifestOf(dir);
    manifest.files['scripts/okf-retired.mts'] = sha(retired);
    fs.writeFileSync(path.join(dir, 'scripts', '.okf-bootstrap.json'), JSON.stringify(manifest, null, 2) + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'retired tool');
    const src = release('removed-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));

    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not in this release \(not deleted\)\s+scripts\/okf-retired\.mts/);
    assert.equal(read(path.join(dir, 'scripts', 'okf-retired.mts')), retired);
    assert.equal(manifestOf(dir).files['scripts/okf-retired.mts'], sha(retired));
  });

  it('restores edited scripts when the release bootstrap fails, and exits 1', () => {
    const dir = scaffold('bootstrap-fails');
    fs.appendFileSync(path.join(dir, 'scripts', 'okf-view.mts'), '// my local edit\n');
    git(dir, 'commit', '-q', '-am', 'local edit');
    const edited = read(path.join(dir, 'scripts', 'okf-view.mts'));
    const src = release('bootstrap-fails-src', (assets) => {
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n');
      // Copies the scripts (overwriting the edit), then fails.
      const bs = path.join(assets, 'bootstrap.mts');
      fs.appendFileSync(bs, "\nthrow new Error('release bootstrap broke');\n");
    });
    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /release bootstrap broke/);
    assert.equal(read(path.join(dir, 'scripts', 'okf-view.mts')), edited);
    assert.ok(!fs.existsSync(path.join(dir, '.okf-update', 'backup')));
  });

  it('refuses --apply while a backup from an unfinished apply is there (exit 1)', () => {
    const dir = scaffold('leftover-backup');
    const src = release('leftover-backup-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));
    const kept = path.join(dir, '.okf-update', 'backup', 'scripts', 'okf-view.mts');
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.writeFileSync(kept, '// the only copy of an edit\n');
    const r = update(dir, ['--source', src, '--apply', '--allow-dirty']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /did not finish/);
    assert.equal(read(kept), '// the only copy of an edit\n');
    assert.doesNotMatch(read(path.join(dir, 'scripts', 'okf-view.mts')), /release/);
  });

  it('exits 2 on a manifest key outside scripts/', () => {
    const dir = scaffold('bad-key');
    const manifest = manifestOf(dir);
    manifest.files['scripts/../../outside.mts'] = sha('x');
    fs.writeFileSync(path.join(dir, 'scripts', '.okf-bootstrap.json'), JSON.stringify(manifest));
    const r = update(dir, ['--source', release('bad-key-src')]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /not a file in scripts/);
  });

  it('does not put back an AGENTS.md snippet someone removed', () => {
    const dir = path.join(scratch, 'edukai');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'edukai', private: true }));
    assert.equal(run(BOOTSTRAP, [dir, '--edukai'], ROOT).code, 0);
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# AGENTS.md\n\nOurs.\n');
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'scaffold');
    const src = release('edukai-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));
    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 0, r.out);
    assert.equal(read(path.join(dir, 'AGENTS.md')), '# AGENTS.md\n\nOurs.\n');
    assert.ok(pkgScripts(dir)['edukai:index'], 'edukai scripts still there');
  });

  it('lists only templates the release changed, not authored files that differ', () => {
    const dir = scaffold('authored');
    fs.appendFileSync(path.join(dir, 'okf', 'index.md'), '\n- a concept I wrote\n');
    git(dir, 'commit', '-q', '-am', 'authored');
    const src = release('authored-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));
    const r = update(dir, ['--source', src]);
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /Templates/);
  });

  it('prints the release changelog after the installed version', () => {
    const dir = scaffold('changelog');
    const src = release('changelog-src', (assets) => fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release\n'));
    fs.writeFileSync(
      path.join(src, 'CHANGELOG.md'),
      '# Changelog\n\n## 9.9.9 - 2026-11-01\n\n- the new thing\n\n## 0.6.0 - 2026-10-08\n\n- an old thing\n',
    );
    const r = update(dir, ['--source', src]);
    assert.match(r.out, /the new thing/);
    assert.doesNotMatch(r.out, /an old thing/);
  });

  it('writes a changed template under .okf-update/ and never touches the authored file', () => {
    const dir = scaffold('template');
    const log = read(path.join(dir, 'okf', 'log.md'));
    const src = release('template-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'templates', 'okf', 'log.md'), '\nrelease note line\n'),
    );
    const dry = update(dir, ['--source', src]);
    assert.match(dry.out, /would write \.okf-update\/okf\/log\.md/);
    assert.ok(!fs.existsSync(path.join(dir, '.okf-update')), 'dry run writes no hand-diff copy');

    const r = update(dir, ['--source', src, '--apply']);
    assert.equal(r.code, 0, r.out);
    assert.match(read(path.join(dir, '.okf-update', 'okf', 'log.md')), /release note line/);
    assert.equal(read(path.join(dir, 'okf', 'log.md')), log, 'authored file untouched');
    assert.ok(!fs.existsSync(path.join(dir, '.okf-update', 'okf', 'index.md')), 'only the changed template');
    const templateHash = sha(read(path.join(src, 'skills', 'okf-bootstrap', 'assets', 'templates', 'okf', 'log.md')));
    assert.equal(manifestOf(dir).templates['okf/log.md'], templateHash, 'the release template is now the installed one');
  });

  it("does not count its own leftovers (.okf-update/, scripts/*.new) as a dirty tree", () => {
    const dir = scaffold('leftovers');
    fs.appendFileSync(path.join(dir, 'scripts', 'okf-view.mts'), '// my edit\n');
    git(dir, 'commit', '-qam', 'edit');
    const src = release('leftovers-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release change\n'),
    );
    assert.equal(update(dir, ['--source', src, '--apply']).code, 0);
    assert.ok(fs.existsSync(path.join(dir, 'scripts', 'okf-view.mts.new')));
    git(dir, 'add', '-A');
    git(dir, 'reset', '-q', '--', 'scripts/okf-view.mts.new');
    git(dir, 'commit', '-qm', 'update');
    const again = update(dir, ['--source', src, '--apply']);
    assert.equal(again.code, 0, again.out);
  });

  it('refuses an older release unless --allow-downgrade', () => {
    const dir = scaffold('downgrade');
    const src = release('downgrade-src', (assets) => {
      const bs = path.join(assets, 'bootstrap.mts');
      fs.writeFileSync(bs, read(bs).replace(/const VERSION = '[^']+'/, "const VERSION = '0.0.1'"));
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// older\n');
    });
    const refused = update(dir, ['--source', src, '--apply']);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /--allow-downgrade/);
    assert.equal(update(dir, ['--source', src, '--apply', '--allow-downgrade']).code, 0);
  });

  it('works on another directory with --dir', () => {
    const dir = scaffold('dir-flag');
    const r = run(path.join(dir, 'scripts', 'okf-update.mts'), ['--dir', dir, '--source', ROOT], scratch);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^up to date/m);
  });

  it('renders template copies with the project name it was scaffolded with, not the folder name', () => {
    const dir = path.join(scratch, 'named-folder');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', private: true, scripts: {} }));
    assert.equal(run(BOOTSTRAP, [dir, '--name', 'Fancy Name'], ROOT).code, 0);
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'scaffold');
    const src = release('named-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'templates', 'okf', 'log.md'), '\nFor {{PROJECT_NAME}}\n'),
    );
    assert.equal(update(dir, ['--source', src, '--apply']).code, 0);
    assert.match(read(path.join(dir, '.okf-update', 'okf', 'log.md')), /For Fancy Name/);
    assert.equal(manifestOf(dir).name, 'Fancy Name');
  });

  it('does not bring back an authoring template that was deleted', () => {
    const dir = scaffold('deleted-aid');
    fs.rmSync(path.join(dir, 'okf-concept-template.md'));
    git(dir, 'commit', '-qam', 'drop aid');
    const src = release('deleted-aid-src', (assets) =>
      fs.appendFileSync(path.join(assets, 'okf-view.mts'), '// release change\n'),
    );
    assert.equal(update(dir, ['--source', src, '--apply']).code, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'okf-concept-template.md')));
  });

  it('refuses a branch as --ref, and --ref with --source', () => {
    const dir = scaffold('refs');
    const src = release('refs-src');
    const branch = update(dir, ['--ref', 'main']);
    assert.equal(branch.code, 2, branch.out);
    assert.match(branch.out, /Branches are never used/);
    const both = update(dir, ['--ref', 'v0.6.0', '--source', src]);
    assert.equal(both.code, 2, both.out);
  });
});

describe('okf-update invariants', () => {
  it('imports only node built-ins, so it runs in a project with nothing installed', () => {
    const specs = [...read(path.join(ASSETS, 'okf-update.mts')).matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    assert.ok(specs.length > 0);
    for (const spec of specs) assert.match(spec!, /^node:/, `non-builtin import ${spec}`);
  });

  it('is in the generated list the bootstrap ships, under the npm script the bootstrap writes', () => {
    assert.match(read(BOOTSTRAP), /const UPDATE_TOOL = 'okf-update'/);
    assert.match(read(BOOTSTRAP), /'okf:update'\] = 'node --import \.\/scripts\/okf-start\.mjs scripts\/okf-update\.mts'/);
  });
});
