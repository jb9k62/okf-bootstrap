#!/usr/bin/env node
/**
 * Regenerate the README images from the demo bundle, so they follow the viewer as it improves.
 *
 *   node scripts/screenshots.mts [--out docs/images] [--only viewer,widget-herd,quiz]
 *
 * Builds the example widgets, writes the demo viewer to .cache/, opens it in headless Chromium
 * (playwright), and saves each shot in a light and a dark variant: <name>-light.png and
 * <name>-dark.png, which the README pairs with <picture> so GitHub shows the one matching the
 * reader's theme. The .github/workflows/screenshots.yml workflow runs this and commits changes to the
 * chore/screenshots branch.
 *
 * Needs `npx playwright install chromium`, and network access: the viewer loads its libraries
 * from a CDN. Fonts come from the machine, so shots taken locally and in CI can differ slightly.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'skills', 'okf-bootstrap', 'assets');
const WIDGETS = path.join(ASSETS, 'templates', 'okf-widgets', 'dist', 'okf-widgets.js');
const VIEWER = path.join(ROOT, '.cache', 'screenshots', 'viz.html');

interface Shot {
  name: string;
  /** Concept id to open (the viewer's URL hash). */
  concept: string;
  viewport: { width: number; height: number };
  /** Sharper images for small crops; the full viewer stays at 1x to keep the file small. */
  scale: number;
  /**
   * Prepare the page, and return the elements whose combined box is captured (with some
   * padding), or an empty list for the whole viewport.
   */
  prepare: (page: Page) => Promise<string[]>;
}

const WIDGET = 'figure.okfw[data-widget="retry-backoff"]';

/** The retry widget after clicking one of its presets. */
const widgetPreset = (preset: string) => async (page: Page) => {
  await page.locator(WIDGET).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: preset }).click();
  return [WIDGET];
};

const SHOTS: Shot[] = [
  {
    // The whole viewer: graph, legend and reading pane, on a concept with a diagram.
    name: 'viewer',
    concept: 'parcel-tracker/architecture',
    viewport: { width: 1440, height: 900 },
    scale: 1,
    prepare: async () => [],
  },
  {
    // The same widget in two states: the lesson is the difference between them.
    name: 'widget-herd',
    concept: 'tours/retries-explainer',
    viewport: { width: 1280, height: 1100 },
    scale: 2,
    prepare: widgetPreset('No jitter: the thundering herd'),
  },
  {
    name: 'widget-jitter',
    concept: 'tours/retries-explainer',
    viewport: { width: 1280, height: 1100 },
    scale: 2,
    prepare: widgetPreset('Full jitter'),
  },
  {
    // The first quiz question after a wrong answer, so the feedback and the score show.
    name: 'quiz',
    concept: 'tours/retries-explainer',
    viewport: { width: 1280, height: 1100 },
    scale: 2,
    prepare: async (page) => {
      const card = '#detail-body .quiz .quiz-card >> nth=0';
      await page.locator(card).scrollIntoViewIfNeeded();
      await page.locator(card).locator('button').first().click();
      return ['#detail-body .quiz .quiz-score', card];
    },
  },
];

const PADDING = 16;

function run(command: string, args: string[]): void {
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${r.status}`);
}

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outDir = path.resolve(ROOT, flag('--out') ?? 'docs/images');
const only = flag('--only')?.split(',');
const shots = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;

run('npm', ['run', 'build', '-w', 'okf-widgets']);
run(process.execPath, [
  path.join(ASSETS, 'okf-view.mts'),
  'examples/demo/okf',
  '--out',
  VIEWER,
  '--widgets',
  WIDGETS,
  '--strict',
]);

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const shot of shots) {
    for (const theme of ['light', 'dark'] as const) {
      const page = await browser.newPage({
        viewport: shot.viewport,
        deviceScaleFactor: shot.scale,
        colorScheme: theme,
      });
      await page.goto(`${pathToFileURL(VIEWER).href}#${shot.concept}`);
      await page.waitForFunction('window.__OKF_VIEW__ && window.mermaid && window.cytoscape');
      // Every diagram settled, and the graph layout finished animating.
      await page.waitForFunction(
        () => !document.querySelector("#detail-body .mermaid[data-state='pending']"),
      );
      await page.waitForTimeout(1500);
      const selectors = await shot.prepare(page);
      await page.waitForTimeout(300);
      const file = path.join(outDir, `${shot.name}-${theme}.png`);
      if (selectors.length === 0) {
        await page.screenshot({ path: file });
      } else {
        const boxes = [];
        for (const selector of selectors) {
          const box = await page.locator(selector).boundingBox();
          if (!box) throw new Error(`${shot.name}: ${selector} is not visible`);
          boxes.push(box);
        }
        const x = Math.min(...boxes.map((b) => b.x)) - PADDING;
        const y = Math.min(...boxes.map((b) => b.y)) - PADDING;
        const right = Math.max(...boxes.map((b) => b.x + b.width)) + PADDING;
        const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + PADDING;
        await page.screenshot({ path: file, clip: { x, y, width: right - x, height: bottom - y } });
      }
      console.log(`  ${path.relative(ROOT, file)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
