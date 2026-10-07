#!/usr/bin/env node
/**
 * edukai, the hook side: what a harness adapter runs at the three moments it speaks to an
 * agent, and the code that derives a lesson's state.
 *
 * This file runs from an installed plugin or package, where `node_modules` may not exist, and
 * its output is put in front of an agent. So it follows a hard rule that a test enforces: it
 * imports only `node:` built-ins and ./okf-rank.mts. It never parses YAML, never imports
 * okf-core.mts, and never runs code from the project. It reads the JSON cache that
 * okf-edukai.mts writes, and the files that cache names.
 *
 * Usage:
 *   node okf-edukai-hook.mts <command> [arguments] [options]
 *
 *   brief              what an agent is told when a session opens (at most 2,000 characters)
 *   cites <path>       the lessons that cite a file (at most 3; none shown twice in a session)
 *   debt               lessons this session's edits left broken, failed or suspect
 *   hook               the Claude Code adapter: hook JSON on stdin, reply JSON on stdout
 *
 * Options:
 *   --bundle <dir>     the memory bundle (default: ./edukai)
 *   --root <dir>       the project root that `sources` and `check` paths are resolved against
 *                      (default: the bundle's parent folder)
 *   --session <id>     the harness session, so nothing is repeated within it
 *   --edited           (cites) the file was edited, not only read
 *   --now <iso>        the instant staleness is judged at (default: now)
 *   --json             machine-readable output
 *
 * Environment: EDUKAI_DEBUG=1 lets `hook` report its errors; EDUKAI_NUDGE=0 turns the finish
 * nudge off.
 *
 * Exit codes: 0 ok (saying nothing is still ok), 2 could not run (bad arguments, no bundle).
 * `hook` always exits 0 and stays silent on any error, unless EDUKAI_DEBUG=1.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshness } from './okf-rank.mts';
import type { EntryMeta } from './okf-rank.mts';

// --- what the cache holds -----------------------------------------------------

export const CACHE_SCHEMA = 1;
// A file modified this close to the cache being written may have changed again within the
// same timestamp tick, so its bytes are compared instead of its timestamps.
const RACY_MS = 2000;
const MAX_CHECK_BYTES = 1_000_000;
export const MAX_REGEX_LENGTH = 200;
const BRIEF_CHARS = 2000;
const BRIEF_MAX_HASHED = 2000;
const CITES_SHOWN = 3;
const DEBT_SHOWN = 5;
const SESSION_MAX_AGE_MS = 7 * 86_400_000;

export const RECHECK_ACTOR = 'process:edukai-recheck';
export const CONFIDENCES = ['tested', 'observed', 'inferred'];
export const CHECK_KINDS = ['contains', 'lacks', 'matches', 'exists'] as const;

export interface Check {
  file: string;
  contains?: string;
  lacks?: string;
  matches?: string;
  exists?: boolean;
}

export interface SourceRef {
  /** From the project root, with forward slashes. */
  path: string;
  digest?: string;
}

export interface LessonRecord {
  id: string;
  title: string;
  confidence: string;
  status: string; // lower-case
  stale_after: string;
  sources: SourceRef[];
  checks: Check[];
}

export interface DomainRecord {
  id: string;
  title: string;
  description: string;
  lessons: number;
  /** False when the domain has lessons but no overview.md yet. */
  overview?: boolean;
}

export interface FileStamp {
  size: number;
  mtime: number;
  ctime: number;
  hash: string;
}

export interface CacheFile {
  schema: number;
  written: number; // ms since the epoch
  files: Record<string, FileStamp>;
  domains: DomainRecord[];
  lessons: LessonRecord[];
}

export type State =
  | 'superseded'
  | 'broken'
  | 'failed'
  | 'suspect'
  | 'stale'
  | 'renewable'
  | 'unverified'
  | 'fresh';

/** The states an agent has to act on. */
export const QUEUE: State[] = ['broken', 'failed', 'suspect', 'stale'];

export interface Derived {
  state: State;
  /** Why, for the queue states: "check "X" does not hold in src/a.ts". Empty otherwise. */
  detail: string;
}

export class UsageError extends Error {}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- paths --------------------------------------------------------------------

/** The real path when there is one, so /tmp and /private/tmp name the same project. */
export function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

/** A `sources` or `check` path as written, in the one spelling the cache compares. */
export function normalizeRel(p: string): string {
  return path.posix.normalize(p.trim().replace(/\\/g, '/')).replace(/^\.\//, '');
}

/**
 * The absolute path of a project file named from the root, or null when the name leaves the
 * root: an absolute path, a `..` that climbs out, or a link that points outside.
 */
export function resolveInRoot(root: string, rel: string): string | null {
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) return null;
  const full = path.resolve(root, rel);
  const back = path.relative(root, full);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) return null;
  try {
    const real = fs.realpathSync(full);
    const realBack = path.relative(realOrResolved(root), real);
    if (realBack.startsWith('..') || path.isAbsolute(realBack)) return null;
  } catch {
    // Missing: there is nothing to follow, and the caller reports it as missing.
  }
  return full;
}

/** A path the harness gave (absolute, or relative to `cwd`) as a path from the project root. */
export function relToRoot(root: string, file: string, cwd: string): string | null {
  const abs = path.resolve(cwd, file);
  // Resolve links in the part of the path that exists: a file being created has no real path yet.
  let head = abs;
  let tail = '';
  for (;;) {
    try {
      head = fs.realpathSync(head);
      break;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) break;
      tail = tail ? path.join(path.basename(head), tail) : path.basename(head);
      head = parent;
    }
  }
  const back = path.relative(realOrResolved(root), tail ? path.join(head, tail) : head);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) return null;
  return toPosix(back);
}

// --- reading project files ----------------------------------------------------

/** `sha256:` and the first 16 hex characters of the file's SHA-256, with CRLF read as LF. */
export function digestOf(bytes: Buffer): string {
  const lf = Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return 'sha256:' + crypto.createHash('sha256').update(lf).digest('hex').slice(0, 16);
}

export interface ProjectFile {
  /** `outside` is a name that leaves the project root. */
  status: 'ok' | 'missing' | 'outside' | 'too-big';
  bytes: Buffer | null;
  digest: string;
}

export interface Reader {
  read(rel: string): ProjectFile;
  /** How many distinct files were read from disk. */
  count(): number;
}

/** Reads each project file at most once per run. */
export function makeReader(root: string): Reader {
  const seen = new Map<string, ProjectFile>();
  return {
    count: () => seen.size,
    read(rel: string): ProjectFile {
      const hit = seen.get(rel);
      if (hit) return hit;
      let out: ProjectFile;
      const full = resolveInRoot(root, rel);
      if (full === null) {
        out = { status: 'outside', bytes: null, digest: '' };
      } else {
        try {
          const st = fs.statSync(full);
          if (!st.isFile()) out = { status: 'missing', bytes: null, digest: '' };
          else if (st.size > 64 * MAX_CHECK_BYTES) out = { status: 'too-big', bytes: null, digest: '' };
          else {
            const bytes = fs.readFileSync(full);
            out = { status: 'ok', bytes, digest: digestOf(bytes) };
          }
        } catch {
          out = { status: 'missing', bytes: null, digest: '' };
        }
      }
      seen.set(rel, out);
      return out;
    },
  };
}

// --- checks and states --------------------------------------------------------

/** How a check reads in a report: `"RETRIES = 5"`, `lacks "x"`, `/re/`, `exists: false`. */
export function checkLabel(c: Check): string {
  if (typeof c.contains === 'string') return JSON.stringify(c.contains);
  if (typeof c.lacks === 'string') return 'lacks ' + JSON.stringify(c.lacks);
  if (typeof c.matches === 'string') return '/' + c.matches + '/';
  if (typeof c.exists === 'boolean') return 'exists: ' + c.exists;
  return '(no test)';
}

/** Why a `check` entry is not one this tool can run, or null when it is well formed. */
export function checkProblem(c: unknown): string | null {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'is not a mapping';
  const entry = c as Record<string, unknown>;
  if (typeof entry.file !== 'string' || entry.file.trim() === '') return 'has no `file`';
  // eslint-disable-next-line no-control-regex -- a path with a line break could pose as a hook line
  if (/[\u0000-\u001f]/.test(entry.file)) return 'has a `file` with a control character in it';
  const tests = CHECK_KINDS.filter((k) => entry[k] !== undefined);
  if (tests.length !== 1) {
    return `needs exactly one of ${CHECK_KINDS.join(', ')} (it has ${tests.length === 0 ? 'none' : tests.join(' and ')})`;
  }
  const kind = tests[0]!;
  if (kind === 'exists') {
    if (typeof entry.exists !== 'boolean') return '`exists` must be true or false';
    return null;
  }
  const value = entry[kind];
  if (typeof value !== 'string' || value === '') return `\`${kind}\` must be a non-empty string`;
  if (kind === 'matches') {
    if (value.length > MAX_REGEX_LENGTH) return `\`matches\` is over ${MAX_REGEX_LENGTH} characters`;
    try {
      new RegExp(value);
    } catch (e) {
      return '`matches` is not a regular expression: ' + errorText(e);
    }
  }
  return null;
}

type CheckResult = 'holds' | 'fails' | 'missing';

function runCheck(c: Check, reader: Reader): CheckResult {
  if (checkProblem(c) !== null) return 'fails';
  const f = reader.read(normalizeRel(c.file));
  if (f.status === 'outside') return 'fails';
  if (typeof c.exists === 'boolean') {
    const there = f.status !== 'missing';
    if (c.exists) return there ? 'holds' : 'missing';
    return there ? 'fails' : 'holds';
  }
  if (f.status === 'missing') return 'missing';
  if (f.status === 'too-big' || !f.bytes || f.bytes.length > MAX_CHECK_BYTES) return 'fails';
  const text = f.bytes.toString('utf8');
  if (typeof c.contains === 'string') return text.includes(c.contains) ? 'holds' : 'fails';
  if (typeof c.lacks === 'string') return text.includes(c.lacks) ? 'fails' : 'holds';
  return new RegExp(c.matches!).test(text) ? 'holds' : 'fails';
}

/** The first check that does not hold, as a sentence, or null when all hold. */
export function firstFailingCheck(checks: Check[], reader: Reader): string | null {
  for (const c of checks) {
    const r = runCheck(c, reader);
    if (r === 'missing') return `${normalizeRel(c.file)} is missing`;
    if (r === 'fails') return failText(c, reader);
  }
  return null;
}

function failText(c: Check, reader: Reader): string {
  const problem = checkProblem(c);
  if (problem !== null) return `a check ${problem}`;
  const file = normalizeRel(c.file);
  const f = reader.read(file);
  if (f.status === 'outside') return `check file ${file} is outside the project root`;
  if (typeof c.exists === 'boolean') return `${file} exists, and the check says it should not`;
  if (f.status === 'too-big' || (f.bytes && f.bytes.length > MAX_CHECK_BYTES)) {
    return `${file} is over 1 MB, too large to check`;
  }
  return `check ${checkLabel(c)} does not hold in ${file}`;
}

export const isStaleAt = (stale_after: string, now: Date): boolean =>
  freshness({ stale_after } as EntryMeta, now).state === 'stale';

/** Section 6 of the spec: derived on every run, never stored. First match wins. */
export function deriveState(l: LessonRecord, reader: Reader, now: Date): Derived {
  if (l.status === 'deprecated') return { state: 'superseded', detail: '' };

  // broken: a pinned source, or a file a check names, is missing.
  for (const s of l.sources) {
    if (!s.digest) continue;
    const f = reader.read(s.path);
    if (f.status === 'missing') return { state: 'broken', detail: `${s.path} is missing` };
    if (f.status === 'outside') return { state: 'broken', detail: `${s.path} is outside the project root` };
  }
  const results = l.checks.map((c) => runCheck(c, reader));
  const gone = results.indexOf('missing');
  if (gone !== -1) return { state: 'broken', detail: `${normalizeRel(l.checks[gone]!.file)} is missing` };

  const bad = results.indexOf('fails');
  if (bad !== -1) return { state: 'failed', detail: failText(l.checks[bad]!, reader) };

  const moved = l.sources.find((s) => s.digest && reader.read(s.path).digest !== s.digest);
  const expired = isStaleAt(l.stale_after, now);
  if (l.checks.length === 0) {
    if (moved) return { state: 'suspect', detail: `${moved.path} changed since it was pinned` };
    if (expired) return { state: 'stale', detail: `since ${l.stale_after.slice(0, 10)}` };
  } else if (moved || expired) {
    return { state: 'renewable', detail: '' };
  }
  if (l.confidence === 'inferred') return { state: 'unverified', detail: '' };
  return { state: 'fresh', detail: '' };
}

// --- the cache ----------------------------------------------------------------

export interface CachePaths {
  file: string;
  sessions: string;
}

/**
 * Where the cache and the session files live, or null when no private place exists (then
 * there is no cache). The same rule as okf-search: under the project's node_modules when it
 * has one, otherwise a per-user folder in the temp dir that must be ours and private, because
 * the hooks put this file's text in front of an agent and another user must not plant one.
 */
export function cachePaths(root: string, bundleRoot: string): CachePaths | null {
  const key = crypto.createHash('sha1').update(realOrResolved(bundleRoot)).digest('hex').slice(0, 12);
  const nm = path.join(root, 'node_modules');
  let dir: string;
  let isDir = false;
  try {
    isDir = fs.statSync(nm).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir) {
    dir = path.join(nm, '.cache', 'edukai');
  } else {
    const uid = process.getuid?.();
    dir = path.join(os.tmpdir(), `edukai-${uid ?? 'user'}`);
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) return null;
    } catch {
      return null;
    }
  }
  return { file: path.join(dir, `${key}.json`), sessions: path.join(dir, 'sessions', key) };
}

/** To a temporary name with `wx`, then rename: no half file, and never through a planted link. */
export function writeFileAtomic(file: string, text: string): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false; // The cache is an optimisation. A read-only checkout still works.
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The cache, with every field checked: an unknown schema or a damaged file is no cache. */
export function readCache(file: string): CacheFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.schema !== CACHE_SCHEMA || typeof raw.written !== 'number') return null;
  if (!isRecord(raw.files) || !Array.isArray(raw.domains) || !Array.isArray(raw.lessons)) return null;
  const files: Record<string, FileStamp> = {};
  for (const [rel, v] of Object.entries(raw.files)) {
    if (!isRecord(v)) return null;
    files[rel] = { size: Number(v.size), mtime: Number(v.mtime), ctime: Number(v.ctime), hash: str(v.hash) };
  }
  const domains: DomainRecord[] = raw.domains.filter(isRecord).map((d) => ({
    id: str(d.id),
    title: str(d.title),
    description: str(d.description),
    lessons: Number(d.lessons) || 0,
    ...(d.overview === false ? { overview: false } : {}),
  }));
  const lessons: LessonRecord[] = raw.lessons.filter(isRecord).map((l) => ({
    id: str(l.id),
    title: str(l.title),
    confidence: str(l.confidence),
    status: str(l.status),
    stale_after: str(l.stale_after),
    sources: (Array.isArray(l.sources) ? l.sources : [])
      .filter(isRecord)
      .filter((s) => typeof s.path === 'string')
      .map((s) => ({ path: str(s.path), ...(typeof s.digest === 'string' ? { digest: s.digest } : {}) })),
    checks: (Array.isArray(l.checks) ? l.checks : []).filter(isRecord).map((c) => c as unknown as Check),
  }));
  return { schema: CACHE_SCHEMA, written: raw.written, files, domains, lessons };
}

export const hashBytes = (bytes: Buffer): string => crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);

/** Every concept file in the bundle (the root's own index.md and log.md are reserved). */
export function listConceptFiles(bundleRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile() && entry.name.endsWith('.md') && rel !== 'index.md' && rel !== 'log.md') out.push(rel);
    }
  };
  walk(bundleRoot, '');
  return out.sort();
}

/**
 * Does the cache still describe the folder? This file cannot parse YAML, so it cannot heal
 * the cache; it can only say so. A file is trusted on the same size, mtime and ctime, and one
 * modified close to the cache being written is compared by its bytes instead.
 */
export function cacheIsCurrent(cache: CacheFile, bundleRoot: string): boolean {
  const files = listConceptFiles(bundleRoot);
  if (files.length !== Object.keys(cache.files).length) return false;
  for (const rel of files) {
    const rec = cache.files[rel];
    if (!rec) return false;
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(bundleRoot, rel));
    } catch {
      return false;
    }
    if (rec.size !== st.size) return false;
    const sameStamp = rec.mtime === st.mtimeMs && rec.ctime === st.ctimeMs;
    if (sameStamp && rec.mtime < cache.written - RACY_MS) continue;
    try {
      if (hashBytes(fs.readFileSync(path.join(bundleRoot, rel))) !== rec.hash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// --- the session file -----------------------------------------------------------

interface Session {
  shown: string[];
  edited: string[];
  nudged: string[];
  /** Lessons already wrong when this session first read their file: not this session's debt. */
  prior: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function sessionFile(paths: CachePaths | null, id: string | null): string | null {
  if (!paths || !id) return null;
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return safe ? path.join(paths.sessions, `${safe}.json`) : null;
}

function loadSession(file: string | null): Session {
  if (file) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isRecord(raw)) return { shown: strings(raw.shown), edited: strings(raw.edited), nudged: strings(raw.nudged), prior: strings(raw.prior) };
    } catch {
      // No session yet, or a damaged one: start clean.
    }
  }
  return { shown: [], edited: [], nudged: [], prior: [] };
}

const LOCK_TRIES = 200;
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 5000;

/**
 * Read, change and write the session file as one step. A harness runs hooks in parallel when
 * the agent makes parallel tool calls, and an edit lost here is a nudge that never fires. The
 * lock is a folder (mkdir is atomic); one left behind by a killed hook is taken over.
 */
function withSession<T>(file: string | null, change: (s: Session) => { save: boolean; result: T }): T {
  if (!file) return change(loadSession(null)).result;
  const lock = file + '.lock';
  let held = false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let i = 0; i < LOCK_TRIES && !held; i++) {
      try {
        fs.mkdirSync(lock);
        held = true;
      } catch {
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
        } catch {
          // Released between the two calls: try again.
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
      }
    }
  } catch {
    // No place to lock: carry on unlocked rather than say nothing.
  }
  try {
    const session = loadSession(file);
    const { save, result } = change(session);
    if (save) saveSession(file, session);
    return result;
  } finally {
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
}

function saveSession(file: string | null, s: Session): void {
  if (file) writeFileAtomic(file, JSON.stringify(s));
}

function pruneSessions(paths: CachePaths | null): void {
  if (!paths) return;
  // Session folders sit beside the cache, one per bundle; all are swept.
  const top = path.dirname(paths.sessions);
  let dirs: string[];
  try {
    dirs = fs.readdirSync(top);
  } catch {
    return;
  }
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  for (const d of dirs) {
    const dir = path.join(top, d);
    try {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (name.endsWith('.json') && fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
      }
    } catch {
      // Not a folder, or not ours to read.
    }
  }
}

// --- text for the agent -----------------------------------------------------------

interface Context {
  bundleRoot: string;
  root: string;
  /** The bundle as the agent should read it: from the project root, with a trailing slash. */
  bundleLabel: string;
  now: Date;
  session: string | null;
  cwd: string;
  paths: CachePaths | null;
  cache: CacheFile | null;
}

/** One line, bounded, so text from a lesson file cannot pose as a second hook line. */
function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** Any text that came from the bundle or a path, before it goes into a line for the agent. */
const safe = (s: string): string => oneLine(s, 300);

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

export function makeContext(bundle: string, rootArg: string | null, now: Date, session: string | null, cwd: string): Context {
  const bundleRoot = realOrResolved(path.resolve(cwd, bundle));
  const root = rootArg === null ? path.dirname(bundleRoot) : realOrResolved(path.resolve(cwd, rootArg));
  const paths = cachePaths(root, bundleRoot);
  const label = toPosix(path.relative(root, bundleRoot)) || '.';
  return {
    bundleRoot,
    root,
    bundleLabel: label + '/',
    now,
    session,
    cwd,
    paths,
    cache: paths ? readCache(paths.file) : null,
  };
}

export interface Reply {
  text: string;
  data: unknown;
}

const citesFile = (l: LessonRecord, rel: string): boolean =>
  l.sources.some((s) => s.path === rel) || l.checks.some((c) => typeof c.file === 'string' && normalizeRel(c.file) === rel);

export function brief(ctx: Context): Reply {
  const where = ctx.bundleLabel;
  const file = sessionFile(ctx.paths, ctx.session);
  pruneSessions(ctx.paths);
  // A new or compacted context has lost what `cites` said earlier, so it may be said again.
  withSession(file, (s) => {
    const had = s.shown.length > 0;
    s.shown = [];
    return { save: had, result: null };
  });
  if (!ctx.cache) {
    const text = `edukai: this project keeps agent memory in ${where}, but it has no index yet. Run npm run edukai:index.`;
    return { text, data: { indexed: false } };
  }
  const { lessons, domains } = ctx.cache;
  const reader = makeReader(ctx.root);
  const counts: Partial<Record<State, number>> = {};
  let stopped = false;
  for (const l of lessons) {
    if (reader.count() >= BRIEF_MAX_HASHED) {
      stopped = true;
      break;
    }
    const { state } = deriveState(l, reader, ctx.now);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  const current = cacheIsCurrent(ctx.cache, ctx.bundleRoot);

  const head = `edukai: this project keeps agent memory in ${where} (${plural(lessons.length, 'lesson')}, ${plural(domains.length, 'domain')}).`;
  const tail: string[] = [];
  const queued = (['failed', 'broken', 'suspect', 'stale'] as State[]).filter((s) => counts[s]);
  if (queued.length) {
    tail.push(`Needs an agent: ${queued.map((s) => `${counts[s]} ${s}`).join(', ')}. Run npm run edukai:recheck for the list.`);
  }
  if (stopped) tail.push(`Stopped after reading ${BRIEF_MAX_HASHED.toLocaleString('en-GB')} source files; npm run edukai:recheck checks them all.`);
  if (!current) tail.push('edukai: the index is out of date. Run npm run edukai:index.');
  tail.push(
    'Find a lesson: npm run edukai:search -- search "<words>". Read a domain\'s overview before',
    'working in it. Use the edukai skill to record what you learn.',
  );
  const budget = BRIEF_CHARS - head.length - tail.join('\n').length - 80;
  const lines: string[] = [];
  let used = 0;
  for (const [i, d] of domains.entries()) {
    const description = oneLine(d.description, 140).replace(/\.$/, '');
    const id = oneLine(d.id, 80);
    const pointer = d.overview === false ? `${where}${id}/lessons/ (no overview yet)` : `${where}${id}/overview.md`;
    const line = `- ${id} (${d.lessons})${description ? `: ${description}.` : ':'} ${pointer}`;
    if (used + line.length + 1 > budget) {
      lines.push(`- and ${plural(domains.length - i, 'more domain')}: ${where}index.md`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const text = [head, ...lines, ...tail].join('\n');
  return { text, data: { indexed: true, current, lessons: lessons.length, domains, counts, stopped } };
}

const WRONG: State[] = ['broken', 'failed', 'suspect'];

export function cites(ctx: Context, target: string, edited: boolean): Reply {
  const rel = relToRoot(ctx.root, target, ctx.cwd);
  if (rel === null) return { text: '', data: { path: rel, total: 0, lessons: [] } };
  const hits = (ctx.cache?.lessons ?? []).filter((l) => l.status !== 'deprecated' && citesFile(l, rel));
  const reader = makeReader(ctx.root);
  const states = new Map(hits.slice(0, 50).map((l) => [l.id, deriveState(l, reader, ctx.now)]));
  const shown = withSession(sessionFile(ctx.paths, ctx.session), (session) => {
    let save = false;
    // A lesson that is already wrong when its file is first read is not this session's doing.
    if (!edited && !session.edited.includes(rel)) {
      for (const l of hits) {
        if (WRONG.includes(states.get(l.id)?.state as State) && !session.prior.includes(l.id)) {
          session.prior.push(l.id);
          save = true;
        }
      }
    }
    if (edited && !session.edited.includes(rel)) {
      session.edited.push(rel);
      save = true;
    }
    const unseen = hits.filter((l) => !session.shown.includes(l.id));
    const list = unseen.slice(0, CITES_SHOWN);
    if (list.length) {
      session.shown.push(...list.map((l) => l.id));
      save = true;
    }
    return { save, result: { list, rest: unseen.length - list.length } };
  });
  if (shown.list.length === 0) return { text: '', data: { path: rel, total: hits.length, lessons: [] } };
  const out = [`edukai: ${hits.length} lesson${hits.length === 1 ? ' cites' : 's cite'} ${safe(rel)}`];
  for (const l of shown.list) {
    // A lesson in the queue is a lead to check, not a fact: say so where the agent meets it.
    const d = states.get(l.id);
    const queued = d && QUEUE.includes(d.state);
    const label = [queued ? d.state : '', oneLine(l.confidence, 12) || 'lesson'].filter(Boolean).join(' · ');
    out.push(`- [${label}] ${oneLine(l.title, 160)} (${ctx.bundleLabel}${safe(l.id)}.md)${queued ? `: ${safe(d.detail)}` : ''}`);
  }
  if (shown.rest > 0) out.push(`- and ${shown.rest} more: npm run edukai:search -- search "${safe(path.posix.basename(rel))}"`);
  return {
    text: out.join('\n'),
    data: {
      path: rel,
      total: hits.length,
      lessons: shown.list.map((l) => ({ id: l.id, title: l.title, confidence: l.confidence, state: states.get(l.id)?.state })),
    },
  };
}

export function debt(ctx: Context): Reply {
  const none: Reply = { text: '', data: { total: 0, lessons: [] } };
  const cache = ctx.cache;
  if (!cache) return none;
  const reader = makeReader(ctx.root);
  const found = withSession(sessionFile(ctx.paths, ctx.session), (session) => {
    const wrong: Array<{ lesson: LessonRecord; derived: Derived }> = [];
    if (session.edited.length === 0) return { save: false, result: wrong };
    for (const l of cache.lessons) {
      if (l.status === 'deprecated' || session.nudged.includes(l.id) || session.prior.includes(l.id)) continue;
      if (!session.edited.some((rel) => citesFile(l, rel))) continue;
      const derived = deriveState(l, reader, ctx.now);
      if (WRONG.includes(derived.state)) wrong.push({ lesson: l, derived });
    }
    session.nudged.push(...wrong.slice(0, DEBT_SHOWN).map((w) => w.lesson.id));
    return { save: wrong.length > 0, result: wrong };
  });
  if (found.length === 0) return none;
  const named = found.slice(0, DEBT_SHOWN);
  const n = found.length;
  const out = [
    n === 1
      ? 'edukai: your changes left 1 lesson wrong. Fix it before you finish: supersede it, or verify it.'
      : `edukai: your changes left ${n} lessons wrong. Fix them before you finish: supersede or verify each.`,
  ];
  for (const { lesson, derived } of named) {
    const why = safe(derived.detail).replace(' does not hold in ', ' no longer holds in ');
    out.push(`- [${derived.state}] ${oneLine(lesson.title, 160)}: ${why} (${ctx.bundleLabel}${safe(lesson.id)}.md)`);
  }
  if (n > named.length) out.push(`- and ${n - named.length} more: npm run edukai:recheck`);
  out.push('The edukai skill says how (its "Recheck" section).');
  return {
    text: out.join('\n'),
    data: { total: n, lessons: named.map(({ lesson, derived }) => ({ id: lesson.id, title: lesson.title, ...derived })) },
  };
}

/**
 * The memory bundle for a session started in `start`: the nearest folder at or above it that
 * holds edukai/index.md, so a session opened in a subfolder still finds its project's memory.
 */
export function findBundle(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const bundle = path.join(dir, 'edukai');
    if (fs.existsSync(path.join(bundle, 'index.md'))) return bundle;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// --- the Claude Code adapter --------------------------------------------------

/**
 * Reads one hook payload and returns the reply JSON, or '' to say nothing. Holds no logic of
 * its own: it picks one of the three commands above.
 */
export function claudeHook(input: Record<string, unknown>, env: NodeJS.ProcessEnv, now: Date): string {
  const event = str(input.hook_event_name);
  const cwd = str(input.cwd) || process.cwd();
  const project = env.CLAUDE_PROJECT_DIR || cwd;
  // The plugin loads in every project; one without a memory bundle hears nothing.
  const bundle = findBundle(cwd) ?? findBundle(project);
  if (bundle === null) return '';
  const ctx = makeContext(bundle, null, now, str(input.session_id) || null, cwd);
  const context = (text: string): string =>
    text ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) : '';

  if (event === 'SessionStart') return context(brief(ctx).text);
  if (event === 'PostToolUse') {
    const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
    const file = str(toolInput.file_path) || str(toolInput.notebook_path);
    if (!file) return '';
    return context(cites(ctx, file, str(input.tool_name) !== 'Read').text);
  }
  if (event === 'Stop') {
    // `stop_hook_active` is true on the stop that follows a block: never block twice in a row.
    if (input.stop_hook_active === true || input.agent_id || env.EDUKAI_NUDGE === '0') return '';
    const text = debt(ctx).text;
    return text ? JSON.stringify({ decision: 'block', reason: text }) : '';
  }
  return '';
}

// --- CLI ------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['bundle', 'root', 'session', 'now']);
const BOOL_FLAGS = new Set(['edited', 'json', 'help']);
const COMMANDS = ['brief', 'cites', 'debt', 'hook'];

export interface ParsedArgs {
  flags: Map<string, string[]>;
  rest: string[];
}

/** The okf-search argument shape: `--flag value`, `--flag=value`, and an error for anything unknown. */
export function parseFlags(argv: string[], valueFlags: Set<string>, boolFlags: Set<string>): ParsedArgs {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (boolFlags.has(name)) {
      flags.set(name, ['true']);
    } else if (valueFlags.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new UsageError(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), v]);
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  return { flags, rest };
}

export function parseNow(raw: string | null): Date {
  const now = raw === null ? new Date() : new Date(raw);
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now is not a date: ${raw}`);
  return now;
}

/** The comment at the top of a tool, as its --help. */
export function helpText(url: string): string {
  return fs.readFileSync(new URL(url), 'utf8').split('*/')[0]!.replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '');
}

export function runHook(): number {
  try {
    const input: unknown = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    if (!isRecord(input)) return 0;
    const reply = claudeHook(input, process.env, new Date());
    if (reply) console.log(reply);
  } catch (e) {
    // A hook that fails must not get in the agent's way; a broken install looks like silence.
    if (process.env.EDUKAI_DEBUG === '1') console.error('okf-edukai-hook: ' + (e instanceof Error && e.stack ? e.stack : e));
  }
  return 0;
}

function main(): number {
  const { flags, rest } = parseFlags(process.argv.slice(2), VALUE_FLAGS, BOOL_FLAGS);
  const one = (n: string) => flags.get(n)?.at(-1) ?? null;
  if (flags.has('help') || rest.length === 0) {
    console.log(helpText(import.meta.url));
    return flags.has('help') ? 0 : 2;
  }
  const command = rest[0]!;
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command "${command}" (${COMMANDS.join(', ')})`);
  if (command === 'hook') return runHook();

  const bundle = one('bundle') ?? 'edukai';
  const bundleRoot = path.resolve(bundle);
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    throw new UsageError(`bundle directory not found: ${bundle} (pass --bundle <dir>)`);
  }
  const ctx = makeContext(bundle, one('root'), parseNow(one('now')), one('session'), process.cwd());
  let reply: Reply;
  if (command === 'brief') {
    reply = brief(ctx);
  } else if (command === 'cites') {
    if (rest.length !== 2) throw new UsageError('cites takes one file path');
    reply = cites(ctx, rest[1]!, flags.has('edited'));
  } else {
    reply = debt(ctx);
  }
  if (flags.has('json')) console.log(JSON.stringify({ ...(reply.data as object), text: reply.text }, null, 2));
  else if (reply.text) console.log(reply.text);
  return 0;
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    process.exitCode = main();
  } catch (e) {
    // `hook` must stay silent even when its own arguments are wrong.
    if (process.argv[2] === 'hook') {
      if (process.env.EDUKAI_DEBUG === '1') console.error('okf-edukai-hook: ' + errorText(e));
      process.exitCode = 0;
    } else {
      console.error('okf-edukai-hook: ' + (e instanceof UsageError ? e.message : e instanceof Error && e.stack ? e.stack : e));
      process.exitCode = 2;
    }
  }
}
