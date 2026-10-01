/**
 * Micro-world: a Bloom filter, a few bits that remember a set of ids without storing them. The
 * reader sizes the bit array, the number of keys and the number of hash functions, then asks
 * about a key and sees exactly which bits it was checked against. It teaches the asymmetry that
 * makes the structure useful ("no" is certain, "yes" is only likely) and what drives how often
 * "yes" is wrong.
 */

import { useState } from 'react';
import { Facts, ModelNote, Note, Presets, Slider, useWorld, type WorldPreset } from '../kit.tsx';
import {
  expectedFalsePositiveRate,
  filled,
  has,
  measure,
  optimalK,
  positions,
} from '../models/bloom.ts';

interface State {
  m: number;
  n: number;
  k: number;
}

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'sized',
    label: 'Sized for the job',
    state: { m: 1024, n: 100, k: 7 },
    note: 'About ten bits per key and seven hashes: roughly one key in a hundred that was never added still gets a "yes", and "no" is never wrong. Ask about evt-7 (added) and evt-999 (never added).',
  },
  {
    id: 'overfull',
    label: 'Far too many keys',
    state: { m: 64, n: 100, k: 4 },
    note: 'A hundred keys in 64 bits: every bit is lit, so nearly every question is answered "maybe". A full Bloom filter says yes to everything and is worth nothing.',
  },
  {
    id: 'one',
    label: 'A single hash',
    state: { m: 1024, n: 100, k: 1 },
    note: 'With one hash each key lights one bit, so a stranger needs only one lit bit to look present. More hashes make a stranger prove itself several times, up to the point where they fill the array.',
  },
  {
    id: 'many',
    label: 'Too many hashes',
    state: { m: 1024, n: 100, k: 16 },
    note: 'Sixteen hashes check a stranger more times, but each key now lights sixteen bits and the array fills. Past the optimum, more hashes make it worse. The best k is about (bits per key) x 0.69.',
  },
];

const percent = (rate: number) => `${(rate * 100).toFixed(rate < 0.1 ? 2 : 0)}%`;
const COLUMNS = 64;

export default function BloomFilter() {
  const world = useWorld(PRESETS);
  const [query, setQuery] = useState('evt-7');
  const { m, n, k } = world.state;

  const measured = measure(m, k, n);
  const filter = measured.filter;
  const expected = expectedFalsePositiveRate(m, k, n);
  const best = optimalK(m, n);

  const key = query.trim();
  const probed = key === '' ? [] : positions(key, m, k);
  const probedSet = new Set(probed);
  const maybe = key !== '' && has(filter, key);
  const added = /^evt-\d+$/.test(key) && Number(key.slice(4)) < n && String(Number(key.slice(4))) === key.slice(4);
  const lit = filled(filter);

  return (
    <div>
      <Presets presets={PRESETS} active={world.preset?.id ?? null} probe="overfull" onChoose={world.choose} />

      <div className="okfw-columns">
        <section>
          <Slider label="Bits" value={m} min={64} max={2048} step={64} onChange={(next) => world.set({ m: next })} />
          <Slider label="Keys added" value={n} min={0} max={300} onChange={(next) => world.set({ n: next })} />
          <Slider label="Hash functions" value={k} min={1} max={16} onChange={(next) => world.set({ k: next })} />
        </section>
        <section>
          <label className="okfw-row">
            Ask about a key{' '}
            <input
              type="text"
              aria-label="Key to look up"
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="okfw-reason">
            The filter holds evt-0 to evt-{Math.max(0, n - 1)}. Anything else was never added.
          </p>
          <p data-testid="bloom-answer" data-wrong={maybe && !added}>
            {key === '' ? (
              'Type a key.'
            ) : !maybe ? (
              <>
                <strong>Definitely not seen.</strong> At least one of its bits is dark, and adding
                a key never darkens a bit.
              </>
            ) : added ? (
              <>
                <strong>Probably seen.</strong> Every bit is lit. This time that is true: it was
                added.
              </>
            ) : (
              <>
                <strong>Probably seen: a false positive.</strong> Every one of its bits was lit
                by other keys, but it was never added.
              </>
            )}
          </p>
        </section>
      </div>

      <div
        className="okfw-bits"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
        role="img"
        aria-label={`${lit} of ${m} bits set`}
      >
        {Array.from(filter.bits, (bit, index) => (
          <span key={index} data-lit={bit === 1} data-probed={probedSet.has(index) || undefined} />
        ))}
      </div>
      <p className="okfw-reason">Lit bits are filled; the ringed bits are the ones the question checks.</p>

      <Facts
        testId="bloom-result"
        rows={[
          [
            'Bits set',
            <>
              <strong className="okfw-big" data-bad={lit / m > 0.6}>
                {Math.round((lit / m) * 100)}%
              </strong>{' '}
              ({lit} of {m})
            </>,
          ],
          [
            'Strangers answered "yes"',
            `${percent(measured.measuredRate)} measured on ${measured.probes} strangers; ${percent(expected)} by formula`,
          ],
          ['Best hash count here', k === best ? `${best}, which is what you have` : `${best} (you have ${k})`],
        ]}
      />
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/bloom.ts</code> (two seeded, mixed FNV-1a hashes from{' '}
        <code>models/hash.ts</code>, combined by double hashing). A
        production filter differs in hash quality and in being sized once, up front, for the
        keys it will hold.
      </ModelNote>
    </div>
  );
}
