/**
 * The browser gates on real bundles: the demo (diagram, callouts, quizzes, the example
 * widgets) and the error fixture (malformed quiz questions and callouts, counted against
 * render_expect). Needs playwright's Chromium, mmdc, and network access for the viewer's CDN.
 * Run with npm run test:render.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'skills', 'okf-bootstrap', 'assets');
const WIDGETS = path.join(ASSETS, 'templates', 'okf-widgets', 'dist', 'okf-widgets.js');

function run(args: string[]) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 600_000 });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe('render gates', { timeout: 600_000 }, () => {
  it('builds the example widgets', () => {
    const r = spawnSync('npm', ['run', 'build', '-w', 'okf-widgets'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('renders the demo: diagrams, quizzes, and every widget mounts and responds', () => {
    const r = run([
      path.join(ASSETS, 'okf-view.mts'),
      'examples/demo/okf',
      '--out',
      '.cache/demo.html',
      '--widgets',
      WIDGETS,
      '--check-render',
      '--strict',
    ]);
    assert.equal(r.code, 0, r.out);
    // Every ```widget block in the demo, so adding a widget to a tour needs no edit here.
    const demo = path.join(ROOT, 'examples', 'demo', 'okf');
    const blocks = (fs.readdirSync(demo, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.md'))
      .reduce((n, file) => n + (fs.readFileSync(path.join(demo, file), 'utf8').match(/^```widget$/gm) ?? []).length, 0);
    assert.ok(blocks >= 7, 'the demo should exercise every example widget');
    assert.match(r.out, new RegExp(`widgets respond\\s+: ${blocks} of ${blocks}`));
    assert.match(r.out, /pan\/zoom wired\s+: yes/);
  });

  // The gate above proves the sql-erd widget mounts and responds, which it also does on its
  // built-in sample. This proves the SQL written under the widget name reaches it.
  it('hands the SQL in a widget block to the widget', async (t) => {
    const { chromium } = await import('playwright');
    const require = createRequire(import.meta.url);
    const libs: Record<string, [string, string]> = {
      'cytoscape@': ['cytoscape', 'dist/cytoscape.min.js'],
      'marked@': ['marked', 'marked.min.js'],
      'mermaid@': ['mermaid', 'dist/mermaid.min.js'],
    };
    const local = (url: string) => {
      const hit = Object.keys(libs).find((key) => url.includes(key));
      if (!hit) return null;
      const [pkg, file] = libs[hit]!;
      const entry = require.resolve(pkg);
      const marker = `${path.sep}node_modules${path.sep}${pkg}${path.sep}`;
      return fs.readFileSync(path.join(entry.slice(0, entry.lastIndexOf(marker) + marker.length), file), 'utf8');
    };
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.OKF_CHROMIUM || undefined });
    } catch (e) {
      return t.skip(`no browser: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
    try {
      const out = path.resolve(ROOT, '.cache', 'demo-erd.html');
      const built = run([path.join(ASSETS, 'okf-view.mts'), 'examples/demo/okf', '--out', out, '--widgets', WIDGETS]);
      assert.equal(built.code, 0, built.out);
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route(/^https:/, (route) => {
        const body = local(route.request().url());
        return body ? route.fulfill({ contentType: 'text/javascript', body }) : route.continue();
      });
      await page.goto(`file://${out}#parcel-tracker/data-model`);
      const diagram = page.locator('figure.okfw[data-widget="sql-erd"] svg[role="img"]');
      await diagram.waitFor({ timeout: 20_000 });
      assert.match((await diagram.getAttribute('aria-label')) ?? '', /3 tables and 2 relationships/);
      await page.getByRole('button', { name: 'Parcel ops' }).click();
      assert.match((await diagram.getAttribute('aria-label')) ?? '', /13 tables and 17 relationships/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });

  it('shows the authoring mistakes in the error fixture', () => {
    const r = run([
      path.join(ASSETS, 'okf-view.mts'),
      'test/fixtures/okf-render-errors',
      '--out',
      '.cache/fixture.html',
      '--check-render',
    ]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /quiz errors shown: 2/);
    assert.match(r.out, /unknown callouts : 1/);
  });

  it('parses every Mermaid block in the demo with mmdc', () => {
    const r = run([path.join(ASSETS, 'okf-mermaid.mts'), 'examples/demo/okf']);
    assert.equal(r.code, 0, r.out);
  });

  // A consumer project outside this repo, so nothing resolves from this repo's node_modules:
  // it catches a template that only works because the workspace root happens to provide a
  // dependency. Installs from the npm registry.
  it('works in a fresh consumer project scaffolded with --widgets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-consumer-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "consumer", "private": true }\n');
      const sh = (cmd: string) => {
        const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8', timeout: 600_000 });
        assert.equal(r.status, 0, `${cmd}\n${r.stdout}${r.stderr}`);
        return r.stdout;
      };
      sh(`node ${JSON.stringify(path.join(ASSETS, 'bootstrap.mts'))} . --name Consumer --widgets`);
      sh('npm install --no-audit --no-fund');
      sh('npm install -D --no-audit --no-fund playwright');
      sh('npm run okf:widgets:typecheck');
      sh('npm run okf:widgets:test');
      sh('npm run okf:validate');
      fs.writeFileSync(
        path.join(dir, 'okf', 'consumer', 'tour.md'),
        '---\ntype: Explainer\ntitle: Tour\n---\n\n```widget\nretry-backoff\n```\n',
      );
      assert.match(sh('npm run okf:mermaid:render'), /widgets respond\s+: 1 of 1/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
