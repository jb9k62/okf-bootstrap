#!/usr/bin/env node
/**
 * edukai, the project side: every part of keeping a memory bundle that needs no model.
 * Creates lesson files, pins what a lesson depends on, re-checks, and builds the syllabus and
 * the cache the harness hooks read (okf-edukai-hook.mts, which also derives the states).
 *
 * A memory bundle is an OKF v0.2 bundle of lessons: one claim each, with the files it rests
 * on (`sources`, pinned by a content digest) and, where the claim is text in a file, a
 * `check` that code can re-run. `verify`, `supersede` and `recheck` work on any OKF bundle,
 * so `--bundle okf` pins and re-checks design concepts too.
 *
 * Usage:
 *   node scripts/okf-edukai.mts <command> [arguments] [options]
 *
 *   new --domain <d> --title <t> --by <actor>
 *                      create a lesson file and print its path; a new domain also gets an
 *                      overview.md stub. Also: --confidence <c> (default inferred),
 *                      --source <path> (repeat), --description <text>, --tags a,b,
 *                      --body <text>, --slug <short-claim>
 *   verify <file> --by <actor>
 *                      run the checks (exit 1 if one fails), pin every file source, set this
 *                      actor's `verified` entry and `stale_after`. Also: --confidence <c>,
 *                      --days <n> (default 30)
 *   supersede <old> <new>
 *                      point the two at each other and set the old one `status: deprecated`
 *   index [--check]    rebuild the generated block in index.md, and the cache. With --check,
 *                      write nothing and exit 1 if index.md would change
 *   recheck [--write] [--strict]
 *                      report every concept's state. --write renews each `renewable` one
 *                      (never edits a claim); --strict exits 1 on broken, failed or suspect
 *
 * Options:
 *   --bundle <dir>     bundle directory (default: ./edukai)
 *   --root <dir>       the project root that `sources` and `check` paths are resolved against
 *                      (default: the bundle's parent folder)
 *   --now <iso>        the instant used for timestamps and staleness (default: now)
 *   --json             machine-readable output
 *
 * Confidence: tested (reproduced it), observed (saw or read it), inferred (deduced it).
 * Actors: <harness>/<model> for an agent, human:<id> for a person.
 *
 * Exit codes: 0 ran and nothing is wrong, 1 something is broken (named by file), 2 could not
 * run (no bundle, `yaml` not installed, bad arguments). `recheck` exits 1 only with --strict,
 * and never for `stale` or `unverified`: a build must not fail because time passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DAY } from './okf-rank.mts';
import {
  cachePaths,
  CACHE_SCHEMA,
  checkProblem,
  CONFIDENCES,
  deriveState,
  digestOf,
  errorText,
  firstFailingCheck,
  hashBytes,
  helpText,
  makeReader,
  normalizeRel,
  parseFlags,
  parseNow,
  QUEUE,
  readCache,
  realOrResolved,
  RECHECK_ACTOR,
  UsageError,
  writeFileAtomic,
} from './okf-edukai-hook.mts';
import type { CacheFile, Check, Derived, DomainRecord, LessonRecord, Reader, SourceRef, State } from './okf-edukai-hook.mts';

// `yaml` is the one dependency, and a missing one must read as "could not run" (2), not as a
// raw module error that exits 1 and looks like a broken bundle.
let core: typeof import('./okf-core.mts');
let YAML: typeof import('yaml');
try {
  core = await import('./okf-core.mts');
  YAML = await import('yaml');
} catch (e) {
  console.error('okf-edukai: could not load the `yaml` package (' + errorText(e).split('\n')[0] + ').\n  fix: npm install');
  process.exit(2);
}

type Frontmatter = Record<string, unknown>;

/** Something wrong with the bundle's content: exit 1, named by file. */
class BrokenError extends Error {}

interface Options {
  command: string;
  args: string[];
  bundle: string;
  bundleRoot: string;
  root: string;
  now: Date;
  json: boolean;
  flags: Map<string, string[]>;
}

interface Doc {
  rel: string; // bundle-relative, with .md
  id: string;
  full: string;
  text: string;
  fm: Frontmatter;
  body: string;
  type: string;
}

interface Skipped {
  file: string;
  reason: string;
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const toPosix = (p: string): string => p.split(path.sep).join('/');

// --- reading the bundle ---------------------------------------------------------

function loadBundle(bundleRoot: string): { docs: Doc[]; skipped: Skipped[]; stamps: CacheFile['files'] } {
  const docs: Doc[] = [];
  const skipped: Skipped[] = [];
  const stamps: CacheFile['files'] = {};
  for (const rel of core.listMarkdown(bundleRoot)) {
    if (core.RESERVED.has(rel)) continue;
    const full = path.join(bundleRoot, rel);
    let bytes: Buffer;
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
      bytes = fs.readFileSync(full);
    } catch (e) {
      skipped.push({ file: rel, reason: errorText(e) });
      continue;
    }
    stamps[rel] = { size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs, hash: hashBytes(bytes) };
    const text = bytes.toString('utf8');
    try {
      const { frontmatter, body } = core.parseDocument(text);
      if (frontmatter.type == null || String(frontmatter.type).trim() === '') {
        skipped.push({ file: rel, reason: 'no non-empty `type` in frontmatter' });
        continue;
      }
      docs.push({ rel, id: rel.replace(/\.md$/, ''), full, text, fm: frontmatter, body, type: String(frontmatter.type) });
    } catch (e) {
      skipped.push({ file: rel, reason: errorText(e) });
    }
  }
  return { docs, skipped, stamps };
}

const isUrl = (s: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(s);

/** The `sources` entries that name a file under the project root (not a URL, not a bundle path). */
function fileSources(fm: Frontmatter): Array<{ index: number; path: string; digest?: string }> {
  const list = Array.isArray(fm.sources) ? fm.sources : [];
  const out: Array<{ index: number; path: string; digest?: string }> = [];
  list.forEach((s: unknown, index: number) => {
    if (!isRecord(s) || typeof s.resource !== 'string') return;
    const resource = s.resource.trim();
    if (!resource || isUrl(resource) || resource.startsWith('/')) return;
    out.push({ index, path: normalizeRel(resource), ...(typeof s.digest === 'string' ? { digest: s.digest } : {}) });
  });
  return out;
}

const checksOf = (fm: Frontmatter): Check[] => (Array.isArray(fm.check) ? fm.check.filter(isRecord).map((c) => c as unknown as Check) : []);

function recordOf(d: Doc): LessonRecord {
  return {
    id: d.id,
    title: String(d.fm.title ?? d.id),
    confidence: String(d.fm.confidence ?? ''),
    status: String(d.fm.status ?? 'stable').toLowerCase(),
    stale_after: d.fm.stale_after == null ? '' : String(d.fm.stale_after),
    sources: fileSources(d.fm).map(({ path: p, digest }): SourceRef => ({ path: p, ...(digest ? { digest } : {}) })),
    checks: checksOf(d.fm),
  };
}

const domainOf = (id: string): string => (id.includes('/') ? id.split('/')[0]! : '');
const generatedAt = (fm: Frontmatter): number => (isRecord(fm.generated) ? new Date(String(fm.generated.at)).getTime() : NaN);

function domainsOf(docs: Doc[]): DomainRecord[] {
  const byId = new Map<string, DomainRecord>();
  const entry = (id: string): DomainRecord => {
    let d = byId.get(id);
    if (!d) byId.set(id, (d = { id, title: id, description: '', lessons: 0, overview: false }));
    return d;
  };
  for (const d of docs) {
    const domain = domainOf(d.id);
    if (!domain) continue;
    if (d.type === 'Lesson') entry(domain).lessons++;
    else if (d.type === 'Overview' && d.id === `${domain}/overview`) {
      const e = entry(domain);
      delete e.overview;
      e.title = String(d.fm.title ?? domain);
      e.description = String(d.fm.description ?? '');
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// --- the cache ----------------------------------------------------------------

/** The cache describes the memory bundle only; a design bundle named with --bundle has none. */
const isMemoryBundle = (bundleRoot: string): boolean => path.basename(bundleRoot) === 'edukai';

/** Re-read the bundle and rewrite the cache when it no longer says the same thing. */
function syncCache(o: Options, write = true): ReturnType<typeof loadBundle> {
  const loaded = loadBundle(o.bundleRoot);
  if (!write || !isMemoryBundle(o.bundleRoot)) return loaded;
  const paths = cachePaths(o.root, o.bundleRoot);
  if (!paths) return loaded;
  const next: CacheFile = {
    schema: CACHE_SCHEMA,
    written: Date.now(),
    files: loaded.stamps,
    domains: domainsOf(loaded.docs),
    lessons: loaded.docs.filter((d) => d.type === 'Lesson').map(recordOf),
  };
  const old = readCache(paths.file);
  const same = old !== null && JSON.stringify({ ...old, written: 0 }) === JSON.stringify({ ...next, written: 0 });
  if (!same) writeFileAtomic(paths.file, JSON.stringify(next));
  return loaded;
}

// --- rewriting frontmatter ----------------------------------------------------
// Edits are spliced into the frontmatter text at the offsets the `yaml` parser reports, so
// comments, key order, quoting and flow maps all survive, and a file whose values did not
// change is not written at all.

const FM_RE = /^(﻿?---[ \t]*\r?\n)([\s\S]*?\r?\n|)(---[ \t]*(?:\r?\n|$))/;
const KEY_ORDER = ['type', 'title', 'description', 'tags', 'confidence', 'status', 'generated', 'verified', 'stale_after', 'supersedes', 'superseded_by', 'sources', 'check'];

type YamlNode = { range?: [number, number, number] | null };

const scalar = (v: string): string => YAML.stringify(v, { lineWidth: 0 }).trimEnd();
const flowMap = (entries: Record<string, string>): string =>
  '{ ' + Object.entries(entries).map(([k, v]) => `${k}: ${scalar(v)}`).join(', ') + ' }';

/** The start of the line after `pos`, adding the newline a last line may lack. */
function nextLine(text: string, pos: number): { text: string; at: number } {
  const nl = text.indexOf('\n', Math.max(pos - 1, 0));
  if (nl === -1) return { text: text + '\n', at: text.length + 1 };
  return { text, at: nl + 1 };
}

const splice = (text: string, from: number, to: number, insert: string): string => text.slice(0, from) + insert + text.slice(to);
const columnOf = (text: string, pos: number): number => pos - (text.lastIndexOf('\n', pos - 1) + 1);

function topPairs(fm: string) {
  const doc = YAML.parseDocument(fm);
  if (doc.errors.length) throw new Error('Invalid YAML in frontmatter: ' + doc.errors[0]!.message);
  const map = doc.contents;
  if (!YAML.isMap(map)) throw new Error('Frontmatter must be a YAML mapping');
  return { doc, map };
}

const rangeOf = (node: unknown): [number, number, number] => {
  const r = (node as YamlNode | null)?.range;
  if (!r) throw new Error('the YAML parser gave no position for a node');
  return r;
};

/** Insert `block` (whole lines, no trailing newline) as a new top-level key, in the usual key order. */
function insertTop(fm: string, key: string, block: string): string {
  const { map } = topPairs(fm);
  const before = KEY_ORDER.slice(0, KEY_ORDER.indexOf(key)).reverse();
  for (const anchor of before) {
    const pair = map.items.find((p) => YAML.isScalar(p.key) && p.key.value === anchor);
    if (!pair) continue;
    const end = pair.value ? rangeOf(pair.value)[1] : rangeOf(pair.key)[1];
    const { text, at } = nextLine(fm, end);
    return splice(text, at, at, block + '\n');
  }
  const text = fm === '' || fm.endsWith('\n') ? fm : fm + '\n';
  return text + block + '\n';
}

/** Set a top-level key to a plain string value. */
function setTop(fm: string, key: string, value: string): string {
  const { doc, map } = topPairs(fm);
  if (doc.get(key) === value) return fm;
  const pair = map.items.find((p) => YAML.isScalar(p.key) && p.key.value === key);
  if (!pair) return insertTop(fm, key, `${key}: ${scalar(value)}`);
  if (pair.value && YAML.isScalar(pair.value) && pair.value.value != null) {
    const [from, to] = rangeOf(pair.value);
    return splice(fm, from, to, scalar(value));
  }
  // An empty value (`stale_after:`), or one that is not a scalar: rewrite from the key's end.
  const from = rangeOf(pair.key)[1];
  const to = pair.value && !(YAML.isScalar(pair.value) && pair.value.value == null) ? rangeOf(pair.value)[1] : fm.indexOf(':', from) + 1;
  return splice(fm, from, Math.max(to, from), `: ${scalar(value)}`);
}

/** Set `sources[index].digest`. */
function setDigest(fm: string, index: number, digest: string): string {
  const { doc } = topPairs(fm);
  const item = doc.getIn(['sources', index], true);
  if (!YAML.isMap(item)) throw new Error(`sources[${index}] is not a mapping`);
  if (item.get('digest') === digest) return fm;
  const existing = item.get('digest', true);
  if (YAML.isScalar(existing) && existing.value != null) {
    const [from, to] = rangeOf(existing);
    return splice(fm, from, to, scalar(digest));
  }
  if (YAML.isScalar(existing)) {
    // `digest:` with nothing after it.
    const pair = item.items.find((p) => YAML.isScalar(p.key) && p.key.value === 'digest')!;
    const from = rangeOf(pair.key)[1];
    return splice(fm, from, fm.indexOf(':', from) + 1, `: ${scalar(digest)}`);
  }
  if (item.flow) {
    // Add the key before the closing brace, leaving the other values exactly as written.
    const [from, to] = rangeOf(item);
    const close = fm.lastIndexOf('}', to - 1);
    if (close <= from) throw new Error(`sources[${index}] is a flow mapping this tool cannot extend`);
    const inner = fm.slice(from, close).replace(/[ \t]+$/, '');
    return splice(fm, from, close, `${inner}${item.items.length ? ',' : ''} digest: ${scalar(digest)} `);
  }
  const first = item.items[0]!;
  const last = item.items.at(-1)!;
  const indent = ' '.repeat(columnOf(fm, rangeOf(first.key)[0]));
  const end = last.value ? rangeOf(last.value)[1] : rangeOf(last.key)[1];
  const { text, at } = nextLine(fm, end);
  return splice(text, at, at, `${indent}digest: ${scalar(digest)}\n`);
}

/** Set this actor's `verified` entry: one per actor, so a new check replaces the old one. */
function setVerified(fm: string, by: string, at: string): string {
  const { doc, map } = topPairs(fm);
  const entry = flowMap({ by, at });
  const pair = map.items.find((p) => YAML.isScalar(p.key) && p.key.value === 'verified');
  const value = pair?.value;
  if (!pair || value == null || (YAML.isScalar(value) && value.value == null)) {
    if (pair) {
      const from = rangeOf(pair.key)[1];
      const to = value ? rangeOf(value)[1] : from;
      return splice(fm, from, to, `:\n  - ${entry}`);
    }
    return insertTop(fm, 'verified', `verified:\n  - ${entry}`);
  }
  const list = YAML.isSeq(value) ? value.items : [value];
  for (const item of list) {
    if (!YAML.isMap(item) || (item.toJSON() as Record<string, unknown>).by !== by) continue;
    if ((item.toJSON() as Record<string, unknown>).at === at) return fm;
    const old = item.get('at', true);
    const [from, to] = YAML.isScalar(old) ? rangeOf(old) : rangeOf(item);
    return splice(fm, from, to, YAML.isScalar(old) ? scalar(at) : entry);
  }
  if (YAML.isSeq(value) && !value.flow && value.items.length) {
    const lastItem = value.items.at(-1)!;
    const start = rangeOf(lastItem)[0];
    const lineStart = fm.lastIndexOf('\n', start - 1) + 1;
    const indent = ' '.repeat(Math.max(fm.indexOf('-', lineStart) - lineStart, 0));
    const { text, at: pos } = nextLine(fm, rangeOf(lastItem)[1]);
    return splice(text, pos, pos, `${indent}- ${entry}\n`);
  }
  // A single mapping, or a flow or empty list: rewrite the value as a block list.
  const kept = (doc.get('verified') as { toJSON(): unknown }).toJSON();
  const all = (Array.isArray(kept) ? kept : [kept]).filter(isRecord);
  const lines = [...all.map((e) => flowMap(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, String(v)])))), entry];
  const from = rangeOf(pair.key)[1];
  return splice(fm, from, rangeOf(value)[1], ':\n' + lines.map((l) => `  - ${l}`).join('\n'));
}

/** Apply edits to a document's frontmatter. Returns the new text, or the same text when nothing changed. */
function editFrontmatter(text: string, edit: (fm: string) => string, expect: (fm: Frontmatter) => string | null): string {
  const m = text.match(FM_RE);
  if (!m) throw new Error('no YAML frontmatter block');
  const before = m[2]!;
  const after = edit(before);
  if (after === before) return text;
  const out = m[1]! + after + m[3]! + text.slice(m[0]!.length);
  // Never write a file the edit did not leave as intended.
  const wrong = expect(core.parseDocument(out).frontmatter);
  if (wrong) throw new Error('could not rewrite the frontmatter safely: ' + wrong);
  return out;
}

function writeIfChanged(d: Doc, next: string): boolean {
  if (next === d.text) return false;
  fs.writeFileSync(d.full, next);
  d.text = next;
  const parsed = core.parseDocument(next);
  d.fm = parsed.frontmatter;
  d.body = parsed.body;
  return true;
}

// --- shared steps -------------------------------------------------------------

const rootLabel = (o: Options, d: Doc): string => toPosix(path.relative(process.cwd(), d.full)) || d.rel;

/** A concept named on the command line: a path from here, or from the bundle root. */
function resolveConcept(o: Options, docs: Doc[], arg: string): Doc {
  const candidates = [path.resolve(arg), path.resolve(arg + '.md'), path.join(o.bundleRoot, arg.replace(/^\/+/, '')), path.join(o.bundleRoot, arg.replace(/^\/+/, '') + '.md')];
  for (const c of candidates) {
    const real = realOrResolved(c);
    const hit = docs.find((d) => realOrResolved(d.full) === real);
    if (hit) return hit;
  }
  throw new UsageError(`no concept "${arg}" in ${o.bundle} (give a path from here or from the bundle root)`);
}

function actorOf(o: Options): string {
  const by = o.flags.get('by')?.at(-1);
  if (!by) throw new UsageError('--by <actor> is required: <harness>/<model> for an agent, human:<id> for a person');
  if (/[<>]/.test(by)) throw new UsageError(`--by "${by}" is a placeholder: put your own harness and model, such as claude-code/opus-5.5`);
  if (/[\s,{}[\]#"'`]/.test(by) || !/^[^/:]+[/:].+/.test(by)) {
    throw new UsageError(`--by "${by}" is not an actor: use <harness>/<model>, human:<id> or process:<name>`);
  }
  return by;
}

function confidenceOf(o: Options): string | null {
  const c = o.flags.get('confidence')?.at(-1) ?? null;
  if (c !== null && !CONFIDENCES.includes(c)) throw new UsageError(`--confidence: "${c}" is not ${CONFIDENCES.join(', ')}`);
  return c;
}

const latestVerified = (fm: Frontmatter): number =>
  Math.max(...core.normalizeVerified(fm).map((v) => new Date(String(v.at)).getTime()).filter((t) => !Number.isNaN(t)), -Infinity);

/**
 * Pin every file source and record a check by `by` at `now`. Throws BrokenError when a check
 * does not hold or a source cannot be pinned, and writes nothing then.
 */
function pinAndSign(o: Options, d: Doc, by: string, days: number, confidence: string | null): { pinned: number; stale_after: string; changed: boolean } {
  const reader = makeReader(o.root);
  for (const c of checksOf(d.fm)) {
    const problem = checkProblem(c);
    if (problem) throw new BrokenError(`${rootLabel(o, d)}: a check ${problem}`);
  }
  const failing = firstFailingCheck(checksOf(d.fm), reader);
  if (failing) throw new BrokenError(`${rootLabel(o, d)}: ${failing}`);
  const sources = fileSources(d.fm);
  const digests = new Map<number, string>();
  for (const s of sources) {
    const f = reader.read(s.path);
    if (f.status === 'outside') throw new BrokenError(`${rootLabel(o, d)}: source ${s.path} is outside the project root`);
    if (f.status !== 'ok') throw new BrokenError(`${rootLabel(o, d)}: source ${s.path} is ${f.status === 'missing' ? 'missing' : 'too large to pin'}`);
    digests.set(s.index, f.digest);
  }
  const at = iso(o.now);
  const newest = Math.max(latestVerified(d.fm), o.now.getTime());
  const stale_after = iso(new Date(newest + days * DAY));
  const next = rewrite(o, d, () => editFrontmatter(
    d.text,
    (fm) => {
      let out = fm;
      if (confidence !== null) out = setTop(out, 'confidence', confidence);
      for (const [index, digest] of digests) out = setDigest(out, index, digest);
      out = setVerified(out, by, at);
      return setTop(out, 'stale_after', stale_after);
    },
    (fm) => {
      if (confidence !== null && fm.confidence !== confidence) return 'confidence';
      if (fm.stale_after !== stale_after) return 'stale_after';
      if (!core.normalizeVerified(fm).some((v) => v.by === by && v.at === at)) return 'verified';
      const now = fileSources(fm);
      for (const [index, digest] of digests) if (now.find((s) => s.index === index)?.digest !== digest) return `sources[${index}].digest`;
      return null;
    },
  ));
  return { pinned: digests.size, stale_after, changed: writeIfChanged(d, next) };
}

/** A frontmatter shape the splicing cannot handle is a problem with that file (1), not a crash (2). */
function rewrite(o: Options, d: Doc, edit: () => string): string {
  try {
    return edit();
  } catch (e) {
    throw new BrokenError(`${rootLabel(o, d)}: ${errorText(e)}. Nothing was written; tidy that key by hand and run it again`);
  }
}

function print(o: Options, data: unknown, text: () => string): void {
  console.log(o.json ? JSON.stringify(data, null, 2) : text());
}

// --- new ----------------------------------------------------------------------

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cmdNew(o: Options): number {
  const one = (n: string) => o.flags.get(n)?.at(-1) ?? null;
  const domain = one('domain');
  const title = one('title')?.trim();
  if (!domain || !title) throw new UsageError('new needs --domain <d> and --title <t>');
  if (!/^(codebase|tooling|user)-[a-z0-9]+(-[a-z0-9]+)*$/.test(domain)) {
    throw new UsageError(`--domain "${domain}": use lowercase-hyphen with a prefix, codebase-…, tooling-… or user-…`);
  }
  const by = actorOf(o);
  const confidence = confidenceOf(o) ?? 'inferred';
  for (const name of ['title', 'description']) {
    if (/[\r\n]/.test(one(name) ?? '')) throw new UsageError(`--${name} must be one line`);
  }
  const slug = kebab(one('slug') ?? title).slice(0, 60).replace(/-+$/, '');
  if (!slug) throw new UsageError('the title has no letters or digits to name the file with; pass --slug');
  const at = iso(o.now);
  const rel = `${domain}/lessons/${at.slice(0, 10)}-${slug}.md`;
  const full = path.join(o.bundleRoot, rel);
  if (fs.existsSync(full)) throw new BrokenError(`${toPosix(path.relative(process.cwd(), full))} already exists; pick another --slug, or supersede it`);

  // A project file given as an absolute path is named from the project root, like any other.
  const sources = (o.flags.get('source') ?? []).map((s) => s.trim()).filter(Boolean).map((s) => {
    if (!path.isAbsolute(s)) return s;
    const back = path.relative(o.root, realOrResolved(s));
    return back && !back.startsWith('..') && !path.isAbsolute(back) ? toPosix(back) : s;
  });
  for (const s of sources) {
    if (/[\r\n]/.test(s)) throw new UsageError('--source must be one line');
    if (isUrl(s) || s.startsWith('/')) continue;
    if (makeReader(o.root).read(normalizeRel(s)).status === 'outside') throw new BrokenError(`source ${s} is outside the project root`);
  }
  const tags = (o.flags.get('tags') ?? []).flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean);
  const badTag = tags.find((t) => !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(t));
  if (badTag !== undefined) throw new UsageError(`--tags: "${badTag}" is not a tag (letters, digits, dot, dash, underscore)`);
  const description = one('description')?.trim() || title;
  const body = one('body')?.trim() || `${description.replace(/\.$/, '')}.`;
  const lines = [
    '---',
    'type: Lesson',
    `title: ${scalar(title)}`,
    `description: ${scalar(description)}`,
    ...(tags.length ? [`tags: [${tags.map(scalar).join(', ')}]`] : []),
    `confidence: ${confidence}`,
    `generated: ${flowMap({ by, at })}`,
    ...(sources.length ? ['sources:', ...sources.map((s) => `  - resource: ${scalar(isUrl(s) || s.startsWith('/') ? s : normalizeRel(s))}`)] : ['sources: []']),
    '---',
    '',
    body,
    '',
  ];
  const written = [rel];
  const overview = path.join(o.bundleRoot, domain, 'overview.md');
  const newDomain = !fs.existsSync(overview);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (newDomain) {
    fs.writeFileSync(
      overview,
      [
        '---',
        'type: Overview',
        `title: ${scalar(domain)}`,
        `description: ${scalar(`What agents have learned about ${domain}.`)}`,
        `generated: ${flowMap({ by, at })}`,
        '---',
        '',
        'Rewrite this stub once the domain has a few lessons: two to five paragraphs that teach it',
        'to someone who will not open the lessons.',
        '',
        '## Current understanding',
        '',
        `- [${title}](/${rel})`,
        '',
        '## Open questions',
        '',
        '- None recorded yet.',
        '',
      ].join('\n'),
    );
    written.push(`${domain}/overview.md`);
  }
  // Never leave a lesson the validator cannot read.
  const written_fm = core.parseDocument(lines.join('\n')).frontmatter;
  if (written_fm.title !== title || (isRecord(written_fm.generated) ? written_fm.generated.by : null) !== by) {
    throw new UsageError('the title or --by does not survive as YAML; simplify it');
  }
  fs.writeFileSync(full, lines.join('\n'), { flag: 'wx' });
  syncCache(o);
  const shown = toPosix(path.relative(process.cwd(), full));
  print(o, { file: shown, id: rel.replace(/\.md$/, ''), written, confidence, new_domain: newDomain }, () => {
    const out = [shown];
    const note = (s: string) => console.error(s);
    if (newDomain) note(`new domain ${domain}: wrote its overview.md stub; run npm run edukai:index to list it in the syllabus`);
    if (sources.length === 0) note('add at least one entry to `sources` (and a `check` when the claim is text in a file)');
    if (confidence !== 'inferred') note(`then: okf-edukai verify ${shown} --by ${by} --confidence ${confidence}`);
    return out.join('\n');
  });
  return 0;
}

// --- verify -------------------------------------------------------------------

function cmdVerify(o: Options): number {
  if (o.args.length !== 1) throw new UsageError('verify takes one concept file');
  const by = actorOf(o);
  const daysRaw = o.flags.get('days')?.at(-1) ?? '30';
  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days <= 0) throw new UsageError('--days must be a positive number');
  const { docs } = syncCache(o);
  const d = resolveConcept(o, docs, o.args[0]!);
  if (String(d.fm.status ?? '').toLowerCase() === 'deprecated') {
    throw new BrokenError(`${rootLabel(o, d)} is superseded; verify the lesson that replaced it`);
  }
  // A check by someone is what `inferred` lacks, so a verified lesson cannot stay inferred.
  let confidence = confidenceOf(o);
  if (confidence === 'inferred') throw new UsageError('an inferred lesson has no `verified` entry; verify with --confidence tested or observed');
  if (confidence === null && d.type === 'Lesson' && !['tested', 'observed'].includes(String(d.fm.confidence))) confidence = 'observed';
  const r = pinAndSign(o, d, by, days, confidence);
  syncCache(o);
  print(o, { file: rootLabel(o, d), by, ...r }, () =>
    `verified ${rootLabel(o, d)}: ${r.pinned} source${r.pinned === 1 ? '' : 's'} pinned, stale_after ${r.stale_after}${r.changed ? '' : ' (nothing changed)'}`,
  );
  return 0;
}

// --- supersede ----------------------------------------------------------------

function cmdSupersede(o: Options): number {
  if (o.args.length !== 2) throw new UsageError('supersede takes the old concept, then the new one');
  const { docs } = syncCache(o);
  const old = resolveConcept(o, docs, o.args[0]!);
  const fresh = resolveConcept(o, docs, o.args[1]!);
  if (old === fresh) throw new BrokenError(`${rootLabel(o, old)} cannot supersede itself`);
  const oldPath = `/${old.rel}`;
  const newPath = `/${fresh.rel}`;
  if (old.fm.superseded_by != null && old.fm.superseded_by !== newPath) {
    throw new BrokenError(`${rootLabel(o, old)} is already superseded by ${String(old.fm.superseded_by)}`);
  }
  if (fresh.fm.supersedes != null && fresh.fm.supersedes !== oldPath) {
    throw new BrokenError(`${rootLabel(o, fresh)} already supersedes ${String(fresh.fm.supersedes)}; one lesson replaces one lesson`);
  }
  // Following the new lesson's own replacements must never lead back to the old one.
  const byRel = new Map(docs.map((d) => [`/${d.rel}`, d]));
  const seen = new Set<string>();
  for (let at: Doc | undefined = fresh; at; at = byRel.get(String(at.fm.superseded_by ?? ''))) {
    if (at === old || seen.has(at.rel)) throw new BrokenError(`${rootLabel(o, fresh)} is itself replaced by ${rootLabel(o, old)}: that would be a cycle`);
    seen.add(at.rel);
  }
  const nextOld = rewrite(o, old, () => editFrontmatter(
    old.text,
    (fm) => setTop(setTop(fm, 'status', 'deprecated'), 'superseded_by', newPath),
    (fm) => (fm.status === 'deprecated' && fm.superseded_by === newPath ? null : 'status and superseded_by'),
  ));
  const nextNew = rewrite(o, fresh, () => editFrontmatter(
    fresh.text,
    (fm) => setTop(fm, 'supersedes', oldPath),
    (fm) => (fm.supersedes === oldPath ? null : 'supersedes'),
  ));
  const changed = [writeIfChanged(old, nextOld), writeIfChanged(fresh, nextNew)];
  syncCache(o);
  print(o, { old: rootLabel(o, old), new: rootLabel(o, fresh), changed: changed.some(Boolean) }, () =>
    `${rootLabel(o, old)} is now deprecated, superseded by ${rootLabel(o, fresh)}${changed.some(Boolean) ? '' : ' (nothing changed)'}`,
  );
  return 0;
}

// --- index --------------------------------------------------------------------

const INDEX_OPEN = '<!-- edukai:index -->';
const INDEX_CLOSE = '<!-- /edukai:index -->';

function indexBlock(domains: DomainRecord[]): string {
  const lines = domains.map((d) => `* [${d.title.replace(/[[\]]/g, '')}](/${d.id}/overview.md)${d.description ? ` - ${d.description.replace(/\s+/g, ' ').trim()}` : ''}`);
  return [INDEX_OPEN, ...(lines.length ? lines : ['*No domains yet. The first lesson creates one.*']), INDEX_CLOSE].join('\n');
}

function cmdIndex(o: Options): number {
  const check = o.flags.has('check');
  const { docs } = syncCache(o, !check);
  const file = path.join(o.bundleRoot, 'index.md');
  const shown = toPosix(path.relative(process.cwd(), file));
  if (!fs.existsSync(file)) throw new BrokenError(`${shown} is missing; a memory bundle keeps its syllabus there`);
  const text = fs.readFileSync(file, 'utf8');
  const block = indexBlock(domainsOf(docs).filter((d) => d.overview !== false));
  const from = text.indexOf(INDEX_OPEN);
  const to = text.indexOf(INDEX_CLOSE, from + 1);
  const next =
    from !== -1 && to !== -1
      ? text.slice(0, from) + block + text.slice(to + INDEX_CLOSE.length)
      : text.replace(/\n*$/, '\n') + '\n' + block + '\n';
  const changed = next !== text;
  if (check) {
    print(o, { file: shown, current: !changed }, () => (changed ? `${shown} is out of date. Run npm run edukai:index.` : `${shown} is current`));
    return changed ? 1 : 0;
  }
  if (changed) fs.writeFileSync(file, next);
  print(o, { file: shown, changed }, () => `${shown}: ${changed ? 'rebuilt the syllabus' : 'already current'}`);
  return 0;
}

// --- recheck ------------------------------------------------------------------

interface Row {
  file: string;
  id: string;
  type: string;
  state: State | 'current' | 'outdated';
  detail: string;
  renewed?: string;
}

function overviewRow(d: Doc, docs: Doc[]): Row {
  const domain = domainOf(d.id);
  const own = generatedAt(d.fm);
  const newer = docs
    .filter((x) => x.type === 'Lesson' && domainOf(x.id) === domain && generatedAt(x.fm) > own)
    .sort((a, b) => generatedAt(b.fm) - generatedAt(a.fm))[0];
  return {
    file: d.rel,
    id: d.id,
    type: d.type,
    state: newer ? 'outdated' : 'current',
    detail: newer ? `${newer.rel} is newer than this overview` : '',
  };
}

function derive(docs: Doc[], reader: Reader, now: Date): Row[] {
  return docs.map((d): Row => {
    if (d.type === 'Overview') return overviewRow(d, docs);
    const derived: Derived = deriveState(recordOf(d), reader, now);
    return { file: d.rel, id: d.id, type: d.type, ...derived };
  });
}

const tally = (rows: Row[], order: string[]): string =>
  order
    .map((s) => [s, rows.filter((r) => r.state === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join(', ');

function cmdRecheck(o: Options): number {
  const write = o.flags.has('write');
  const strict = o.flags.has('strict');
  let { docs, skipped } = syncCache(o);
  let rows = derive(docs, makeReader(o.root), o.now);
  const renewed = new Map<string, string>();
  const notRenewed = new Map<string, string>();
  if (write) {
    for (const row of rows.filter((r) => r.state === 'renewable')) {
      const d = docs.find((x) => x.rel === row.file)!;
      try {
        renewed.set(row.file, pinAndSign(o, d, RECHECK_ACTOR, 30, null).stale_after);
      } catch (e) {
        // One lesson that cannot be renewed (an unpinned source that is gone) must not stop the rest.
        if (!(e instanceof BrokenError)) throw e;
        notRenewed.set(row.file, e.message.replace(/^.*?\.md: /, ''));
      }
    }
    if (renewed.size) {
      ({ docs, skipped } = syncCache(o));
      rows = derive(docs, makeReader(o.root), o.now);
    }
  }
  for (const r of rows) {
    if (renewed.has(r.file)) r.renewed = renewed.get(r.file)!;
    // It needs an agent after all: its checks hold, but it cannot be pinned again.
    if (notRenewed.has(r.file)) Object.assign(r, { state: 'broken', detail: notRenewed.get(r.file)! });
  }

  const lessons = rows.filter((r) => r.type === 'Lesson');
  const overviews = rows.filter((r) => r.type === 'Overview');
  const others = rows.filter((r) => r.type !== 'Lesson' && r.type !== 'Overview');
  const queue = rows.filter((r) => (QUEUE as string[]).includes(r.state) || r.state === 'outdated').sort((a, b) => a.file.localeCompare(b.file));
  const failing = rows.filter((r) => r.state === 'broken' || r.state === 'failed' || r.state === 'suspect').length;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;

  print(o, { bundle: o.bundle, now: iso(o.now), counts, needs_an_agent: queue.length, renewed: [...renewed.keys()], concepts: rows, skipped }, () => {
    const quiet = ['fresh', 'renewable', 'unverified', 'superseded'];
    const line = (label: string, list: Row[], order: string[]) => {
      const breakdown = tally(list, order);
      return `  ${label.padEnd(12)}: ${list.length}${breakdown ? `   (${breakdown})` : ''}`;
    };
    const out = [`edukai recheck: ${o.bundle}  (now ${iso(o.now)})`];
    if (lessons.length || others.length === 0) out.push(line('lessons', lessons, quiet));
    if (overviews.length || others.length === 0) out.push(line('overviews', overviews, ['current', 'outdated']));
    if (others.length) out.push(line('concepts', others, quiet));
    for (const [file, until] of renewed) out.push(`  ✓ ${file}  [renewed] stale_after ${until}`);
    out.push(`  needs an agent: ${queue.length}`);
    for (const r of queue) out.push(`  ✗ ${r.file}  [${r.state}] ${r.detail}`);
    for (const s of skipped) out.push(`  ✗ ${s.file}  [unreadable] ${s.reason}`);
    return out.join('\n');
  });
  return strict && (failing > 0 || skipped.length > 0) ? 1 : 0;
}

// --- arguments ----------------------------------------------------------------

const VALUE_FLAGS = new Set(['bundle', 'root', 'now', 'domain', 'title', 'by', 'confidence', 'days', 'source', 'description', 'tags', 'body', 'slug']);
const BOOL_FLAGS = new Set(['json', 'check', 'write', 'strict', 'help']);
const COMMANDS = ['new', 'verify', 'supersede', 'index', 'recheck'];

function parseArgs(argv: string[]): Options {
  const { flags, rest } = parseFlags(argv, VALUE_FLAGS, BOOL_FLAGS);
  if (flags.has('help') || rest.length === 0) {
    console.log(helpText(import.meta.url));
    process.exit(flags.has('help') ? 0 : 2);
  }
  const command = rest[0]!;
  if (!COMMANDS.includes(command)) {
    const hint = ['brief', 'cites', 'debt', 'hook'].includes(command) ? ' (that one is in okf-edukai-hook.mts)' : '';
    throw new UsageError(`unknown command "${command}"${hint}: use ${COMMANDS.join(', ')}`);
  }
  const one = (n: string) => flags.get(n)?.at(-1) ?? null;
  const bundle = one('bundle') ?? 'edukai';
  const resolved = path.resolve(bundle);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new UsageError(`bundle directory not found: ${bundle} (pass --bundle <dir>, or scaffold one with bootstrap.mts --edukai)`);
  }
  const bundleRoot = realOrResolved(resolved);
  const rootArg = one('root');
  if (rootArg !== null && (!fs.existsSync(rootArg) || !fs.statSync(rootArg).isDirectory())) {
    throw new UsageError(`--root is not a directory: ${rootArg}`);
  }
  return {
    command,
    args: rest.slice(1),
    bundle,
    bundleRoot,
    root: rootArg === null ? path.dirname(bundleRoot) : realOrResolved(path.resolve(rootArg)),
    now: parseNow(one('now')),
    json: flags.has('json'),
    flags,
  };
}

function main(): number {
  const o = parseArgs(process.argv.slice(2));
  switch (o.command) {
    case 'new': return cmdNew(o);
    case 'verify': return cmdVerify(o);
    case 'supersede': return cmdSupersede(o);
    case 'index': return cmdIndex(o);
    default: return cmdRecheck(o);
  }
}

try {
  process.exitCode = main();
} catch (e) {
  if (e instanceof BrokenError) {
    console.error('okf-edukai: ' + e.message);
    process.exitCode = 1;
  } else {
    console.error('okf-edukai: ' + (e instanceof UsageError ? e.message : e instanceof Error && e.stack ? e.stack : e));
    process.exitCode = 2;
  }
}
