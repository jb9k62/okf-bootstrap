#!/usr/bin/env node
/**
 * OKF bundle validator and viewer (targets OKF_VERSION below).
 *
 * Walks a bundle, checks conformance (SPEC §11: every non-reserved .md needs
 * frontmatter with a non-empty `type`), derives trust tier (§5.3) and
 * staleness (§5.5), then writes one self-contained HTML page: a concept graph
 * (Cytoscape) beside a reading pane (marked for markdown, Mermaid for
 * diagrams, which get their own pan/zoom canvas and toolbar). The libraries
 * load from a CDN. Based on the viewer in
 * GoogleCloudPlatform/knowledge-catalog.
 *
 * TypeScript that Node runs directly (type stripping, Node 24+), so no build step.
 * Callouts ([!note] blockquotes), ```quiz blocks and ```widget blocks (React
 * micro-worlds from packages/okf-widgets) render in the reading pane too.
 *
 * Usage:
 *   node scripts/okf-view.mts [bundle] [options]
 *     bundle        OKF bundle directory (default: ./okf)
 *     --out <f>     write the viewer here (default: <bundle>/viz.html)
 *     --validate    validate only; do not write the viewer
 *     --check-render  write the viewer, then open it in headless Chromium
 *                     (via playwright) and verify every Mermaid diagram
 *                     actually renders client-side and carries working
 *                     pan/zoom controls. Exit 1 if a diagram fails, 2 if the
 *                     check could not run at all (no playwright, no Chromium,
 *                     CDN unreachable).
 *     --strict      exit 1 if any conformance issues are found
 *     --widgets <f> the built widget bundle to inline (default:
 *                   packages/okf-widgets/dist/okf-widgets.js next to scripts/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

type Frontmatter = Record<string, unknown>;
type Evidence = Record<string, unknown>;

interface Issue {
  file: string;
  kind: string;
  message: string;
}

interface Concept {
  id: string;
  type: string;
  title: string;
  description: string;
  resource: string;
  tags: string[];
  status: string;
  generated: object;
  verified: Evidence[];
  stale_after: string;
  render_expect: Record<string, number> | null;
  sources: object[];
  trust_tier: string;
  stale: boolean;
  body: string;
  links_to: string[];
}

interface Graph {
  nodes: Array<{ data: Record<string, unknown> }>;
  edges: Array<{ data: { id: string; source: string; target: string } }>;
  bodies: Record<string, string>;
  expects: Record<string, Record<string, number>>;
  types: string[];
  palette: Record<string, string>;
  defaultColor: string;
}

interface Options {
  bundle: string;
  out: string | null;
  validateOnly: boolean;
  strict: boolean;
  checkRender: boolean;
  widgets: string | null;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// The hooks the generated page exposes, which the render gate drives from inside Chromium.
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- page-side API, untyped
    __OKF_VIEW__: any;
    BUNDLE: { expects?: Record<string, Record<string, number>> };
  }
}

// Bundle-relative, so only the bundle root's own index.md/log.md are reserved.
// A nested design/index.md is an ordinary concept and needs a `type`.
const RESERVED = new Set(['index.md', 'log.md']);

// The OKF spec version this tool implements. A bundle's index.md may declare
// `okf_version`; a different value is reported (not an error), because the spec
// asks consumers for best-effort reading of other versions (SPEC §12).
const OKF_VERSION = '0.2';

// The interactive React widgets (packages/okf-widgets), inlined so the viewer stays one file.
// Build them first with `npm run okf:widgets:build`; without the bundle the viewer still
// works and each widget block shows how to build it.
const DEFAULT_WIDGETS_BUNDLE = fileURLToPath(
  new URL('../packages/okf-widgets/dist/okf-widgets.js', import.meta.url),
);

function readWidgetsBundle(file: string): string | null {
  try {
    // A "</script" inside the bundle would end the inline block early.
    return fs
      .readFileSync(file, 'utf8')
      .replace(/<\/script/gi, '<\\/script');
  } catch {
    return null;
  }
}
const LINK_RE = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)/g;

// --- document parsing (mirrors reference_agent/bundle/document.py) ----------

function parseDocument(text: string): { frontmatter: Frontmatter; body: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length === 0 || lines[0]!.trim() !== '---') {
    return { frontmatter: {}, body: text };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) throw new Error('Unterminated YAML frontmatter block');
  const fmText = lines.slice(1, endIdx).join('\n');
  let fm: unknown;
  try {
    fm = YAML.parse(fmText) ?? {};
  } catch (e) {
    throw new Error(`Invalid YAML in frontmatter: ${errorMessage(e)}`);
  }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }
  let body = lines.slice(endIdx + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatter: fm as Frontmatter, body };
}

function normalizeVerified(fm: Frontmatter): Evidence[] {
  const v = fm.verified;
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object');
  if (typeof v === 'object') return [v as Evidence];
  return [];
}

function trustTier(fm: Frontmatter): string {
  const ev = normalizeVerified(fm);
  if (ev.length === 0) return 'unverified';
  if (ev.some((e) => String(e.by || '').startsWith('human:')))
    return 'human-reviewed';
  return 'machine-confirmed';
}

// SPEC §5: every timestamp is an ISO 8601 datetime with an explicit UTC offset.
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Timestamp-valued keys that are not a datetime with an offset, as "key: value". */
function badTimestamps(fm: Frontmatter): string[] {
  const found: Array<[string, unknown]> = [['stale_after', fm.stale_after]];
  if (fm.generated && typeof fm.generated === 'object') {
    found.push(['generated.at', (fm.generated as Evidence).at]);
  }
  normalizeVerified(fm).forEach((v, i) => found.push([`verified[${i}].at`, v.at]));
  return found
    .filter(([, value]) => value != null && !TIMESTAMP_RE.test(String(value)))
    .map(([key, value]) => `${key}: ${String(value)}`);
}

function isStale(fm: Frontmatter, today: Date): boolean {
  const raw = fm.stale_after;
  if (!raw) return false;
  // A date-only value (reported as a timestamp issue) is read as midnight UTC.
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return false;
  return (today || new Date()) >= d;
}

// --- link extraction (mirrors reference viewer _extract_links) --------------

/**
 * Blank out fenced blocks and inline code spans. Markdown inside them is shown
 * verbatim rather than rendered, so a link written there is not a link: it must
 * not become a graph edge, and must not be reported as a dangling one either.
 * Best effort, and deliberately line-based: an unbalanced backtick leaves its
 * line alone rather than swallowing the rest of the document.
 */
function stripCode(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        m &&
        m[2]![0] === fence.char &&
        m[2]!.length >= fence.len &&
        m[3]!.trim() === ''
      )
        fence = null;
      out.push('');
    } else if (m) {
      fence = { char: m[2]![0]!, len: m[2]!.length };
      out.push('');
    } else {
      out.push(line.replace(/(`+)(.*?)\1/g, ' '));
    }
  }
  return out.join('\n');
}

function extractLinks(body: string, docDir: string, bundleRoot: string): string[] {
  const out = new Set<string>();
  const rootResolved = path.resolve(bundleRoot);
  for (const m of stripCode(body).matchAll(LINK_RE)) {
    const target = m[1]!;
    if (/^[a-z]+:\/\//i.test(target)) continue; // external URL
    // Absolute bundle-relative form (OKF §6.1, recommended) resolves against
    // the bundle root.
    const base = target.startsWith('/') ? rootResolved : docDir;
    const relTarget = target.replace(/^\/+/, '');
    let resolved;
    try {
      resolved = path.relative(rootResolved, path.resolve(base, relTarget));
    } catch {
      continue;
    }
    if (resolved.startsWith('..') || path.isAbsolute(resolved)) continue;
    const rel = resolved.split(path.sep).join('/');
    out.add(rel.endsWith('.md') ? rel.slice(0, -3) : rel);
  }
  return [...out];
}

// --- walk + validate the bundle ---------------------------------------------

function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

function walkBundle(
  bundleRoot: string,
  today: Date,
): { concepts: Concept[]; issues: Issue[]; reserved: string[] } {
  const concepts: Concept[] = [];
  const issues: Issue[] = [];
  const reserved: string[] = [];
  const reservedLinks: Array<{ file: string; links_to: string[] }> = [];
  const files = listMarkdown(bundleRoot);
  for (const rel of files) {
    const full = path.join(bundleRoot, rel);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      issues.push({ file: rel, kind: 'read', message: errorMessage(e) });
      continue;
    }
    if (RESERVED.has(rel)) {
      reserved.push(rel);
      // No `type` needed, but index.md is where most bundle links live, so its
      // links are still checked.
      try {
        const { body } = parseDocument(text);
        reservedLinks.push({
          file: rel,
          links_to: extractLinks(body, path.dirname(full), bundleRoot),
        });
      } catch (e) {
        issues.push({ file: rel, kind: 'parse', message: errorMessage(e) });
      }
      continue;
    }

    let doc;
    try {
      doc = parseDocument(text);
    } catch (e) {
      issues.push({ file: rel, kind: 'parse', message: errorMessage(e) });
      continue;
    }
    const fm = doc.frontmatter;
    if (fm.type == null || String(fm.type).trim() === '') {
      issues.push({
        file: rel,
        kind: 'missing-type',
        message: 'No non-empty `type` in frontmatter (OKF v0.2 §11)',
      });
      continue;
    }

    for (const bad of badTimestamps(fm)) {
      issues.push({
        file: rel,
        kind: 'timestamp',
        message: `${bad} is not an ISO 8601 datetime with an offset (SPEC §5), for example 2026-06-30T14:00:00Z`,
      });
    }

    const tags = Array.isArray(fm.tags)
      ? fm.tags.map(String)
      : fm.tags
        ? [String(fm.tags)]
        : [];
    const sources = Array.isArray(fm.sources)
      ? fm.sources.filter((s: unknown) => s && typeof s === 'object')
      : fm.sources && typeof fm.sources === 'object'
        ? [fm.sources]
        : [];
    concepts.push({
      id: rel.replace(/\.md$/, ''),
      type: String(fm.type),
      title: String(fm.title ?? rel.replace(/\.md$/, '')),
      description: String(fm.description ?? ''),
      resource: String(fm.resource ?? ''),
      tags,
      status: String(fm.status ?? 'stable'),
      generated:
        fm.generated && typeof fm.generated === 'object' ? fm.generated : {},
      verified: normalizeVerified(fm),
      stale_after: String(fm.stale_after ?? ''),
      // Test fixtures only: the counts the render gate must find, declared by hand so the
      // check does not depend on the viewer's own parsers.
      render_expect:
        fm.render_expect && typeof fm.render_expect === 'object'
          ? (fm.render_expect as Record<string, number>)
          : null,
      sources,
      trust_tier: trustTier(fm),
      stale: isStale(fm, today),
      body: doc.body,
      links_to: extractLinks(doc.body, path.dirname(full), bundleRoot),
    });
  }
  issues.push(...danglingLinkIssues(files, concepts, reservedLinks));
  return { concepts, issues, reserved };
}

/**
 * Report internal links whose target file is not in the bundle. `extractLinks`
 * has already dropped external URLs and paths that leave the bundle, so what
 * is left should name a real file: a link that does not is a typo or a
 * rename that was missed, and it silently disappears from the graph otherwise.
 * A link to a file that exists but has no `type` is not reported here - the
 * missing type is already its own issue.
 */
function danglingLinkIssues(
  files: string[],
  concepts: Concept[],
  reservedLinks: Array<{ file: string; links_to: string[] }>,
): Issue[] {
  const present = new Set(files.map((rel) => rel.replace(/\.md$/, '')));
  const sources = [
    ...concepts.map((c) => ({ file: c.id + '.md', links_to: c.links_to })),
    ...reservedLinks,
  ];
  const out: Issue[] = [];
  for (const src of sources) {
    for (const target of src.links_to) {
      if (present.has(target)) continue;
      out.push({
        file: src.file,
        kind: 'dangling-link',
        message: `Link to /${target}.md, which is not a file in the bundle`,
      });
    }
  }
  return out;
}

// --- graph construction ------------------------------------------------------

const TYPE_PALETTE: Record<string, string> = {
  Application: '#2563eb',
  // Not an OKF-spec type. The spec allows any type string and renders unknown
  // ones grey; a guided tour is distinct enough from the reference concepts to
  // earn its own colour in the graph.
  Explainer: '#0d9488',
  Architecture: '#0891b2',
  'API Reference': '#7c3aed',
  'Data Model': '#d97706',
  Process: '#059669',
  'Architectural Decision': '#e11d48',
  Reference: '#64748b',
  Metric: '#ca8a04',
  Playbook: '#ea580c',
  'BigQuery Dataset': '#8b5cf6',
  'BigQuery Table': '#3b82f6',
};
const DEFAULT_NODE_COLOR = '#94a3b8';

function buildGraph(concepts: Concept[]): Graph {
  const ids = new Set(concepts.map((c) => c.id));
  const edges: Graph['edges'] = [];
  const seen = new Set<string>();
  const inDegree = new Map<string, number>();
  for (const c of concepts) {
    for (const target of c.links_to) {
      if (target === c.id || !ids.has(target)) continue;
      const key = `${c.id}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      edges.push({ data: { id: `${c.id}__${target}`, source: c.id, target } });
    }
  }
  const nodes = concepts.map((c) => ({
    data: {
      id: c.id,
      label: c.title,
      type: c.type,
      description: c.description,
      resource: c.resource,
      tags: c.tags,
      status: c.status,
      generated: c.generated,
      verified: c.verified,
      stale_after: c.stale_after,
      sources: c.sources,
      trust_tier: c.trust_tier,
      stale: c.stale,
      color: TYPE_PALETTE[c.type] ?? DEFAULT_NODE_COLOR,
      // Sized by how many concepts link here, so hubs stand out.
      size: Math.min(56, 24 + 6 * (inDegree.get(c.id) ?? 0)),
    },
  }));
  const bodies = Object.fromEntries(concepts.map((c) => [c.id, c.body]));
  const expects = Object.fromEntries(
    concepts.flatMap((c) => (c.render_expect ? [[c.id, c.render_expect] as const] : [])),
  );
  const types = [...new Set(concepts.map((c) => c.type))].sort();
  return {
    nodes,
    edges,
    bodies,
    expects,
    types,
    palette: TYPE_PALETTE,
    defaultColor: DEFAULT_NODE_COLOR,
  };
}

// The okf_version the root index.md declares, or null if it declares none.
function readBundleVersion(bundleRoot: string): string | null {
  try {
    const { frontmatter } = parseDocument(
      fs.readFileSync(path.join(bundleRoot, 'index.md'), 'utf8'),
    );
    const v = frontmatter.okf_version;
    return v === undefined || v === null ? null : String(v);
  } catch {
    return null;
  }
}

// The page title comes from the root index.md's H1, falling back to the folder name.
function readBundleTitle(bundleRoot: string): string {
  try {
    const { body } = parseDocument(
      fs.readFileSync(path.join(bundleRoot, 'index.md'), 'utf8'),
    );
    const h1 = body.match(/^# (.+)$/m);
    if (h1) return h1[1]!.trim();
  } catch {
    // no readable index.md
  }
  return path.basename(bundleRoot) || 'okf';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JSON inside <script>: escaping "<" stops a body containing "</script>" ending the block early.
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// --- HTML template ----------------------------------------------------------

function buildHTML(title: string, graph: Graph, widgetsJs: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>
  // Set the theme before first paint, so a dark-theme reader never sees a light flash.
  let okfTheme = null;
  try { okfTheme = localStorage.getItem("okf-theme"); } catch {}
  document.documentElement.dataset.theme = okfTheme === "dark" || okfTheme === "light"
    ? okfTheme
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
</script>
<!-- Pinned with subresource integrity: a pinned version on a CDN is immutable,
     so a changed file means something is wrong and the script should not run.
     Mermaid is on 11.x to match the mmdc the parse gate uses, so both gates
     accept one dialect. -->
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.28.1/dist/cytoscape.min.js" integrity="sha384-J7Q85oZE4GJ/e7+n2aOQsLXfDwwfnA8S2nZAL5BpFsfpCF84zQD7LroZ/dMnLgex" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" integrity="sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js" integrity="sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.2/highlight.min.js" integrity="sha384-pZ4gLQJIEk/VKnGk59xUSQK8Ne/erZQR9cpnPXPLB9iN1tXsVkRVfHYGdFYrSkv1" crossorigin="anonymous"></script>
<style>
${CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <strong id="bundle-name"></strong>
    <span>OKF bundle</span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Filter by title, path or tag" aria-label="Filter the graph">
    <select id="filter-type" aria-label="Filter by type"><option value="">All types</option></select>
    <select id="layout" aria-label="Graph layout">
      <option value="cose">Force (cose)</option>
      <option value="concentric">Concentric (hubs in centre)</option>
      <option value="breadthfirst">Breadth-first (hierarchy)</option>
      <option value="circle">Circle</option>
      <option value="grid">Grid</option>
    </select>
    <button id="reset" type="button">Reset</button>
    <button id="reading-toggle" type="button" aria-pressed="false">Reading view</button>
    <button id="theme-toggle" type="button">Dark theme</button>
  </div>
</header>

<main>
  <section id="graph-pane" aria-label="Concept graph">
    <div id="graph"></div>
    <ul id="legend" aria-label="Concept types"></ul>
  </section>
  <section id="detail">
    <p id="detail-empty">Select a concept in the graph.</p>
    <article id="detail-content" hidden>
      <header class="concept-header">
        <span id="detail-type" class="type-chip"></span>
        <h1 id="detail-title"></h1>
        <p id="detail-description" class="lead"></p>
        <div id="detail-badges" class="badges"></div>
        <details class="provenance">
          <summary>Sources and review</summary>
          <dl id="detail-meta"></dl>
        </details>
      </header>
      <div id="detail-body" class="prose"></div>
      <nav id="detail-backlinks" hidden>
        <h2>Linked from</h2>
        <ul id="backlinks-list"></ul>
      </nav>
    </article>
    <!-- IDE-style status bar: appears when the concept header scrolls out of view. -->
    <div id="statusbar">
      <span id="status-type" class="type-chip"></span>
      <span id="status-title"></span>
      <span id="status-section"></span>
      <span id="status-progress"></span>
      <button id="status-top" type="button" title="Scroll back to the top of this concept">&#8593; Top</button>
    </div>
  </section>
</main>

<script>
${widgetsJs ?? '/* The widget bundle is not built: npm run okf:widgets:build */'}
</script>
<script>
window.BUNDLE_NAME = ${scriptJson(title)};
window.BUNDLE = ${scriptJson(graph)};
</script>
<script>
${JS}
</script>
</body>
</html>
`;
}

const CSS = `
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --text: #334155;
  --text-muted: #64748b;
  --heading: #0f172a;
  --accent: #2563eb;
  --code-bg: #eef2f7;
  --pre-bg: #f8fafc;
  --code-keyword: #be185d;
  --code-string: #15803d;
  --code-number: #b45309;
  --code-title: #1d4ed8;
  --code-attr: #b45309;
  --code-builtin: #0e7490;
  --code-comment: #64748b;
  --code-meta: #7c3aed;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #0b1120;
  --surface: #0f172a;
  --surface-2: #1e293b;
  --border: #1e293b;
  --border-strong: #334155;
  --text: #cbd5e1;
  --text-muted: #94a3b8;
  --heading: #f1f5f9;
  --accent: #60a5fa;
  --code-bg: #1e293b;
  --pre-bg: #111827;
  --code-keyword: #f472b6;
  --code-string: #4ade80;
  --code-number: #fbbf24;
  --code-title: #60a5fa;
  --code-attr: #fbbf24;
  --code-builtin: #22d3ee;
  --code-comment: #94a3b8;
  --code-meta: #c4b5fd;
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.7 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, select {
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 5px 10px;
}
button, select { cursor: pointer; }
button:hover { background: var(--surface-2); }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Top bar */
.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: baseline; gap: 10px; }
.brand strong { font-size: 15px; color: var(--heading); }
.brand span { font-size: 12px; color: var(--text-muted); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }
.controls input { width: 220px; }

/* Layout: graph on the left, reading pane on the right */
main { flex: 1; min-height: 0; display: flex; }
#graph-pane {
  position: relative;
  flex: 0 0 40%;
  min-width: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
}
#graph { position: absolute; inset: 0; }
#legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  margin: 0;
  padding: 8px 12px;
  list-style: none;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
#legend li { display: flex; align-items: center; gap: 8px; }
#legend .dot { width: 9px; height: 9px; border-radius: 50%; }
#detail { flex: 1; min-width: 0; overflow-y: auto; }
#detail-content, #detail-empty { max-width: 46rem; margin: 0 auto; padding: 36px 36px 72px; }
#detail-empty { color: var(--text-muted); text-align: center; }
body.reading #graph-pane { display: none; }

/* Concept header */
.concept-header { margin-bottom: 32px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.type-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.type-chip::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--chip); }
.concept-header h1 {
  margin: 6px 0 8px;
  font-size: 30px;
  line-height: 1.25;
  letter-spacing: -0.015em;
  color: var(--heading);
}
.lead { margin: 0 0 14px; font-size: 17px; line-height: 1.6; color: var(--text-muted); }
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge {
  font-size: 12px;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
}
.badge.tag::before { content: "#"; opacity: 0.6; }
.badge.trust-human-reviewed { background: #ede9fe; color: #5b21b6; }
.badge.trust-machine-confirmed { background: #dbeafe; color: #1e40af; }
.badge.trust-unverified { background: #fef3c7; color: #92400e; }
.badge.status-draft { background: #fef3c7; color: #92400e; }
.badge.status-deprecated, .badge.stale { background: #fee2e2; color: #991b1b; }
:root[data-theme="dark"] .badge.trust-human-reviewed { background: #2e1065; color: #c4b5fd; }
:root[data-theme="dark"] .badge.trust-machine-confirmed { background: #172554; color: #93c5fd; }
:root[data-theme="dark"] .badge.trust-unverified,
:root[data-theme="dark"] .badge.status-draft { background: #422006; color: #fcd34d; }
:root[data-theme="dark"] .badge.status-deprecated,
:root[data-theme="dark"] .badge.stale { background: #450a0a; color: #fca5a5; }
.provenance { margin-top: 14px; font-size: 13px; }
.provenance summary { cursor: pointer; color: var(--text-muted); }
#detail-meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 10px 0 0; }
#detail-meta dt { color: var(--text-muted); }
#detail-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
#detail-meta ul { margin: 0; padding-left: 18px; }
#detail-meta code { font-size: 12px; }

/* Rendered markdown */
.prose > :first-child { margin-top: 0; }
.prose h2 { margin: 2.2em 0 0.6em; font-size: 22px; line-height: 1.3; color: var(--heading); }
.prose h3 { margin: 1.8em 0 0.5em; font-size: 17px; color: var(--heading); }
.prose p, .prose ul, .prose ol { margin: 0 0 1em; }
.prose ul, .prose ol { padding-left: 1.4em; }
.prose li + li { margin-top: 0.35em; }
.prose strong { color: var(--heading); }
.prose a { color: var(--accent); text-decoration: none; }
.prose a:hover { text-decoration: underline; }
code { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; }
.prose code { font-size: 0.85em; padding: 0.15em 0.4em; border-radius: 4px; background: var(--code-bg); }
.prose pre {
  margin: 0 0 1.3em;
  padding: 14px 18px;
  overflow-x: auto;
  background: var(--pre-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.prose pre code { padding: 0; background: none; font-size: 13px; line-height: 1.6; }
.hljs { background: none; color: var(--text); }
.hljs-comment, .hljs-quote { color: var(--code-comment); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type, .hljs-tag, .hljs-operator { color: var(--code-keyword); }
.hljs-string, .hljs-doctag, .hljs-regexp, .hljs-addition { color: var(--code-string); }
.hljs-number { color: var(--code-number); }
.hljs-title, .hljs-title.function_, .hljs-title.class_, .hljs-section, .hljs-selector-id { color: var(--code-title); font-weight: 600; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-property, .hljs-params { color: var(--code-attr); }
.hljs-built_in, .hljs-builtin-name, .hljs-name, .hljs-class { color: var(--code-builtin); }
.hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta { color: var(--code-meta); }
.hljs-deletion { color: #b91c1c; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
.table-wrap { margin: 0 0 1.3em; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.prose table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.55; }
.prose th, .prose td { padding: 9px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
.prose th { background: var(--surface-2); font-weight: 600; color: var(--heading); white-space: nowrap; }
.prose tr:last-child td { border-bottom: 0; }
.prose blockquote { margin: 0 0 1em; padding: 2px 16px; border-left: 3px solid var(--border-strong); color: var(--text-muted); }

/* Callouts: a blockquote whose first line is [!type]. The accent drives the
   border, the title and the tint, so a new type needs one line here. The plain
   background is the fallback where color-mix is unavailable. */
.prose .callout {
  margin: 0 0 1.3em;
  padding: 12px 16px 12px 18px;
  border-left: 4px solid var(--callout-accent, var(--border-strong));
  border-radius: 0 8px 8px 0;
  background: var(--surface-2);
  background: color-mix(in srgb, var(--callout-accent) 9%, var(--surface));
}
.prose .callout > :last-child { margin-bottom: 0; }
.prose .callout .callout-title {
  margin: 0 0 7px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--callout-accent, var(--text-muted));
}
.prose .callout-note { --callout-accent: #2563eb; }
.prose .callout-tip { --callout-accent: #0d9488; }
.prose .callout-important { --callout-accent: #7c3aed; }
.prose .callout-warning { --callout-accent: #b45309; }
.prose .callout-caution { --callout-accent: #dc2626; }
.prose .callout-definition { --callout-accent: #0891b2; }
.prose .callout-example { --callout-accent: #047857; }
.prose .callout-edge-case { --callout-accent: #c2410c; }
:root[data-theme="dark"] .prose .callout-note { --callout-accent: #60a5fa; }
:root[data-theme="dark"] .prose .callout-tip { --callout-accent: #2dd4bf; }
:root[data-theme="dark"] .prose .callout-important { --callout-accent: #a78bfa; }
:root[data-theme="dark"] .prose .callout-warning { --callout-accent: #fbbf24; }
:root[data-theme="dark"] .prose .callout-caution { --callout-accent: #f87171; }
:root[data-theme="dark"] .prose .callout-definition { --callout-accent: #22d3ee; }
:root[data-theme="dark"] .prose .callout-example { --callout-accent: #34d399; }
:root[data-theme="dark"] .prose .callout-edge-case { --callout-accent: #fb923c; }

/* Quiz: a "quiz" fenced block, rendered as click-to-check questions. */
.prose .quiz { margin: 0 0 1.3em; }
.prose .quiz-score {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.prose .quiz-card {
  margin: 0 0 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.prose .quiz-q {
  display: flex;
  gap: 10px;
  margin-bottom: 11px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--heading);
}
.prose .quiz-num {
  flex: none;
  height: 21px;
  padding: 0 8px;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 21px;
  color: var(--accent);
  background: var(--surface-2);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  border-radius: 999px;
}
.prose .quiz-options { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.prose .quiz-options button { width: 100%; text-align: left; line-height: 1.5; }
.prose .quiz-card[data-answered="true"] .quiz-options button { cursor: default; }
.prose .quiz-options button.is-correct { border-color: #16a34a; }
.prose .quiz-options button.is-picked.is-correct {
  background: var(--surface-2);
  background: color-mix(in srgb, #16a34a 16%, var(--surface));
}
.prose .quiz-options button.is-picked.is-wrong {
  border-color: #dc2626;
  background: var(--surface-2);
  background: color-mix(in srgb, #dc2626 16%, var(--surface));
}
.prose .quiz-options button.is-muted { opacity: 0.5; }
.prose .quiz-feedback {
  margin-top: 11px;
  padding: 10px 13px;
  font-size: 13.5px;
  line-height: 1.6;
  border-left: 3px solid var(--border-strong);
  border-radius: 0 6px 6px 0;
  background: var(--surface-2);
}
.prose .quiz-feedback.is-correct {
  border-left-color: #16a34a;
  background: color-mix(in srgb, #16a34a 11%, var(--surface));
}
.prose .quiz-feedback.is-wrong {
  border-left-color: #dc2626;
  background: color-mix(in srgb, #dc2626 11%, var(--surface));
}
.prose .quiz-feedback p { margin: 0; }
.prose .quiz-verdict { color: var(--heading); }
.prose .quiz-error { margin: 0; font-size: 13.5px; color: #b91c1c; }
.prose .widget-error {
  margin: 0 0 1.3em;
  padding: 10px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  color: #b91c1c;
}
:root[data-theme="dark"] .prose .widget-error { color: #fca5a5; }
:root[data-theme="dark"] .prose .quiz-error { color: #fca5a5; }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
/* Mermaid diagrams: a clipped canvas with its own pan/zoom toolbar */
.prose .mermaid {
  margin: 0 0 1.3em;
  padding: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.mermaid-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.mermaid-tools button { min-width: 26px; padding: 2px 7px; font-size: 13px; line-height: 1.5; background: var(--surface); }
.mermaid-zoom-level {
  min-width: 42px;
  text-align: center;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.mermaid-canvas {
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.mermaid-canvas.dragging { cursor: grabbing; }
.mermaid-canvas svg { display: block; max-width: none; }
/* Edge labels sit on the canvas colour in both themes, so a line passes behind the text
   (Mermaid's dark theme otherwise paints every label a fixed grey box). */
.mermaid-canvas .edgeLabel,
.mermaid-canvas .edgeLabel p,
.mermaid-canvas .labelBkg { background-color: var(--surface) !important; }
.mermaid-canvas .edgeLabel rect { fill: var(--surface) !important; }
.prose .mermaid[data-state="error"] { padding: 20px; text-align: left; border-color: #fca5a5; }
.prose .mermaid[data-state="error"] p { color: #b91c1c; font-size: 14px; }
.prose .mermaid[data-state="error"] pre { margin-bottom: 0; }
/* Expanded: the diagram covers the window until Esc or the close button. */
.prose .mermaid.expanded {
  position: fixed;
  inset: 0;
  z-index: 60;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: var(--bg);
}
.prose .mermaid.expanded .mermaid-canvas { background: var(--surface); }

/* Backlinks */
#detail-backlinks { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 15px; }
#detail-backlinks h2 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
}
#detail-backlinks ul { margin: 0; padding-left: 1.2em; }
#detail-backlinks a { color: var(--accent); text-decoration: none; }
#detail-backlinks a:hover { text-decoration: underline; }

/* IDE-style status bar, pinned to the bottom of the reading pane and only lifted
   into view once the concept header has scrolled away. */
#statusbar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 6px 18px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text-muted);
  background: var(--surface);
  border-top: 1px solid var(--border);
  opacity: 0;
  transform: translateY(100%);
  transition: opacity 120ms ease, transform 120ms ease;
  pointer-events: none;
}
#statusbar.shown { opacity: 1; transform: none; pointer-events: auto; }
#statusbar .type-chip { font-size: 10px; letter-spacing: 0.08em; }
#status-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--heading);
}
#status-section {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#status-section::before { content: "› "; }
#status-progress { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
#status-top { flex: 0 0 auto; padding: 3px 9px; font-size: 12px; }

@media (max-width: 820px) {
  main { flex-direction: column; }
  #graph-pane { flex: 0 0 40vh; border-right: 0; border-bottom: 1px solid var(--border); }
  #detail-content, #detail-empty { padding: 24px 18px 56px; }
  .controls input { width: 100%; }
  #statusbar { padding: 6px 12px; gap: 8px; }
}
`;

// Client script. It sits inside a template literal, so it avoids backticks,
// "\${", and backslashes.
const JS = `
(() => {
  const bundle = window.BUNDLE;
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(bundle.nodes.map((node) => [node.data.id, node.data]));
  const THEME_KEY = "okf-theme";
  let theme = document.documentElement.dataset.theme;
  let current = null;
  let renderToken = 0;
  let diagramCount = 0;

  $("bundle-name").textContent = window.BUNDLE_NAME;

  const backlinks = {};
  for (const edge of bundle.edges) (backlinks[edge.data.target] ||= []).push(edge.data.source);

  for (const type of bundle.types) {
    $("filter-type").append(new Option(type, type));
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = bundle.palette[type] || bundle.defaultColor;
    item.append(dot, type);
    $("legend").append(item);
  }

  // Cytoscape styles can't read CSS variables, so each theme's graph colours live here.
  function graphStyle() {
    const dark = theme === "dark";
    const label = dark ? "#e2e8f0" : "#1e293b";
    const labelBg = dark ? "#0f172a" : "#ffffff";
    const edge = dark ? "#475569" : "#cbd5e1";
    return [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "width": "data(size)",
          "height": "data(size)",
          "border-width": 2,
          "border-color": labelBg,
          "label": "data(label)",
          "color": label,
          "font-size": 13,
          "font-weight": 500,
          "text-valign": "bottom",
          "text-margin-y": 5,
          "text-wrap": "wrap",
          "text-max-width": 150,
          "text-background-color": labelBg,
          "text-background-opacity": 0.85,
          "text-background-padding": 2,
          "text-background-shape": "roundrectangle",
        },
      },
      { selector: "node[?stale]", style: { "border-color": "#dc2626", "border-style": "dashed" } },
      { selector: 'node[status = "deprecated"]', style: { "opacity": 0.5 } },
      { selector: "node:selected", style: { "border-width": 4, "border-color": "#f59e0b" } },
      {
        selector: "edge",
        style: {
          "width": 1.2,
          "curve-style": "bezier",
          "line-color": edge,
          "target-arrow-color": edge,
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.8,
        },
      },
      { selector: "edge.focus", style: { "width": 2, "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
      { selector: ".faded", style: { "opacity": 0.25 } },
      { selector: ".dim", style: { "opacity": 0.1 } },
    ];
  }

  function layoutOptions(name) {
    const base = { name, animate: false, padding: 40, nodeDimensionsIncludeLabels: true };
    if (name === "cose") return { ...base, nodeRepulsion: () => 60000, idealEdgeLength: () => 70, nodeOverlap: 20, randomize: false };
    // Most linked-to concepts go first, so hubs sit at the centre or the top.
    if (name === "concentric") return { ...base, minNodeSpacing: 30, concentric: (n) => n.indegree(), levelWidth: () => 1 };
    if (name === "breadthfirst") return { ...base, directed: true, spacingFactor: 1.1, roots: cy.nodes().filter((n) => n.indegree() === 0) };
    return base;
  }

  const cy = cytoscape({
    container: $("graph"),
    elements: [...bundle.nodes, ...bundle.edges],
    style: graphStyle(),
    layout: layoutOptions("cose"),
    minZoom: 0.3,
    maxZoom: 2.5,
  });

  cy.on("tap", "node", (event) => navigate(event.target.id()));
  cy.on("tap", (event) => { if (event.target === cy) clearFocus(); });

  function clearFocus() {
    cy.elements().removeClass("faded focus").unselect();
  }

  // Selecting a concept fades everything outside its immediate neighbourhood.
  function focusNode(id) {
    clearFocus();
    const node = cy.getElementById(id);
    if (node.empty()) return;
    node.select();
    cy.elements().not(node.closedNeighborhood()).addClass("faded");
    node.connectedEdges().addClass("focus");
    const box = node.renderedBoundingBox();
    const offscreen = box.x1 < 0 || box.y1 < 0 || box.x2 > cy.width() || box.y2 > cy.height();
    if (offscreen && cy.width() > 0) cy.animate({ center: { eles: node } }, { duration: 250 });
  }

  // The URL hash names the open concept, so links, Back/Forward, and reloads all work.
  function navigate(id) {
    if (location.hash.slice(1) === id) show(id);
    else location.hash = id;
  }
  window.addEventListener("hashchange", () => show(decodeURIComponent(location.hash.slice(1))));

  function show(id) {
    const data = byId[id];
    if (!data) return;
    current = id;
    focusNode(id);
    document.title = data.label + " | " + window.BUNDLE_NAME;

    $("detail-empty").hidden = true;
    $("detail-content").hidden = false;
    $("detail-type").textContent = data.type;
    $("detail-type").style.setProperty("--chip", data.color);
    $("detail-title").textContent = data.label;
    $("detail-description").textContent = data.description;
    $("detail-description").hidden = !data.description;

    const badges = [];
    if (data.status !== "stable") badges.push(badge(data.status, "status-" + data.status));
    badges.push(badge(data.trust_tier.replaceAll("-", " "), "trust-" + data.trust_tier));
    if (data.stale) badges.push(badge("stale since " + data.stale_after.slice(0, 10), "stale"));
    for (const tag of data.tags) badges.push(badge(tag, "tag"));
    $("detail-badges").replaceChildren(...badges);

    renderProvenance(data, id);
    renderBody(id);
    renderBacklinks(id);
    renderStatusbar(data);
    $("detail").scrollTop = 0;
  }

  function renderProvenance(data, id) {
    const rows = [["File", code(id + ".md")]];
    if (data.generated && data.generated.by) rows.push(["Generated", actor(data.generated)]);
    rows.push(["Verified", data.verified.length ? data.verified.map(actor).join("; ") : "Not yet"]);
    if (data.resource) rows.push(["Resource", code(data.resource)]);
    if (data.sources.length) {
      const list = document.createElement("ul");
      for (const source of data.sources) {
        const item = document.createElement("li");
        if (source.title) item.append(source.title, " ");
        item.append(code(source.resource || source.id || ""));
        list.append(item);
      }
      rows.push(["Sources", list]);
    }
    $("detail-meta").replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.append(value);
      return [dt, dd];
    }));
  }

  function renderBody(id) {
    const body = $("detail-body");
    // React roots from the last concept are unmounted before their DOM is replaced.
    if (window.OkfWidgets) window.OkfWidgets.unmountAll();
    body.innerHTML = marked.parse(bundle.bodies[id] || "", { gfm: true });

    // The header already shows the title, so drop the body's own H1.
    const first = body.firstElementChild;
    if (first && first.tagName === "H1") first.remove();

    renderCallouts(body);
    renderQuizzes(body);
    renderWidgets(body);
    addHeadingIds(body);

    for (const table of body.querySelectorAll("table")) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.replaceWith(wrap);
      wrap.append(table);
    }

    for (const link of body.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      if (href.startsWith("#")) {
        // A link to a section of this concept. The URL hash names the open
        // concept, so the fragment must not be written to the URL: scroll to
        // the heading instead, and leave a fragment with no target alone.
        const section = document.getElementById(href.slice(1));
        if (section) {
          link.addEventListener("click", (event) => {
            event.preventDefault();
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          continue;
        }
      }
      const target = href.startsWith("/") ? href.slice(1).split("#")[0].replace(/[.]md$/, "") : null;
      if (target && byId[target]) {
        if (link.textContent === href) link.textContent = byId[target].label;
        link.setAttribute("href", "#" + target);
      } else {
        link.target = "_blank";
        link.rel = "noopener";
      }
    }

    highlightCode(body);
    renderMermaid(body, ++renderToken);
  }

  // --- Status bar -----------------------------------------------------------
  // An IDE-style bar at the bottom of the reading pane. The concept header is
  // watched directly, so the bar appears exactly when the title scrolls out of
  // view, and it tracks the section you are in plus how far through you are.
  let headerWatcher = null;
  let statusFrame = 0;

  function renderStatusbar(data) {
    $("status-type").textContent = data.type;
    $("status-type").style.setProperty("--chip", data.color);
    $("status-title").textContent = data.label;
    $("statusbar").classList.remove("shown");
    updateStatusbar();

    const header = $("detail-content").querySelector(".concept-header");
    if (!header) return;
    if (!("IntersectionObserver" in window)) {
      // No observer, no way to know when the header leaves: keep the bar up.
      $("statusbar").classList.add("shown");
      return;
    }
    headerWatcher ||= new IntersectionObserver((entries) => {
      for (const entry of entries) $("statusbar").classList.toggle("shown", !entry.isIntersecting);
    }, { root: $("detail"), threshold: 0 });
    headerWatcher.disconnect();
    headerWatcher.observe(header);
  }

  function updateStatusbar() {
    const detail = $("detail");
    const paneTop = detail.getBoundingClientRect().top;
    let section = "";
    for (const heading of $("detail-body").querySelectorAll("h2, h3")) {
      if (heading.getBoundingClientRect().top - paneTop > 28) break;
      section = heading.textContent.trim();
    }
    $("status-section").textContent = section;
    const scrollable = detail.scrollHeight - detail.clientHeight;
    $("status-progress").textContent = scrollable > 8 ? Math.round((detail.scrollTop / scrollable) * 100) + "%" : "";
  }

  $("detail").addEventListener("scroll", () => {
    if (statusFrame) return;
    statusFrame = requestAnimationFrame(() => { statusFrame = 0; updateStatusbar(); });
  }, { passive: true });

  $("status-top").addEventListener("click", () => $("detail").scrollTo({ top: 0, behavior: "smooth" }));

  // --- Callouts -------------------------------------------------------------
  // A blockquote whose first line is [!type] becomes a styled callout. The set
  // is the GitHub alert types plus the two this bundle uses. An unknown type is
  // left as an ordinary blockquote rather than swallowed.
  const CALLOUT_TYPES = {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    caution: "Caution",
    definition: "Definition",
    example: "Example",
    "edge-case": "Edge case",
  };

  // The client script avoids backslashes (see the note above JS), so the two
  // parsers below use string operations rather than escaped regexes.
  const NEWLINE = String.fromCharCode(10);

  // The [!type] marker on a blockquote's first line, lower-cased, or null.
  function calloutMarker(quote) {
    const paragraph = quote.firstElementChild;
    if (!paragraph || paragraph.tagName !== "P") return null;
    const marker = paragraph.firstChild;
    if (!marker || marker.nodeType !== 3) return null;
    const firstLine = marker.nodeValue.split(NEWLINE)[0];
    if (firstLine.slice(0, 2) !== "[!") return null;
    const close = firstLine.indexOf("]");
    if (close < 0) return null;
    return firstLine.slice(2, close).trim().toLowerCase();
  }

  function renderCallouts(root) {
    for (const quote of [...root.querySelectorAll("blockquote")]) {
      const type = calloutMarker(quote);
      const label = type === null ? undefined : CALLOUT_TYPES[type];
      if (!label) continue;
      const paragraph = quote.firstElementChild;
      const marker = paragraph.firstChild;
      // Only the first line can carry the marker; the rest is the callout body.
      const firstLine = marker.nodeValue.split(NEWLINE)[0];
      const close = firstLine.indexOf("]");

      const rest = marker.nodeValue.slice(firstLine.length);
      marker.nodeValue = rest.charAt(0) === NEWLINE ? rest.slice(1) : rest;
      // A marker with nothing after it leaves an empty paragraph behind.
      if (paragraph.childNodes.length === 1 && marker.nodeValue.trim() === "") paragraph.remove();

      const box = document.createElement("div");
      box.className = "callout callout-" + type;
      const title = document.createElement("p");
      title.className = "callout-title";
      title.textContent = firstLine.slice(close + 1).trim() || label;
      // Snapshot the children first: append() would move them out of the live list.
      box.append(title, ...[...quote.childNodes]);
      quote.replaceWith(box);
    }
  }

  // --- Widgets --------------------------------------------------------------
  // A widget fenced block holds the name of one React widget from
  // packages/okf-widgets. The block becomes a mount point; a missing bundle or
  // an unknown name is shown, never hidden.
  function renderWidgets(root) {
    for (const block of [...root.querySelectorAll("pre > code.language-widget")]) {
      const name = block.textContent.trim();
      const mountPoint = document.createElement("div");
      mountPoint.className = "widget-mount";
      mountPoint.dataset.widget = name;
      block.parentElement.replaceWith(mountPoint);
      const api = window.OkfWidgets;
      let problem = null;
      if (!api) {
        problem = "The interactive widget " + name + " is not built. Run npm run okf:view, which builds the widgets first (npm run okf:widgets:build).";
      } else if (!api.mount(mountPoint, name)) {
        problem = "Unknown widget " + name + ". Known widgets: " + api.names.join(", ") + ".";
      }
      mountPoint.dataset.state = problem ? "error" : "mounted";
      if (problem) {
        const message = document.createElement("p");
        message.className = "widget-error";
        message.textContent = problem;
        mountPoint.append(message);
      }
    }
  }

  // --- Quiz -----------------------------------------------------------------
  // A quiz fenced block: questions separated by a --- line, options as
  // - [ ] / - [x], and ~ lines giving the feedback for the option above them.
  // Question and option text is plain text, so markdown inside it shows
  // literally.
  function parseChoice(line) {
    if (!line.startsWith("-")) return null;
    const rest = line.slice(1).trimStart();
    if (rest.charAt(0) !== "[") return null;
    const close = rest.indexOf("]");
    if (close < 0) return null;
    const mark = rest.slice(1, close).trim().toLowerCase();
    if (mark !== "" && mark !== "x") return null;
    const text = rest.slice(close + 1).trim();
    if (text === "") return null;
    return { text, correct: mark === "x", feedback: [] };
  }

  function parseQuiz(source) {
    const questions = [];
    let question = null;
    let option = null;
    for (const raw of source.split(NEWLINE)) {
      const line = raw.trim();
      if (line === "---") {
        if (question) questions.push(question);
        question = null;
        option = null;
        continue;
      }
      if (line === "") continue;
      const choice = parseChoice(line);
      if (choice) {
        question ||= { text: "", options: [] };
        option = choice;
        question.options.push(option);
        continue;
      }
      if (line.startsWith("~")) {
        if (option) option.feedback.push(line.slice(1).trim());
        continue;
      }
      question ||= { text: "", options: [] };
      question.text = question.text ? question.text + " " + line : line;
    }
    if (question) questions.push(question);
    return questions;
  }

  function renderQuizzes(root) {
    for (const block of [...root.querySelectorAll("pre > code.language-quiz")]) {
      const questions = parseQuiz(block.textContent);
      const quiz = document.createElement("div");
      quiz.className = "quiz";
      const score = document.createElement("p");
      score.className = "quiz-score";
      quiz.append(score);

      const cards = [];
      const updateScore = () => {
        const answered = cards.filter((card) => card.dataset.answered === "true").length;
        const right = cards.filter((card) => card.dataset.right === "true").length;
        score.textContent = answered === 0
          ? cards.length + " questions. Pick an answer to check yourself."
          : "Score " + right + " / " + cards.length + "  (" + answered + " answered)";
      };

      questions.forEach((question, index) => {
        const card = document.createElement("div");
        card.className = "quiz-card";
        card.dataset.answered = "false";
        cards.push(card);

        const head = document.createElement("div");
        head.className = "quiz-q";
        const num = document.createElement("span");
        num.className = "quiz-num";
        num.textContent = "Q" + (index + 1);
        const text = document.createElement("span");
        text.textContent = question.text;
        head.append(num, text);

        const list = document.createElement("ul");
        list.className = "quiz-options";

        const correctCount = question.options.filter((option) => option.correct).length;
        if (correctCount !== 1) {
          // An authoring mistake, shown rather than hidden: a question nobody can
          // answer correctly is worse than a visible error.
          const bad = document.createElement("p");
          bad.className = "quiz-error";
          bad.textContent = "This question has " + correctCount +
            " options marked correct; it needs exactly one.";
          list.append(bad);
          card.append(head, list);
          quiz.append(card);
          return;
        }

        const feedback = document.createElement("div");
        feedback.className = "quiz-feedback";
        feedback.hidden = true;
        // Recorded up front, not on click, so the render gate can drive the quiz.
        card.dataset.correctIndex = String(question.options.findIndex((option) => option.correct));

        question.options.forEach((option, optionIndex) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = option.text;
          button.addEventListener("click", () => {
            if (card.dataset.answered === "true") return;
            card.dataset.answered = "true";
            card.dataset.right = String(option.correct);
            [...list.querySelectorAll("button")].forEach((other, i) => {
              other.classList.toggle("is-picked", i === optionIndex);
              other.classList.toggle("is-correct", question.options[i].correct);
              other.classList.toggle("is-wrong", i === optionIndex && !option.correct);
              if (i !== optionIndex && !question.options[i].correct) other.classList.add("is-muted");
            });
            const verdict = document.createElement("p");
            const strong = document.createElement("strong");
            strong.className = "quiz-verdict";
            strong.textContent = option.correct ? "Correct." : "Not quite.";
            verdict.append(
              strong,
              " " + (option.feedback.join(" ") || (option.correct ? "That is the one." : "")),
            );
            feedback.replaceChildren(verdict);
            feedback.className = "quiz-feedback " + (option.correct ? "is-correct" : "is-wrong");
            feedback.hidden = false;
            updateScore();
          });
          item.append(button);
          list.append(item);
        });

        card.append(head, list, feedback);
        quiz.append(card);
      });

      if (questions.length === 0) {
        const bad = document.createElement("p");
        bad.className = "quiz-error";
        bad.textContent = "This quiz block has no questions.";
        quiz.append(bad);
      }
      updateScore();
      block.parentElement.replaceWith(quiz);
    }
  }

  // --- Section anchors ------------------------------------------------------
  // Heading ids, so a link inside a concept can point at a section. See the
  // fragment branch in renderBody for why the click is handled, not followed.
  function addHeadingIds(root) {
    const seen = new Set();
    for (const heading of root.querySelectorAll("h2, h3")) {
      const base = heading.textContent.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      let id = base;
      let n = 2;
      while (seen.has(id)) id = base + "-" + n++;
      seen.add(id);
      heading.id = id;
    }
  }

  function highlightCode(root) {
    if (!window.hljs) return;
    for (const block of root.querySelectorAll("pre > code:not(.language-mermaid):not(.language-quiz)")) {
      hljs.highlightElement(block);
    }
  }

  // Diagrams render one at a time, each in its own try, so a broken diagram shows
  // its error and source instead of stopping the others.
  async function renderMermaid(root, token) {
    const figures = [...root.querySelectorAll("pre > code.language-mermaid")].map((block) => {
      const figure = document.createElement("div");
      figure.className = "mermaid";
      figure.dataset.state = "pending";
      block.parentElement.replaceWith(figure);
      return { figure, source: block.textContent };
    });
    if (figures.length === 0) return;

    if (!window.mermaid) {
      for (const { figure, source } of figures) showDiagramError(figure, source, "Mermaid did not load");
      return;
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "neutral" });

    for (const { figure, source } of figures) {
      const diagramId = "okf-diagram-" + ++diagramCount;
      try {
        const { svg } = await mermaid.render(diagramId, source);
        if (token !== renderToken) return; // another concept was opened meanwhile
        figure.innerHTML = svg;
        prepareDiagram(figure);
        figure.dataset.state = "rendered";
      } catch (error) {
        document.getElementById("d" + diagramId)?.remove(); // Mermaid leaves its error graphic in <body>
        if (token !== renderToken) return;
        showDiagramError(figure, source, error && error.message ? error.message : String(error));
      }
    }
  }

  function showDiagramError(figure, source, message) {
    figure.dataset.state = "error";
    const note = document.createElement("p");
    note.textContent = "Diagram failed to render: " + message;
    const pre = document.createElement("pre");
    pre.textContent = source;
    figure.replaceChildren(note, pre);
    console.error("Mermaid diagram failed:", message);
  }

  // --- Diagram pan and zoom -------------------------------------------------
  // Each diagram owns a transform (translate + scale) and a clipped canvas that
  // acts as its viewport. Mermaid hands back an SVG sized to its viewBox, so
  // pinning that size makes one scale factor mean the same thing everywhere;
  // the toolbar, Ctrl/Cmd + wheel, and drag-to-pan all write to the same state.
  const diagramViews = new WeakMap();
  const MIN_DIAGRAM_ZOOM = 0.15;
  const MAX_DIAGRAM_ZOOM = 8;
  const ZOOM_STEP = 1.3;
  let drag = null;

  function prepareDiagram(figure) {
    const svg = figure.querySelector("svg");
    if (!svg) return;
    const canvas = document.createElement("div");
    canvas.className = "mermaid-canvas";
    canvas.title = "Drag to pan, Ctrl or Cmd with the wheel to zoom, double-click to fit";
    figure.replaceChildren(diagramTools(figure), canvas);
    canvas.append(svg);
    if (!diagramView(figure)) return;
    sizeDiagramCanvas(figure);
    fitDiagram(figure);
  }

  function diagramTools(figure) {
    const tools = document.createElement("div");
    tools.className = "mermaid-tools";
    const level = document.createElement("span");
    level.className = "mermaid-zoom-level";
    level.textContent = "100%";
    const button = (act, label, title, onClick) => {
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.act = act;
      el.textContent = label;
      el.title = title;
      el.addEventListener("click", onClick);
      return el;
    };
    tools.append(
      button("zoom-out", "\u2212", "Zoom out", () => zoomDiagram(figure, 1 / ZOOM_STEP)),
      level,
      button("zoom-in", "+", "Zoom in", () => zoomDiagram(figure, ZOOM_STEP)),
      button("fit", "Fit", "Fit the diagram to the pane", () => fitDiagram(figure)),
      button("expand", "\u2922", "Expand this diagram (Esc closes)", () => toggleDiagramExpand(figure)),
    );
    return tools;
  }

  // The view is created once per rendered figure; the WeakMap keeps its
  // listeners and transform state from being rebuilt on every fit or zoom.
  function diagramView(figure) {
    const canvas = figure.querySelector(".mermaid-canvas");
    const svg = canvas && canvas.querySelector("svg");
    if (!svg) return null;
    const cached = diagramViews.get(figure);
    if (cached) return cached;

    const box = svg.viewBox && svg.viewBox.baseVal;
    const bounds = svg.getBoundingClientRect();
    const view = {
      canvas,
      svg,
      width: (box && box.width) || bounds.width || 600,
      height: (box && box.height) || bounds.height || 400,
      scale: 1,
      x: 0,
      y: 0,
    };
    diagramViews.set(figure, view);
    // Mermaid ships width="100%" plus a max-width, which makes the drawn size
    // depend on the pane; pin it to the viewBox so the transform is predictable.
    svg.style.maxWidth = "none";
    svg.setAttribute("width", view.width);
    svg.setAttribute("height", view.height);
    svg.style.transformOrigin = "0 0";

    canvas.addEventListener("wheel", (event) => zoomWheel(event, figure), { passive: false });
    canvas.addEventListener("pointerdown", (event) => startDrag(event, figure));
    canvas.addEventListener("pointermove", (event) => moveDrag(event, figure));
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("dblclick", () => fitDiagram(figure));
    return view;
  }

  function sizeDiagramCanvas(figure) {
    const view = diagramView(figure);
    if (!view) return;
    const available = view.canvas.clientWidth || view.width;
    const cap = figure.classList.contains("expanded")
      ? Math.max(240, window.innerHeight - 56) // the toolbar is the only chrome left
      : Math.max(220, Math.min(Math.round(window.innerHeight * 0.7), 620));
    const height = Math.max(150, Math.min(view.height * Math.min(1, available / view.width), cap));
    view.canvas.style.height = Math.round(height) + "px";
  }

  function fitDiagram(figure) {
    const view = diagramView(figure);
    if (!view) return;
    const available = view.canvas.clientWidth || view.width;
    const availableHeight = view.canvas.clientHeight || view.height;
    const scale = Math.min(available / view.width, availableHeight / view.height, 1);
    view.scale = scale > 0 ? scale : 1;
    view.x = (available - view.width * view.scale) / 2;
    view.y = (availableHeight - view.height * view.scale) / 2;
    applyDiagramTransform(view);
  }

  function applyDiagramTransform(view) {
    view.svg.style.transform = "translate(" + view.x + "px, " + view.y + "px) scale(" + view.scale + ")";
    const level = view.canvas.parentElement.querySelector(".mermaid-zoom-level");
    if (level) level.textContent = Math.round(view.scale * 100) + "%";
  }

  function zoomDiagram(figure, factor, originX, originY) {
    const view = diagramView(figure);
    if (!view) return;
    const next = Math.min(MAX_DIAGRAM_ZOOM, Math.max(MIN_DIAGRAM_ZOOM, view.scale * factor));
    if (next === view.scale) return;
    // Keep the point under the cursor (or the middle) where it is.
    const px = originX === undefined ? view.canvas.clientWidth / 2 : originX;
    const py = originY === undefined ? view.canvas.clientHeight / 2 : originY;
    view.x = px - ((px - view.x) / view.scale) * next;
    view.y = py - ((py - view.y) / view.scale) * next;
    view.scale = next;
    applyDiagramTransform(view);
  }

  // A bare wheel belongs to the page: zooming on it would trap the reader inside
  // a tall diagram. Ctrl/Cmd + wheel zooms (trackpad pinch sends that too).
  function zoomWheel(event, figure) {
    if (!event.ctrlKey && !event.metaKey) return;
    const view = diagramView(figure);
    if (!view) return;
    event.preventDefault();
    const rect = view.canvas.getBoundingClientRect();
    zoomDiagram(figure, event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
  }

  function startDrag(event, figure) {
    if (event.button !== 0) return;
    const view = diagramView(figure);
    if (!view) return;
    drag = { figure, view, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    view.canvas.classList.add("dragging");
    view.canvas.setPointerCapture(event.pointerId);
  }

  function moveDrag(event, figure) {
    if (!drag || drag.pointerId !== event.pointerId || drag.figure !== figure) return;
    drag.view.x = drag.x + (event.clientX - drag.clientX);
    drag.view.y = drag.y + (event.clientY - drag.clientY);
    applyDiagramTransform(drag.view);
  }

  function endDrag(event) {
    if (!drag) return;
    if (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    drag.view.canvas.classList.remove("dragging");
    drag = null;
  }

  function toggleDiagramExpand(figure) {
    const expanded = figure.classList.toggle("expanded");
    const button = figure.querySelector(".mermaid-tools button[data-act='expand']");
    if (button) {
      button.textContent = expanded ? "\u2715" : "\u2922";
      button.title = expanded ? "Close the expanded diagram (Esc)" : "Expand this diagram (Esc closes)";
    }
    // Wait for the new size to be laid out before measuring and refitting.
    requestAnimationFrame(() => {
      sizeDiagramCanvas(figure);
      fitDiagram(figure);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const figure = document.querySelector("#detail-body .mermaid.expanded");
    if (figure) toggleDiagramExpand(figure);
  });

  let layoutFrame = 0;
  window.addEventListener("resize", () => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      for (const figure of document.querySelectorAll("#detail-body .mermaid[data-state='rendered']")) {
        sizeDiagramCanvas(figure);
        fitDiagram(figure);
      }
      updateStatusbar();
    });
  });

  function renderBacklinks(id) {
    const sources = backlinks[id] || [];
    $("detail-backlinks").hidden = sources.length === 0;
    $("backlinks-list").replaceChildren(...sources.map((source) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + source;
      link.textContent = byId[source].label;
      item.append(link);
      return item;
    }));
  }

  function badge(text, className) {
    const el = document.createElement("span");
    el.className = "badge " + className;
    el.textContent = text;
    return el;
  }

  function code(text) {
    const el = document.createElement("code");
    el.textContent = text;
    return el;
  }

  function actor(event) {
    return event.at ? event.by + ", " + String(event.at).slice(0, 10) : String(event.by);
  }

  // Search text and type filter combine: a node must pass both to stay bright.
  function applyFilters() {
    const query = $("search").value.trim().toLowerCase();
    const type = $("filter-type").value;
    cy.nodes().forEach((node) => {
      const d = node.data();
      const text = (d.label + " " + d.id + " " + d.tags.join(" ")).toLowerCase();
      node.toggleClass("dim", (query !== "" && !text.includes(query)) || (type !== "" && d.type !== type));
    });
    cy.edges().forEach((edge) => {
      edge.toggleClass("dim", edge.source().hasClass("dim") || edge.target().hasClass("dim"));
    });
  }
  $("search").addEventListener("input", applyFilters);
  $("filter-type").addEventListener("change", applyFilters);

  $("layout").addEventListener("change", () => {
    cy.layout(layoutOptions($("layout").value)).run();
    cy.fit(undefined, 40);
  });

  $("reset").addEventListener("click", () => {
    $("search").value = "";
    $("filter-type").value = "";
    applyFilters();
    clearFocus();
    cy.fit(undefined, 40);
  });

  $("reading-toggle").addEventListener("click", () => {
    const reading = document.body.classList.toggle("reading");
    $("reading-toggle").setAttribute("aria-pressed", String(reading));
    if (!reading) {
      cy.resize();
      cy.fit(undefined, 40);
    }
  });

  function updateThemeButton() {
    $("theme-toggle").textContent = theme === "dark" ? "Light theme" : "Dark theme";
  }
  $("theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    updateThemeButton();
    cy.style(graphStyle());
    if (current) {
      // Re-render so diagrams pick up the new theme, keeping the reading position.
      const scroll = $("detail").scrollTop;
      show(current);
      $("detail").scrollTop = scroll;
    }
  });

  updateThemeButton();
  cy.fit(undefined, 40);

  // Open the concept named in the URL, else the first Application concept, else the most linked-to one.
  const requested = decodeURIComponent(location.hash.slice(1));
  const byLinks = [...bundle.nodes].sort((a, b) => (backlinks[b.data.id] || []).length - (backlinks[a.data.id] || []).length);
  const start = byId[requested]
    ? requested
    : (bundle.nodes.find((node) => node.data.type === "Application") || byLinks[0] || { data: {} }).data.id;
  if (start) show(start);

  // Audit hook for --check-render (harmless in normal use): just enough access
  // to drive the viewer and observe diagram render states. Note: this block
  // lives inside a Node template literal, so no backticks are allowed here.
  window.__OKF_VIEW__ = {
    ids: bundle.nodes.map((node) => node.data.id),
    show,
    // How many diagrams this concept should produce, counted the way
    // renderMermaid finds them: from the parsed markdown, not from a pattern
    // over the source. An example fence nested inside another fence is a code
    // block to marked, so it is not counted here either, and a tilde fence is.
    // Returns null if marked has not loaded, meaning "cannot say".
    mermaidCount(id) {
      if (!window.marked) return null;
      const doc = new DOMParser().parseFromString(
        marked.parse(bundle.bodies[id] || "", { gfm: true }),
        "text/html",
      );
      return doc.querySelectorAll("pre > code.language-mermaid").length;
    },
    // How many widgets this concept should mount, counted from the parsed
    // markdown the way renderWidgets finds them. Null means "cannot say".
    widgetCount(id) {
      if (!window.marked) return null;
      const doc = new DOMParser().parseFromString(
        marked.parse(bundle.bodies[id] || "", { gfm: true }),
        "text/html",
      );
      return doc.querySelectorAll("pre > code.language-widget").length;
    },
    // How many quiz questions this concept should render, counted the way
    // renderQuizzes finds them: from the parsed markdown. Returns null if
    // marked has not loaded, meaning "cannot say".
    quizCount(id) {
      if (!window.marked) return null;
      const doc = new DOMParser().parseFromString(
        marked.parse(bundle.bodies[id] || "", { gfm: true }),
        "text/html",
      );
      let total = 0;
      for (const block of doc.querySelectorAll("pre > code.language-quiz")) {
        total += parseQuiz(block.textContent).length;
      }
      return total;
    },
    // The error paths the render gate checks: how many quiz questions should
    // show the "exactly one correct option" error, and how many [!type]
    // blockquotes should become callouts (known) or stay blockquotes (unknown).
    // Returns null if marked has not loaded.
    markupCounts(id) {
      if (!window.marked) return null;
      const doc = new DOMParser().parseFromString(
        marked.parse(bundle.bodies[id] || "", { gfm: true }),
        "text/html",
      );
      let quizErrors = 0;
      for (const block of doc.querySelectorAll("pre > code.language-quiz")) {
        for (const question of parseQuiz(block.textContent)) {
          if (question.options.filter((option) => option.correct).length !== 1) quizErrors++;
        }
      }
      let knownCallouts = 0;
      let unknownCallouts = 0;
      for (const quote of doc.querySelectorAll("blockquote")) {
        const type = calloutMarker(quote);
        if (type === null) continue;
        if (CALLOUT_TYPES[type]) knownCallouts++;
        else unknownCallouts++;
      }
      return { quizErrors, knownCallouts, unknownCallouts };
    },
  };
})();
`;

// --- CLI -------------------------------------------------------------------------

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    bundle: 'okf',
    out: null,
    validateOnly: false,
    strict: false,
    checkRender: false,
    widgets: null,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') {
      opts.out = argv[++i] ?? null;
    } else if (a === '--validate') {
      opts.validateOnly = true;
    } else if (a === '--check-render') {
      opts.checkRender = true;
    } else if (a === '--strict') {
      opts.strict = true;
    } else if (a === '--widgets') {
      opts.widgets = argv[++i] ?? null;
    } else if (a.startsWith('-')) {
      console.error('Unknown flag: ' + a);
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length) opts.bundle = positional[0]!;
  if (opts.validateOnly && opts.checkRender) {
    console.error(
      '--check-render writes the viewer first; it cannot be combined with --validate.',
    );
    process.exit(2);
  }
  return opts;
}

const firstLine = (e: unknown): string => errorMessage(e).split('\n')[0] ?? '';

/**
 * Race a promise against a deadline. A late rejection from the loser (the
 * browser closing under a still-pending evaluate) is swallowed, so it cannot
 * surface as an unhandled rejection after the race has settled.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => {});
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const CONCEPT_TIMEOUT_MS = 20000;

/**
 * Client-side render gate. Opens the freshly written viz.html in headless
 * Chromium (via the project-local playwright, else playwright-core), walks
 * every concept through view.show(), and waits for each concept's Mermaid
 * figures to leave data-state="pending".
 *
 * Returns a process exit code, on the same contract as okf-mermaid.mts:
 *   0  every diagram rendered, each with working pan/zoom controls, and every
 *      quiz question rendered
 *   1  a diagram ended in error, never left pending, a concept rendered a
 *      different number of figures or quiz questions than its markdown parses
 *      to, a rendered diagram is missing its pan/zoom controls, the zoom-in
 *      control did not change the diagram's transform, a click on a correct
 *      quiz answer did not reveal its feedback and move the score, or a widget
 *      did not mount or did not respond to its data-probe control
 *   2  the check could not run: no playwright, no Chromium, the viewer's CDN
 *      libraries never loaded, or the audit itself failed
 *
 * A check that could not run is never reported as a pass: exit 2 says the
 * diagrams are unproven, which is not the same as fine.
 */
async function checkRender(outPath: string): Promise<number> {
  // Loaded on demand: playwright is only needed by this gate, and is optional.
  let chromium: typeof import('playwright').chromium | undefined;
  for (const mod of ['playwright', 'playwright-core']) {
    try {
      chromium = (await import(mod)).chromium;
      break;
    } catch {
      /* try next */
    }
  }
  const cannotRun = (why: string, fix?: string) => {
    console.log(`\nBrowser render check: could not run (${why})`);
    if (fix) console.log(`  ${fix}`);
    console.log(
      '  exit 2: the gate did not run, so nothing is proven about the diagrams.',
    );
    return 2;
  };
  if (!chromium) {
    return cannotRun(
      'playwright not installed',
      'fix: npm i -D playwright && npx playwright install chromium',
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    return cannotRun(
      'could not launch chromium: ' + firstLine(e),
      'fix: npx playwright install chromium',
    );
  }

  console.log('\nBrowser render check (headless Chromium):');
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(outPath).href, { waitUntil: 'load' });
    try {
      await page.waitForFunction(
        'window.__OKF_VIEW__ && window.marked && window.mermaid',
        null,
        { timeout: 30000 },
      );
    } catch (e) {
      // marked and Mermaid come from a CDN. Without them there is nothing to
      // audit, and this is exactly the failure the gate exists to catch, so it
      // must not pass quietly.
      return cannotRun(
        'the viewer never finished loading its CDN libraries: ' + firstLine(e),
        'fix: re-run where cdn.jsdelivr.net is reachable (the viewer needs it to render at all)',
      );
    }

    const ids: string[] = await page.evaluate('window.__OKF_VIEW__.ids');
    const budgetMs = 60000 + ids.length * (CONCEPT_TIMEOUT_MS + 5000);
    const report = await withTimeout(
      page.evaluate(async (conceptTimeoutMs: number) => {
        const view = window.__OKF_VIEW__;
        const diagrams = [];
        const mismatches = [];
        const quizMismatches = [];
        let zoomChecked = false;
        let zoomWorks = null;
        let quizChecked = false;
        let quizWorks = null;
        let quizQuestions = 0;
        let quizErrors = 0;
        let unknownCallouts = 0;
        const markupMismatches = [];
        const widgets = [];
        const widgetMismatches = [];
        const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        for (const id of view.ids) {
          view.show(id);
          const expected = view.mermaidCount(id);
          const deadline = Date.now() + conceptTimeoutMs;
          while (
            Date.now() < deadline &&
            document.querySelector<HTMLElement>(
              "#detail-body .mermaid[data-state='pending']",
            )
          ) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const figures = [
            ...document.querySelectorAll<HTMLElement>('#detail-body .mermaid'),
          ];
          if (expected !== null && figures.length !== expected) {
            mismatches.push({ concept: id, expected, found: figures.length });
          }
          for (const fig of figures) {
            diagrams.push({
              concept: id,
              state:
                fig.dataset.state === 'pending' ? 'timeout' : fig.dataset.state,
              error:
                fig.dataset.state === 'error'
                  ? String(fig.querySelector<HTMLElement>('p')?.textContent || '').slice(
                      0,
                      400,
                    )
                  : undefined,
              controls: fig.querySelectorAll<HTMLElement>('.mermaid-tools button').length,
              canvas: Boolean(fig.querySelector<HTMLElement>('.mermaid-canvas > svg')),
            }); // Prove the pan/zoom wiring on the first rendered diagram: one
            // zoom-in click has to change the transform, not just exist.
            if (!zoomChecked && fig.dataset.state === 'rendered') {
              const zoomIn = fig.querySelector<HTMLElement>(
                ".mermaid-tools button[data-act='zoom-in']",
              );
              const svg = fig.querySelector<HTMLElement>('.mermaid-canvas > svg');
              if (zoomIn && svg) {
                const before = svg.style.transform;
                zoomIn.click();
                zoomChecked = true;
                zoomWorks =
                  svg.style.transform !== before &&
                  svg.style.transform.indexOf('scale(') !== -1;
              }
            }
          }

          // Quizzes: the rendered question count has to match the markdown, and
          // the first question with a correct option has to respond to a click
          // by revealing its feedback and moving the score.
          const expectedQuiz = view.quizCount(id);
          const cards = [
            ...document.querySelectorAll<HTMLElement>('#detail-body .quiz-card'),
          ];
          if (expectedQuiz !== null && cards.length !== expectedQuiz) {
            quizMismatches.push({
              concept: id,
              expected: expectedQuiz,
              found: cards.length,
            });
          }
          quizQuestions += cards.length;
          // Error paths: a malformed question shows its error, a known [!type]
          // becomes a callout, and an unknown one stays a plain blockquote.
          const markup = view.markupCounts(id);
          if (markup !== null) {
            const body = document.querySelector<HTMLElement>('#detail-body')!;
            const found: Record<string, number> = {
              quizErrors: body.querySelectorAll<HTMLElement>('.quiz-error').length,
              knownCallouts: body.querySelectorAll<HTMLElement>('.callout').length,
              unknownCallouts: [...body.querySelectorAll<HTMLElement>('blockquote')].filter(
                (quote) =>
                  String(quote.textContent).trimStart().slice(0, 2) === '[!',
              ).length,
            };
            for (const key of Object.keys(found)) {
              if (found[key] !== markup[key]) {
                markupMismatches.push({
                  concept: id,
                  what: key,
                  expected: markup[key],
                  found: found[key],
                });
              }
            }
            quizErrors += found.quizErrors!;
            unknownCallouts += found.unknownCallouts!;
            // A fixture's hand-declared counts are the independent check: they catch a bug
            // in parseQuiz or calloutMarker that the comparison above would share.
            const declared = (window.BUNDLE.expects || {})[id];
            if (declared) {
              const actual: Record<string, number> = { ...found, quizQuestions: cards.length };
              for (const key of Object.keys(declared)) {
                if (actual[key] !== declared[key]) {
                  markupMismatches.push({
                    concept: id,
                    what: key + ' (declared in render_expect)',
                    expected: declared[key],
                    found: actual[key],
                  });
                }
              }
            }
          }
          if (!quizChecked) {
            const card = cards.find(
              (c) => c.dataset.correctIndex !== undefined,
            );
            if (card) {
              const buttons = card.querySelectorAll<HTMLElement>('.quiz-options button');
              const button = buttons[Number(card.dataset.correctIndex)];
              const feedback = card.querySelector<HTMLElement>('.quiz-feedback');
              const score = card.closest('.quiz')?.querySelector<HTMLElement>('.quiz-score');
              if (button) {
                button.click();
                quizChecked = true;
                quizWorks =
                  card.dataset.answered === 'true' &&
                  card.dataset.right === 'true' &&
                  feedback !== null &&
                  !feedback.hidden &&
                  feedback.classList.contains('is-correct') &&
                  (!score || score.textContent.indexOf('Score 1 /') === 0);
              }
            }
          }
          // Widgets: every widget block has to mount its React figure, and the
          // control each widget marks with data-probe has to change what it shows.
          const expectedWidgets = view.widgetCount(id);
          const mounts = [
            ...document.querySelectorAll<HTMLElement>('#detail-body .widget-mount'),
          ];
          if (expectedWidgets !== null && mounts.length !== expectedWidgets) {
            widgetMismatches.push({
              concept: id,
              expected: expectedWidgets,
              found: mounts.length,
            });
          }
          for (const mount of mounts) {
            const mountDeadline = Date.now() + 5000;
            while (
              Date.now() < mountDeadline &&
              mount.dataset.state === 'mounted' &&
              !mount.querySelector<HTMLElement>('figure.okfw')
            ) {
              await pause(50);
            }
            const figure = mount.querySelector<HTMLElement>('figure.okfw');
            const probe = figure ? figure.querySelector<HTMLElement>('[data-probe]') : null;
            let responds = false;
            if (figure && probe) {
              const before = figure.textContent;
              probe.click();
              const clickDeadline = Date.now() + 2000;
              while (
                Date.now() < clickDeadline &&
                figure.textContent === before
              ) {
                await pause(50);
              }
              responds = figure.textContent !== before;
            }
            const error =
              mount.querySelector<HTMLElement>('.widget-error') ||
              (figure && figure.querySelector<HTMLElement>('.okfw-error'));
            widgets.push({
              concept: id,
              name: mount.dataset.widget,
              mounted: Boolean(figure),
              probe: Boolean(probe),
              responds,
              error: error
                ? String(error.textContent).slice(0, 300)
                : undefined,
            });
          }
        }
        return {
          diagrams,
          mismatches,
          quizMismatches,
          quizChecked,
          quizWorks,
          quizQuestions,
          quizErrors,
          unknownCallouts,
          markupMismatches,
          zoomChecked,
          zoomWorks,
          widgets,
          widgetMismatches,
        };
      }, CONCEPT_TIMEOUT_MS),
      budgetMs,
      `render audit did not finish within ${Math.round(budgetMs / 1000)}s`,
    );

    const total = report.diagrams.length;
    const failed = report.diagrams.filter((d) => d.state !== 'rendered');
    const bare = report.diagrams.filter(
      (d) => d.state === 'rendered' && (!d.canvas || !d.controls),
    );
    const zoomBroken = report.zoomChecked && !report.zoomWorks;
    const quizBroken = report.quizChecked && !report.quizWorks;
    const widgetsBroken = report.widgets.filter(
      (w) => !w.mounted || !w.probe || !w.responds || w.error,
    );
    console.log(`  concepts visited : ${ids.length}`);
    console.log(`  diagrams found   : ${total}`);
    console.log(`  rendered ok      : ${total - failed.length}`);
    console.log(`  failed           : ${failed.length}`);
    console.log(
      `  pan/zoom wired   : ${report.zoomChecked ? (report.zoomWorks ? 'yes' : 'no') : 'not checked'}`,
    );
    console.log(`  quiz questions   : ${report.quizQuestions}`);
    console.log(`  quiz errors shown: ${report.quizErrors}`);
    console.log(
      `  unknown callouts : ${report.unknownCallouts} (left as blockquotes)`,
    );
    console.log(
      `  quiz click wired : ${report.quizChecked ? (report.quizWorks ? 'yes' : 'no') : 'not checked'}`,
    );
    console.log(
      `  widgets mounted  : ${report.widgets.filter((w) => w.mounted).length} of ${report.widgets.length}`,
    );
    console.log(
      `  widgets respond  : ${report.widgets.filter((w) => w.responds).length} of ${report.widgets.length}`,
    );
    for (const w of widgetsBroken) {
      const why = w.error
        ? w.error
        : !w.mounted
          ? 'did not mount'
          : !w.probe
            ? 'has no data-probe control'
            : 'its data-probe control changed nothing';
      console.log(`  ✗ ${w.concept}.md  widget ${w.name}: ${why}`);
    }
    for (const m of report.widgetMismatches) {
      console.log(
        `  ✗ ${m.concept}.md  markdown parses to ${m.expected} widget(s) but the viewer mounted ${m.found}`,
      );
    }
    for (const f of failed) {
      const detail =
        f.state === 'timeout'
          ? `diagram render timed out after ${CONCEPT_TIMEOUT_MS / 1000}s`
          : f.error || f.state;
      console.log(`  ✗ ${f.concept}.md  ${detail}`);
    }
    for (const b of bare) {
      console.log(
        `  ✗ ${b.concept}.md  rendered diagram has no pan/zoom controls (canvas: ${b.canvas}, buttons: ${b.controls})`,
      );
    }
    if (zoomBroken) {
      console.log('  ✗ clicking zoom-in did not change the diagram transform');
    }
    if (quizBroken) {
      console.log(
        '  ✗ clicking a correct quiz answer did not reveal its feedback and score',
      );
    }
    for (const m of report.mismatches) {
      console.log(
        `  ✗ ${m.concept}.md  markdown parses to ${m.expected} diagram(s) but the viewer rendered ${m.found}`,
      );
    }
    for (const m of report.markupMismatches) {
      console.log(
        `  ✗ ${m.concept}.md  expected ${m.expected} ${m.what} but the viewer rendered ${m.found}`,
      );
    }
    for (const m of report.quizMismatches) {
      console.log(
        `  ✗ ${m.concept}.md  markdown parses to ${m.expected} quiz question(s) but the viewer rendered ${m.found}`,
      );
    }
    if (
      failed.length ||
      bare.length ||
      zoomBroken ||
      quizBroken ||
      report.mismatches.length ||
      report.quizMismatches.length ||
      report.markupMismatches.length ||
      widgetsBroken.length ||
      report.widgetMismatches.length
    )
      return 1;
    console.log(
      total
        ? '  ✓ every mermaid diagram renders client-side with pan/zoom controls'
        : '  ✓ no mermaid diagrams to check',
    );
    if (report.quizQuestions)
      console.log(
        '  ✓ every quiz question renders, and a click checks an answer',
      );
    if (report.widgets.length)
      console.log(
        '  ✓ every widget mounts, and its probe control changes what it shows',
      );
    return 0;
  } catch (e) {
    return cannotRun('the render audit failed: ' + firstLine(e));
  } finally {
    await browser.close();
  }
}

function countBy(concepts: Concept[], key: 'trust_tier' | 'status'): string {
  const counts: Record<string, number> = {};
  for (const c of concepts) counts[c[key]] = (counts[c[key]] || 0) + 1;
  return Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bundleRoot = path.resolve(opts.bundle);
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    console.error(`Bundle directory not found: ${bundleRoot}`);
    process.exit(2);
  }
  const { concepts, issues, reserved } = walkBundle(bundleRoot, new Date());
  const graph = buildGraph(concepts);
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(bundleRoot, 'viz.html');

  console.log(`\nOKF validation: ${bundleRoot}`);
  const declared = readBundleVersion(bundleRoot);
  console.log(
    `  okf_version          : ${declared ?? '(not declared)'}` +
      (declared === null || declared === OKF_VERSION
        ? ''
        : `  (this tool implements ${OKF_VERSION}; read best-effort, see the playbook's migration section)`),
  );
  console.log(`  concepts (valid)     : ${concepts.length}`);
  console.log(`  graph edges          : ${graph.edges.length}`);
  console.log(`  reserved (index/log) : ${reserved.length}`);
  console.log(`  issues               : ${issues.length}`);
  if (issues.length) {
    console.log('\nIssues:');
    for (const i of issues)
      console.log(`  ✗ ${i.file}  [${i.kind}] ${i.message}`);
  } else {
    console.log(
      '  ✓ every non-reserved .md has a type, and every internal link resolves',
    );
  }
  console.log(`  trust tiers: ${countBy(concepts, 'trust_tier')}`);
  console.log(`  statuses   : ${countBy(concepts, 'status')}`);

  if (!opts.validateOnly) {
    const widgetsFile = opts.widgets
      ? path.resolve(opts.widgets)
      : DEFAULT_WIDGETS_BUNDLE;
    const widgetsJs = readWidgetsBundle(widgetsFile);
    const usesWidgets = concepts.some((c) => /^\s*(`{3,}|~{3,})\s*widget\s*$/m.test(c.body));
    if (widgetsJs === null && usesWidgets) {
      console.log(
        `\nNote: no widget bundle at ${widgetsFile}, so widget blocks show a build hint.` +
          '\n  fix: npm run okf:widgets:build (or scaffold one: okf-bootstrap --widgets)',
      );
    }
    const html = buildHTML(readBundleTitle(bundleRoot), graph, widgetsJs);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(
      `\nWrote viewer: ${outPath} (${html.length} bytes). Open it in a browser; libraries load from a CDN.`,
    );
  }

  // A render gate that could not run (2) outranks a conformance failure (1):
  // the stronger signal is "this was not checked".
  let exitCode = 0;
  if (opts.checkRender) exitCode = await checkRender(outPath);
  if (opts.strict && issues.length && exitCode === 0) exitCode = 1;
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('okf-view: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
