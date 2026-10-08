/**
 * Shared OKF reading code: frontmatter parsing, trust tier (SPEC §5.3), staleness
 * (§5.5), link extraction (§6.1) and bundle walking. Used by okf-view.mts and
 * okf-search.mts (with okf-rank.mts, the ranking), which are copied into projects beside this file as
 * scripts/okf-*.mts. Imports nothing from outside this directory.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { stripCode } from './okf-rank.mts';

// `yaml` is loaded by the first document parsed, not at start-up: a search answered from
// its cache reads no frontmatter, and loading the parser would be most of its run time.
let yamlModule: typeof import('yaml') | null = null;

/** The `yaml` package. Throws when it is not installed. */
export function loadYaml(): typeof import('yaml') {
  return (yamlModule ??= createRequire(import.meta.url)('yaml') as typeof import('yaml'));
}

export type Frontmatter = Record<string, unknown>;
export type Evidence = Record<string, unknown>;

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Bundle-relative, so only the bundle root's own index.md/log.md are reserved.
// A nested design/index.md is an ordinary concept and needs a `type`.
export const RESERVED = new Set(['index.md', 'log.md']);

const LINK_RE = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)/g;

// --- document parsing (mirrors reference_agent/bundle/document.py) ----------

/**
 * A document as its frontmatter text (null when it has none) and its body, without
 * reading the YAML.
 */
export function splitDocument(text: string): { frontmatter: string | null; body: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length === 0 || lines[0]!.trim() !== '---') {
    return { frontmatter: null, body: text };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) throw new Error('Unterminated YAML frontmatter block');
  let body = lines.slice(endIdx + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatter: lines.slice(1, endIdx).join('\n'), body };
}

export function parseDocument(text: string): { frontmatter: Frontmatter; body: string } {
  const { frontmatter: fmText, body } = splitDocument(text);
  if (fmText === null) return { frontmatter: {}, body };
  let fm: unknown;
  try {
    fm = loadYaml().parse(fmText) ?? {};
  } catch (e) {
    throw new Error(`Invalid YAML in frontmatter: ${errorMessage(e)}`);
  }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }
  return { frontmatter: fm as Frontmatter, body };
}

export function normalizeVerified(fm: Frontmatter): Evidence[] {
  const v = fm.verified;
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object');
  if (typeof v === 'object') return [v as Evidence];
  return [];
}

export function trustTier(fm: Frontmatter): string {
  const ev = normalizeVerified(fm);
  if (ev.length === 0) return 'unverified';
  if (ev.some((e) => String(e.by || '').startsWith('human:')))
    return 'human-reviewed';
  return 'machine-confirmed';
}

export function isStale(fm: Frontmatter, today: Date): boolean {
  const raw = fm.stale_after;
  if (!raw) return false;
  // A date-only value (reported as a timestamp issue) is read as midnight UTC.
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return false;
  return (today || new Date()) >= d;
}

// --- link extraction (mirrors reference viewer _extract_links) --------------

export function extractLinks(body: string, docDir: string, bundleRoot: string): string[] {
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

export function listMarkdown(root: string): string[] {
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
