/**
 * The browser gates on real bundles: the demo (diagram, callouts, quizzes, both example
 * widgets) and the error fixture (malformed quiz questions and callouts, counted against
 * render_expect). Needs playwright's Chromium, mmdc, and network access for the viewer's CDN.
 * Run with npm run test:render.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
    assert.match(r.out, /widgets respond\s+: 2 of 2/);
    assert.match(r.out, /pan\/zoom wired\s+: yes/);
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
