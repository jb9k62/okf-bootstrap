#!/usr/bin/env node
/**
 * Bootstrap an OKF knowledge bundle + tooling into a project.
 *
 * TypeScript that Node runs directly (type stripping, Node 24+): no build step, no install.
 *
 * Scaffolds into a target project directory (default: current dir):
 *   okf/index.md              : bundle root index (reserved, no `type` needed)
 *   okf/log.md                : update history (reserved)
 *   okf/adr/readme.md         : decision records index (type: Reference)
 *   okf/adr/template.md       : ADR template (type: Reference)
 *   scripts/okf-view.mts      : validator + viewer + render gate (copied verbatim)
 *   scripts/okf-mermaid.mts   : mermaid parse checker via mmdc (copied verbatim)
 *   scripts/okf-search.mts    : ranked, freshness-aware search for agents (copied verbatim)
 *   scripts/okf-core.mts      : parsing shared by the view and search tools (copied verbatim)
 *   okf-concept-template.md   : authoring aid for a reference concept (outside the bundle)
 *   okf-explainer-template.md : authoring aid for a guided tour: callouts, widgets, a quiz
 *   packages/okf-widgets/     : with --widgets, the React micro-world package (a workspace)
 *
 * and adds the okf: npm scripts to package.json.
 *
 * Re-running is safe: authored files (index.md, log.md, the ADR index and template, the two
 * authoring templates) are kept if they already exist, and only --force replaces them.
 * packages/okf-widgets is the project's own code once scaffolded, so it is never replaced,
 * not even by --force. The tools under scripts/ are generated, so they are always
 * refreshed, and older .mjs copies of them are removed.
 *
 * Usage:
 *   node bootstrap.mts [target-dir] [--name "Project Name"] [--slug project-slug]
 *                      [--widgets] [--tools-only] [--no-scripts] [--force]
 *
 *   --name        Human title used in index.md (default: basename of target dir).
 *   --slug        Lowercase id for the concept dir (default: kebab-case of name).
 *   --widgets     Also scaffold packages/okf-widgets (React widgets for explainers), add it
 *                 to the npm workspaces, and build it before okf:view and the render gate.
 *   --tools-only  Re-scaffold the tooling only (scripts/ + package.json scripts), leaving
 *                 existing okf/ content untouched. Use this to upgrade the tools in a
 *                 project that already has a bundle. Combine with --widgets to add widgets.
 *   --no-scripts  Do not add the `okf:` scripts to package.json.
 *   --force       Overwrite authored files with the templates again. This throws away
 *                 hand-written content, including log.md's history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, 'templates');
// The producer stamped into scaffolded frontmatter (OKF actor convention: <producer>/<version>).
// Kept equal to package.json's version by the test suite.
const VERSION = '0.3.0';
const TOOLS = ['okf-view', 'okf-mermaid', 'okf-search', 'okf-core'] as const;
const LEGACY_MJS: readonly string[] = ['okf-view', 'okf-mermaid'];
const WIDGETS_DIR = 'packages/okf-widgets';
const WIDGETS_PKG = 'okf-widgets';

interface Options {
  dir: string;
  name: string | null;
  slug: string | null;
  scripts: boolean;
  toolsOnly: boolean;
  force: boolean;
  widgets: boolean;
}

type Vars = Record<string, string>;

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'okf';
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function render(text: string, vars: Vars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `<${k}>`);
}

function parseArgs(argv: string[]): Options {
  const out: Options = {
    dir: '.',
    name: null,
    slug: null,
    scripts: true,
    toolsOnly: false,
    force: false,
    widgets: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--name') out.name = argv[++i] ?? null;
    else if (a === '--slug') out.slug = argv[++i] ?? null;
    else if (a === '--tools-only') out.toolsOnly = true;
    else if (a === '--no-scripts') out.scripts = false;
    else if (a === '--force') out.force = true;
    else if (a === '--widgets') out.widgets = true;
    else if (a === '-h' || a === '--help') {
      console.log(
        'usage: node bootstrap.mts [target-dir] [--name "Project Name"] [--slug slug]\n' +
          '                          [--widgets] [--tools-only] [--no-scripts] [--force]',
      );
      process.exit(0);
    } else if (a.startsWith('-')) {
      console.error('Unknown flag: ' + a);
      process.exit(2);
    } else out.dir = a;
  }
  return out;
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeRendered(src: string, dest: string, vars: Vars): void {
  const text = fs.readFileSync(src, 'utf8');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, render(text, vars));
}

/** Copy a template directory, leaving out what a build or an install left behind. */
function copyTree(src: string, dest: string): void {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path.relative(src, from)),
  });
}

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `Node ${process.versions.node} cannot run TypeScript directly. The OKF tools need Node 24+ ` +
      '(22.18+ works too).',
  );
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
const target = path.resolve(opts.dir);
const created: string[] = [];
const kept: string[] = [];
const removed: string[] = [];
const shortPath = (p: string) => path.relative(target, p) || p;

/**
 * Authored content is never replaced without --force: log.md is a history, index.md and
 * adr/readme.md are indexes that get filled in by hand, and a re-run to refresh the tools
 * should not cost any of it.
 */
function writeUnlessPresent(dest: string, write: () => void): boolean {
  if (fs.existsSync(dest) && !opts.force) {
    kept.push(shortPath(dest));
    return false;
  }
  write();
  created.push(shortPath(dest));
  return true;
}

if (!fs.existsSync(target)) {
  console.error(`Target dir not found: ${target}`);
  process.exit(2);
}
const name = opts.name ?? path.basename(target);
const slug = opts.slug ?? kebab(name);
const vars: Vars = {
  PROJECT_NAME: name,
  PROJECT_SLUG: slug,
  TODAY: today(),
  // OKF timestamps are ISO 8601 datetimes with an offset (SPEC §5).
  NOW: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  VERSION,
};

// --- bundle skeleton (skipped entirely by --tools-only) ---------------------
const okf = path.join(target, 'okf');
if (opts.toolsOnly) {
  if (!fs.existsSync(okf)) {
    console.error(`--tools-only needs an existing okf/ bundle in ${target}`);
    process.exit(2);
  }
} else {
  fs.mkdirSync(path.join(okf, 'adr'), { recursive: true });
  for (const extra of ['design', slug]) {
    fs.mkdirSync(path.join(okf, extra), { recursive: true });
    if (!fs.existsSync(path.join(okf, extra, '.gitkeep'))) {
      fs.writeFileSync(path.join(okf, extra, '.gitkeep'), '');
    }
  }
  for (const rel of ['index.md', 'log.md', 'adr/readme.md', 'adr/template.md']) {
    const dest = path.join(okf, rel);
    writeUnlessPresent(dest, () => writeRendered(path.join(TEMPLATES, 'okf', rel), dest, vars));
  }
}

// --- tooling ----------------------------------------------------------------
// The scripts are generated copies, so they are always refreshed; that is the point of
// --tools-only. A project bootstrapped before the tools became TypeScript has .mjs copies;
// they are removed so there is one copy of each tool, and package.json points at the new one.
for (const tool of TOOLS) {
  copyFile(path.join(HERE, `${tool}.mts`), path.join(target, 'scripts', `${tool}.mts`));
  // Only the two tools that once shipped as .mjs have a legacy copy; a project's own
  // scripts/okf-search.mjs is not ours to delete.
  const legacy = path.join(target, 'scripts', `${tool}.mjs`);
  if (LEGACY_MJS.includes(tool) && fs.existsSync(legacy)) {
    fs.rmSync(legacy);
    removed.push(shortPath(legacy));
  }
}
// The authoring templates are aids people edit, so they follow the bundle content's rule.
for (const [template, dest] of [
  ['concept.md', 'okf-concept-template.md'],
  ['explainer.md', 'okf-explainer-template.md'],
] as const) {
  const out = path.join(target, dest);
  writeUnlessPresent(out, () => copyFile(path.join(TEMPLATES, template), out));
}

// --- widgets ------------------------------------------------------------------
const widgetsPath = path.join(target, WIDGETS_DIR);
if (opts.widgets) {
  if (fs.existsSync(widgetsPath)) {
    kept.push(WIDGETS_DIR + '/ (project code; never replaced, not even by --force)');
  } else {
    copyTree(path.join(TEMPLATES, 'okf-widgets'), widgetsPath);
    created.push(WIDGETS_DIR + '/');
  }
}
// A project that already has the package keeps getting it built, even on a plain re-run.
const hasWidgets = fs.existsSync(path.join(widgetsPath, 'package.json'));

// --- package.json -------------------------------------------------------------
if (opts.scripts) {
  const pkgPath = path.join(target, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.scripts = pkg.scripts || {};
      const build = hasWidgets ? 'npm run okf:widgets:build && ' : '';
      pkg.scripts['okf:validate'] = 'node scripts/okf-view.mts okf --validate';
      pkg.scripts['okf:fix'] = 'node scripts/okf-view.mts okf --validate --fix';
      pkg.scripts['okf:view'] = build + 'node scripts/okf-view.mts okf';
      pkg.scripts['okf:mermaid'] = 'node scripts/okf-mermaid.mts okf';
      pkg.scripts['okf:search'] = 'node scripts/okf-search.mts';
      pkg.scripts['okf:mermaid:render'] = build + 'node scripts/okf-view.mts okf --check-render';
      if (hasWidgets) {
        pkg.scripts['okf:widgets:build'] = `npm run build -w ${WIDGETS_PKG}`;
        pkg.scripts['okf:widgets:test'] = `npm test -w ${WIDGETS_PKG}`;
        pkg.scripts['okf:widgets:typecheck'] = `npm run typecheck -w ${WIDGETS_PKG}`;
        // npm workspaces: the widget package's devDependencies install with the project's.
        const workspaces: unknown = pkg.workspaces;
        if (workspaces !== undefined && !Array.isArray(workspaces)) {
          console.warn(
            `  package.json "workspaces" is not an array; add "${WIDGETS_DIR}" to it by hand.`,
          );
        } else {
          const list = (workspaces ?? []) as string[];
          const covered = list.some((w) => w === WIDGETS_DIR || w === 'packages/*');
          if (!covered) {
            pkg.workspaces = [...list, WIDGETS_DIR];
            console.log(`  added ${WIDGETS_DIR} to the npm workspaces`);
          }
        }
      }
      // okf-view.mts imports `yaml`. Without it the tool dies on a raw ERR_MODULE_NOT_FOUND
      // that says nothing about this scaffold.
      const hasYaml = pkg.dependencies?.yaml || pkg.devDependencies?.yaml;
      if (!hasYaml) {
        pkg.devDependencies = pkg.devDependencies || {};
        pkg.devDependencies.yaml = '^2.9.1';
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log('  added the okf: scripts to ' + pkgPath);
      if (!hasYaml) console.log('  added the yaml devDependency; run npm install');
    } catch (e) {
      console.warn(
        '  could not edit package.json (' + (e as Error).message + '); add scripts manually.',
      );
    }
  } else {
    console.warn(
      '  no package.json found; add the okf: scripts manually (see templates/package-json-scripts.md).',
    );
  }
}

// --- report -------------------------------------------------------------------
console.log('\nBootstrapped OKF bundle + tooling in: ' + target);
if (!opts.toolsOnly) console.log(`  okf/${slug}/, okf/design/   (fill with your first concepts)`);
console.log('  scripts/okf-view.mts       (validator + viewer + --check-render)  refreshed');
console.log('  scripts/okf-mermaid.mts    (mermaid parse check via mmdc)         refreshed');
console.log('  scripts/okf-search.mts     (ranked, freshness-aware search)       refreshed');
console.log('  scripts/okf-core.mts       (parsing shared by view and search)    refreshed');
if (created.length) {
  console.log('\nCreated:');
  for (const f of created) console.log('  ' + f);
}
if (kept.length) {
  console.log('\nKept (already there, not touched; --force replaces the authored files):');
  for (const f of kept) console.log('  ' + f);
}
if (removed.length) {
  console.log('\nRemoved (replaced by the .mts tools):');
  for (const f of removed) console.log('  ' + f);
}
console.log('\nSet up (once):');
console.log('  npm install');
console.log('  npm i -D @mermaid-js/mermaid-cli@11 playwright && npx playwright install chromium');
console.log('\nChecks (expect all to pass before you commit):');
console.log('  npm run okf:validate        # frontmatter + link conformance');
console.log('  npm run okf:fix             # write the relationship key under every ER diagram');
console.log('  npm run okf:view            # validate + write okf/viz.html');
console.log('  npm run okf:mermaid         # every mermaid block parses (needs mmdc)');
console.log('  npm run okf:mermaid:render  # every diagram, quiz and widget works in the viewer');
console.log('  npm run okf:search -- search "query"   # find concepts before reading them');
if (hasWidgets) {
  console.log('  npm run okf:widgets:typecheck && npm run okf:widgets:test');
}
console.log('\nThe tools are .mts: Node 24+ runs them as-is, and no package.json "type" change');
console.log("is needed. Next: author the first concepts, then commit. The skill's PLAYBOOK.md");
console.log('has the full procedure, and EXPLAINERS.md covers tours, quizzes and widgets.');
