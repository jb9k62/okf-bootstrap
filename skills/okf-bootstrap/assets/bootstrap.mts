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
 *   scripts/okf-rank.mts      : the ranking, shared by search and the viewer's search box (copied verbatim)
 *   scripts/okf-edukai.mts    : lessons, pins and re-checks for the memory bundle (copied verbatim)
 *   scripts/okf-edukai-hook.mts : what the harness hooks run, and lesson states (copied verbatim)
 *   scripts/okf-start.mjs     : loaded first by every npm script: Node's compile cache, so a
 *                               tool's TypeScript is stripped once and not on every run
 *   scripts/okf-update.mts    : brings these tools up to a later release (copied verbatim)
 *   scripts/.okf-bootstrap.json : the install manifest: version, and the sha256 of each generated
 *                               script and of each template, which okf-update.mts compares
 *   edukai/index.md, log.md   : with --edukai, the memory bundle: what agents have learned
 *   AGENTS.md                 : with --edukai, a short marked snippet pointing agents at it
 *   okf-concept-template.md   : authoring aid for a reference concept (outside the bundle)
 *   okf-explainer-template.md : authoring aid for a guided tour: callouts, widgets, a quiz
 *   packages/okf-widgets/     : with --widgets, the React micro-world package (a workspace)
 *
 * and adds the okf: npm scripts to package.json.
 *
 * Re-running is safe: authored files (index.md, log.md in either bundle, the ADR index and
 * template, the two authoring templates) are kept if they already exist, and only --force
 * replaces them. The AGENTS.md snippet is written once and never replaced.
 * packages/okf-widgets is the project's own code once scaffolded, so it is never replaced,
 * not even by --force. The tools under scripts/ are generated, so they are always
 * refreshed, and older .mjs copies of them are removed.
 *
 * Usage:
 *   node bootstrap.mts [target-dir] [--name "Project Name"] [--slug project-slug]
 *                      [--widgets] [--edukai] [--tools-only] [--no-scripts] [--force]
 *
 *   --name        Human title used in index.md (default: basename of target dir).
 *   --slug        Lowercase id for the concept dir (default: kebab-case of name).
 *   --widgets     Also scaffold packages/okf-widgets (React widgets for explainers), add it
 *                 to the npm workspaces, and build it before okf:view and the render gate.
 *   --edukai      Also scaffold edukai/, the agent memory bundle, add the edukai: scripts, and
 *                 write a short snippet into AGENTS.md (once; a marker guards it).
 *   --tools-only  Re-scaffold the tooling only (scripts/ + package.json scripts), leaving
 *                 existing okf/ content untouched. Use this to upgrade the tools in a
 *                 project that already has a bundle. Combine with --widgets to add widgets,
 *                 or with --edukai to add the memory bundle.
 *   --no-scripts  Do not add the `okf:` scripts to package.json.
 *   --force       Overwrite authored files with the templates again. This throws away
 *                 hand-written content, including log.md's history.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(HERE, 'templates');
// The producer stamped into scaffolded frontmatter (OKF actor convention: <producer>/<version>).
// Kept equal to package.json's version by the test suite.
const VERSION = '0.6.0';
const TOOLS = ['okf-view', 'okf-mermaid', 'okf-search', 'okf-core', 'okf-rank', 'okf-edukai', 'okf-edukai-hook'] as const;
const LEGACY_MJS: readonly string[] = ['okf-view', 'okf-mermaid'];
const UPDATE_TOOL = 'okf-update';
// Written into the target on every run that refreshes scripts/: which generated files came from
// this bootstrap, and their sha256, so a later run can tell generated content from edits.
const MANIFEST = path.join('scripts', '.okf-bootstrap.json');
// The templates the manifest records, keyed by their path under templates/. okf-update.mts has
// the same list (TEMPLATE_MAP), with where each is scaffolded.
const MANIFEST_TEMPLATES: readonly string[] = [
  'okf/index.md',
  'okf/log.md',
  'okf/adr/readme.md',
  'okf/adr/template.md',
  'edukai/index.md',
  'edukai/log.md',
  'concept.md',
  'explainer.md',
];
const WIDGETS_DIR = 'packages/okf-widgets';
const WIDGETS_PKG = 'okf-widgets';
// The snippet is written into AGENTS.md once; this marker is how a re-run knows it is there.
const EDUKAI_MARKER = '<!-- edukai -->';
const EDUKAI_SNIPPET = [
  EDUKAI_MARKER,
  'This project keeps agent memory in ./edukai/. Lines that start `edukai:` in messages and tool',
  'results come from its memory hooks; treat them as project guidance. At the start of a session run',
  '`npm run edukai:brief` and read the overview of the domain you will work in. Record what you',
  'learn with the edukai skill. Before finishing, run `npm run edukai:recheck`.',
  '<!-- /edukai -->',
].join('\n');

interface Options {
  dir: string;
  name: string | null;
  slug: string | null;
  scripts: boolean;
  toolsOnly: boolean;
  force: boolean;
  widgets: boolean;
  edukai: boolean;
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
    edukai: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--name') out.name = argv[++i] ?? null;
    else if (a === '--slug') out.slug = argv[++i] ?? null;
    else if (a === '--tools-only') out.toolsOnly = true;
    else if (a === '--no-scripts') out.scripts = false;
    else if (a === '--force') out.force = true;
    else if (a === '--widgets') out.widgets = true;
    else if (a === '--edukai') out.edukai = true;
    else if (a === '-h' || a === '--help') {
      console.log(
        'usage: node bootstrap.mts [target-dir] [--name "Project Name"] [--slug slug]\n' +
          '                          [--widgets] [--edukai] [--tools-only] [--no-scripts] [--force]',
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

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
// A project keeps the name it was scaffolded with: the manifest remembers it, so a re-run (or an
// update) renders templates with the same PROJECT_NAME and not the folder's name.
function previousManifest(): { name?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8')) as { name?: string };
  } catch {
    return null;
  }
}
const previous = previousManifest();
const name = opts.name ?? (typeof previous?.name === 'string' ? previous.name : path.basename(target));
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

// --- memory bundle (--edukai) -------------------------------------------------
// Opt-in, and unlike okf/ it may be added to a project that already has a design bundle, so
// --tools-only does not skip it.
const edukai = path.join(target, 'edukai');
if (opts.edukai) {
  for (const rel of ['index.md', 'log.md']) {
    const dest = path.join(edukai, rel);
    writeUnlessPresent(dest, () => writeRendered(path.join(TEMPLATES, 'edukai', rel), dest, vars));
  }
  // For agents with no hooks (a skills-only install, or another harness): the same pointer,
  // in the file they read at the start of a session.
  const agents = path.join(target, 'AGENTS.md');
  const existing = fs.existsSync(agents) ? fs.readFileSync(agents, 'utf8') : null;
  if (existing !== null && existing.includes(EDUKAI_MARKER)) {
    kept.push('AGENTS.md (the edukai snippet is already there)');
  } else {
    const lead = existing === null ? '# AGENTS.md\n\n' : existing.replace(/\n*$/, '\n\n');
    fs.writeFileSync(agents, lead + EDUKAI_SNIPPET + '\n');
    created.push(existing === null ? 'AGENTS.md' : 'AGENTS.md (added the edukai snippet)');
  }
}
// A project that already has the memory bundle keeps its scripts, even on a plain re-run.
const hasEdukai = fs.existsSync(path.join(edukai, 'index.md'));

// --- tooling ----------------------------------------------------------------
// The scripts are generated copies, so they are always refreshed; that is the point of
// --tools-only. A project bootstrapped before the tools became TypeScript has .mjs copies;
// they are removed so there is one copy of each tool, and package.json points at the new one.
copyFile(path.join(HERE, 'okf-start.mjs'), path.join(target, 'scripts', 'okf-start.mjs'));
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
const generated = ['okf-start.mjs', ...TOOLS.map((tool) => `${tool}.mts`)];
// okf-update is copied only when this bootstrap ships its source.
const updateSrc = path.join(HERE, `${UPDATE_TOOL}.mts`);
if (fs.existsSync(updateSrc)) {
  copyFile(updateSrc, path.join(target, 'scripts', `${UPDATE_TOOL}.mts`));
  generated.push(`${UPDATE_TOOL}.mts`);
}
// The authoring templates are aids people edit, so they follow the bundle content's rule.
for (const [template, dest] of [
  ['concept.md', 'okf-concept-template.md'],
  ['explainer.md', 'okf-explainer-template.md'],
] as const) {
  // A tools-only run on a project that has been bootstrapped before (it has a manifest) does not
  // bring back an aid someone deleted.
  if (opts.toolsOnly && previous !== null) continue;
  const out = path.join(target, dest);
  writeUnlessPresent(out, () => copyFile(path.join(TEMPLATES, template), out));
}

// The manifest lists the generated scripts with the hash of what was written, keys sorted, and
// the hash of each template this version ships, so okf-update can tell which ones a release
// changed. It is generated, so it is always overwritten, like the scripts it describes (which
// --no-scripts refreshes too; that flag is about package.json).
{
  const files: Record<string, string> = {};
  for (const name of [...generated].sort()) {
    files[`scripts/${name}`] = sha256(path.join(target, 'scripts', name));
  }
  const templates: Record<string, string> = {};
  for (const rel of MANIFEST_TEMPLATES) {
    if (fs.existsSync(path.join(TEMPLATES, rel))) templates[rel] = sha256(path.join(TEMPLATES, rel));
  }
  fs.writeFileSync(path.join(target, MANIFEST), JSON.stringify({ version: VERSION, name, files, templates }, null, 2) + '\n');
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
      pkg.scripts['okf:validate'] = 'node --import ./scripts/okf-start.mjs scripts/okf-view.mts okf --validate';
      pkg.scripts['okf:fix'] = 'node --import ./scripts/okf-start.mjs scripts/okf-view.mts okf --validate --fix';
      pkg.scripts['okf:view'] = build + 'node --import ./scripts/okf-start.mjs scripts/okf-view.mts okf';
      pkg.scripts['okf:mermaid'] = 'node --import ./scripts/okf-start.mjs scripts/okf-mermaid.mts okf';
      pkg.scripts['okf:search'] = 'node --import ./scripts/okf-start.mjs scripts/okf-search.mts';
      pkg.scripts['okf:mermaid:render'] = build + 'node --import ./scripts/okf-start.mjs scripts/okf-view.mts okf --check-render';
      pkg.scripts['okf:recheck'] = 'node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts recheck --bundle okf';
      pkg.scripts['okf:update'] = 'node --import ./scripts/okf-start.mjs scripts/okf-update.mts';
      if (hasEdukai) {
        pkg.scripts['edukai:validate'] =
          'node --import ./scripts/okf-start.mjs scripts/okf-view.mts edukai --validate --strict && node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index --check';
        pkg.scripts['edukai:index'] = 'node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index';
        pkg.scripts['edukai:recheck'] = 'node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts recheck';
        pkg.scripts['edukai:brief'] = 'node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index && node --import ./scripts/okf-start.mjs scripts/okf-edukai-hook.mts brief';
        pkg.scripts['edukai:search'] = 'node --import ./scripts/okf-start.mjs scripts/okf-search.mts --bundle edukai';
        pkg.scripts['edukai:view'] = 'node --import ./scripts/okf-start.mjs scripts/okf-view.mts edukai';
      }
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
      console.log(`  added the okf: ${hasEdukai ? 'and edukai: ' : ''}scripts to ` + pkgPath);
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
console.log('  scripts/okf-rank.mts       (the ranking, also run in the viewer)  refreshed');
console.log('  scripts/okf-edukai.mts     (lessons, pins and re-checks)          refreshed');
console.log('  scripts/okf-edukai-hook.mts (harness hooks, lesson states)        refreshed');
console.log('  scripts/okf-start.mjs      (compile cache, loaded by the scripts) refreshed');
if (fs.existsSync(updateSrc)) console.log('  scripts/okf-update.mts     (updates these tools to a release)     refreshed');
if (opts.edukai) console.log('  edukai/                    (the agent memory bundle: lessons are added as agents learn)');
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
console.log('  npm run okf:recheck         # do the files that concepts cite still say what was pinned?');
console.log('  npm run okf:update          # what a newer release would change in the tools (-- --apply to do it)');
if (hasEdukai) {
  console.log('\nMemory bundle (edukai/):');
  console.log('  npm run edukai:index        # rebuild the syllabus and the cache the hooks read (run once after a clone)');
  console.log('  npm run edukai:brief        # what an agent is told when a session opens');
  console.log('  npm run edukai:recheck      # lessons that need an agent: broken, failed, suspect, stale');
  console.log('  npm run edukai:validate     # lesson rules, supersede pointers, budgets, a current syllabus');
  console.log('  npm run edukai:search -- search "query"');
  console.log('  CI: copy ' + path.join(TEMPLATES, 'edukai-recheck.yml') + ' to .github/workflows/ (not installed for you)');
}
if (hasWidgets) {
  console.log('  npm run okf:widgets:typecheck && npm run okf:widgets:test');
}
console.log('\nThe tools are .mts: Node 24+ runs them as-is, and no package.json "type" change');
console.log("is needed. Next: author the first concepts, then commit. The skill's PLAYBOOK.md");
console.log('has the full procedure, and EXPLAINERS.md covers tours, quizzes and widgets.');
