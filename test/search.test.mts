/**
 * okf-search end to end: ranking, spec signals, filters, the cache and the exit codes, on
 * throwaway bundles under .cache/. Each run's cwd has an empty node_modules so the tool's
 * cache lands in the scratch directory, not in the repo.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEARCH = path.join(ROOT, 'skills', 'okf-bootstrap', 'assets', 'okf-search.mts');
const CACHE = path.join(ROOT, '.cache', 'test');
fs.mkdirSync(CACHE, { recursive: true });
const scratch = fs.mkdtempSync(path.join(CACHE, 'search-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const NOW = '2026-10-05T00:00:00Z';

function bundle(name: string, files: Record<string, string>): string {
  const dir = path.join(scratch, name);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'okf', rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'okf', rel), text);
  }
  return dir;
}

function search(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [SEARCH, ...args, '--bundle', 'okf', '--now', NOW], {
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const json = (cwd: string, args: string[]) => JSON.parse(search(cwd, [...args, '--json']).out);
const ids = (r: { results: Array<{ id: string }> }) => r.results.map((x) => x.id);

const doc = (fm: string, body: string) => `---\ntype: Reference\n${fm}\n---\n\n${body}\n`;

const FILES: Record<string, string> = {
  'index.md': '# Index\n',
  'log.md': '# Log\n',
  'retry.md': doc(
    'title: Retry policy\ntags: [retries, reliability]\nstale_after: 2026-12-01T00:00:00Z\nverified: { by: "human:sam", at: 2026-10-01T00:00:00Z }',
    '# Retry policy\n\n## Why jitter\n\nFull jitter spreads clients out.\n\n## Settings\n\nFive retries.\n\nSee [the cache](/cache.md).',
  ),
  'old-retry.md': doc(
    'title: Retry policy (old)\ntags: [retries]\nstale_after: 2026-01-01T00:00:00Z',
    '# Retry policy\n\nFull jitter spreads clients out.',
  ),
  'cache.md': doc('title: Cache\ntags: [caching]\nstatus: deprecated', '# Cache\n\nEvicts the least recently used entry. Links [retry](/retry.md).'),
  'notes/draft.md': doc('title: Draft notes\ntags: [retries]\nstatus: draft', '# Notes\n\nRetry thoughts.'),
};

describe('okf-search ranking and the spec', () => {
  const cwd = bundle('rank', FILES);

  it('ranks the human-reviewed, fresh concept above a stale twin, and flags the stale one', () => {
    const r = json(cwd, ['search', 'retry jitter']);
    assert.deepEqual(ids(r).slice(0, 2), ['retry', 'old-retry']);
    const old = r.results[1];
    assert.equal(old.freshness, 'stale');
    assert.equal(old.trust, 'unverified');
    assert.equal(r.results[0].trust, 'human-reviewed');
  });

  it('demotes stale and deprecated concepts but still returns them', () => {
    const r = json(cwd, ['search', 'cache', '--explain']);
    const hit = r.results.find((x: { id: string }) => x.id === 'cache');
    assert.ok(hit, 'a deprecated concept is still returned');
    const why = hit.explain.adjust.map((a: { why: string }) => a.why);
    assert.ok(why.includes('deprecated'), why.join());
  });

  it('judges staleness at --now, with stale_after inclusive (SPEC §5.5)', () => {
    const at = (now: string) =>
      JSON.parse(
        spawnSync(process.execPath, [SEARCH, 'search', 'retry', '--fresh', '--json', '--bundle', 'okf', '--now', now], {
          cwd,
          encoding: 'utf8',
        }).stdout,
      );
    assert.ok(ids(at('2026-11-30T23:59:59Z')).includes('retry'));
    assert.ok(!ids(at('2026-12-01T00:00:00Z')).includes('retry'), 'now == stale_after is stale');
  });

  it('filters by tag, trust, status, freshness and links', () => {
    assert.deepEqual(ids(json(cwd, ['search', '--tag', 'caching'])), ['cache']);
    assert.deepEqual(ids(json(cwd, ['search', 'retry', '--trust', 'human'])), ['retry']);
    assert.deepEqual(ids(json(cwd, ['search', '--status', 'draft'])), ['notes/draft']);
    assert.deepEqual(ids(json(cwd, ['search', '--stale'])), ['old-retry']);
    assert.deepEqual(ids(json(cwd, ['search', '--links-to', 'retry'])), ['cache']);
    assert.deepEqual(ids(json(cwd, ['search', '--linked-from', 'retry'])), ['cache']);
    assert.deepEqual(ids(json(cwd, ['search', '--expires-within', '90d'])), ['retry']);
  });

  it('matches plurals and prefixes, and --all requires every term', () => {
    assert.ok(ids(json(cwd, ['search', 'retries'])).includes('retry'));
    assert.ok(ids(json(cwd, ['search', 'retr'])).includes('retry'));
    assert.deepEqual(ids(json(cwd, ['search', 'jitter zebra', '--all'])), []);
  });

  it('ranks the concept a prefix names above words that merely share it', () => {
    const files: Record<string, string> = {
      'a.md': doc('title: Architecture', '# Architecture\n\nRetains retrieves retained retrofit retort.'),
      'retry.md': doc('title: Retry policy\ntags: [retries]', '# Retry\n\nBackoff.'),
    };
    assert.equal(ids(json(bundle('prefix', files), ['search', 'ret']))[0], 'retry');
  });

  it('treats status case-insensitively and rejects nonsense queries and flags', () => {
    const c = bundle('status', { ...FILES, 'up.md': doc('title: Up\nstatus: Deprecated', '# Up') });
    assert.deepEqual(ids(json(c, ['search', '--status', 'deprecated'])).sort(), ['cache', 'up']);
    assert.equal(search(c, ['search', '--status', 'foo']).code, 2);
    assert.equal(search(c, ['search', '!!!']).code, 2);
    assert.equal(search(c, ['stale', '--fresh']).code, 2);
  });

  it('is deterministic and an empty result exits 0', () => {
    const a = search(cwd, ['search', 'retry']).out;
    assert.equal(a, search(cwd, ['search', 'retry']).out);
    const none = search(cwd, ['search', 'zzzzqqq']);
    assert.equal(none.code, 0);
    assert.match(none.out, /No concepts match/);
  });
});

describe('okf-search show, related, facets, stale', () => {
  const cwd = bundle('read', FILES);

  it('shows one section, or just the outline', () => {
    const s = search(cwd, ['show', '/retry.md', '--section', 'why jitter']);
    assert.equal(s.code, 0, s.err);
    assert.match(s.out, /Full jitter spreads clients out/);
    assert.doesNotMatch(s.out, /Five retries/, 'the next section is not included');
    const o = json(cwd, ['show', 'retry', '--outline']);
    assert.deepEqual(o.headings.map((h: { text: string }) => h.text), ['Retry policy', 'Why jitter', 'Settings']);
    assert.equal(o.content, undefined);
  });

  it('exits 2 and suggests ids for an unknown concept or heading', () => {
    const r = search(cwd, ['show', 'nope/retry']);
    assert.equal(r.code, 2);
    assert.match(r.err, /did you mean: .*\bretry\b/);
    const h = search(cwd, ['show', 'retry', '--section', 'absent']);
    assert.equal(h.code, 2);
    assert.match(h.err, /headings: Retry policy/);
  });

  it('relates by links, backlinks and shared tags', () => {
    const r = json(cwd, ['related', 'retry']);
    assert.deepEqual(r.links_to.map((x: { id: string }) => x.id), ['cache']);
    assert.deepEqual(r.linked_from.map((x: { id: string }) => x.id), ['cache']);
    assert.deepEqual(r.shared_tags.map((x: { id: string }) => x.id), ['notes/draft', 'old-retry']);
  });

  it('counts facets and lists the review queue, most overdue first', () => {
    const f = json(cwd, ['facets']);
    assert.equal(f.concepts, 4);
    assert.equal(f.stale, 1);
    assert.deepEqual(f.tags[0], { name: 'retries', count: 3, stale: 1 });
    assert.deepEqual(ids(json(cwd, ['stale'])), ['old-retry']);
    assert.deepEqual(ids(json(cwd, ['stale', '--expires-within', '90d'])), ['old-retry', 'retry']);
  });
});

describe('okf-search cache, bad files and exit codes', () => {
  it('rebuilds from a corrupt cache, and picks up an edit', () => {
    const cwd = bundle('cache', FILES);
    json(cwd, ['search', 'retry']);
    const dir = path.join(cwd, 'node_modules', '.cache', 'okf-search');
    const [file] = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(file, 'a cache was written');
    fs.writeFileSync(path.join(dir, file!), '{ not json');
    assert.ok(ids(json(cwd, ['search', 'retry'])).includes('retry'));

    // A same-size edit still changes mtime; make the new text longer so size differs too.
    fs.appendFileSync(path.join(cwd, 'okf', 'cache.md'), '\nSpecial zebra term.\n');
    assert.deepEqual(ids(json(cwd, ['search', 'zebra'])), ['cache']);
    fs.rmSync(path.join(cwd, 'okf', 'cache.md'));
    assert.deepEqual(ids(json(cwd, ['search', 'zebra'])), [], 'a deleted file leaves the results');
  });

  it('does not trust a same-size edit that keeps its mtime, nor cache a read error', () => {
    const cwd = bundle('racy', FILES);
    const file = path.join(cwd, 'okf', 'retry.md');
    assert.deepEqual(ids(json(cwd, ['search', '--stale'])), ['old-retry']);
    // Push the cache's files well into the past so only ctime can give the edit away.
    const past = new Date(Date.now() - 3_600_000);
    for (const f of ['retry.md', 'old-retry.md']) fs.utimesSync(path.join(cwd, 'okf', f), past, past);
    json(cwd, ['search', 'retry']);
    const old = path.join(cwd, 'okf', 'old-retry.md');
    fs.writeFileSync(old, fs.readFileSync(old, 'utf8').replace('2026-01-01', '2027-01-01'));
    fs.utimesSync(old, past, past); // same size, same mtime
    assert.deepEqual(ids(json(cwd, ['search', '--stale'])), []);

    if (process.getuid?.() !== 0) {
      fs.chmodSync(file, 0o000);
      const r = search(cwd, ['search', 'retry']);
      assert.match(r.err, /skipped retry\.md/);
      fs.chmodSync(file, 0o644);
      assert.ok(ids(json(cwd, ['search', 'retry'])).includes('retry'), 'a read error heals once fixed');
    }
  });

  it('works with --no-cache and writes nothing', () => {
    const cwd = bundle('nocache', FILES);
    assert.ok(ids(json(cwd, ['search', 'retry', '--no-cache'])).includes('retry'));
    assert.ok(!fs.existsSync(path.join(cwd, 'node_modules', '.cache')));
  });

  it('names files it cannot index, and --strict turns that into exit 1', () => {
    const cwd = bundle('bad', { ...FILES, 'broken.md': '---\ntitle: no type\n---\n', 'yaml.md': '---\na: [\n---\n' });
    const ok = search(cwd, ['search', 'retry']);
    assert.equal(ok.code, 0);
    assert.match(ok.err, /skipped broken\.md: no non-empty `type`/);
    assert.match(ok.err, /skipped yaml\.md: Invalid YAML/);
    assert.equal(search(cwd, ['search', 'retry', '--strict']).code, 1);
  });

  it('exits 2 for a missing bundle, bad arguments, and a search with nothing to go on', () => {
    const cwd = bundle('args', FILES);
    const run = (args: string[]) => spawnSync(process.execPath, [SEARCH, ...args], { cwd, encoding: 'utf8' });
    assert.equal(run(['search', 'x', '--bundle', 'missing']).status, 2);
    assert.equal(run(['search', 'x', '--bundle', 'okf', '--bogus']).status, 2);
    assert.equal(run(['search', 'x', '--bundle', 'okf', '--fresh', '--stale']).status, 2);
    assert.equal(run(['search', 'x', '--bundle', 'okf', '--trust', 'maybe']).status, 2);
    assert.equal(run(['search', '--bundle', 'okf']).status, 2);
    assert.equal(run([]).status, 2);
  });

  it('answers a 600-concept bundle quickly, cold and warm', () => {
    const files: Record<string, string> = {};
    const filler = 'lorem ipsum dolor sit amet consectetur '.repeat(150);
    for (let i = 0; i < 600; i++) {
      files[`d${i % 10}/c${i}.md`] = doc(`title: Concept ${i}\ntags: [t${i % 25}]`, `# Concept ${i}\n\n${filler}\nUnique${i} marker.`);
    }
    const cwd = bundle('scale', files);
    const t0 = Date.now();
    assert.deepEqual(ids(json(cwd, ['search', 'unique417'])), ['d7/c417']);
    const cold = Date.now() - t0;
    const t1 = Date.now();
    json(cwd, ['search', 'unique417']);
    const warm = Date.now() - t1;
    // Generous bounds: this guards against an accidental O(n²), not against a slow machine.
    assert.ok(cold < 10_000, `cold ${cold}ms`);
    assert.ok(warm < 5_000, `warm ${warm}ms`);
  });
});
