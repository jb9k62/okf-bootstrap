/**
 * okf-search end to end: ranking, spec signals, filters, the cache and the exit codes, on
 * throwaway bundles under .cache/. Each run's cwd has an empty node_modules so the tool's
 * cache lands in the scratch directory, not in the repo.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

describe('okf-search: the words a query finds', () => {
  const WORDS: Record<string, string> = {
    'index.md': '# Index\n',
    'boxes.md': doc('title: Parcel boxes', '# Boxes\n\nEach box holds one parcel. Indexes are rebuilt nightly; a rule matches on the prefix.'),
    'cache.md': doc('title: Response cache', '# Cache\n\nResponses are cached for a minute. The poller retried twice, then pinned the carrier.'),
    'code.md': doc('title: Client code', '# Client\n\nThe client lives on GitHub. parseHTTPResponse reads the body; weekStartUtc finds the Monday.'),
    'cafe.md': doc('title: Café orders', '# Orders\n\nA naïve façade over the ordering service.'),
    'jitter.md': doc('title: Jitter', '# Jitter\n\nFull jitter spreads clients out. Concurrency is capped at four.'),
  };
  const cwd = bundle('words', WORDS);
  const find = (query: string, ...more: string[]) => ids(json(cwd, ['search', query, ...more]));

  it('meets plurals in -es, and the -ing and -ed forms of a word', () => {
    for (const q of ['box', 'boxes', 'index', 'indexes', 'match', 'matching', 'rule matched']) assert.deepEqual(find(q), ['boxes'], q);
    for (const q of ['caching', 'cache', 'caches', 'retry', 'retrying', 'pin', 'pinning']) assert.deepEqual(find(q), ['cache'], q);
  });

  it('finds a camelCase word by its parts and as one word, and an accented word without the accents', () => {
    for (const q of ['github', 'git hub', 'GitHub', 'parse HTTP', 'parsehttpresponse', 'week start', 'weekStartUtc']) assert.deepEqual(find(q), ['code'], q);
    assert.deepEqual(find('GitHub', '--all'), ['code'], 'the parts of one word are one requirement');
    for (const q of ['cafe', 'café', 'naive facade', 'FAÇADE']) assert.deepEqual(find(q), ['cafe'], q);
  });

  it('ignores the words a question is asked with, unless they are all there is', () => {
    assert.deepEqual(find('how does the cache work', '--all'), [], '"work" is nowhere, and --all means every real word');
    assert.deepEqual(find('what is the jitter for', '--all'), ['jitter']);
    assert.ok(find('the').length > 0, 'a query of nothing else still searches');
  });

  it('falls back to the word a query nearly spells, at a lower weight', () => {
    assert.deepEqual(find('jiter'), ['jitter'], 'one letter dropped');
    assert.deepEqual(find('concurrent'), ['jitter'], 'a long shared start');
    assert.deepEqual(find('jit'), ['jitter'], 'a prefix still comes first');
    assert.deepEqual(find('zzzzqqq'), []);
    const exact = json(cwd, ['search', 'jitter', '--explain']).results[0].score;
    assert.ok(json(cwd, ['search', 'jiter', '--explain']).results[0].score < exact);
  });

  it('is not confused by words that name members of Object', () => {
    const c = bundle('proto', { ...WORDS, 'proto.md': doc('title: Prototype notes', '# Notes\n\nThe constructor sets __proto__ and toString; hasOwnProperty is avoided.') });
    for (const run of [1, 2]) {
      for (const q of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) assert.deepEqual(ids(json(c, ['search', q, '--all'])), ['proto'], `${q}, run ${run}`);
      assert.deepEqual(ids(json(c, ['search', 'valueOf'])), [], 'not in the bundle, whatever Object says');
    }
  });
});

describe('okf-search: what counts towards a rank', () => {
  it('puts the concept a query names above ones that only mention it', () => {
    const filler = 'The store keeps parcels and their events for ninety days. '.repeat(12);
    const cwd = bundle('named', {
      'index.md': '# Index\n',
      'retry-policy.md': doc('title: Retry policy\ndescription: The retry settings a client uses.', `# Retry policy\n\n${filler}\n\nFive attempts.`),
      'mention.md': doc('title: Release notes', '# Notes\n\nRetry policy retry policy.'),
      'linker.md': doc('title: Unrelated page', '# Page\n\nSee [the settings](/retry-policy.md) and [more](/retry-policy.md "Retry policy").\n\n<!-- retry policy retry policy -->'),
    });
    const r = json(cwd, ['search', 'retry policy']);
    assert.deepEqual(ids(r), ['retry-policy', 'mention'], 'a link target and a comment are not text');
    assert.ok(r.results[0].score > r.results[1].score);
  });

  it('gives the forms of a word one rarity, so a rare form cannot outrank the word itself', () => {
    const cwd = bundle('forms', {
      'index.md': '# Index\n',
      'api.md': doc('title: Routes', '# Routes\n\nGET the parcel. GET the report. Each route needs a key.'),
      'adr.md': doc('title: A decision', '# Decision\n\nWe keep getting this wrong, so it is written down here for everyone.'),
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`n${i}.md`, doc(`title: Note ${i}`, `# Note ${i}\n\nNothing to see.`)])),
    });
    assert.deepEqual(ids(json(cwd, ['search', 'get'])), ['api', 'adr']);
  });

  it('shows the part of a long line that matched', () => {
    const long = 'Carriers differ in many small ways that matter little here. '.repeat(5) + 'Only two of them offer webhooks today. ' + 'The rest are polled on a timer. '.repeat(4);
    const cwd = bundle('snippet', { 'index.md': '# Index\n', 'carriers.md': doc('title: Carriers', `# Carriers\n\n${long}`) });
    const { snippet } = json(cwd, ['search', 'webhook']).results[0];
    assert.match(snippet, /^\.\.\..*offer webhooks today.*\.\.\.$/);
    assert.ok(snippet.length <= 160, String(snippet.length));
  });
});

describe('okf-search: judged queries on the demo bundles', () => {
  // What a reader would ask, and the concepts that answer it. A change to the ranking that
  // moves these down is a regression, whatever else it improves.
  const JUDGED: Array<[bundle: string, query: string, answers: string[]]> = [
    ['okf', 'retry policy', ['parcel-tracker/retry-policy']],
    ['okf', 'why jitter', ['adr/0003-full-jitter-retries', 'tours/retries-explainer', 'parcel-tracker/retry-policy']],
    ['okf', 'exponential back-off', ['adr/0003-full-jitter-retries', 'parcel-tracker/retry-policy', 'tours/retries-explainer']],
    ['okf', 'what to do when a carrier is failing', ['parcel-tracker/runbook-carrier-outage']],
    ['okf', 'api routes', ['parcel-tracker/api']],
    ['okf', 'GET parcels', ['parcel-tracker/api']],
    ['okf', 'how is current status derived', ['parcel-tracker/data-model']],
    ['okf', 'weekly reporting', ['parcel-tracker/weekly-report']],
    ['okf', 'timezone weeks', ['adr/0002-weeks-on-the-utc-clock', 'tours/week-explainer', 'parcel-tracker/weekly-report']],
    ['okf', 'where do design docs live', ['adr/0001-keep-design-in-okf-bundle']],
    ['okf', 'agent memory', ['parcel-tracker/agent-memory', 'adr/0004-agent-memory-in-a-second-bundle']],
    ['okf', 'cache eviction policies', ['tours/caching-explainer']],
    ['okf', 'caching', ['tours/caching-explainer']],
    ['okf', 'consistent hashing ring', ['tours/hashing-explainer']],
    ['okf', 'rate limiting token bucket', ['tours/ratelimit-explainer']],
    ['okf', 'concurrent requests limit', ['tours/concurrency-explainer']],
    ['okf', 'false positives', ['tours/bloom-explainer']],
    ['okf', 'jiter', ['adr/0003-full-jitter-retries', 'parcel-tracker/retry-policy', 'tours/retries-explainer']],
    ['okf', 'couriers', ['parcel-tracker/overview']],
    ['edukai', 'how do I run the tests', ['tooling-parcel-tracker/lessons/2026-08-23-ci-runs-tests-via-btest', 'tooling-parcel-tracker/overview']],
    ['edukai', 'poller retries', ['codebase-parcel-tracker/lessons/2026-10-02-poller-retries-five-times']],
    ['edukai', 'timing out carrier calls', ['codebase-parcel-tracker/lessons/2026-10-03-poller-timeout-is-ten-seconds']],
    ['edukai', 'webhook', ['codebase-parcel-tracker/lessons/2026-10-03-two-carriers-have-webhooks']],
    ['edukai', 'seeding local database', ['tooling-parcel-tracker/lessons/2026-09-10-seed-script-loads-sample-parcels']],
    ['edukai', 'notifications per status', ['codebase-parcel-tracker/lessons/2026-10-04-notifier-sends-one-message-per-status-change']],
    ['edukai', 'report.ts', ['codebase-parcel-tracker/lessons/2026-10-02-weeks-start-monday-utc']],
    ['edukai', 'customer messages', ['codebase-parcel-tracker/lessons/2026-10-04-notifier-sends-one-message-per-status-change']],
  ];

  it('puts an answer in the top three for every one, and first for most', () => {
    let reciprocal = 0;
    for (const [name, query, answers] of JUDGED) {
      const r = spawnSync(process.execPath, [SEARCH, 'search', query, '--bundle', path.join('examples', 'demo', name), '--now', '2026-10-15T00:00:00Z', '--json', '--limit', '50', '--no-cache'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const found = ids(JSON.parse(r.stdout));
      const rank = found.findIndex((id) => answers.includes(id)) + 1;
      assert.ok(rank >= 1 && rank <= 3, `"${query}" in ${name}: an answer at rank ${rank || 'none'} of ${found.slice(0, 3).join(', ')}`);
      reciprocal += 1 / rank;
    }
    const mrr = reciprocal / JUDGED.length;
    assert.ok(mrr >= 0.93, `mean reciprocal rank ${mrr.toFixed(3)}`);
  });
});

describe('okf-search: the files a concept cites', () => {
  const lesson = (title: string, extra: string) => `---\ntype: Lesson\ntitle: ${title}\n${extra}\n---\n\nA claim.\n`;
  const cwd = bundle('cites', {
    'index.md': '# Index\n',
    'poller.md': lesson('Five attempts', 'sources:\n  - resource: src/poller.ts\n  - resource: https://example.com/poller.ts\ncheck:\n  - { file: ./src/config/limits.ts, contains: "5" }'),
    'report.md': lesson('Weeks are UTC', 'sources:\n  - resource: src/report/week.ts\n  - resource: /adr.md'),
    'adr.md': doc('title: A decision', '# Decision\n\nNothing about files.'),
    'url.md': lesson('Read it online', 'sources:\n  - resource: https://example.com/src/poller.ts'),
  });

  it('finds a concept by the name of a file it rests on', () => {
    assert.deepEqual(ids(json(cwd, ['search', 'poller.ts', '--all'])), ['poller'], 'a URL source is not a cited file');
    assert.equal(ids(json(cwd, ['search', 'poller.ts']))[0], 'poller', 'and without --all, the file named in full comes first');
    assert.deepEqual(ids(json(cwd, ['search', 'limits'])), ['poller'], 'a file a check names counts');
    assert.equal(ids(json(cwd, ['search', 'week.ts']))[0], 'report');
  });

  it('filters with --cites by file, by folder and by the end of a path', () => {
    const cites = (value: string) => ids(json(cwd, ['search', '--cites', value]));
    assert.deepEqual(cites('src/poller.ts'), ['poller']);
    assert.deepEqual(cites('./src/poller.ts'), ['poller']);
    assert.deepEqual(cites('poller.ts'), ['poller']);
    assert.deepEqual(cites('src/config/limits.ts'), ['poller']);
    assert.deepEqual(cites('src'), ['poller', 'report']);
    assert.deepEqual(cites('src/'), ['poller', 'report']);
    assert.deepEqual(cites('src/report'), ['report']);
    assert.deepEqual(cites('adr.md'), ['report']);
    assert.deepEqual(cites('src/pol'), [], 'a folder or a file, never part of a name');
    assert.deepEqual(ids(json(cwd, ['search', 'attempts', '--cites', 'src'])), ['poller'], 'and it narrows a query');
    const bare = search(cwd, ['search', '--cites']);
    assert.equal(bare.code, 2, 'the next flag is not its value');
    assert.match(bare.err, /--cites needs a value/);
    assert.deepEqual(ids(json(cwd, ['search', '--cites=src'])), ['poller', 'report']);
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

  it('takes the end of an id, or another case, when one concept answers to it', () => {
    assert.equal(json(cwd, ['show', 'draft', '--outline']).id, 'notes/draft');
    assert.equal(json(cwd, ['show', 'Notes/Draft.md', '--outline']).id, 'notes/draft');
    const c = bundle('tails', { ...FILES, 'notes/retry.md': doc('title: Retry notes', '# Notes'), 'old/retry.md': doc('title: Old retry', '# Old') });
    assert.equal(json(c, ['show', 'retry', '--outline']).id, 'retry', 'an exact id wins');
    fs.rmSync(path.join(c, 'okf', 'retry.md'));
    const two = search(c, ['show', 'retry']);
    assert.equal(two.code, 2, 'two concepts end that way: it will not guess');
    assert.match(two.err, /did you mean: notes\/retry, old\/retry/);
    assert.match(json(c, ['show', 'draft', '--section', 'notes']).content, /Retry thoughts/);
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

  it('answers from the cache exactly as it does without one, through adds, edits and deletes', () => {
    const cwd = bundle('incremental', {
      ...FILES,
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`n/c${i}.md`, doc(`title: Note ${i}\ntags: [t${i % 3}]`, `# Note ${i}\n\nRetry number ${i}, jitter marker${i}. See [next](/n/c${(i + 1) % 8}.md).`)])),
    });
    const queries = [['search', 'retry jitter'], ['search', 'marker3'], ['search', 'mark'], ['search', 'zebra'], ['search', '--tag', 't1'], ['facets'], ['related', 'n/c1'], ['stale']];
    const same = (when: string) => {
      for (const q of queries) {
        const cached = search(cwd, [...q, '--json', '--limit', '50']);
        const fresh = search(cwd, [...q, '--json', '--limit', '50', '--no-cache']);
        assert.deepEqual([cached.code, cached.out, cached.err], [fresh.code, fresh.out, fresh.err], `${q.join(' ')} ${when}`);
      }
    };
    // Files well in the past are trusted on their timestamps, so the cache really is reused.
    const settle = () => {
      const past = new Date(Date.now() - 3_600_000);
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else fs.utimesSync(path.join(dir, e.name), past, past);
        }
      };
      walk(path.join(cwd, 'okf'));
    };
    const file = (rel: string) => path.join(cwd, 'okf', rel);
    settle();
    same('cold');
    same('warm');
    const cache = path.join(cwd, 'node_modules', '.cache', 'okf-search');
    const read = () => JSON.parse(fs.readFileSync(path.join(cache, fs.readdirSync(cache)[0]!), 'utf8'));
    assert.equal(read().docs.length, 12);
    assert.ok(Array.isArray(read().postings.jitter), 'an inverted index, not a copy of every concept');
    const written = fs.statSync(path.join(cache, fs.readdirSync(cache)[0]!)).mtimeMs;

    fs.rmSync(file('n/c0.md'));
    fs.rmSync(file('cache.md'));
    same('after two deletes');
    fs.writeFileSync(file('n/c3.md'), doc('title: Note three, rewritten', '# Rewritten\n\nA zebra, and no marker at all.'));
    fs.writeFileSync(file('a-first.md'), doc('title: Sorts first', '# First\n\nZebra jitter. See [3](/n/c3.md).'));
    settle();
    same('after an edit and an add that renumbers every concept');
    fs.writeFileSync(file('n/c5.md'), '---\ntitle: no type now\n---\n');
    same('after a concept became unreadable');
    fs.writeFileSync(file('n/c5.md'), doc('title: Note 5 again', '# Back\n\nMarker5 is back.'));
    fs.rmSync(file('n'), { recursive: true });
    same('after a folder went');
    assert.equal(read().docs.length, 4);
    assert.equal(read().postings.marker3, undefined, 'a word no concept holds any more is dropped');
    assert.ok(fs.statSync(path.join(cache, fs.readdirSync(cache)[0]!)).mtimeMs > written);
    settle();
    same('settled');
    const before = fs.statSync(path.join(cache, fs.readdirSync(cache)[0]!)).mtimeMs;
    same('and unchanged');
    assert.equal(fs.statSync(path.join(cache, fs.readdirSync(cache)[0]!)).mtimeMs, before, 'an unchanged bundle does not rewrite its cache');
  });

  it('needs `yaml` only to read a file it has not indexed, and exits 2 without it', () => {
    // Outside the repo there is no node_modules above the tools, as in a project before `npm install`.
    const away = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-search-test-'));
    try {
      for (const f of ['okf-search.mts', 'okf-core.mts', 'okf-rank.mts']) fs.copyFileSync(path.join(path.dirname(SEARCH), f), path.join(away, f));
      fs.mkdirSync(path.join(away, 'node_modules'));
      fs.mkdirSync(path.join(away, 'okf'));
      fs.writeFileSync(path.join(away, 'okf', 'retry.md'), doc('title: Retry policy', '# Retry policy\n\nFive retries.'));
      const past = new Date(Date.now() - 3_600_000);
      fs.utimesSync(path.join(away, 'okf', 'retry.md'), past, past);
      const at = (env: Record<string, string>) =>
        spawnSync(process.execPath, [path.join(away, 'okf-search.mts'), 'search', 'retry', '--bundle', 'okf'], { cwd: away, encoding: 'utf8', env: { ...process.env, NODE_PATH: '', ...env } });
      const none = at({});
      assert.equal(none.status, 2, 'could not run is 2, never a pass and never a broken bundle');
      assert.match(none.stderr, /could not load the `yaml` package[\s\S]*fix: npm install/);
      assert.equal(fs.existsSync(path.join(away, 'node_modules', '.cache')), false, 'and no file is cached as broken');
      const withYaml = at({ NODE_PATH: path.join(ROOT, 'node_modules') });
      assert.equal(withYaml.status, 0, withYaml.stderr);
      const warm = at({});
      assert.deepEqual([warm.status, warm.stdout], [0, withYaml.stdout], 'the cached index answers with no parser at all');
    } finally {
      fs.rmSync(away, { recursive: true, force: true });
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
