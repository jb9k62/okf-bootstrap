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

// The Filters and Display controls sit in popovers, closed until a reader opens them. Open the
// panel that holds a control before driving it, and close it again afterwards with Escape.
async function openPanel(p: Page, name: 'filters' | 'display') {
  if (!(await p.isVisible(`#${name}-panel`))) await p.click(`#${name}-toggle`);
}
async function closePanels(p: Page) {
  if ((await p.locator('.popover:not([hidden])').count()) > 0) await p.keyboard.press('Escape');
}
async function inPanel(p: Page, name: 'filters' | 'display', action: () => Promise<unknown>) {
  await openPanel(p, name);
  await action();
  await closePanels(p);
}
// Reset is hidden while nothing is set, so only click it when it is showing.
async function resetIfShown(p: Page) {
  if (await p.isVisible('#reset')) await p.click('#reset');
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

  // Opening a concept from a list sets location.hash, and the viewer shows it on the
  // `hashchange` that follows. Wait for that, or it can land in the middle of the next test
  // and replace the concept that test opened.
  const hashShown = () =>
    page.waitForFunction(() => {
      const id = decodeURIComponent(location.hash.slice(1));
      const node = (window.BUNDLE as unknown as { nodes: Array<{ data: { id: string; label: string } }> }).nodes.find((n) => n.data.id === id);
      return !!node && document.title.startsWith(node.data.label + ' | ');
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
    await inPanel(page, 'display', async () => {
      for (const layout of layouts) {
        await page.selectOption('#layout', layout);
        await page.waitForTimeout(100);
      }
      await page.selectOption('#layout', 'cose');
    });
  });

  view('the switcher shows one view at a time and hides graph-only controls', async () => {
    const state = () =>
      page.evaluate(() => ({
        view: document.body.dataset.view,
        tree: !document.getElementById('tree')!.hidden,
        table: !document.getElementById('table-wrap')!.hidden,
        layout: getComputedStyle(document.getElementById('layout')!.closest('.graph-only')!).display !== 'none',
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
    await inPanel(page, 'filters', () => page.selectOption('#filter-type', 'Metric'));
    assert.equal(await page.locator('#tree .tree-item:not([hidden])').count(), 1);
    await page.click('[data-view=table]');
    assert.equal(await page.locator('#concept-table tbody tr').count(), 1);
    await inPanel(page, 'filters', () => page.selectOption('#filter-type', ''));
    await page.fill('#search', 'zzqqxxnomatch');
    assert.equal(await page.locator('#concept-table tbody tr').count(), 0);
    assert.equal(await page.locator('#table-empty').isVisible(), true);
    await page.fill('#search', '');
    await page.click('[data-view=graph]');
  });

  view('ranked search lists results with trust and freshness, and Enter opens the first', async () => {
    await resetIfShown(page);
    await page.focus('#search');
    await page.keyboard.type('retry policy');
    await page.waitForSelector('#search-results:not([hidden]) .sr-item');
    const rows = await page.$$eval('#search-results .sr-item', (r) => r.map((x) => x.textContent ?? ''));
    assert.ok(rows.length >= 2, 'several results');
    assert.match(rows[0]!, /human reviewed|human-reviewed/, 'a human-reviewed concept leads');
    assert.match(rows[0]!, /fresh, \d+d left/);
    assert.match((await page.textContent('#search-results .sr-head')) ?? '', /best first/);
    // Non-matches dim in the graph.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash.includes('retry-policy'));
    assert.equal(await page.isHidden('#search-results'), true, 'the list closes once a result is chosen');
    await page.click('#reset');
  });

  view('the search mode, trust and freshness controls change what matches', async () => {
    await page.click('[data-view=table]');
    const rowCount = () => page.locator('#concept-table tbody tr').count();
    const all = await rowCount();
    // Ranked: the table follows the ranking and shows a Match column.
    await page.fill('#search', 'retries');
    const ranked = await rowCount();
    assert.ok(ranked > 0 && ranked < all);
    assert.equal(await page.locator('#concept-table th:last-child').isVisible(), true);
    // Contains: a plain match on title, path or tag, with no Match column.
    await inPanel(page, 'filters', () => page.selectOption('#search-mode', 'contains'));
    assert.equal(await page.locator('#concept-table th:last-child').isHidden(), true);
    assert.ok((await rowCount()) > 0);
    await inPanel(page, 'filters', () => page.selectOption('#search-mode', 'ranked'));
    // Trust and freshness narrow ranked results.
    await inPanel(page, 'filters', () => page.selectOption('#filter-trust', 'human-reviewed'));
    const human = await rowCount();
    assert.ok(human > 0 && human < ranked, `human-reviewed ${human} of ${ranked}`);
    await inPanel(page, 'filters', () => page.selectOption('#filter-trust', ''));
    await page.fill('#search', '');
    await inPanel(page, 'filters', () => page.selectOption('#filter-fresh', 'stale'));
    assert.equal(await rowCount(), 1, 'the demo has one stale concept');
    await page.click('#reset');
    assert.equal(await rowCount(), all);
    await page.click('[data-view=graph]');
  });

  view('the Filters badge, chips and Reset follow the active filters, and the popovers close', async () => {
    await resetIfShown(page);
    assert.equal(await page.isHidden('#reset'), true, 'Reset has nothing to clear');
    assert.equal(await page.isHidden('#filters-count'), true, 'no badge with no filter set');
    assert.equal(await page.isHidden('#filter-chips'), true, 'no chips with no filter set');
    assert.equal(await page.isHidden('#filters-panel'), true, 'the Filters panel starts closed');
    assert.equal(await page.isHidden('#display-panel'), true, 'the Display panel starts closed');

    await openPanel(page, 'filters');
    await page.selectOption('#filter-trust', 'human-reviewed');
    assert.equal(await page.textContent('#filters-count'), '1');
    await page.selectOption('#filter-fresh', 'stale');
    assert.equal(await page.textContent('#filters-count'), '2');
    assert.equal(await page.locator('#filter-chips .filter-chip').count(), 2);
    assert.equal(await page.isVisible('#reset'), true, 'Reset appears once a filter is set');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#filters-panel'), false, 'Escape closes the panel');
    assert.equal(await page.getAttribute('#filters-toggle', 'aria-expanded'), 'false');
    assert.equal(await page.isVisible('#filter-chips'), true, 'the chips stay in the bar');

    // A chip removes its own filter and nothing else.
    await page.click('#filter-chips .filter-chip:has-text("Freshness")');
    assert.equal(await page.inputValue('#filter-fresh'), '');
    assert.equal(await page.inputValue('#filter-trust'), 'human-reviewed');
    assert.equal(await page.textContent('#filters-count'), '1');
    assert.equal(await page.locator('#filter-chips .filter-chip').count(), 1);

    // One popover at a time, and a click outside the open one closes it.
    await page.click('#filters-toggle');
    await page.click('#display-toggle');
    assert.equal(await page.isVisible('#display-panel'), true);
    assert.equal(await page.isVisible('#filters-panel'), false, 'opening Display closes Filters');
    await page.click('#detail');
    assert.equal(await page.isVisible('#display-panel'), false, 'an outside click closes it');
    assert.equal(await page.getAttribute('#display-toggle', 'aria-expanded'), 'false');

    // Clear filters empties the rest, and Reset hides again.
    await openPanel(page, 'filters');
    await page.click('#clear-filters');
    assert.equal(await page.isHidden('#filters-count'), true);
    assert.equal(await page.isHidden('#filter-chips'), true);
    assert.equal(await page.isHidden('#reset'), true, 'Reset hides with nothing set');
    await closePanels(page);

    // A search query counts as something for Reset to clear.
    await page.fill('#search', 'retry');
    assert.equal(await page.isVisible('#reset'), true, 'a search query shows Reset');
    await page.fill('#search', '');
    assert.equal(await page.isHidden('#reset'), true);
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
    await hashShown();
    await page.click('[data-view=graph]');
  });

  view('table rows open with the keyboard', async () => {
    await page.click('[data-view=table]');
    await page.locator('#concept-table tbody tr').nth(3).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate('document.body.dataset.view'), 'graph');
    await hashShown();
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

    await inPanel(page, 'display', () => page.click('#hood-toggle'));
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

    await inPanel(page, 'display', () => page.click('#hood-toggle'));
    assert.equal(await page.isDisabled('#layout'), false);
    assert.equal((await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]).length, ids.length);
  });

  view('reset in neighbourhood mode clears filters and keeps the neighbourhood in view', async () => {
    const ids: string[] = await page.evaluate('window.__OKF_VIEW__.ids');
    await page.evaluate((id) => window.__OKF_VIEW__.show(id), ids[0]!);
    await inPanel(page, 'display', () => page.click('#hood-toggle'));
    const before: string[] = await page.evaluate('window.__OKF_VIEW__.visibleIds()');
    assert.ok(before.length < ids.length);

    await page.fill('#search', 'zzzz');
    await page.keyboard.press('Escape'); // close the results list, which can sit over Reset
    await page.click('#reset');
    assert.equal(await page.inputValue('#search'), '');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'true');
    assert.deepEqual(new Set(await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]), new Set(before));
    assert.equal(await page.evaluate('window.__OKF_VIEW__.inView()'), true);

    await inPanel(page, 'display', () => page.click('#hood-toggle'));
  });

  view('colour modes recolour the key and the tree dots', async () => {
    const key = () => page.$$eval('#legend li', (items) => items.map((i) => i.textContent?.trim() ?? ''));
    const typeKey = await key();
    assert.ok(typeKey.includes('Application'));
    await inPanel(page, 'display', () => page.selectOption('#color-by', 'trust'));
    assert.deepEqual(await key(), ['Human reviewed', 'Machine confirmed', 'Unverified']);
    await inPanel(page, 'display', () => page.selectOption('#color-by', 'freshness'));
    assert.deepEqual(await key(), ['Fresh', 'Stale within 30 days', 'Stale', 'No expiry set']);

    await page.click('[data-view=tree]');
    const dots = await page.$$eval('#tree .tree-item .dot', (d) => d.map((x) => (x as HTMLElement).title));
    // The demo mixes all three freshness states, so the tooltips must not be uniform.
    assert.ok(new Set(dots).size >= 3, 'dots carry the freshness of their concept: ' + [...new Set(dots)]);
    await inPanel(page, 'display', () => page.selectOption('#color-by', 'trust'));
    const trust = await page.$$eval('#tree .tree-item .dot', (d) => d.map((x) => (x as HTMLElement).title));
    assert.ok(trust.includes('Human reviewed') && trust.includes('Machine confirmed') && trust.includes('Unverified'));
    await inPanel(page, 'display', () => page.selectOption('#color-by', 'type'));
    await page.click('[data-view=graph]');
  });

  view('expanding a diagram fills the window in graph, tree and reading view, and Esc restores it', async () => {
    await page.click('#view-switch [data-view=graph]');
    await page.evaluate(() => window.__OKF_VIEW__.show('parcel-tracker/architecture'));
    await page.waitForSelector('.mermaid[data-state=rendered]', { timeout: 30_000 });
    const svgWidth = () => page.evaluate(() => document.querySelector('.mermaid svg')!.getBoundingClientRect().width);
    const inline = await svgWidth();
    const geometry = () =>
      page.evaluate(() => {
        const fig = document.querySelector('.mermaid')!.getBoundingClientRect();
        const canvas = document.querySelector('.mermaid-canvas')!.getBoundingClientRect();
        const tools = document.querySelector('.mermaid-tools')!.getBoundingClientRect();
        const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return {
          fig, canvasHeight: canvas.height, toolsHeight: tools.height, w: innerWidth, h: innerHeight,
          onTop: !!mid && !!mid.closest('.mermaid'),
        };
      });

    for (const mode of ['graph', 'tree', 'reading']) {
      if (mode === 'tree') await page.click('#view-switch [data-view=tree]');
      if (mode === 'reading') await page.click('#reading-toggle');
      await page.click('.mermaid-tools button[data-act=expand]');
      await page.waitForFunction(() => document.querySelector('.mermaid.expanded .mermaid-canvas')!.getBoundingClientRect().height > 600);
      let g = await geometry();
      assert.deepEqual([g.fig.x, g.fig.y, g.fig.width, g.fig.height], [0, 0, g.w, g.h], `${mode}: covers the window`);
      assert.ok(g.onTop, `${mode}: sits above the page`);
      assert.ok(Math.abs(g.canvasHeight + g.toolsHeight - g.h) <= 2, `${mode}: the canvas fills under the toolbar`);
      assert.ok((await svgWidth()) > inline, `${mode}: the diagram is enlarged to fit`);

      // A resize while expanded refills the new window.
      await page.setViewportSize({ width: 1000, height: 600 });
      await page.waitForFunction(() => Math.abs(document.querySelector('.mermaid-canvas')!.getBoundingClientRect().height - (innerHeight - 38)) < 30);
      g = await geometry();
      assert.deepEqual([g.fig.width, g.fig.height], [1000, 600], `${mode}: refits after resize`);
      await page.setViewportSize({ width: 1400, height: 800 });

      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.mermaid.expanded').count(), 0, `${mode}: Esc closes`);
      await page.waitForFunction(() => document.querySelector('.mermaid-canvas')!.getBoundingClientRect().height < 500);
      if (mode === 'reading') await page.click('#reading-toggle');
    }
    await page.click('#view-switch [data-view=graph]');
  });

  view('the ER diagram key sits under its diagram, and moves to a corner panel when it is expanded', async () => {
    await page.evaluate(() => window.__OKF_VIEW__.show('parcel-tracker/data-model'));
    await page.waitForSelector('.mermaid[data-state=rendered]', { timeout: 30_000 });
    const key = page.locator('#detail-body .callout.erd-key');
    assert.equal(await key.count(), 1, 'the key is tied to the diagram above it');
    assert.equal(await key.isVisible(), true, 'visible in the reading pane, without expanding');
    assert.ok(await key.locator('.erd-glyph').count() > 0, 'its symbols are drawn');
    assert.match(await key.innerText(), /each CARRIER is linked to zero or more PARCEL/, 'each relationship is in words');
    const figure = (await page.locator('.mermaid').first().boundingBox())!;
    const inPage = (await key.boundingBox())!;
    assert.ok(inPage.y >= figure.y + figure.height - 4, 'below the diagram, not over it');
    await page.click('.mermaid-tools button[data-act=expand]');
    assert.equal(await key.isVisible(), true, 'shown over the expanded diagram');
    const box = (await key.boundingBox())!;
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1400 && box.y + box.height <= 800, 'inside the window');
    await page.keyboard.press('Escape');
    const back = (await key.boundingBox())!;
    assert.ok(back.y >= figure.y + figure.height - 4, 'back under the diagram once collapsed');
  });

  view('the ER diagram is drawn in the viewer colours, with a primary key in the accent', async () => {
    await page.evaluate(() => window.__OKF_VIEW__.show('parcel-tracker/data-model'));
    await page.waitForSelector('.mermaid[data-state=rendered]', { timeout: 30_000 });
    const look = await page.evaluate(() => {
      const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop) : '');
      const root = getComputedStyle(document.documentElement);
      const svg = document.querySelector('.mermaid svg')!;
      return {
        accent: root.getPropertyValue('--accent').trim(),
        line: css(svg.querySelector('.relationshipLine'), 'stroke-width'),
        key: css(svg.querySelector('.attribute-keys .nodeLabel, .attribute-keys p'), 'color'),
      };
    });
    assert.equal(look.line, '1.6px', 'relationship lines are heavier than Mermaid default');
    assert.ok(look.key && look.key !== 'rgb(0, 0, 0)', 'key column has its own colour');
  });

  view('reading view hides the list or graph, shows the concept, and restores each view', async () => {
    const ids: string[] = await page.evaluate('window.__OKF_VIEW__.ids');
    await page.evaluate((id) => window.__OKF_VIEW__.show(id), ids[0]!);
    const title = await page.textContent('#detail-title');
    assert.ok(title);
    const paneVisible = () => page.isVisible('#graph-pane');
    const detailBox = async () => (await page.locator('#detail').boundingBox())!;

    for (const name of ['graph', 'tree', 'table']) {
      await page.click(`#view-switch [data-view=${name}]`);
      const normal = await detailBox().catch(() => null);
      await page.click('#reading-toggle');
      assert.equal(await page.getAttribute('#reading-toggle', 'aria-pressed'), 'true', name);
      assert.equal(await paneVisible(), false, `${name}: the pane is hidden while reading`);
      assert.equal(await page.isVisible('#detail'), true, `${name}: the concept is shown`);
      assert.equal(await page.textContent('#detail-title'), title, name);
      const reading = await detailBox();
      assert.ok(reading.width > 900, `${name}: the reading pane takes the window (${reading.width}px)`);
      if (normal) assert.ok(reading.width >= normal.width, name);

      await page.click('#reading-toggle');
      assert.equal(await page.getAttribute('#reading-toggle', 'aria-pressed'), 'false', name);
      assert.equal(await paneVisible(), true, `${name}: the pane is back`);
      assert.equal(await page.isVisible('#detail'), name !== 'table', `${name}: detail only beside graph and tree`);
      assert.equal(await page.getAttribute(`#view-switch [data-view=${name}]`, 'aria-pressed'), 'true', name);
    }

    // The graph is refitted on the way out, even after the window changed size.
    await page.click('#view-switch [data-view=graph]');
    await page.click('#reading-toggle');
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.click('#reading-toggle');
    assert.equal(await page.evaluate('window.__OKF_VIEW__.inView()'), true, 'graph fits after reading');
    await page.setViewportSize({ width: 1400, height: 800 });

    // Switching view while reading keeps reading; the new view shows on the way out.
    await page.click('#reading-toggle');
    await page.click('#view-switch [data-view=table]');
    assert.equal(await paneVisible(), false, 'still reading after switching to the table');
    assert.equal(await page.isVisible('#detail'), true);
    await page.click('#reading-toggle');
    assert.equal(await page.isVisible('#concept-table'), true);
    assert.equal(await page.isVisible('#detail'), false);

    // Neighbourhood survives a trip through reading view.
    await page.click('#view-switch [data-view=graph]');
    await inPanel(page, 'display', () => page.click('#hood-toggle'));
    const shown: string[] = await page.evaluate('window.__OKF_VIEW__.visibleIds()');
    await page.click('#reading-toggle');
    await page.click('#reading-toggle');
    assert.deepEqual(new Set(await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]), new Set(shown));
    assert.equal(await page.evaluate('window.__OKF_VIEW__.inView()'), true);
    await inPanel(page, 'display', () => page.click('#hood-toggle'));
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

  view('the search box finds a lesson by a file it cites, as okf-search does', async () => {
    // The memory bundle is the one whose concepts name project files in `sources`.
    const out = path.join(dir, 'memory.html');
    const built = spawnSync(process.execPath, [VIEWER, 'examples/demo/edukai', '--out', out], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const cli = spawnSync(process.execPath, [path.join(path.dirname(VIEWER), 'okf-search.mts'), 'search', 'week.ts', '--bundle', 'examples/demo/edukai', '--json', '--no-cache'], { cwd: ROOT, encoding: 'utf8' });
    const expected = JSON.parse(cli.stdout).results[0];
    assert.equal(expected.id, 'codebase-parcel-tracker/lessons/2026-10-02-weeks-start-monday-utc');

    const memory = await browser!.newPage({ viewport: { width: 1400, height: 800 } });
    const errors: string[] = [];
    memory.on('pageerror', (e) => errors.push(e.message));
    try {
      await memory.route(/^https:/, (route) => {
        const body = localLib(route.request().url());
        return body ? route.fulfill({ contentType: 'text/javascript', body }) : route.continue();
      });
      await memory.goto('file://' + out);
      await memory.waitForFunction('window.__OKF_VIEW__ && window.marked && window.cytoscape', undefined, { timeout: 20_000 });
      await memory.focus('#search');
      await memory.keyboard.type('week.ts');
      await memory.waitForSelector('#search-results:not([hidden]) .sr-item');
      const first = (await memory.textContent('#search-results .sr-item')) ?? '';
      assert.ok(first.includes(expected.title), `${first} should lead with ${expected.title}`);
      assert.deepEqual(errors, [], 'page errors');
    } finally {
      await memory.close();
    }
  });

  view('on a phone the top bar stays compact, its controls wrap, and a panel is a full-width sheet', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      const m = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const bar = document.querySelector('.topbar') as HTMLElement;
        const controls = ['#view-switch', '#filters-toggle', '#display-toggle', '#reading-toggle', '#theme-toggle'];
        return {
          scrollWidth: document.documentElement.scrollWidth,
          barScrollWidth: bar.scrollWidth,
          barWidth: bar.clientWidth,
          topbar: box('.topbar').height,
          searchWidth: box('#search').width,
          searchAboveControls: box('#search').bottom <= box('#view-switch').top,
          controlsInside: controls.every((sel) => box(sel).right <= innerWidth && box(sel).left >= 0),
          legendInPane: box('#legend').right <= box('#graph-pane').right,
          detail: box('#detail').height,
        };
      });
      assert.equal(m.scrollWidth, 390, 'page width equals the viewport');
      assert.ok(m.barScrollWidth <= m.barWidth, 'the top bar does not scroll sideways');
      assert.ok(m.topbar < 844 * 0.25, `top bar is ${m.topbar}px tall`);
      assert.ok(m.searchWidth > 390 - 40, 'search fills the row');
      assert.equal(m.searchAboveControls, true);
      assert.equal(m.controlsInside, true, 'every control is on screen');
      assert.equal(m.legendInPane, true);
      assert.ok(m.detail > 844 * 0.4, `reading pane is ${m.detail}px tall`);

      await page.click('#filters-toggle');
      const sheet = await page.evaluate(() => {
        const panel = document.querySelector('#filters-panel')!.getBoundingClientRect();
        const bar = document.querySelector('.topbar')!.getBoundingClientRect();
        return { left: panel.left, right: panel.right, top: panel.top, barBottom: bar.bottom };
      });
      assert.ok(sheet.left <= 1 && sheet.right >= 389, `the sheet spans the width: ${JSON.stringify(sheet)}`);
      assert.ok(Math.abs(sheet.top - sheet.barBottom) <= 2, 'the sheet sits under the bar');
      await closePanels(page);
    } finally {
      await page.setViewportSize({ width: 1400, height: 800 });
    }
  });
});

// B: keyboard shortcuts. Ctrl plus a key drives the toolbar, and holding Ctrl shows the keys.
type Shortcut = { id: string; key: string; el: Element | null };
type KeyInit = { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean };

describe('viewer keyboard shortcuts', { timeout: 120_000 }, () => {
  let dir = '';
  let out = '';
  let browser: Browser | undefined;
  let page: Page;
  let pageErrors: string[] = [];
  let skipReason = '';

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-shortcuts-'));
    out = path.join(dir, 'viz.html');
    const built = spawnSync(process.execPath, [VIEWER, 'examples/demo/okf', '--out', out], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(built.status, 0, built.stdout + built.stderr);

    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true, executablePath: process.env.OKF_CHROMIUM || undefined });
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
      await page.waitForFunction('window.__OKF_VIEW__ && window.__OKF_SHORTCUTS__ && window.marked && window.cytoscape', undefined, {
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

  // Every test starts from a fresh page: graph view, panels closed, nothing searched.
  const shortcut = (name: string, fn: () => Promise<void>) =>
    it(name, async (t) => {
      if (skipReason) return t.skip(skipReason);
      pageErrors = [];
      await page.reload();
      await page.waitForFunction('window.__OKF_SHORTCUTS__');
      await fn();
      assert.deepEqual(pageErrors, [], 'page errors');
    });

  const press = (combo: string) => page.keyboard.press(combo);
  const viewOf = () => page.getAttribute('body', 'data-view');
  // Dispatches a keydown on the page and reports whether a handler prevented its default action.
  const dispatchKey = (init: KeyInit) =>
    page.evaluate(
      (i) => !document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...i })),
      init,
    );
  // The badges that are actually displayed (the CSS hides them when hints are off).
  const visibleBadges = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.kbd-hint')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent ?? ''),
    );

  shortcut('the registry has unique ids and keys, each with a target', async () => {
    const list = await page.evaluate(() =>
      (window as unknown as { __OKF_SHORTCUTS__: Shortcut[] }).__OKF_SHORTCUTS__.map((e) => ({ id: e.id, key: e.key, hasEl: e.el !== null })),
    );
    assert.equal(list.length, 10);
    assert.equal(new Set(list.map((e) => e.id)).size, list.length, 'ids are unique');
    assert.equal(new Set(list.map((e) => e.key)).size, list.length, 'keys are unique');
    assert.ok(list.every((e) => e.hasEl), 'every entry has an element');
    assert.deepEqual(
      list.map((e) => e.key),
      ['/', '1', '2', '3', 'l', 'u', 'r', 'y', 'h', 'j'],
    );
  });

  shortcut('Ctrl+/ focuses the search box', async () => {
    await press('Control+/');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
  });

  shortcut('Ctrl+1, 2 and 3 switch the view', async () => {
    await press('Control+2');
    assert.equal(await viewOf(), 'tree');
    assert.equal(await page.getAttribute('button[data-view="tree"]', 'aria-pressed'), 'true');
    await press('Control+3');
    assert.equal(await viewOf(), 'table');
    assert.equal(await page.isVisible('#table-wrap'), true);
    await press('Control+1');
    assert.equal(await viewOf(), 'graph');
    assert.equal(await page.getAttribute('button[data-view="graph"]', 'aria-pressed'), 'true');
  });

  shortcut('Ctrl+l and Ctrl+u open and close Filters and Display', async () => {
    await press('Control+l');
    assert.equal(await page.getAttribute('#filters-toggle', 'aria-expanded'), 'true');
    assert.equal(await page.isVisible('#filters-panel'), true);
    await press('Control+l');
    assert.equal(await page.getAttribute('#filters-toggle', 'aria-expanded'), 'false');
    await press('Control+u');
    assert.equal(await page.getAttribute('#display-toggle', 'aria-expanded'), 'true');
    assert.equal(await page.isVisible('#display-panel'), true);
    await press('Control+u');
    assert.equal(await page.getAttribute('#display-toggle', 'aria-expanded'), 'false');
  });

  shortcut('Ctrl+r toggles the Reading view', async () => {
    await press('Control+r');
    assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), true);
    assert.equal(await page.getAttribute('#reading-toggle', 'aria-pressed'), 'true');
    await press('Control+r');
    assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), false);
  });

  shortcut('Ctrl+y switches the theme and back', async () => {
    const before = await page.getAttribute('html', 'data-theme');
    await press('Control+y');
    assert.notEqual(await page.getAttribute('html', 'data-theme'), before, 'the theme changed');
    await press('Control+y');
    assert.equal(await page.getAttribute('html', 'data-theme'), before);
  });

  shortcut('Ctrl+h toggles Neighbourhood in the graph view only', async () => {
    await press('Control+h');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'true');
    await press('Control+h');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'false');
    await press('Control+2');
    await press('Control+h');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'false', 'no-op in the tree view');
    await press('Control+1');
  });

  shortcut('Ctrl+j resets only while Reset is showing', async () => {
    const clicks = () => page.evaluate(() => (window as unknown as Record<string, number>).resetClicks);
    await page.evaluate(() => {
      (window as unknown as Record<string, number>).resetClicks = 0;
      document.getElementById('reset')!.addEventListener('click', () => {
        (window as unknown as Record<string, number>).resetClicks++;
      });
    });
    assert.equal(await page.isHidden('#reset'), true);
    await press('Control+j');
    assert.equal(await clicks(), 0, 'a hidden Reset is a no-op');

    await page.fill('#search', 'box');
    assert.equal(await page.isVisible('#reset'), true);
    await press('Control+j');
    assert.equal(await page.inputValue('#search'), '', 'the query is cleared');
    assert.equal(await clicks(), 1);
  });

  shortcut('holding Ctrl shows a badge on each visible target, and releasing hides them', async () => {
    await page.keyboard.down('Control');
    const expected = await page.evaluate(() =>
      (window as unknown as { __OKF_SHORTCUTS__: Array<{ id: string; key: string; el: Element }> }).__OKF_SHORTCUTS__
        .filter((e) => e.id !== 'search' && e.el.getClientRects().length > 0)
        .map((e) => 'Ctrl+' + e.key.toUpperCase()),
    );
    // Graph view with the panels closed: three views, Filters, Display, Reading and the theme.
    assert.deepEqual(expected, ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+L', 'Ctrl+U', 'Ctrl+R', 'Ctrl+Y']);
    assert.deepEqual((await visibleBadges()).sort(), [...expected].sort());
    assert.equal(await page.getAttribute('#search', 'placeholder'), 'Ctrl+/ to search');

    await page.keyboard.up('Control');
    assert.deepEqual(await visibleBadges(), []);
    assert.equal(await page.getAttribute('#search', 'placeholder'), 'Search concepts');
  });

  shortcut('a badge follows a target that opens, and blur or a hidden tab clears the hints', async () => {
    // Control stays held, so the bare key is pressed with it (press('Control+u') would release Control).
    await page.keyboard.down('Control');
    await page.keyboard.press('u');
    assert.ok((await visibleBadges()).includes('Ctrl+H'), 'Neighbourhood shows once Display is open');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.deepEqual(await visibleBadges(), []);
    await page.keyboard.up('Control');

    await page.keyboard.down('Control');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.deepEqual(await visibleBadges(), []);
    await page.keyboard.up('Control');
    await press('Control+u');
  });

  shortcut('Meta, Alt, Shift and repeated combinations do nothing and are not prevented', async () => {
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', metaKey: true }), false);
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', ctrlKey: true, metaKey: true }), false);
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', ctrlKey: true, altKey: true }), false);
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', ctrlKey: true, shiftKey: true }), false);
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', ctrlKey: true, repeat: true }), false);
    assert.equal(await viewOf(), 'graph');
  });

  shortcut('a matched shortcut is prevented, an unmatched Ctrl key is not', async () => {
    assert.equal(await dispatchKey({ key: '2', code: 'Digit2', ctrlKey: true }), true, 'Ctrl+2 is prevented');
    assert.equal(await viewOf(), 'tree');
    assert.equal(await dispatchKey({ key: 'z', code: 'KeyZ', ctrlKey: true }), false, 'Ctrl+Z is left alone');
    await press('Control+1');
  });

  shortcut('while the search modal is open only search and reset work', async () => {
    await page.evaluate(() => document.body.classList.add('search-open'));
    try {
      assert.equal(await dispatchKey({ key: '3', code: 'Digit3', ctrlKey: true }), false);
      assert.equal(await viewOf(), 'graph', 'the view does not change');
      assert.equal(await dispatchKey({ key: '/', code: 'Slash', ctrlKey: true }), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
    } finally {
      await page.evaluate(() => document.body.classList.remove('search-open'));
    }
  });
});
