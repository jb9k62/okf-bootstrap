/**
 * Micro-world: find a number in a list, one comparison at a time. The reader steps through
 * linear and binary search, then removes the safeguard: binary search needs the list sorted,
 * and on an unsorted list it confidently says a present value is missing.
 */

import { useState } from 'react';
import { Choice, Facts, ModelNote, Note, Presets, Scrubber, useWorld, type WorldPreset } from '../kit.tsx';
import { isSorted, parseList, search, type Method } from '../models/search.ts';

interface State {
  method: Method;
  list: string;
  target: number;
}

const EVENS = Array.from({ length: 64 }, (_, i) => i * 2).join(' ');

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'binary',
    label: 'Binary search, 64 items',
    state: { method: 'binary', list: EVENS, target: 90 },
    note: 'Each comparison throws away half of what is left, so 64 items take at most 7 looks, and a million take at most 20. Drag the slider and watch the ringed range shrink.',
  },
  {
    id: 'linear',
    label: 'Linear search, the same list',
    state: { method: 'linear', list: EVENS, target: 90 },
    note: 'Linear search looks at items in order until it finds one. Its cost grows with the list; binary search grows with the logarithm of it. For a handful of items, linear is just as good and needs no sorting.',
  },
  {
    id: 'unsorted',
    label: 'Binary search on an unsorted list',
    state: { method: 'binary', list: '9 1 8 2 7 3 6 4 5', target: 3 },
    note: 'The 3 is in the list, but binary search compared the middle (7), concluded "too big, look left", and walked away from it. Its steps rely on order. Switch to linear and it is found at position 6.',
  },
];

export default function BinarySearch() {
  const world = useWorld(PRESETS);
  const [step, setStep] = useState(0);
  const { method, list: text, target } = world.state;
  const list = parseList(text).slice(0, 100);
  const result = search(method, list, target);
  const linear = search('linear', list, target);
  const at = Math.min(step, Math.max(0, result.steps.length - 1));
  const current = result.steps[at];
  const sorted = isSorted(list);
  const wrong = method === 'binary' && result.found === -1 && linear.found !== -1;
  const bestCase = Math.ceil(Math.log2(list.length + 1));

  return (
    <div>
      <Presets
        presets={PRESETS}
        active={world.preset?.id ?? null}
        probe="linear"
        onChoose={(preset) => {
          world.choose(preset);
          setStep(0);
        }}
      />
      <div className="okfw-columns">
        <section>
          <Choice
            label="Method"
            options={[
              { id: 'linear', label: 'Linear' },
              { id: 'binary', label: 'Binary' },
            ]}
            value={method}
            onChange={(next) => {
              world.set({ method: next });
              setStep(0);
            }}
          />
          <label className="okfw-row">
            Look for{' '}
            <input
              type="number"
              aria-label="Target"
              value={target}
              onChange={(event) => {
                world.set({ target: Number(event.target.value) });
                setStep(0);
              }}
            />
          </label>
        </section>
        <section>
          <h4>The list (up to 100 numbers)</h4>
          <input
            type="text"
            className="okfw-wide"
            aria-label="List"
            value={text}
            spellCheck={false}
            onChange={(event) => {
              world.set({ list: event.target.value });
              setStep(0);
            }}
          />
        </section>
      </div>

      <div className="okfw-cells" role="img" aria-label={`${list.length} numbers; comparing position ${current ? current.index + 1 : 'none'}`}>
        {list.map((value, index) => {
          const inRange = current && index >= current.lo && index <= current.hi;
          const seen = result.steps.slice(0, at).some((s) => s.index === index);
          return (
            <span key={index} data-in={inRange || undefined} data-seen={seen || undefined} data-now={current?.index === index || undefined} data-hit={result.found === index && at === result.steps.length - 1 || undefined}>
              {value}
            </span>
          );
        })}
      </div>

      <Scrubber
        label="Comparison"
        value={at}
        max={result.steps.length - 1}
        onChange={setStep}
        describe={() =>
          current ? (
            <>
              compare position {current.index + 1} ({current.value}) with {target}:{' '}
              <strong data-testid="search-outcome">
                {current.outcome === 'found' ? 'found' : current.outcome === 'miss' ? 'not it, next' : current.outcome === 'low' ? 'too small, go right' : 'too big, go left'}
              </strong>
            </>
          ) : (
            'nothing to compare'
          )
        }
      />

      <Facts
        testId="search-result"
        rows={[
          [
            'Result',
            result.found === -1 ? <strong>not found</strong> : <strong>found at position {result.found + 1}</strong>,
          ],
          ['Comparisons', `${result.steps.length} (${method} search)`],
          ['At most', method === 'binary' ? `${bestCase} for ${list.length} items` : `${list.length} for ${list.length} items`],
        ]}
      />
      {method === 'binary' && !sorted && (
        <Note tone="warn">This list is not sorted, so binary search's answer cannot be trusted.</Note>
      )}
      {wrong && (
        <Note tone="warn">
          Binary search says the target is missing, but linear search finds it at position {linear.found + 1}.
        </Note>
      )}
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/search.ts</code>. It counts comparisons, not time; on real
        hardware a short linear scan can beat binary search because of how memory is read.
      </ModelNote>
    </div>
  );
}
