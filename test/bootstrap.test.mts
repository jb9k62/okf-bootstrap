/**
 * The scaffold and the validator, end to end, on throwaway projects under .cache/ (inside the
 * repo, so the copied tools resolve `yaml` from this repo's node_modules).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'okf-bootstrap');
const BOOTSTRAP = path.join(SKILL, 'assets', 'bootstrap.mts');
const CACHE = path.join(ROOT, '.cache', 'test');
fs.mkdirSync(CACHE, { recursive: true });
const scratch = fs.mkdtempSync(path.join(CACHE, 'bootstrap-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function project(name: string, pkg: object | null = { name, private: true }): string {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return dir;
}

function run(file: string, args: string[], cwd = ROOT) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const pkgOf = (dir: string) => JSON.parse(read(path.join(dir, 'package.json')));

describe('bootstrap', () => {
  it('scaffolds a bundle that validates clean with the copied tools', () => {
    const dir = project('plain');
    const r = run(BOOTSTRAP, [dir, '--name', 'Plain App']);
    assert.equal(r.code, 0, r.out);
    for (const file of [
      'okf/index.md',
      'okf/log.md',
      'okf/adr/readme.md',
      'okf/adr/template.md',
      'okf/plain-app/.gitkeep',
      'scripts/okf-view.mts',
      'scripts/okf-mermaid.mts',
      'okf-concept-template.md',
      'okf-explainer-template.md',
    ]) {
      assert.ok(fs.existsSync(path.join(dir, file)), `missing ${file}`);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'packages')), 'no widgets without --widgets');
    const pkg = pkgOf(dir);
    assert.equal(pkg.scripts['okf:view'], 'node scripts/okf-view.mts okf');
    assert.equal(pkg.scripts['okf:widgets:build'], undefined);
    assert.ok(pkg.devDependencies.yaml);
    assert.equal(pkg.type, undefined, 'the tools are .mts; package.json "type" stays alone');

    const v = run(path.join(dir, 'scripts', 'okf-view.mts'), ['okf', '--validate', '--strict'], dir);
    assert.equal(v.code, 0, v.out);
    assert.match(v.out, /issues\s+: 0/);
    assert.match(read(path.join(dir, 'okf', 'index.md')), /^# Plain App$/m);
    // Scaffolded timestamps follow SPEC §5 (datetime with offset), or validate above would fail.
    assert.match(read(path.join(dir, 'okf', 'adr', 'readme.md')), /at: \d{4}-\d{2}-\d{2}T[\d:]+Z/);
  });

  it('keeps authored files on a re-run, and --force replaces them', () => {
    const dir = project('rerun');
    run(BOOTSTRAP, [dir]);
    const log = path.join(dir, 'okf', 'log.md');
    fs.writeFileSync(log, '# Update log\n\n## 2026-01-01\n\n- history\n');
    const again = run(BOOTSTRAP, [dir]);
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /Kept[\s\S]*okf\/log\.md/);
    assert.match(read(log), /history/);
    run(BOOTSTRAP, [dir, '--force']);
    assert.doesNotMatch(read(log), /history/);
  });

  it('replaces legacy .mjs tools and rewires the scripts', () => {
    const dir = project('legacy', {
      name: 'legacy',
      scripts: { 'okf:view': 'node scripts/okf-view.mjs okf' },
    });
    fs.mkdirSync(path.join(dir, 'okf'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'okf-view.mjs'), '// old');
    const r = run(BOOTSTRAP, [dir, '--tools-only']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!fs.existsSync(path.join(dir, 'scripts', 'okf-view.mjs')));
    assert.match(r.out, /Removed[\s\S]*scripts\/okf-view\.mjs/);
    assert.equal(pkgOf(dir).scripts['okf:view'], 'node scripts/okf-view.mts okf');
    assert.ok(!fs.existsSync(path.join(dir, 'okf', 'index.md')), '--tools-only leaves okf/ alone');
  });

  it('refuses --tools-only without a bundle', () => {
    const r = run(BOOTSTRAP, [project('empty'), '--tools-only']);
    assert.equal(r.code, 2);
  });

  it('scaffolds the widget package as a workspace, and never replaces it', () => {
    const dir = project('widgets', { name: 'widgets', workspaces: ['apps/*'] });
    const r = run(BOOTSTRAP, [dir, '--widgets']);
    assert.equal(r.code, 0, r.out);
    const widgets = path.join(dir, 'packages', 'okf-widgets');
    for (const file of ['package.json', 'src/index.tsx', 'src/kit.tsx', 'README.md', 'vite.config.ts']) {
      assert.ok(fs.existsSync(path.join(widgets, file)), `missing ${file}`);
    }
    assert.ok(!fs.existsSync(path.join(widgets, 'node_modules')), 'no node_modules copied');
    assert.ok(!fs.existsSync(path.join(widgets, 'dist')), 'no build output copied');
    const pkg = pkgOf(dir);
    assert.deepEqual(pkg.workspaces, ['apps/*', 'packages/okf-widgets']);
    assert.equal(pkg.scripts['okf:view'], 'npm run okf:widgets:build && node scripts/okf-view.mts okf');
    assert.equal(pkg.scripts['okf:widgets:build'], 'npm run build -w okf-widgets');

    fs.writeFileSync(path.join(widgets, 'src', 'mine.ts'), 'export {};\n');
    const again = run(BOOTSTRAP, [dir, '--widgets', '--force']);
    assert.equal(again.code, 0, again.out);
    assert.ok(fs.existsSync(path.join(widgets, 'src', 'mine.ts')), 'project widgets survive --force');
    assert.deepEqual(pkgOf(dir).workspaces, ['apps/*', 'packages/okf-widgets'], 'no duplicate entry');
  });
});

describe('okf-view validation', () => {
  const VIEW = path.join(SKILL, 'assets', 'okf-view.mts');

  function bundle(name: string, files: Record<string, string>): string {
    const dir = path.join(scratch, name);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  }

  it('reports a missing type, a dangling link and a date-only timestamp', () => {
    const dir = bundle('issues', {
      'index.md': '---\nokf_version: "0.2"\n---\n\n# T\n\n[gone](/nope.md)\n',
      'a.md': '---\ntitle: no type\n---\n',
      'b.md': '---\ntype: Reference\ngenerated: { by: x/1, at: 2026-08-09 }\n---\n',
      'c.md': '---\ntype: Reference\nstale_after: 2026-08-09T00:00:00+02:00\n---\n',
    });
    const r = run(VIEW, [dir, '--validate', '--strict']);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a\.md\s+\[missing-type\]/);
    assert.match(r.out, /index\.md\s+\[dangling-link\]/);
    assert.match(r.out, /b\.md\s+\[timestamp\] generated\.at: 2026-08-09/);
    assert.doesNotMatch(r.out, /c\.md/, 'a datetime with an offset is fine');
  });

  it('reports a bundle that declares another OKF version', () => {
    const dir = bundle('version', { 'index.md': '---\nokf_version: "0.3"\n---\n\n# T\n' });
    const r = run(VIEW, [dir, '--validate']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /okf_version\s+: 0\.3\s+\(this tool implements 0\.2/);
  });
});

describe('release metadata', () => {
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));

  it('stamps the package version into scaffolded frontmatter', () => {
    assert.match(read(BOOTSTRAP), new RegExp(`const VERSION = '${pkg.version.replace(/\./g, '\\.')}'`));
  });

  it('keeps the Claude Code plugin manifest in step with package.json', () => {
    const plugin = JSON.parse(read(path.join(ROOT, '.claude-plugin', 'plugin.json')));
    assert.equal(plugin.name, pkg.name);
    assert.equal(plugin.version, pkg.version);
  });

  it('has skill frontmatter both pi and Claude Code accept', () => {
    const front = read(path.join(SKILL, 'SKILL.md')).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    assert.match(front, /^name: okf-bootstrap$/m);
    const description = front.split(/^description:/m)[1] ?? '';
    assert.ok(description.trim().length > 0);
    // Agent Skills spec limit (pi warns above it; Claude Code truncates).
    assert.ok(description.replace(/\s+/g, ' ').length <= 1024, 'description over 1024 chars');
  });

  it('vendors the OKF spec at the version the viewer implements', () => {
    const upstream = JSON.parse(read(path.join(SKILL, 'references', 'okf-spec', 'UPSTREAM.json')));
    assert.match(read(path.join(SKILL, 'assets', 'okf-view.mts')), new RegExp(`OKF_VERSION = '${upstream.version}'`));
    assert.match(read(path.join(SKILL, 'references', 'okf-spec', 'SPEC.md')), new RegExp(`\\*\\*Version ${upstream.version}`));
  });
});
