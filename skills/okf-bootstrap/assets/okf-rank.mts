/**
 * The ranking behind okf-search, with no file system and no imports, so one copy of it
 * runs in Node (scripts/okf-search.mts) and, with its types stripped, inlined into the
 * viewer's page (okf-view.mts). Keep it that way: nothing here may touch `fs`, `path`,
 * `process` or the DOM.
 *
 * BM25F over title, tags, path, description, headings and body, then adjusted by what
 * the OKF spec says about a concept: stale (§5.5) and deprecated (§5.4) concepts are
 * demoted and flagged, never hidden; human-reviewed (§5.3) concepts rank above
 * machine-confirmed above unverified; concepts that others link to get a small boost.
 */

export type Field = 'title' | 'tags' | 'path' | 'description' | 'headings' | 'body';
export const FIELDS: Field[] = ['title', 'tags', 'path', 'description', 'headings', 'body'];
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
const MAX_PREFIX_EXPANSIONS = 25;

export const DAY = 86_400_000;

export interface Heading {
  level: number;
  text: string;
}

/** What a concept's frontmatter and links say, before its text is counted. */
export interface EntryMeta {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  status: string; // lower-case
  trust: string; // unverified | machine-confirmed | human-reviewed
  stale_after: string;
  generated_at: string;
  verified_at: string;
  links_to: string[];
}

export interface Entry extends EntryMeta {
  headings: Heading[];
  len: Record<Field, number>;
  tf: Record<Field, Record<string, number>>;
}

export interface RankIndex {
  entries: Entry[];
  byId: Map<string, Entry>;
  inlinks: Map<string, string[]>;
  df: Map<string, number>;
  avgLen: Record<Field, number>;
}

// --- tokenizing -------------------------------------------------------------

/** A light plural stripper, so "retries" and "retry" (or "tags" and "tag") meet. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

export function tokenize(text: string): string[] {
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

/**
 * Blank out fenced blocks and inline code spans. Markdown inside them is shown
 * verbatim rather than rendered, so a link written there is not a link, and a
 * "# comment" there is not a heading. One output line per input line.
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

export function headingsOf(body: string): Heading[] {
  const out: Heading[] = [];
  for (const line of stripCode(body).split(/\r?\n/)) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}

/** Count a concept's words, field by field. */
export function buildEntry(meta: EntryMeta, body: string): Entry {
  const headings = headingsOf(body);
  const texts: Record<Field, string> = {
    title: meta.title,
    tags: meta.tags.join(' '),
    path: meta.id,
    description: meta.description,
    headings: headings.map((h) => h.text).join('\n'),
    body,
  };
  const len = {} as Record<Field, number>;
  const tf = {} as Record<Field, Record<string, number>>;
  for (const f of FIELDS) ({ tf: tf[f], len: len[f] } = termCounts(texts[f]));
  return { ...meta, headings, len, tf };
}

/** Whole-bundle statistics: document frequencies, average lengths, who links to whom. */
export function buildIndex(entries: Entry[]): RankIndex {
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
  return { entries, byId, inlinks, df, avgLen };
}

// --- freshness --------------------------------------------------------------

export interface Freshness {
  state: 'stale' | 'fresh' | 'no-expiry';
  /** Whole days past `stale_after` (stale) or until it (fresh). */
  days: number | null;
}

export function freshness(e: EntryMeta, now: Date): Freshness {
  const t = e.stale_after ? new Date(e.stale_after).getTime() : NaN;
  if (Number.isNaN(t)) return { state: 'no-expiry', days: null };
  const delta = t - now.getTime();
  // SPEC §5.5: stale when now >= stale_after.
  return delta <= 0
    ? { state: 'stale', days: Math.floor(-delta / DAY) }
    : { state: 'fresh', days: Math.ceil(delta / DAY) };
}

export function freshnessLabel(f: Freshness): string {
  if (f.state === 'stale') return f.days === 0 ? 'stale today' : `stale ${f.days}d`;
  if (f.state === 'fresh') return `fresh, ${f.days}d left`;
  return 'no expiry';
}

// --- filtering --------------------------------------------------------------

export interface Filters {
  tags: string[];
  type: string | null;
  status: string | null;
  trust: string[] | null;
  freshness: 'fresh' | 'stale' | null;
  /** Milliseconds: stale_after falls within this long from now. */
  expiresWithin: number | null;
  /** Only concepts this one links to. */
  linkedFrom: EntryMeta | null;
  /** Only concepts that link to this one. */
  linksTo: EntryMeta | null;
}

export const NO_FILTERS: Filters = {
  tags: [],
  type: null,
  status: null,
  trust: null,
  freshness: null,
  expiresWithin: null,
  linkedFrom: null,
  linksTo: null,
};

export function hasFilters(f: Filters): boolean {
  return Boolean(
    f.tags.length || f.type || f.status || f.trust || f.freshness || f.expiresWithin !== null || f.linkedFrom || f.linksTo,
  );
}

export function matchesFilters(e: EntryMeta, f: Filters, now: Date): boolean {
  if (f.type && e.type.toLowerCase() !== f.type.toLowerCase()) return false;
  if (f.status && e.status !== f.status.toLowerCase()) return false;
  if (f.trust && !f.trust.includes(e.trust)) return false;
  if (f.tags.length) {
    const have = new Set(e.tags.map((t) => t.toLowerCase()));
    if (!f.tags.every((t) => have.has(t.toLowerCase()))) return false;
  }
  const fr = freshness(e, now);
  if (f.freshness === 'stale' && fr.state !== 'stale') return false;
  if (f.freshness === 'fresh' && fr.state === 'stale') return false;
  if (f.expiresWithin !== null) {
    if (fr.state !== 'fresh') return false;
    if (new Date(e.stale_after).getTime() - now.getTime() > f.expiresWithin) return false;
  }
  if (f.linkedFrom && !f.linkedFrom.links_to.includes(e.id)) return false;
  if (f.linksTo && !e.links_to.includes(f.linksTo.id)) return false;
  return true;
}

// --- ranking ----------------------------------------------------------------

export interface Hit {
  entry: Entry;
  score: number;
  text: number;
  adjust: Array<{ why: string; factor: number }>;
  matched: string[];
}

/** One query word and the bundle words it stands for. */
interface QueryTerm {
  word: string;
  expansions: Array<{ term: string; weight: number }>;
}

/** Done once per query, not per concept: a word in the bundle is itself; otherwise a prefix. */
function expandQuery(idx: RankIndex, words: string[]): QueryTerm[] {
  return words.map((word) => {
    if (idx.df.has(word)) return { word, expansions: [{ term: word, weight: 1 }] };
    if (word.length < 3) return { word, expansions: [] };
    // Not in the bundle: treat it as a prefix ("retr" finds "retry"), at a lower weight, and
    // keep the commonest few so a short prefix cannot fan out across the vocabulary.
    const found: string[] = [];
    for (const v of idx.df.keys()) if (v.startsWith(word)) found.push(v);
    found.sort((a, b) => idx.df.get(b)! - idx.df.get(a)! || a.localeCompare(b));
    return { word, expansions: found.slice(0, MAX_PREFIX_EXPANSIONS).map((term) => ({ term, weight: 0.6 })) };
  });
}

const present = (e: Entry, term: string) => FIELDS.some((f) => e.tf[f][term]);

/** Each query word scores as its best expansion, so a family of related words cannot outvote the word asked for. */
function bm25f(idx: RankIndex, e: Entry, query: QueryTerm[]): number {
  const n = idx.entries.length;
  let score = 0;
  for (const { expansions } of query) {
    let best = 0;
    for (const { term, weight } of expansions) {
      if (!present(e, term)) continue;
      const df = idx.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      let tfw = 0;
      for (const f of FIELDS) {
        const c = e.tf[f][term];
        if (!c) continue;
        tfw += (FIELD_WEIGHT[f] * c) / (1 - B + (B * e.len[f]) / idx.avgLen[f]);
      }
      best = Math.max(best, weight * idf * (tfw / (K1 + tfw)));
    }
    score += best;
  }
  return score;
}

export function adjustments(e: Entry, idx: RankIndex, now: Date): Hit['adjust'] {
  const out: Hit['adjust'] = [];
  if (freshness(e, now).state === 'stale') out.push({ why: 'stale', factor: STALE_FACTOR });
  if (e.status === 'deprecated') out.push({ why: 'deprecated', factor: DEPRECATED_FACTOR });
  if (e.status === 'draft') out.push({ why: 'draft', factor: DRAFT_FACTOR });
  const boost = TRUST_BOOST[e.trust] ?? 1;
  if (boost !== 1) out.push({ why: e.trust, factor: boost });
  const inbound = idx.inlinks.get(e.id)?.length ?? 0;
  if (inbound) {
    out.push({
      why: `${inbound} inbound link${inbound === 1 ? '' : 's'}`,
      factor: 1 + INLINK_STEP * Math.min(inbound, INLINK_CAP),
    });
  }
  return out;
}

/** Ranked concepts for a query. An empty query lists whatever passes the filters, by title. */
export function search(idx: RankIndex, f: Filters, now: Date, query: string, all = false): Hit[] {
  const terms = [...new Set(tokenize(query))];
  const expanded = expandQuery(idx, terms);
  const hits: Hit[] = [];
  for (const e of idx.entries) {
    if (!matchesFilters(e, f, now)) continue;
    const adjust = adjustments(e, idx, now);
    const factor = adjust.reduce((p, a) => p * a.factor, 1);
    if (terms.length === 0) {
      hits.push({ entry: e, score: 0, text: 0, adjust, matched: [] });
      continue;
    }
    const matched = expanded
      .filter(({ expansions }) => expansions.some(({ term }) => present(e, term)))
      .map(({ word }) => word);
    if (matched.length === 0) continue;
    if (all && matched.length < terms.length) continue;
    const text = bm25f(idx, e, expanded);
    hits.push({ entry: e, score: text * factor, text, adjust, matched });
  }
  // Ties (and the empty query) fall back to the title, so output is deterministic.
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title) || a.entry.id.localeCompare(b.entry.id));
  return hits;
}

/** The body line that matches the most query terms, trimmed to a short plain-text line. */
export function snippet(body: string, query: string, title = ''): string {
  const want = [...new Set(tokenize(query))];
  if (want.length === 0) return '';
  let best = '';
  let bestScore = 0;
  for (const raw of stripCode(body).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[|\-:\s]+$/.test(line)) continue;
    if (title && line.replace(/^#+\s+/, '') === title) continue; // the title is already shown
    const have = new Set(
      tokenize(line).filter((t) => want.includes(t) || want.some((w) => w.length >= 3 && t.startsWith(w))),
    );
    if (have.size > bestScore) {
      bestScore = have.size;
      best = line;
    }
  }
  const plain = best.replace(/^#+\s+|^[-*>]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
  return plain.length > 160 ? plain.slice(0, 157) + '...' : plain;
}
