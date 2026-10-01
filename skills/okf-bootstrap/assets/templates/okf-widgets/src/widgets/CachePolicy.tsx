/**
 * Micro-world: a cache with room for a few entries, a stream of requests, and four rules for
 * what to throw out. The reader changes the policy, the size or the traffic and watches the hit
 * rate move. It exists to break one assumption: that a bigger cache, or a smarter-sounding
 * policy, is always better. The comparison table runs every policy on the same trace at the
 * current size and one larger, which is where FIFO's anomaly shows.
 */

import { Choice, Facts, ModelNote, Note, Presets, Slider, useWorld, type WorldPreset } from '../kit.tsx';
import { parseTrace, POLICIES, simulate, type Policy } from '../models/cache.ts';

const MAX_REQUESTS = 60;

interface State {
  policy: Policy;
  capacity: number;
  trace: string;
}

const BELADY = '1 2 3 4 1 2 5 1 2 3 4 5';

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'belady',
    label: "Belady's anomaly",
    state: { policy: 'fifo', capacity: 3, trace: BELADY },
    note: 'Look at the table: with FIFO, four entries do worse than three on this trace. FIFO evicts by age, not by use, so extra room can change which entries are old at the wrong moment. LRU and OPT never do this.',
  },
  {
    id: 'loop',
    label: 'A loop one key too big',
    state: { policy: 'lru', capacity: 3, trace: '1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4' },
    note: 'Four keys cycle through room for three. By the time a key comes round again it is the one LRU just evicted, so it never hits. OPT still hits half the time. Raise the size to 4 and every request after the first lap hits.',
  },
  {
    id: 'scan',
    label: 'A scan pushes out the hot keys',
    state: { policy: 'lru', capacity: 4, trace: 'a b a b a b a b s1 s2 s3 s4 s5 s6 a b a b' },
    note: 'Two keys are hot, then a one-off scan reads six keys it will never use again. LRU treats each scan key as recent and drops a and b. Switch to LFU: the hot keys have been used often, so the scan only churns itself.',
  },
  {
    id: 'skew',
    label: 'Skewed traffic',
    state: {
      policy: 'fifo',
      capacity: 2,
      trace: 'dhl dhl ups dhl fedex dhl ups dhl post dhl ups fedex dhl dhl',
    },
    note: 'Most lookups go to one carrier. Frequency and recency both notice it; FIFO ignores it and evicts dhl just because it arrived first. When traffic is this skewed, even a tiny cache pays off.',
  },
];

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

export default function CachePolicy() {
  const world = useWorld(PRESETS);
  const { policy, capacity, trace: text } = world.state;
  const trace = parseTrace(text).slice(0, MAX_REQUESTS);
  const run = simulate(policy, capacity, trace);
  const compare = POLICIES.map((p) => ({
    ...p,
    here: simulate(p.id, capacity, trace),
    bigger: simulate(p.id, capacity + 1, trace),
  }));
  const worse = compare.filter((row) => row.bigger.hitRate < row.here.hitRate);
  const rule = POLICIES.find((p) => p.id === policy)!.rule;

  return (
    <div>
      <Presets presets={PRESETS} active={world.preset?.id ?? null} probe="scan" onChoose={world.choose} />

      <div className="okfw-columns">
        <section>
          <h4>Policy: {rule}</h4>
          <Choice
            label="Policy"
            options={POLICIES}
            value={policy}
            onChange={(next) => world.set({ policy: next })}
          />
          <Slider
            label="Cache size"
            value={capacity}
            min={1}
            max={8}
            format={(n) => `${n} ${n === 1 ? 'entry' : 'entries'}`}
            onChange={(next) => world.set({ capacity: next })}
          />
        </section>
        <section>
          <h4>Requests, in order (keys separated by spaces)</h4>
          <input
            type="text"
            className="okfw-wide"
            aria-label="Request trace"
            value={text}
            spellCheck={false}
            onChange={(event) => world.set({ trace: event.target.value })}
          />
          {parseTrace(text).length > MAX_REQUESTS && (
            <p className="okfw-reason">Only the first {MAX_REQUESTS} requests are used.</p>
          )}
        </section>
      </div>

      <div className="okfw-table-wrap">
        <table className="okfw-table okfw-cache-steps" aria-label="Step by step">
          <tbody>
            <tr>
              <th scope="row">Request</th>
              {run.steps.map((step, index) => (
                <td key={index}>{step.key}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Result</th>
              {run.steps.map((step, index) => (
                <td key={index} data-hit={step.hit}>
                  {step.hit ? 'hit' : 'miss'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Evicted</th>
              {run.steps.map((step, index) => (
                <td key={index} className="okfw-muted">
                  {step.evicted ?? ''}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Cache</th>
              {run.steps.map((step, index) => (
                <td key={index} className="okfw-cache-contents">
                  {step.contents.map((key) => (
                    <span key={key} data-new={!step.hit && key === step.key}>
                      {key}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <Facts
        testId="cache-result"
        rows={[
          [
            'Hit rate',
            <>
              <strong className="okfw-big" data-bad={run.hitRate < 0.25 && trace.length > 0}>
                {percent(run.hitRate)}
              </strong>{' '}
              ({run.hits} hits, {run.misses} misses)
            </>,
          ],
        ]}
      />

      <h4>Every policy on this trace</h4>
      <div className="okfw-table-wrap">
        <table className="okfw-table" data-testid="cache-compare">
          <thead>
            <tr>
              <th>Policy</th>
              <th>{capacity} {capacity === 1 ? 'entry' : 'entries'}</th>
              <th>{capacity + 1} entries</th>
            </tr>
          </thead>
          <tbody>
            {compare.map((row) => (
              <tr key={row.id} data-ok={row.bigger.hitRate >= row.here.hitRate}>
                <th scope="row">{row.label}</th>
                <td>{percent(row.here.hitRate)}</td>
                <td>
                  {percent(row.bigger.hitRate)}
                  {row.bigger.hitRate < row.here.hitRate && ' (worse)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {worse.length > 0 && (
        <Note tone="warn">
          More room made {worse.map((row) => row.label).join(' and ')} worse on this trace.
        </Note>
      )}
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/cache.ts</code>. It counts hits and misses only; it knows nothing
        about entry sizes, expiry or the cost of a miss, which all matter in a real cache.
      </ModelNote>
    </div>
  );
}
