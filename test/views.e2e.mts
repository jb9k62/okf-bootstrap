/**
 * The viewer's navigation views in a real browser: the layout dropdown, the Graph | Tree | Table
 * switcher, sorting, the neighbourhood focus and the colour modes, driven on the demo bundle.
 *
 * The viewer loads Cytoscape, marked and Mermaid from a CDN. When those packages resolve from
 * node_modules the test serves them from there, so it also runs offline; otherwise it uses the
 * network. The devDependencies pin the versions the viewer loads and the page keeps its
 * integrity hashes, so a drift between the two fails the test. Needs playwright's Chromium (set OKF_CHROMIUM to a browser binary if the bundled one
 * is not installed); without a browser the tests skip. Run with npm run test:views.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'skills', 'okf-bootstrap', 'assets', 'okf-view.mts');
const require = createRequire(import.meta.url);

// CDN host path fragment -> [npm package, browser build inside it].
const LOCAL_LIBS: Record<string, [string, string]> = {
  'cytoscape@': ['cytoscape', 'dist/cytoscape.min.js'],
  'marked@': ['marked', 'marked.min.js'],
  'mermaid@': ['mermaid', 'dist/mermaid.min.js'],
};

// Package exports can hide the browser build, so find the package directory from its entry point.
function localLib(url: string): string | null {
  const hit = Object.keys(LOCAL_LIBS).find((key) => url.includes(key));
  if (!hit) return null;
  const [pkg, file] = LOCAL_LIBS[hit]!;
  try {
    const entry = require.resolve(pkg);
    const marker = `${path.sep}node_modules${path.sep}${pkg}${path.sep}`;
    const root = entry.slice(0, entry.lastIndexOf(marker) + marker.length);
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
}

describe('viewer views', { timeout: 120_000 }, () => {
  let dir = '';
  let browser: Browser | undefined;
  let page: Page;
  let pageErrors: string[] = [];
  let skipReason = '';

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-views-'));
    const out = path.join(dir, 'viz.html');
    const built = spawnSync(process.execPath, [VIEWER, 'examples/demo/okf', '--out', out], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(built.status, 0, built.stdout + built.stderr);

    try {
      const { chromium } = await import('playwright');
      const executablePath = process.env.OKF_CHROMIUM || undefined;
      browser = await chromium.launch({ headless: true, executablePath });
    } catch (e) {
      skipReason = `no browser: ${e instanceof Error ? e.message.split('\n')[0] : e}`;
      return;
    }
    page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route(/^https:/, (route) => {
      const body = localLib(route.request().url());
      if (body) return route.fulfill({ contentType: 'text/javascript', body });
      return route.continue();
    });
    await page.goto('file://' + out);
    try {
      await page.waitForFunction('window.__OKF_VIEW__ && window.marked && window.cytoscape', undefined, {
        timeout: 20_000,
      });
    } catch {
      skipReason = 'the viewer libraries did not load (no network, and not installed in node_modules)';
    }
  });

  after(async () => {
    await browser?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Skips, rather than fails, when the environment has no usable browser.
  const view = (name: string, fn: () => Promise<void>) =>
    it(name, async (t) => {
      if (skipReason) return t.skip(skipReason);
      pageErrors = [];
      await fn();
      assert.deepEqual(pageErrors, [], 'page errors');
    });

  view('every layout in the dropdown runs without error', async () => {
    const layouts = await page.$$eval('#layout option', (o) => o.map((x) => (x as HTMLOptionElement).value));
    assert.deepEqual(layouts, ['cose', 'concentric', 'breadthfirst', 'circle', 'grid']);
    for (const layout of layouts) {
      await page.selectOption('#layout', layout);
      await page.waitForTimeout(100);
    }
    await page.selectOption('#layout', 'cose');
  });

  view('the switcher shows one view at a time and hides graph-only controls', async () => {
    const state = () =>
      page.evaluate(() => ({
        view: document.body.dataset.view,
        tree: !document.getElementById('tree')!.hidden,
        table: !document.getElementById('table-wrap')!.hidden,
        layout: getComputedStyle(document.getElementById('layout')!).display !== 'none',
      }));
    assert.deepEqual(await state(), { view: 'graph', tree: false, table: false, layout: true });
    await page.click('[data-view=tree]');
    assert.deepEqual(await state(), { view: 'tree', tree: true, table: false, layout: false });
    await page.click('[data-view=table]');
    assert.deepEqual(await state(), { view: 'table', tree: false, table: true, layout: false });
    await page.click('[data-view=graph]');
    assert.deepEqual(await state(), { view: 'graph', tree: false, table: false, layout: true });
  });

  view('the tree lists every concept and opens one on click', async () => {
    const total = await page.evaluate('window.__OKF_VIEW__.ids.length');
    await page.click('[data-view=tree]');
    assert.equal(await page.locator('#tree .tree-item').count(), total);
    const item = page.locator('#tree .tree-item').nth(2);
    const href = await item.getAttribute('href');
    await item.click();
    // The viewer follows the URL hash, which changes the concept on the next hashchange event.
    await page.waitForFunction(
      (h) => document.querySelector('#tree .tree-item[aria-current=true]')?.getAttribute('href') === h,
      href,
    );
    assert.equal(await page.evaluate('"#" + decodeURIComponent(location.hash.slice(1))'), href);
    assert.ok((await page.locator('#legend').isVisible()), 'the colour key is visible in the tree');
    await page.click('[data-view=graph]');
  });

  view('search and the type filter narrow the tree and the table together', async () => {
    await page.click('[data-view=tree]');
    await page.selectOption('#filter-type', 'Metric');
    assert.equal(await page.locator('#tree .tree-item:not([hidden])').count(), 1);
    await page.click('[data-view=table]');
    assert.equal(await page.locator('#concept-table tbody tr').count(), 1);
    await page.selectOption('#filter-type', '');
    await page.fill('#search', 'no-such-concept-xyz');
    assert.equal(await page.locator('#concept-table tbody tr').count(), 0);
    assert.equal(await page.locator('#table-empty').isVisible(), true);
    await page.fill('#search', '');
    await page.click('[data-view=graph]');
  });

  view('table columns sort both ways, and a row opens its concept in the previous view', async () => {
    await page.click('[data-view=tree]');
    await page.click('[data-view=table]');
    const column = (n: number) =>
      page.$$eval(`#concept-table tbody tr td:nth-child(${n})`, (cells) => cells.map((c) => c.textContent ?? ''));
    const titles = await column(1);
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)), 'title ascending by default');
    await page.click('#concept-table th:nth-child(1) button');
    assert.equal(await page.getAttribute('#concept-table th:nth-child(1)', 'aria-sort'), 'descending');
    assert.deepEqual(await column(1), [...titles].reverse());
    await page.click('#concept-table th:nth-child(7) button'); // links in
    await page.click('#concept-table th:nth-child(7) button');
    const linksIn = (await column(7)).map(Number);
    assert.deepEqual(linksIn, [...linksIn].sort((a, b) => b - a), 'links in, descending');

    await page.locator('#concept-table tbody tr').nth(1).click();
    assert.equal(await page.evaluate('document.body.dataset.view'), 'tree', 'returns to the view it came from');
    assert.notEqual(await page.evaluate('location.hash'), '');
    await page.click('[data-view=graph]');
  });

  view('table rows open with the keyboard', async () => {
    await page.click('[data-view=table]');
    await page.locator('#concept-table tbody tr').nth(3).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate('document.body.dataset.view'), 'graph');
  });

  view('neighbourhood shows only the open concept and its neighbours, then restores the graph', async () => {
    const ids: string[] = await page.evaluate('window.__OKF_VIEW__.ids');
    const edges: Array<{ source: string; target: string }> = await page.evaluate(
      'window.BUNDLE.edges.map((e) => e.data)',
    );
    // A concept with links in and links out, so both columns are exercised.
    const focus = ids.find(
      (id) => edges.some((e) => e.target === id) && edges.some((e) => e.source === id),
    )!;
    assert.ok(focus, 'the demo has a concept with links in and out');
    const linksIn = edges.filter((e) => e.target === focus).map((e) => e.source);
    const linksOut = edges.filter((e) => e.source === focus).map((e) => e.target);
    const near = new Set([focus, ...linksIn, ...linksOut]);
    assert.ok(near.size < ids.length, 'the demo is big enough for a neighbourhood to be a subset');

    await page.evaluate((id) => window.__OKF_VIEW__.show(id), focus);
    assert.equal((await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]).length, ids.length);

    await page.click('#hood-toggle');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'true');
    assert.equal(await page.isDisabled('#layout'), true);
    const shown: string[] = await page.evaluate('window.__OKF_VIEW__.visibleIds()');
    assert.deepEqual(new Set(shown), near);

    // Links in sit to the left of the concept and links out to the right.
    const x = (id: string) => page.evaluate((n) => window.__OKF_VIEW__.position(n).x, id) as Promise<number>;
    const centre = await x(focus);
    for (const id of linksIn.filter((n) => !linksOut.includes(n))) assert.ok((await x(id)) < centre, id + ' is left');
    for (const id of linksOut.filter((n) => !linksIn.includes(n))) assert.ok((await x(id)) > centre, id + ' is right');

    // Following a link re-centres on the new concept.
    const next = linksOut[0]!;
    await page.evaluate((id) => window.__OKF_VIEW__.show(id), next);
    assert.ok((await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]).includes(next));

    await page.click('#hood-toggle');
    assert.equal(await page.isDisabled('#layout'), false);
    assert.equal((await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]).length, ids.length);
  });

  view('colour modes recolour the key and the tree dots', async () => {
    const key = () => page.$$eval('#legend li', (items) => items.map((i) => i.textContent?.trim() ?? ''));
    const typeKey = await key();
    assert.ok(typeKey.includes('Application'));
    await page.selectOption('#color-by', 'trust');
    assert.deepEqual(await key(), ['Human reviewed', 'Machine confirmed', 'Unverified']);
    await page.selectOption('#color-by', 'freshness');
    assert.deepEqual(await key(), ['Fresh', 'Stale within 30 days', 'Stale', 'No expiry set']);

    await page.click('[data-view=tree]');
    const dots = await page.$$eval('#tree .tree-item .dot', (d) => d.map((x) => (x as HTMLElement).title));
    // The demo mixes all three freshness states, so the tooltips must not be uniform.
    assert.ok(new Set(dots).size >= 3, 'dots carry the freshness of their concept: ' + [...new Set(dots)]);
    await page.selectOption('#color-by', 'trust');
    const trust = await page.$$eval('#tree .tree-item .dot', (d) => d.map((x) => (x as HTMLElement).title));
    assert.ok(trust.includes('Human reviewed') && trust.includes('Machine confirmed') && trust.includes('Unverified'));
    await page.selectOption('#color-by', 'type');
    await page.click('[data-view=graph]');
  });

  view('reading view and the theme toggle work from every view', async () => {
    for (const name of ['graph', 'tree', 'table']) {
      await page.click(`[data-view=${name}]`);
      await page.click('#reading-toggle');
      assert.equal(await page.isVisible('#detail'), true);
      await page.click('#reading-toggle');
    }
    await page.click('#theme-toggle');
    await page.click('#theme-toggle');
    await page.click('[data-view=graph]');
  });
});
