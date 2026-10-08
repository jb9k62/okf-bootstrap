/**
 * The ranking behind okf-search, with no file system and no imports, so one copy of it
 * runs in Node (scripts/okf-search.mts) and, with its types stripped, inlined into the
 * viewer's page (okf-view.mts). Keep it that way: nothing here may touch `fs`, `path`,
 * `process` or the DOM.
 *
 * BM25F over title, tags, path, description, headings, cited files and body, then adjusted
 * by what the OKF spec says about a concept: stale (§5.5) and deprecated (§5.4) concepts are
 * demoted and flagged, never hidden; human-reviewed (§5.3) concepts rank above
 * machine-confirmed above unverified; concepts that others link to get a small boost.
 *
 * The index is inverted (word -> the concepts that hold it), so a query reads only the
 * words it asks for, however large the bundle.
 */

export type Field = 'title' | 'tags' | 'path' | 'description' | 'headings' | 'cites' | 'body';
export const FIELDS: Field[] = ['title', 'tags', 'path', 'description', 'headings', 'cites', 'body'];
const FIELD_WEIGHT: Record<Field, number> = {
  title: 5,
  tags: 4,
  path: 3,
  description: 2.5,
  headings: 2,
  cites: 3,
  body: 1,
};
const WEIGHTS = FIELDS.map((f) => FIELD_WEIGHT[f]);
// K1 is on the scale of the weights: a count is multiplied by up to 5 before it saturates,
// and at the usual 1.2 one mention in a short body would score like a match in the title.
const K1 = 5;
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

// A query word stands for itself, then for its other forms ("caching" for "cache"), then,
// only when the bundle has neither, for the words it begins or the words it nearly spells.
const VARIANT_WEIGHT = 0.9;
const PREFIX_WEIGHT = 0.6;
const NEAR_WEIGHT = 0.4;
const MAX_PREFIX_EXPANSIONS = 25;
const MAX_NEAR_EXPANSIONS = 5;

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
  /** A lesson's `confidence` (tested, observed, inferred); absent on other concepts. */
  confidence?: string;
  /** The bundle-root path of the concept that replaced this one, when there is one. */
  superseded_by?: string;
  /** The files it rests on: `sources` that are paths, and the files its checks name. */
  cites?: string[];
}

/** A concept as the index keeps it: what it says about itself, and how long each field is. */
export interface Doc extends EntryMeta {
  headings: Heading[];
  len: Record<Field, number>;
}

/** A concept with its words counted, field by field, ready to go into an index. */
export interface Entry extends Doc {
  tf: Record<Field, Map<string, number>>;
}

/**
 * Word -> a flat list of records, one per concept that holds the word:
 * the concept's position in `entries`, a bit per field it appears in (in FIELDS order),
 * then its count in each of those fields. Flat numbers, because that is what a cache
 * parses fastest.
 */
export type Postings = Map<string, number[]>;

export interface RankIndex {
  entries: Doc[];
  byId: Map<string, Doc>;
  inlinks: Map<string, string[]>;
  postings: Postings;
  /** How many concepts hold a word. Filled in as words are asked about. */
  df: Map<string, number>;
  avgLen: Record<Field, number>;
}

// --- tokenizing -------------------------------------------------------------

// Plurals the rules below get wrong, as their singular.
const IRREGULAR = new Map([
  ['statuses', 'status'],
  ['aliases', 'alias'],
  ['analyses', 'analysis'],
  ['indices', 'index'],
  ['matrices', 'matrix'],
  ['vertices', 'vertex'],
  ['buses', 'bus'],
  ['viruses', 'virus'],
]);

/** A light plural stripper, so "retries" and "retry" (or "boxes" and "box") meet. */
function stem(word: string): string {
  if (!word.endsWith('s')) return word;
  const w = IRREGULAR.get(word) ?? word;
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  // "boxes", "matches", "classes", "hashes": the plural added "es". "caches" added "s".
  if (w.length > 4 && /(?:ss|x|sh|ch|zz)es$/.test(w) && !/(?:cach|nich)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    return w.slice(0, -1);
  }
  return w;
}

/** Accents off ("café" is "cafe"), and compatibility forms as their plain letters. */
function fold(text: string): string {
  return /[\u0080-￿]/.test(text) ? text.normalize('NFKD').replace(/\p{M}+/gu, '') : text;
}

const rawWords = (text: string): string[] => fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** camelCase split into its lower-case words ("parseHTTPResponse": parse, http, response); digits stay attached ("http2"). */
function camelParts(word: string): string[] {
  const lower = word.toLowerCase();
  if (lower === word) return [lower];
  const spaced = word.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll}{2})/gu, '$1 $2');
  return spaced === word ? [lower] : spaced.toLowerCase().split(' ');
}

// A bundle says the same few thousand words over and over: each is worked out once.
const TOKENS = new Map<string, string[]>();
const MAX_REMEMBERED = 100_000;

/** One written word as the index counts it: its camelCase parts, and the whole when it has parts. */
function tokensOf(word: string): string[] {
  let out = TOKENS.get(word);
  if (!out) {
    const parts = camelParts(word);
    out = parts.map(stem);
    if (parts.length > 1) out.push(stem(word.toLowerCase()));
    if (TOKENS.size >= MAX_REMEMBERED) TOKENS.clear();
    TOKENS.set(word, out);
  }
  return out;
}

/**
 * The words of a text as the index counts them. snake_case and kebab-case split at the
 * punctuation. A camelCase word counts as its parts and as itself, so "GitHub" is found by
 * "git hub" and by "github".
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of rawWords(text)) for (const t of tokensOf(word)) out.push(t);
  return out;
}

function termCounts(text: string): { tf: Map<string, number>; len: number } {
  const tf = new Map<string, number>();
  let len = 0;
  for (const word of rawWords(text)) {
    for (const t of tokensOf(word)) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
      len++;
    }
  }
  return { tf, len };
}

/**
 * Blank out fenced blocks and inline code spans. Markdown inside them is shown
 * verbatim rather than rendered, so a link written there is not a link, and a
 * "# comment" there is not a heading. One output line per input line.
 * Best effort, and deliberately line-based: an unbalanced backtick leaves its
 * line alone rather than swallowing the rest of the document.
 * With `spans` false only the fenced blocks go, and inline code stays as written.
 */
export function stripCode(body: string, spans = true): string {
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
      out.push(spans ? line.replace(/(`+)(.*?)\1/g, ' ') : line);
    }
  }
  return out.join('\n');
}

/** An ATX heading line: up to three spaces, one to six `#`, the text, optional closing `#`. */
export const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

export function headingsOf(body: string): Heading[] {
  const out: Heading[] = [];
  for (const line of stripCode(body).split(/\r?\n/)) {
    const m = line.match(HEADING_RE);
    if (m) out.push({ level: m[1]!.length, text: m[2]! });
  }
  return out;
}

/**
 * The body as a reader sees it: no HTML comments, and a link as its text. A link's target
 * names another concept's file, and counting it would make every page that links to
 * "retry-policy.md" a page about retry policy.
 */
function proseOf(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '] ');
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
    cites: (meta.cites ?? []).join(' '),
    body: proseOf(body),
  };
  const len = {} as Record<Field, number>;
  const tf = {} as Record<Field, Map<string, number>>;
  for (const f of FIELDS) ({ tf: tf[f], len: len[f] } = termCounts(texts[f]));
  return { ...meta, headings, len, tf };
}

/** Add one concept's words to the postings, as the concept at position `doc`. */
export function addPostings(postings: Postings, doc: number, tf: Entry['tf']): void {
  const masks = new Map<string, number>();
  for (let f = 0; f < FIELDS.length; f++) {
    for (const term of tf[FIELDS[f]!].keys()) masks.set(term, (masks.get(term) ?? 0) | (1 << f));
  }
  for (const [term, mask] of masks) {
    let list = postings.get(term);
    if (!list) postings.set(term, (list = []));
    list.push(doc, mask);
    for (let f = 0; f < FIELDS.length; f++) if (mask & (1 << f)) list.push(tf[FIELDS[f]!].get(term)!);
  }
}

const BITS = Array.from({ length: 1 << FIELDS.length }, (_, mask) => {
  let n = 0;
  for (let i = 0; i < FIELDS.length; i++) if (mask & (1 << i)) n++;
  return n;
});

/**
 * The postings with some concepts taken out and the rest renumbered: `keep[old]` is a
 * concept's new position, or -1 when it has gone (or changed, and will be added again).
 */
export function remapPostings(postings: Postings, keep: number[]): Postings {
  const out: Postings = new Map();
  for (const [term, list] of postings) {
    const next: number[] = [];
    for (let i = 0; i < list.length; ) {
      const to = keep[list[i]!] ?? -1;
      const size = 2 + BITS[list[i + 1]!]!;
      if (to !== -1) {
        next.push(to);
        for (let j = 1; j < size; j++) next.push(list[i + j]!);
      }
      i += size;
    }
    if (next.length) out.set(term, next);
  }
  return out;
}

/** An index over concepts whose words are already in `postings`. */
export function makeIndex(entries: Doc[], postings: Postings): RankIndex {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const inlinks = new Map<string, string[]>();
  const total = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  for (const e of entries) {
    for (const t of e.links_to) {
      if (t === e.id || !byId.has(t)) continue;
      const list = inlinks.get(t) ?? [];
      list.push(e.id);
      inlinks.set(t, list);
    }
    for (const f of FIELDS) total[f] += e.len[f] ?? 0;
  }
  const n = Math.max(entries.length, 1);
  const avgLen = Object.fromEntries(FIELDS.map((f) => [f, Math.max(total[f] / n, 1)])) as Record<
    Field,
    number
  >;
  return { entries, byId, inlinks, postings, df: new Map(), avgLen };
}

/** Whole-bundle statistics: who holds which word, average lengths, who links to whom. */
export function buildIndex(entries: Entry[]): RankIndex {
  const postings: Postings = new Map();
  const docs = entries.map(({ tf, ...doc }, i) => {
    addPostings(postings, i, tf);
    return doc;
  });
  return makeIndex(docs, postings);
}

/** In how many concepts a word appears. */
function docFreq(idx: RankIndex, term: string): number {
  let n = idx.df.get(term);
  if (n === undefined) {
    n = 0;
    const list = idx.postings.get(term) ?? [];
    for (let i = 0; i < list.length; i += 2 + BITS[list[i + 1]!]!) n++;
    idx.df.set(term, n);
  }
  return n;
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
  /** Only lessons with this confidence. */
  confidence?: string | null;
  /** Only concepts that cite this file, or a file under this folder (see `citesPath`). */
  cites?: string | null;
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
    f.tags.length || f.type || f.status || f.trust || f.freshness || f.expiresWithin !== null || f.linkedFrom || f.linksTo || f.confidence || f.cites,
  );
}

/** A file path in the one spelling `cites` is compared in: forward slashes, no `./`, no trailing slash. */
export function citesPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
}

/** Does a cited path answer a `--cites` value: the same file, a file under that folder, or a path that ends with it. */
function citesMatch(cited: string, want: string): boolean {
  return cited === want || cited.startsWith(want + '/') || cited.endsWith('/' + want);
}

export function matchesFilters(e: EntryMeta, f: Filters, now: Date): boolean {
  if (f.type && e.type.toLowerCase() !== f.type.toLowerCase()) return false;
  if (f.status && e.status !== f.status.toLowerCase()) return false;
  if (f.trust && !f.trust.includes(e.trust)) return false;
  if (f.confidence && (e.confidence ?? '') !== f.confidence.toLowerCase()) return false;
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
  if (f.cites && !(e.cites ?? []).some((c) => citesMatch(c, f.cites!))) return false;
  if (f.linkedFrom && !f.linkedFrom.links_to.includes(e.id)) return false;
  if (f.linksTo && !e.links_to.includes(f.linksTo.id)) return false;
  return true;
}

// --- ranking ----------------------------------------------------------------

export interface Hit {
  entry: Doc;
  score: number;
  text: number;
  adjust: Array<{ why: string; factor: number }>;
  matched: string[];
}

// Words a question is asked with, not about. Dropped from a query that has other words.
const STOP_WORDS = new Set(
  ('a an and are as at be but by can do does for from has have how i if in is it its of on or ' +
    'that the their then there these this to was what when where which who why will with').split(' '),
);

/** One query word and the bundle words it stands for. */
interface QueryTerm {
  word: string;
  expansions: Array<{ term: string; weight: number }>;
}

interface QueryWord {
  word: string;
  /** The camelCase word it is a part of: "github" for the "git" of "GitHub". */
  whole: string | null;
}

function queryWords(query: string): QueryWord[] {
  const raw = rawWords(query);
  const content = raw.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const out: QueryWord[] = [];
  const seen = new Set<string>();
  for (const w of content.length ? content : raw) {
    const parts = camelParts(w);
    const whole = parts.length > 1 ? stem(w.toLowerCase()) : null;
    for (const p of parts) {
      const word = stem(p);
      if (seen.has(word)) continue;
      seen.add(word);
      out.push({ word, whole });
    }
  }
  return out;
}

/** The words a query is matched on, in order, without repeats. Empty when it has none. */
export function queryTerms(query: string): string[] {
  return queryWords(query).map((q) => q.word);
}

/**
 * The other forms of a word as the index would hold them: "cache" for "caching" and
 * "cached", "retry" for "retried", "pin" for "pinned", and the other way round.
 */
function inflections(word: string): string[] {
  const bases = new Set([word]);
  for (const suffix of ['ing', 'ed']) {
    if (word.length - suffix.length < 3 || !word.endsWith(suffix)) continue;
    const b = word.slice(0, -suffix.length);
    bases.add(b);
    bases.add(b + 'e');
    if (b.at(-1) === b.at(-2)) bases.add(b.slice(0, -1));
    if (b.endsWith('i')) bases.add(b.slice(0, -1) + 'y');
  }
  const out = new Set<string>();
  for (const b of bases) {
    const root = b.endsWith('e') ? b.slice(0, -1) : b;
    out.add(b);
    out.add(root + 'ing');
    out.add(root + 'ed');
    if (b.endsWith('y')) out.add(b.slice(0, -1) + 'ied');
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(b)) {
      out.add(b + b.at(-1) + 'ing');
      out.add(b + b.at(-1) + 'ed');
    }
  }
  const stems = new Set([...out].map(stem));
  stems.delete(word);
  return [...stems];
}

/** One letter added, dropped or changed. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = (x: string, y: string) => a.slice(i + x.length) === b.slice(i + y.length);
  return a.length === b.length ? rest('x', 'x') : a.length > b.length ? rest('x', '') : rest('', 'x');
}

/** How nearly a bundle word spells a query word: 2 for one edit, 1 for a long shared start, 0 for neither. */
function nearness(word: string, other: string): number {
  if (oneEditApart(word, other)) return 2;
  let shared = 0;
  while (shared < word.length && shared < other.length && word[shared] === other[shared]) shared++;
  return shared >= 5 && shared >= 0.6 * Math.max(word.length, other.length) ? 1 : 0;
}

/** Done once per query, not per concept. */
function expandQuery(idx: RankIndex, words: QueryWord[]): QueryTerm[] {
  const has = (t: string) => idx.postings.has(t);
  const byFreq = (a: string, b: string) => docFreq(idx, b) - docFreq(idx, a) || a.localeCompare(b);
  return words.map(({ word, whole }) => {
    const expansions: QueryTerm['expansions'] = [];
    if (has(word)) expansions.push({ term: word, weight: 1 });
    if (whole !== null && whole !== word && has(whole)) expansions.push({ term: whole, weight: 1 });
    for (const v of inflections(word)) if (has(v)) expansions.push({ term: v, weight: VARIANT_WEIGHT });
    if (expansions.length || word.length < 3) return { word, expansions };
    // Not in the bundle in any form: treat it as a prefix ("retr" finds "retry"), at a lower
    // weight, and keep the commonest few so a short prefix cannot fan out across the vocabulary.
    const found: string[] = [];
    for (const v of idx.postings.keys()) if (v.startsWith(word)) found.push(v);
    if (found.length) {
      found.sort(byFreq);
      return { word, expansions: found.slice(0, MAX_PREFIX_EXPANSIONS).map((term) => ({ term, weight: PREFIX_WEIGHT })) };
    }
    // Not the start of anything either: a misspelling ("jiter"), or a form the rules above do
    // not know ("concurrent" for "concurrency"). Short words are left alone; too many are one letter apart.
    if (word.length < 5) return { word, expansions };
    const near: Array<{ term: string; how: number }> = [];
    for (const v of idx.postings.keys()) {
      const how = v.length < 4 ? 0 : nearness(word, v);
      if (how) near.push({ term: v, how });
    }
    near.sort((a, b) => b.how - a.how || byFreq(a.term, b.term));
    return { word, expansions: near.slice(0, MAX_NEAR_EXPANSIONS).map(({ term }) => ({ term, weight: NEAR_WEIGHT })) };
  });
}

/**
 * BM25F for one query word: each concept's score for its best expansion, so a family of
 * related words cannot outvote the word asked for. The expansions share one rarity, that of
 * the word in any of its forms, so a rare form ("getting") cannot outrank the word itself ("get").
 */
function scoreWord(idx: RankIndex, expansions: QueryTerm['expansions']): Map<number, number> {
  const best = new Map<number, number>();
  for (const { term, weight } of expansions) {
    const list = idx.postings.get(term);
    if (!list) continue;
    for (let i = 0; i < list.length; ) {
      const doc = list[i++]!;
      const mask = list[i++]!;
      const len = idx.entries[doc]!.len;
      let tfw = 0;
      for (let f = 0; f < FIELDS.length; f++) {
        if (!(mask & (1 << f))) continue;
        const field = FIELDS[f]!;
        tfw += (WEIGHTS[f]! * list[i++]!) / (1 - B + (B * (len[field] ?? 0)) / idx.avgLen[field]);
      }
      const score = weight * (tfw / (K1 + tfw));
      if (score > (best.get(doc) ?? 0)) best.set(doc, score);
    }
  }
  const n = idx.entries.length;
  const df = best.size;
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  for (const [doc, score] of best) best.set(doc, score * idf);
  return best;
}

export function adjustments(e: Doc, idx: RankIndex, now: Date): Hit['adjust'] {
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
  const terms = expandQuery(idx, queryWords(query));
  const hits: Hit[] = [];
  if (terms.length === 0) {
    for (const e of idx.entries) {
      if (matchesFilters(e, f, now)) hits.push({ entry: e, score: 0, text: 0, adjust: adjustments(e, idx, now), matched: [] });
    }
  } else {
    const found = new Map<number, { text: number; matched: string[] }>();
    for (const { word, expansions } of terms) {
      for (const [doc, score] of scoreWord(idx, expansions)) {
        let hit = found.get(doc);
        if (!hit) found.set(doc, (hit = { text: 0, matched: [] }));
        hit.text += score;
        hit.matched.push(word);
      }
    }
    for (const [doc, { text, matched }] of found) {
      const e = idx.entries[doc]!;
      if (all && matched.length < terms.length) continue;
      if (!matchesFilters(e, f, now)) continue;
      const adjust = adjustments(e, idx, now);
      hits.push({ entry: e, score: text * adjust.reduce((p, a) => p * a.factor, 1), text, adjust, matched });
    }
  }
  // Ties (and the empty query) fall back to the title, so output is deterministic.
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title) || a.entry.id.localeCompare(b.entry.id));
  return hits;
}

const SNIPPET_CHARS = 160;

/**
 * The body line that matches the most query words, as a short plain-text line. A long line
 * is cut around its first match, so the words that earned it are the ones shown.
 */
export function snippet(body: string, query: string, title = ''): string {
  const want = queryTerms(query);
  if (want.length === 0) return '';
  const forms = want.map((w) => new Set([w, ...inflections(w)]));
  /** Which query word a word of the text answers, or -1. */
  const answers = (raw: string): number => {
    for (const t of tokenize(raw)) {
      const i = want.findIndex((w, k) => forms[k]!.has(t) || (w.length >= 3 && t.startsWith(w)));
      if (i !== -1) return i;
    }
    return -1;
  };
  let best = '';
  let bestScore = 0;
  // Inline code stays: "run through `btest`" with the name cut out says nothing.
  for (const raw of stripCode(proseOf(body), false).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[|\-:\s]+$/.test(line)) continue;
    if (title && line.replace(/^#+\s+/, '') === title) continue; // the title is already shown
    const have = new Set(rawWords(line).map(answers).filter((i) => i !== -1));
    if (have.size > bestScore) {
      bestScore = have.size;
      best = line;
    }
  }
  const plain = best.replace(/^#+\s+|^[-*>]\s+/, '').replace(/\[\^[^\]]*\]:?/g, '').replace(/\[([^\]]*)\]/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= SNIPPET_CHARS) return plain;
  let at = 0;
  for (const m of plain.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (answers(m[0]) !== -1) {
      at = m.index;
      break;
    }
  }
  // Start a few words before the match, on a word boundary.
  let from = Math.max(0, Math.min(at - 40, plain.length - (SNIPPET_CHARS - 6)));
  if (from > 0) from = plain.indexOf(' ', from) + 1;
  const cut = plain.slice(from, from + SNIPPET_CHARS - 6).replace(/\s+\S*$/, '');
  return (from > 0 ? '...' : '') + cut + (from + cut.length < plain.length ? '...' : '');
}
