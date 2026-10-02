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
    await page.fill('#search', 'zzqqxxnomatch');
    assert.equal(await page.locator('#concept-table tbody tr').count(), 0);
    assert.equal(await page.locator('#table-empty').isVisible(), true);
    await page.fill('#search', '');
    await page.click('[data-view=graph]');
  });

  view('ranked search lists results with trust and freshness, and Enter opens the first', async () => {
    await page.click('#reset');
    await page.focus('#search');
    await page.keyboard.type('retry jitter');
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
    await page.selectOption('#search-mode', 'contains');
    assert.equal(await page.locator('#concept-table th:last-child').isHidden(), true);
    assert.ok((await rowCount()) > 0);
    await page.selectOption('#search-mode', 'ranked');
    // Trust and freshness narrow ranked results.
    await page.selectOption('#filter-trust', 'human-reviewed');
    const human = await rowCount();
    assert.ok(human > 0 && human < ranked, `human-reviewed ${human} of ${ranked}`);
    await page.selectOption('#filter-trust', '');
    await page.fill('#search', '');
    await page.selectOption('#filter-fresh', 'stale');
    assert.equal(await rowCount(), 1, 'the demo has one stale concept');
    await page.click('#reset');
    assert.equal(await rowCount(), all);
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

  view('reset in neighbourhood mode clears filters and keeps the neighbourhood in view', async () => {
    const ids: string[] = await page.evaluate('window.__OKF_VIEW__.ids');
    await page.evaluate((id) => window.__OKF_VIEW__.show(id), ids[0]!);
    await page.click('#hood-toggle');
    const before: string[] = await page.evaluate('window.__OKF_VIEW__.visibleIds()');
    assert.ok(before.length < ids.length);

    await page.fill('#search', 'zzzz');
    await page.keyboard.press('Escape'); // close the results list, which can sit over Reset
    await page.click('#reset');
    assert.equal(await page.inputValue('#search'), '');
    assert.equal(await page.getAttribute('#hood-toggle', 'aria-pressed'), 'true');
    assert.deepEqual(new Set(await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]), new Set(before));
    assert.equal(await page.evaluate('window.__OKF_VIEW__.inView()'), true);

    await page.click('#hood-toggle');
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
    await page.click('#hood-toggle');
    const shown: string[] = await page.evaluate('window.__OKF_VIEW__.visibleIds()');
    await page.click('#reading-toggle');
    await page.click('#reading-toggle');
    assert.deepEqual(new Set(await page.evaluate('window.__OKF_VIEW__.visibleIds()') as string[]), new Set(shown));
    assert.equal(await page.evaluate('window.__OKF_VIEW__.inView()'), true);
    await page.click('#hood-toggle');
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

  view('on a phone the top bar stays compact and the page does not scroll sideways', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      const m = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const chips = document.querySelector('.chips') as HTMLElement;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          topbar: box('.topbar').height,
          searchWidth: box('#search').width,
          searchAboveChips: box('#search').bottom <= box('.chips').top,
          chipsScroll: chips.scrollWidth > chips.clientWidth,
          legendInPane: box('#legend').right <= box('#graph-pane').right,
          detail: box('#detail').height,
        };
      });
      assert.equal(m.scrollWidth, 390, 'page width equals the viewport');
      assert.ok(m.topbar < 844 * 0.25, `top bar is ${m.topbar}px tall`);
      assert.ok(m.searchWidth > 390 - 40, 'search fills the row');
      assert.equal(m.searchAboveChips, true);
      assert.equal(m.chipsScroll, true, 'the controls row scrolls instead of wrapping');
      assert.equal(m.legendInPane, true);
      assert.ok(m.detail > 844 * 0.4, `reading pane is ${m.detail}px tall`);
    } finally {
      await page.setViewportSize({ width: 1400, height: 800 });
    }
  });
});
