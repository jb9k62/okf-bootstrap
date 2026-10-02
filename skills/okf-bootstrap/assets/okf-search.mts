#!/usr/bin/env node
/**
 * OKF bundle search: ranked, spec-aware retrieval for agents and people.
 *
 * Reads a bundle once (frontmatter, headings, links, term counts), caches that on
 * disk keyed by each file's size, mtime and ctime, and answers queries from the cache.
 * No daemon: every run re-stats the files and re-parses what changed, and what was
 * modified close to when the cache was written (the "racily clean" rule version
 * control tools use), so a deleted cache only costs time. `--no-cache` skips it.
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
import { fileURLToPath } from 'node:url';
import {
  errorMessage,
  extractLinks,
  listMarkdown,
  normalizeVerified,
  parseDocument,
  RESERVED,
  trustTier,
} from './okf-core.mts';
import {
  buildEntry,
  buildIndex,
  freshness,
  freshnessLabel,
  hasFilters,
  matchesFilters,
  NO_FILTERS,
  search,
  snippet,
  stripCode,
  tokenize,
} from './okf-rank.mts';
import { DAY } from './okf-rank.mts';
import type { Entry, EntryMeta, Filters, Freshness, Hit, RankIndex } from './okf-rank.mts';

// The cache is only valid for the code that wrote it: a hash of this file, okf-core.mts and
// okf-rank.mts, so a refreshed copy of any never reads entries a different tokenizer produced.
const CACHE_VERSION = crypto
  .createHash('sha1')
  .update(fs.readFileSync(fileURLToPath(import.meta.url)))
  .update(fs.readFileSync(fileURLToPath(new URL('./okf-core.mts', import.meta.url))))
  .update(fs.readFileSync(fileURLToPath(new URL('./okf-rank.mts', import.meta.url))))
  .digest('hex')
  .slice(0, 12);
// A file modified this close to the cache being written may have changed again within the
// same timestamp tick, so it is re-read rather than trusted.
const RACY_MS = 2000;

const TRUST_NAMES: Record<string, string> = {
  human: 'human-reviewed',
  machine: 'machine-confirmed',
  unverified: 'unverified',
};

interface Cached {
  size: number;
  mtime: number;
  ctime: number;
  entry?: Entry;
  error?: string; // why the file could not be indexed
}

interface CacheFile {
  version: string;
  written: number; // ms since the epoch, when this file was written
  files: Record<string, Cached>;
}

interface Skipped {
  file: string;
  reason: string;
}

interface Index extends RankIndex {
  skipped: Skipped[];
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

// --- indexing one file ------------------------------------------------------

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
  const generated = fm.generated && typeof fm.generated === 'object' ? fm.generated : {};
  const meta: EntryMeta = {
    id,
    type: String(fm.type),
    title: String(fm.title ?? id),
    description: String(fm.description ?? ''),
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : fm.tags ? [String(fm.tags)] : [],
    status: String(fm.status ?? 'stable').toLowerCase(),
    trust: trustTier(fm),
    stale_after: fm.stale_after == null ? '' : String(fm.stale_after),
    generated_at: String((generated as Record<string, unknown>).at ?? ''),
    verified_at: latest(normalizeVerified(fm).map((v) => v.at)),
    links_to: extractLinks(body, path.dirname(path.join(bundleRoot, rel)), bundleRoot),
  };
  return buildEntry(meta, body);
}

// --- the cache --------------------------------------------------------------

/** Where the cache lives, or null when no private place exists (then there is no cache). */
function cachePath(bundleRoot: string): string | null {
  const key = crypto.createHash('sha1').update(path.resolve(bundleRoot)).digest('hex').slice(0, 12);
  const nm = path.resolve('node_modules');
  if (fs.existsSync(nm)) return path.join(nm, '.cache', 'okf-search', `${key}.json`);
  // No node_modules here: a per-user directory in the temp dir, which must be ours and private,
  // because another user must not be able to plant a cache an agent would then trust.
  const uid = process.getuid?.();
  const dir = path.join(os.tmpdir(), `okf-search-${uid ?? 'user'}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) return null;
  } catch {
    return null;
  }
  return path.join(dir, `${key}.json`);
}

function readCache(file: string): CacheFile | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    return c && c.version === CACHE_VERSION && typeof c.written === 'number' && c.files ? c : null;
  } catch {
    return null; // missing or corrupt: rebuild
  }
}

function writeCache(file: string, cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, JSON.stringify(cache), { flag: 'wx' }); // never write through a planted link
    fs.renameSync(tmp, file); // atomic, so a concurrent reader never sees half a file
  } catch {
    // The cache is an optimisation. A read-only checkout still searches.
  }
}

function loadIndex(bundleRoot: string, useCache: boolean): Index {
  const file = useCache ? cachePath(bundleRoot) : null;
  const old = file ? readCache(file) : null;
  const next: CacheFile = { version: CACHE_VERSION, written: Date.now(), files: {} };
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
    const trusted =
      rec &&
      rec.size === st.size &&
      rec.mtime === st.mtimeMs &&
      rec.ctime === st.ctimeMs &&
      rec.mtime < old!.written - RACY_MS;
    if (!rec || !trusted) {
      changed = true;
      let text: string;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch (e) {
        // A read failure may be transient (permissions), so it is reported but never cached.
        skipped.push({ file: rel, reason: errorMessage(e) });
        continue;
      }
      rec = { size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs };
      try {
        rec.entry = indexFile(rel, bundleRoot, text);
      } catch (e) {
        rec.error = errorMessage(e);
      }
    }
    next.files[rel] = rec;
    if (rec.entry) entries.push(rec.entry);
    else skipped.push({ file: rel, reason: rec.error ?? 'unreadable' });
  }
  if (old && Object.keys(old.files).length !== Object.keys(next.files).length) changed = true;
  if (file && changed) writeCache(file, next);

  return { ...buildIndex(entries), skipped };
}

// --- resolving ids and filters ------------------------------------------------

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

/** The command line's filters, with the concepts they name resolved once. */
function filtersOf(o: Options, idx: Index): Filters {
  return {
    tags: o.tags,
    type: o.type,
    status: o.status,
    trust: o.trust,
    freshness: o.freshness,
    expiresWithin: o.expiresWithin,
    linkedFrom: o.linkedFrom ? resolveId(idx, o.linkedFrom) : null,
    linksTo: o.linksTo ? resolveId(idx, o.linksTo) : null,
  };
}

// --- reading a concept ------------------------------------------------------

function readBody(bundleRoot: string, e: Entry): string {
  try {
    return parseDocument(fs.readFileSync(path.join(bundleRoot, e.id + '.md'), 'utf8')).body;
  } catch {
    return '';
  }
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
  const filters = filtersOf(o, idx);
  const filtered = hasFilters(filters);
  if (!query && !filtered) throw new UsageError('search needs a query or at least one filter');
  if (query && tokenize(query).length === 0 && !filtered) {
    throw new UsageError(`"${query}" has no searchable words`);
  }
  const all = search(idx, filters, o.now, query, o.all);
  const shown = all.slice(0, o.limit);
  const results = shown.map((h) => ({
    ...summary(h.entry, o),
    score: Number(h.score.toFixed(3)),
    snippet: snippet(readBody(bundleRoot, h.entry), query, h.entry.title),
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
  if (o.freshness) throw new UsageError('stale already lists only stale concepts; drop --fresh/--stale');
  // Overdue first, then (with --expires-within) what is about to be. The window is applied
  // here, not by matchesFilters, which would drop the overdue ones.
  const base: Filters = { ...filtersOf(o, idx), freshness: null, expiresWithin: null };
  const rows = idx.entries
    .filter((e) => matchesFilters(e, base, o.now))
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
  const status = one('status');
  if (status !== null && !['draft', 'stable', 'deprecated'].includes(status.toLowerCase())) {
    throw new UsageError(`--status: "${status}" is not draft, stable or deprecated`);
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
