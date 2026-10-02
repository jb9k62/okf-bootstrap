#!/usr/bin/env node
/**
 * OKF bundle search: ranked, spec-aware retrieval for agents and people.
 *
 * Reads a bundle once (frontmatter, headings, links, term counts), caches that on
 * disk keyed by each file's mtime and size, and answers queries from the cache. No
 * daemon: every run re-stats the files and re-parses only what changed, so the
 * answer is never stale and a deleted cache only costs time.
 *
 * Ranking is BM25F over title, tags, path, description, headings and body, then
 * adjusted by what the OKF spec says about a concept: stale (§5.5) and deprecated
 * (§5.4) concepts are demoted and flagged, never hidden; human-reviewed (§5.3)
 * concepts rank above machine-confirmed above unverified; concepts that others link
 * to get a small boost. `--explain` shows the arithmetic.
 *
 * Usage:
 *   node scripts/okf-search.mts <command> [args] [options]
 *
 *   search [query]     ranked concepts (the query may be empty when a filter is given)
 *   show <id>          one concept; --section <heading> for part of it, --outline for headings
 *   related <id>       what it links to, what links to it, concepts sharing its tags
 *   facets             the tags, types, statuses and trust tiers in use, with counts
 *   stale              the review queue: stale concepts, most overdue first
 *
 * Filters (search, stale):
 *   --tag <t>          has this tag (repeat for all of several)
 *   --type <t>         concept type, case-insensitive
 *   --status <s>       draft | stable | deprecated
 *   --trust <list>     human, machine, unverified (comma-separated, exact tiers)
 *   --fresh | --stale  not stale / stale (a concept without `stale_after` never expires)
 *   --expires-within 14d   stale_after falls in the next 14 days (units: h, d, w)
 *   --linked-from <id> concepts that <id> links to
 *   --links-to <id>    concepts that link to <id>
 *   --all              every query term must match
 *
 * Options:
 *   --bundle <dir>     bundle directory (default: ./okf)
 *   --limit <n>        results to show (default 10)
 *   --json             machine-readable output
 *   --explain          show each result's score breakdown
 *   --now <iso>        the instant staleness is judged at (default: now)
 *   --no-cache         do not read or write the cache
 *   --strict           exit 1 if any file in the bundle could not be indexed
 *
 * Exit codes: 0 ok (an empty result is still ok), 1 --strict and a file could not be
 * indexed, 2 could not run (bad arguments, missing bundle or concept).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  errorMessage,
  extractLinks,
  listMarkdown,
  normalizeVerified,
  parseDocument,
  RESERVED,
  stripCode,
  trustTier,
} from './okf-core.mts';

// Bump when the shape of the cache or the tokenizer changes.
const CACHE_VERSION = 1;

type Field = 'title' | 'tags' | 'path' | 'description' | 'headings' | 'body';
const FIELDS: Field[] = ['title', 'tags', 'path', 'description', 'headings', 'body'];
const FIELD_WEIGHT: Record<Field, number> = {
  title: 5,
  tags: 4,
  path: 3,
  description: 2.5,
  headings: 2,
  body: 1,
};
const K1 = 1.2;
const B = 0.75;

// What the spec says about a concept, as multipliers on its text score.
const TRUST_BOOST: Record<string, number> = {
  'human-reviewed': 1.15,
  'machine-confirmed': 1.05,
  unverified: 1,
};
const STALE_FACTOR = 0.6;
const DEPRECATED_FACTOR = 0.5;
const DRAFT_FACTOR = 0.85;
const INLINK_STEP = 0.04; // per inbound link, capped at INLINK_CAP links
const INLINK_CAP = 5;

const TRUST_NAMES: Record<string, string> = {
  human: 'human-reviewed',
  machine: 'machine-confirmed',
  unverified: 'unverified',
};

interface Heading {
  level: number;
  text: string;
}

interface Entry {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  status: string;
  trust: string;
  stale_after: string;
  generated_at: string;
  verified_at: string;
  links_to: string[];
  headings: Heading[];
  len: Record<Field, number>;
  tf: Record<Field, Record<string, number>>;
}

interface Cached {
  size: number;
  mtime: number;
  entry?: Entry;
  error?: string; // why the file could not be indexed
}

interface CacheFile {
  version: number;
  files: Record<string, Cached>;
}

interface Skipped {
  file: string;
  reason: string;
}

interface Index {
  entries: Entry[];
  byId: Map<string, Entry>;
  inlinks: Map<string, string[]>;
  skipped: Skipped[];
  df: Map<string, number>;
  avgLen: Record<Field, number>;
}

interface Options {
  command: string;
  args: string[];
  bundle: string;
  limit: number;
  json: boolean;
  explain: boolean;
  outline: boolean;
  section: string | null;
  now: Date;
  cache: boolean;
  strict: boolean;
  all: boolean;
  tags: string[];
  type: string | null;
  status: string | null;
  trust: string[] | null;
  freshness: 'fresh' | 'stale' | null;
  expiresWithin: number | null;
  linkedFrom: string | null;
  linksTo: string | null;
}

class UsageError extends Error {}

// --- tokenizing -------------------------------------------------------------

/** A light plural stripper, so "retries" and "retry" (or "tags" and "tag") meet. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

function tokenize(text: string): string[] {
  // camelCase and snake_case split into words; digits stay attached ("http2").
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const words = spaced.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map(stem);
}

function termCounts(text: string): { tf: Record<string, number>; len: number } {
  const tf: Record<string, number> = Object.create(null);
  const words = tokenize(text);
  for (const w of words) tf[w] = (tf[w] ?? 0) + 1;
  return { tf, len: words.length };
}

// --- indexing one file ------------------------------------------------------

function headingsOf(body: string): Heading[] {
  const out: Heading[] = [];
  // stripCode keeps one output line per input line and blanks fenced code, so a
  // "# comment" inside a code block is not a heading.
  for (const line of stripCode(body).split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}

function latest(values: unknown[]): string {
  let best = '';
  let bestT = -Infinity;
  for (const v of values) {
    const t = new Date(String(v)).getTime();
    if (!Number.isNaN(t) && t > bestT) {
      bestT = t;
      best = String(v);
    }
  }
  return best;
}

function indexFile(rel: string, bundleRoot: string, text: string): Entry {
  const { frontmatter: fm, body } = parseDocument(text);
  if (fm.type == null || String(fm.type).trim() === '') {
    throw new Error('no non-empty `type` in frontmatter');
  }
  const id = rel.replace(/\.md$/, '');
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : fm.tags ? [String(fm.tags)] : [];
  const headings = headingsOf(body);
  const texts: Record<Field, string> = {
    title: String(fm.title ?? id),
    tags: tags.join(' '),
    path: id,
    description: String(fm.description ?? ''),
    headings: headings.map((h) => h.text).join('\n'),
    body,
  };
  const len = {} as Record<Field, number>;
  const tf = {} as Record<Field, Record<string, number>>;
  for (const f of FIELDS) ({ tf: tf[f], len: len[f] } = termCounts(texts[f]));
  const generated = fm.generated && typeof fm.generated === 'object' ? fm.generated : {};
  return {
    id,
    type: String(fm.type),
    title: texts.title,
    description: texts.description,
    tags,
    status: String(fm.status ?? 'stable'),
    trust: trustTier(fm),
    stale_after: fm.stale_after == null ? '' : String(fm.stale_after),
    generated_at: String((generated as Record<string, unknown>).at ?? ''),
    verified_at: latest(normalizeVerified(fm).map((v) => v.at)),
    links_to: extractLinks(body, path.dirname(path.join(bundleRoot, rel)), bundleRoot),
    headings,
    len,
    tf,
  };
}

// --- the cache --------------------------------------------------------------

function cachePath(bundleRoot: string): string {
  const key = crypto.createHash('sha1').update(path.resolve(bundleRoot)).digest('hex').slice(0, 12);
  const nm = path.resolve('node_modules');
  const base = fs.existsSync(nm) ? path.join(nm, '.cache', 'okf-search') : path.join(os.tmpdir(), 'okf-search');
  return path.join(base, `${key}.json`);
}

function readCache(file: string): CacheFile | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    return c && c.version === CACHE_VERSION && c.files ? c : null;
  } catch {
    return null; // missing or corrupt: rebuild
  }
}

function writeCache(file: string, cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, file); // atomic, so a concurrent reader never sees half a file
  } catch {
    // The cache is an optimisation. A read-only checkout still searches.
  }
}

function loadIndex(bundleRoot: string, useCache: boolean): Index {
  const file = cachePath(bundleRoot);
  const old = useCache ? readCache(file) : null;
  const next: CacheFile = { version: CACHE_VERSION, files: {} };
  let changed = old === null;
  const skipped: Skipped[] = [];
  const entries: Entry[] = [];

  const files = listMarkdown(bundleRoot);
  for (const rel of files) {
    if (RESERVED.has(rel)) continue;
    const full = path.join(bundleRoot, rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch (e) {
      skipped.push({ file: rel, reason: errorMessage(e) });
      continue;
    }
    let rec = old?.files[rel];
    if (!rec || rec.size !== st.size || rec.mtime !== st.mtimeMs) {
      changed = true;
      rec = { size: st.size, mtime: st.mtimeMs };
      try {
        rec.entry = indexFile(rel, bundleRoot, fs.readFileSync(full, 'utf8'));
      } catch (e) {
        rec.error = errorMessage(e);
      }
    }
    next.files[rel] = rec;
    if (rec.entry) entries.push(rec.entry);
    else skipped.push({ file: rel, reason: rec.error ?? 'unreadable' });
  }
  if (old && Object.keys(old.files).length !== Object.keys(next.files).length) changed = true;
  if (useCache && changed) writeCache(file, next);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const inlinks = new Map<string, string[]>();
  const df = new Map<string, number>();
  const total = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  for (const e of entries) {
    for (const t of e.links_to) {
      if (t === e.id || !byId.has(t)) continue;
      const list = inlinks.get(t) ?? [];
      list.push(e.id);
      inlinks.set(t, list);
    }
    const seen = new Set<string>();
    for (const f of FIELDS) {
      total[f] += e.len[f];
      for (const t of Object.keys(e.tf[f])) seen.add(t);
    }
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(entries.length, 1);
  const avgLen = Object.fromEntries(FIELDS.map((f) => [f, Math.max(total[f] / n, 1)])) as Record<
    Field,
    number
  >;
  return { entries, byId, inlinks, skipped, df, avgLen };
}

// --- freshness --------------------------------------------------------------

const DAY = 86_400_000;

interface Freshness {
  state: 'stale' | 'fresh' | 'no-expiry';
  /** Whole days past `stale_after` (stale) or until it (fresh). */
  days: number | null;
}

function freshness(e: Entry, now: Date): Freshness {
  const t = e.stale_after ? new Date(e.stale_after).getTime() : NaN;
  if (Number.isNaN(t)) return { state: 'no-expiry', days: null };
  const delta = t - now.getTime();
  // SPEC §5.5: stale when now >= stale_after.
  return delta <= 0
    ? { state: 'stale', days: Math.floor(-delta / DAY) }
    : { state: 'fresh', days: Math.ceil(delta / DAY) };
}

function freshnessLabel(f: Freshness): string {
  if (f.state === 'stale') return f.days === 0 ? 'stale today' : `stale ${f.days}d`;
  if (f.state === 'fresh') return `fresh, ${f.days}d left`;
  return 'no expiry';
}

// --- filtering --------------------------------------------------------------

function matchesFilters(e: Entry, o: Options, idx: Index): boolean {
  if (o.type && e.type.toLowerCase() !== o.type.toLowerCase()) return false;
  if (o.status && e.status.toLowerCase() !== o.status.toLowerCase()) return false;
  if (o.trust && !o.trust.includes(e.trust)) return false;
  if (o.tags.length) {
    const have = new Set(e.tags.map((t) => t.toLowerCase()));
    if (!o.tags.every((t) => have.has(t.toLowerCase()))) return false;
  }
  const f = freshness(e, o.now);
  if (o.freshness === 'stale' && f.state !== 'stale') return false;
  if (o.freshness === 'fresh' && f.state === 'stale') return false;
  if (o.expiresWithin !== null) {
    if (f.state !== 'fresh') return false;
    if (new Date(e.stale_after).getTime() - o.now.getTime() > o.expiresWithin) return false;
  }
  if (o.linkedFrom) {
    const src = resolveId(idx, o.linkedFrom);
    if (!src.links_to.includes(e.id)) return false;
  }
  if (o.linksTo) {
    const dst = resolveId(idx, o.linksTo);
    if (!e.links_to.includes(dst.id)) return false;
  }
  return true;
}

function normalizeId(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\.md$/, '');
}

function resolveId(idx: Index, raw: string): Entry {
  const id = normalizeId(raw);
  const hit = idx.byId.get(id);
  if (hit) return hit;
  const base = id.split('/').pop()!;
  const near = idx.entries.filter((e) => e.id.includes(base)).slice(0, 5);
  throw new UsageError(
    `no concept "${id}" in the bundle` +
      (near.length ? `\n  did you mean: ${near.map((e) => e.id).join(', ')}` : ''),
  );
}

// --- ranking ----------------------------------------------------------------

interface Hit {
  entry: Entry;
  score: number;
  text: number;
  adjust: Array<{ why: string; factor: number }>;
  matched: string[];
}

function expandTerms(idx: Index, terms: string[]): Array<{ term: string; weight: number }> {
  const out: Array<{ term: string; weight: number }> = [];
  for (const t of terms) {
    if (idx.df.has(t)) {
      out.push({ term: t, weight: 1 });
    } else if (t.length >= 3) {
      // Not in the bundle: treat the word as a prefix ("retr" finds "retry"), at a lower weight.
      for (const v of idx.df.keys()) if (v.startsWith(t)) out.push({ term: v, weight: 0.6 });
    }
  }
  return out;
}

function bm25f(idx: Index, e: Entry, terms: Array<{ term: string; weight: number }>): number {
  const n = idx.entries.length;
  let score = 0;
  for (const { term, weight } of terms) {
    const df = idx.df.get(term) ?? 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    let tfw = 0;
    for (const f of FIELDS) {
      const c = e.tf[f][term];
      if (!c) continue;
      tfw += (FIELD_WEIGHT[f] * c) / (1 - B + (B * e.len[f]) / idx.avgLen[f]);
    }
    score += weight * idf * (tfw / (K1 + tfw));
  }
  return score;
}

function adjustments(e: Entry, o: Options, idx: Index): Hit['adjust'] {
  const out: Hit['adjust'] = [];
  if (freshness(e, o.now).state === 'stale') out.push({ why: 'stale', factor: STALE_FACTOR });
  if (e.status === 'deprecated') out.push({ why: 'deprecated', factor: DEPRECATED_FACTOR });
  if (e.status === 'draft') out.push({ why: 'draft', factor: DRAFT_FACTOR });
  const boost = TRUST_BOOST[e.trust] ?? 1;
  if (boost !== 1) out.push({ why: e.trust, factor: boost });
  const inbound = Math.min(idx.inlinks.get(e.id)?.length ?? 0, INLINK_CAP);
  if (inbound) out.push({ why: `${inbound} inbound link${inbound === 1 ? '' : 's'}`, factor: 1 + INLINK_STEP * inbound });
  return out;
}

function search(idx: Index, o: Options, query: string): Hit[] {
  const terms = [...new Set(tokenize(query))];
  const expanded = expandTerms(idx, terms);
  const hits: Hit[] = [];
  for (const e of idx.entries) {
    if (!matchesFilters(e, o, idx)) continue;
    const adjust = adjustments(e, o, idx);
    const factor = adjust.reduce((p, a) => p * a.factor, 1);
    if (terms.length === 0) {
      hits.push({ entry: e, score: 0, text: 0, adjust, matched: [] });
      continue;
    }
    const matched = terms.filter((t) =>
      expandTerms(idx, [t]).some(({ term }) => FIELDS.some((f) => e.tf[f][term])),
    );
    if (matched.length === 0) continue;
    if (o.all && matched.length < terms.length) continue;
    const text = bm25f(idx, e, expanded);
    hits.push({ entry: e, score: text * factor, text, adjust, matched });
  }
  // Ties (and the empty query) fall back to the title, so output is deterministic.
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title) || a.entry.id.localeCompare(b.entry.id));
  return hits;
}

// --- reading a concept ------------------------------------------------------

function readBody(bundleRoot: string, e: Entry): string {
  try {
    return parseDocument(fs.readFileSync(path.join(bundleRoot, e.id + '.md'), 'utf8')).body;
  } catch {
    return '';
  }
}

/** The body line that matches the most query terms, trimmed around the first match. */
function snippet(body: string, terms: string[]): string {
  if (terms.length === 0) return '';
  const want = new Set(terms);
  let best = '';
  let bestScore = 0;
  for (const raw of stripCode(body).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[|\-:\s]+$/.test(line)) continue;
    const have = new Set(tokenize(line).filter((t) => want.has(t) || [...want].some((w) => w.length >= 3 && t.startsWith(w))));
    if (have.size > bestScore) {
      bestScore = have.size;
      best = line;
    }
  }
  const plain = best.replace(/^#+\s+|^[-*>]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
  return plain.length > 160 ? plain.slice(0, 157) + '...' : plain;
}

function section(body: string, want: string): string | null {
  const lines = body.split(/\r?\n/);
  const flat = stripCode(body).split(/\r?\n/);
  const q = want.trim().toLowerCase();
  const heads: Array<{ i: number; level: number; text: string }> = [];
  flat.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) heads.push({ i, level: m[1]!.length, text: m[2]!.toLowerCase() });
  });
  const start = heads.find((h) => h.text === q) ?? heads.find((h) => h.text.includes(q));
  if (!start) return null;
  const next = heads.find((h) => h.i > start.i && h.level <= start.level);
  return lines.slice(start.i, next ? next.i : lines.length).join('\n').trimEnd();
}

// --- output -----------------------------------------------------------------

function summary(e: Entry, o: Options) {
  const f = freshness(e, o.now);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    tags: e.tags,
    status: e.status,
    trust: e.trust,
    freshness: f.state,
    stale_after: e.stale_after || null,
    days: f.days,
    verified_at: e.verified_at || null,
    generated_at: e.generated_at || null,
  };
}

const badge = (e: Entry, o: Options) => [e.type, e.trust, freshnessLabel(freshness(e, o.now)), ...(e.status === 'stable' ? [] : [e.status])].join(' · ');

function print(o: Options, data: unknown, text: () => string): void {
  console.log(o.json ? JSON.stringify(data, null, 2) : text());
}

function cmdSearch(idx: Index, o: Options, bundleRoot: string): void {
  const query = o.args.join(' ').trim();
  const filtered =
    o.tags.length || o.type || o.status || o.trust || o.freshness || o.expiresWithin !== null || o.linkedFrom || o.linksTo;
  if (!query && !filtered) throw new UsageError('search needs a query or at least one filter');
  const all = search(idx, o, query);
  const shown = all.slice(0, o.limit);
  const terms = [...new Set(tokenize(query))];
  const results = shown.map((h) => ({
    ...summary(h.entry, o),
    score: Number(h.score.toFixed(3)),
    snippet: snippet(readBody(bundleRoot, h.entry), terms),
    ...(o.explain ? { explain: { text: Number(h.text.toFixed(3)), adjust: h.adjust, matched: h.matched } } : {}),
  }));
  print(o, { query, total: all.length, results }, () => {
    if (results.length === 0) return `No concepts match${query ? ` "${query}"` : ''}.`;
    const out = [`${all.length} match${all.length === 1 ? '' : 'es'}${all.length > results.length ? `, showing ${results.length}` : ''}`];
    results.forEach((r, i) => {
      const e = idx.byId.get(r.id)!;
      out.push('', `${i + 1}. ${r.id}${query ? `  (score ${r.score.toFixed(2)})` : ''}`, `   ${r.title}  [${badge(e, o)}]`);
      if (r.description) out.push(`   ${r.description}`);
      if (r.tags.length) out.push(`   tags: ${r.tags.join(', ')}`);
      if (r.snippet) out.push(`   > ${r.snippet}`);
      if (o.explain) {
        const x = (r as { explain: { text: number; adjust: Hit['adjust']; matched: string[] } }).explain;
        out.push(`   text ${x.text.toFixed(2)}` + x.adjust.map((a) => ` × ${a.factor.toFixed(2)} (${a.why})`).join(''));
      }
    });
    return out.join('\n');
  });
}

function cmdShow(idx: Index, o: Options, bundleRoot: string): void {
  if (o.args.length !== 1) throw new UsageError('show takes one concept id');
  const e = resolveId(idx, o.args[0]!);
  const body = readBody(bundleRoot, e);
  const part = o.section ? section(body, o.section) : null;
  if (o.section && part === null) {
    throw new UsageError(
      `no heading matching "${o.section}" in ${e.id}\n  headings: ${e.headings.map((h) => h.text).join(' | ') || '(none)'}`,
    );
  }
  const data = {
    ...summary(e, o),
    links_to: e.links_to,
    linked_from: idx.inlinks.get(e.id) ?? [],
    headings: e.headings,
    ...(o.outline ? {} : { content: part ?? body }),
  };
  print(o, data, () => {
    const out = [`${e.id}`, `${e.title}  [${badge(e, o)}]`];
    if (e.description) out.push(e.description);
    if (e.tags.length) out.push(`tags: ${e.tags.join(', ')}`);
    if (e.verified_at) out.push(`last verified: ${e.verified_at}`);
    if (e.stale_after) out.push(`stale after: ${e.stale_after}`);
    out.push('');
    if (o.outline) out.push(...e.headings.map((h) => `${'  '.repeat(h.level - 1)}${h.text}`));
    else out.push(part ?? body.trimEnd());
    return out.join('\n');
  });
}

function cmdRelated(idx: Index, o: Options): void {
  if (o.args.length !== 1) throw new UsageError('related takes one concept id');
  const e = resolveId(idx, o.args[0]!);
  const pick = (ids: string[]) => ids.filter((id) => id !== e.id).map((id) => idx.byId.get(id)).filter((x): x is Entry => !!x);
  const mine = new Set(e.tags.map((t) => t.toLowerCase()));
  const shared = idx.entries
    .filter((x) => x.id !== e.id)
    .map((x) => ({ x, n: x.tags.filter((t) => mine.has(t.toLowerCase())).length }))
    .filter(({ n }) => n > 0)
    .sort((a, b) => b.n - a.n || a.x.id.localeCompare(b.x.id))
    .slice(0, o.limit);
  const groups = {
    links_to: pick(e.links_to).map((x) => summary(x, o)),
    linked_from: pick(idx.inlinks.get(e.id) ?? []).map((x) => summary(x, o)),
    shared_tags: shared.map(({ x, n }) => ({ ...summary(x, o), shared: n })),
  };
  print(o, { id: e.id, ...groups }, () => {
    const out = [`${e.id}  ${e.title}`];
    for (const [label, list] of Object.entries(groups) as Array<[string, Array<ReturnType<typeof summary>>]>) {
      out.push('', `${label.replace('_', ' ')} (${list.length})`);
      for (const r of list) out.push(`  ${r.id}  [${badge(idx.byId.get(r.id)!, o)}]  ${r.title}`);
    }
    return out.join('\n');
  });
}

function cmdFacets(idx: Index, o: Options): void {
  const count = (keys: (e: Entry) => string[]) => {
    const m = new Map<string, { count: number; stale: number }>();
    for (const e of idx.entries) {
      const stale = freshness(e, o.now).state === 'stale' ? 1 : 0;
      for (const k of new Set(keys(e))) {
        const c = m.get(k) ?? { count: 0, stale: 0 };
        c.count++;
        c.stale += stale;
        m.set(k, c);
      }
    }
    return [...m].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };
  const data = {
    concepts: idx.entries.length,
    stale: idx.entries.filter((e) => freshness(e, o.now).state === 'stale').length,
    tags: count((e) => e.tags),
    types: count((e) => [e.type]),
    status: count((e) => [e.status]),
    trust: count((e) => [e.trust]),
    skipped: idx.skipped,
  };
  print(o, data, () => {
    const out = [`${data.concepts} concepts, ${data.stale} stale`];
    for (const k of ['tags', 'types', 'status', 'trust'] as const) {
      out.push('', k);
      for (const r of data[k]) out.push(`  ${r.name}  ${r.count}${r.stale ? `  (${r.stale} stale)` : ''}`);
    }
    return out.join('\n');
  });
}

function cmdStale(idx: Index, o: Options): void {
  // Overdue first, then (with --expires-within) what is about to be. The window is applied
  // here, not by matchesFilters, which would drop the overdue ones.
  const base: Options = { ...o, freshness: null, expiresWithin: null };
  const rows = idx.entries
    .filter((e) => matchesFilters(e, base, idx))
    .map((e) => ({ e, f: freshness(e, o.now) }))
    .filter(({ e, f }) =>
      f.state === 'stale' ||
      (o.expiresWithin !== null && f.state === 'fresh' && new Date(e.stale_after).getTime() - o.now.getTime() <= o.expiresWithin),
    )
    .sort((a, b) => {
      const rank = (f: Freshness) => (f.state === 'stale' ? -(f.days ?? 0) - 1e6 : (f.days ?? 0));
      return rank(a.f) - rank(b.f) || a.e.id.localeCompare(b.e.id);
    });
  print(o, { total: rows.length, results: rows.slice(0, o.limit).map(({ e }) => summary(e, o)) }, () => {
    if (rows.length === 0) return 'Nothing stale.';
    const out = [`${rows.length} to review`];
    for (const { e } of rows.slice(0, o.limit)) out.push(`  ${e.id}  [${badge(e, o)}]  ${e.title}`);
    return out.join('\n');
  });
}

// --- arguments --------------------------------------------------------------

const VALUE_FLAGS = new Set([
  'bundle', 'limit', 'tag', 'type', 'status', 'trust', 'now', 'section', 'expires-within', 'linked-from', 'links-to',
]);
const BOOL_FLAGS = new Set(['json', 'explain', 'outline', 'fresh', 'stale', 'all', 'no-cache', 'strict', 'help']);

function parseDuration(s: string): number {
  const m = s.match(/^(\d+)([hdw])$/);
  if (!m) throw new UsageError(`bad duration "${s}": use a number and h, d or w, for example 14d`);
  return Number(m[1]) * { h: 3_600_000, d: DAY, w: 7 * DAY }[m[2] as 'h' | 'd' | 'w'];
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (BOOL_FLAGS.has(name)) {
      flags.set(name, ['true']);
    } else if (VALUE_FLAGS.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), v]);
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  const one = (n: string) => flags.get(n)?.at(-1) ?? null;
  const has = (n: string) => flags.has(n);
  if (has('help') || rest.length === 0) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!.replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(has('help') ? 0 : 2);
  }
  const command = rest[0]!;
  if (!['search', 'show', 'related', 'facets', 'tags', 'stale'].includes(command)) {
    throw new UsageError(`unknown command "${command}" (search, show, related, facets, stale)`);
  }
  if (has('fresh') && has('stale')) throw new UsageError('--fresh and --stale contradict each other');
  const limit = one('limit') === null ? 10 : Number(one('limit'));
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
  const now = one('now') === null ? new Date() : new Date(one('now')!);
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now is not a date: ${one('now')}`);
  const trust = one('trust')
    ? one('trust')!.split(',').map((t) => {
        const full = TRUST_NAMES[t.trim().toLowerCase()];
        if (!full) throw new UsageError(`--trust: "${t}" is not human, machine or unverified`);
        return full;
      })
    : null;
  return {
    command: command === 'tags' ? 'facets' : command,
    args: rest.slice(1),
    bundle: one('bundle') ?? 'okf',
    limit,
    json: has('json'),
    explain: has('explain'),
    outline: has('outline'),
    section: one('section'),
    now,
    cache: !has('no-cache'),
    strict: has('strict'),
    all: has('all'),
    tags: (flags.get('tag') ?? []).flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean),
    type: one('type'),
    status: one('status'),
    trust,
    freshness: has('fresh') ? 'fresh' : has('stale') ? 'stale' : null,
    expiresWithin: one('expires-within') === null ? null : parseDuration(one('expires-within')!),
    linkedFrom: one('linked-from'),
    linksTo: one('links-to'),
  };
}

function main(): number {
  const o = parseArgs(process.argv.slice(2));
  const bundleRoot = path.resolve(o.bundle);
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    throw new UsageError(`bundle directory not found: ${o.bundle} (pass --bundle <dir>)`);
  }
  const idx = loadIndex(bundleRoot, o.cache);
  for (const s of idx.skipped) console.error(`okf-search: skipped ${s.file}: ${s.reason}`);
  switch (o.command) {
    case 'search': cmdSearch(idx, o, bundleRoot); break;
    case 'show': cmdShow(idx, o, bundleRoot); break;
    case 'related': cmdRelated(idx, o); break;
    case 'facets': cmdFacets(idx, o); break;
    case 'stale': cmdStale(idx, o); break;
  }
  return o.strict && idx.skipped.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error('okf-search: ' + (e instanceof UsageError ? e.message : e instanceof Error && e.stack ? e.stack : e));
  process.exitCode = 2;
}
