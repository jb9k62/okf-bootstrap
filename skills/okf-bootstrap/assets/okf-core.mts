/**
 * Shared OKF reading code: frontmatter parsing, trust tier (SPEC §5.3), staleness
 * (§5.5), link extraction (§6.1) and bundle walking. Used by okf-view.mts and
 * okf-search.mts, which are copied into projects beside this file as
 * scripts/okf-*.mts. Imports nothing from outside this directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type Frontmatter = Record<string, unknown>;
export type Evidence = Record<string, unknown>;

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Bundle-relative, so only the bundle root's own index.md/log.md are reserved.
// A nested design/index.md is an ordinary concept and needs a `type`.
export const RESERVED = new Set(['index.md', 'log.md']);

const LINK_RE = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)/g;

// --- document parsing (mirrors reference_agent/bundle/document.py) ----------

export function parseDocument(text: string): { frontmatter: Frontmatter; body: string } {
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

/**
 * Blank out fenced blocks and inline code spans. Markdown inside them is shown
 * verbatim rather than rendered, so a link written there is not a link: it must
 * not become a graph edge, and must not be reported as a dangling one either.
 * Best effort, and deliberately line-based: an unbalanced backtick leaves its
 * line alone rather than swallowing the rest of the document.
 */
export function stripCode(body: string): string {
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
