/**
 * Micro-world: one burst of requests, three ways to limit it. The reader switches the limiter
 * and steps through the requests. A fixed window looks fine until the burst straddles a window
 * boundary and the server sees twice the limit; the other two do not have a boundary to hide
 * behind. Step through to see what each one is counting.
 */

import { useState } from 'react';
import { Choice, Facts, ModelNote, Note, Presets, Scrubber, Slider, useWorld, type WorldPreset } from '../kit.tsx';
import { LIMITERS, parseTimes, run, type Limiter } from '../models/ratelimit.ts';

interface State {
  limiter: Limiter;
  limit: number;
  windowMs: number;
  times: string;
}

const BOUNDARY = '900 920 940 960 980 1000 1020 1040 1060 1080';
const BURST = '0 0 0 0 0 0 0 0 400 800 1200 1600 2000 2400';

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'boundary',
    label: 'A burst across the boundary',
    state: { limiter: 'fixed', limit: 5, windowMs: 1000, times: BOUNDARY },
    note: 'Five requests land just before the window resets and five just after. Each window saw only five, so all ten are allowed, yet the server took ten in 180 ms: twice the limit. Check the worst-burst figure.',
  },
  {
    id: 'sliding',
    label: 'The same burst, sliding window',
    state: { limiter: 'sliding', limit: 5, windowMs: 1000, times: BOUNDARY },
    note: 'A sliding window asks "how many in the last second?" at every request, so there is no boundary to straddle. It keeps a timestamp per allowed request, which is its cost.',
  },
  {
    id: 'bucket',
    label: 'Token bucket: a burst, then a trickle',
    state: { limiter: 'bucket', limit: 5, windowMs: 1000, times: BURST },
    note: 'The bucket starts full, so a burst of five goes through at once, then requests are allowed only as fast as tokens refill. It stores two numbers, and it is the one that allows a deliberate burst.',
  },
];

export default function RateLimiter() {
  const world = useWorld(PRESETS);
  const [step, setStep] = useState(0);
  const { limiter, limit, windowMs, times: text } = world.state;
  const times = parseTimes(text);
  const result = run(limiter, limit, windowMs, times);
  const at = Math.min(step, Math.max(0, result.decisions.length - 1));
  const current = result.decisions[at];
  const span = Math.max(1, ...times) * 1.02;
  const rule = LIMITERS.find((l) => l.id === limiter)!.rule;
  const unit = limiter === 'bucket' ? 'tokens left' : 'counted in the window';

  return (
    <div>
      <Presets
        presets={PRESETS}
        active={world.preset?.id ?? null}
        probe="sliding"
        onChoose={(preset) => {
          world.choose(preset);
          setStep(0);
        }}
      />
      <div className="okfw-columns">
        <section>
          <h4>Limiter: {rule}</h4>
          <Choice label="Limiter" options={LIMITERS} value={limiter} onChange={(next) => world.set({ limiter: next })} />
          <Slider label="Limit" value={limit} min={1} max={10} format={(n) => `${n} per window`} onChange={(next) => world.set({ limit: next })} />
          <Slider label="Window" value={windowMs} min={500} max={2000} step={100} format={(n) => `${n} ms`} onChange={(next) => world.set({ windowMs: next })} />
        </section>
        <section>
          <h4>Request times in ms, in order</h4>
          <input
            type="text"
            className="okfw-wide"
            aria-label="Request times"
            value={text}
            spellCheck={false}
            onChange={(event) => world.set({ times: event.target.value })}
          />
        </section>
      </div>

      <div className="okfw-track okfw-timeline" role="img" aria-label={`${result.allowed} of ${times.length} requests allowed`}>
        {limiter === 'fixed' &&
          Array.from({ length: Math.floor(span / windowMs) + 1 }, (_, i) => (
            <span key={i} className="okfw-boundary" style={{ left: `${((i * windowMs) / span) * 100}%` }} />
          ))}
        {result.decisions.map((d, i) => (
          <span
            key={i}
            className="okfw-req"
            data-allowed={d.allowed}
            data-current={i === at || undefined}
            style={{ left: `${(d.at / span) * 100}%` }}
          />
        ))}
      </div>

      <Scrubber
        label="Request"
        value={at}
        max={result.decisions.length - 1}
        onChange={setStep}
        describe={() =>
          current ? (
            <>
              {at + 1} of {result.decisions.length}: at {current.at} ms,{' '}
              <strong data-testid="rate-decision">{current.allowed ? 'allowed' : 'denied'}</strong>, {current.state} {unit}
            </>
          ) : (
            'no requests'
          )
        }
      />

      <Facts
        testId="rate-result"
        rows={[
          ['Allowed', `${result.allowed} of ${times.length}`],
          [
            'Worst burst',
            <>
              <strong className="okfw-big" data-bad={result.worstWindow > limit}>
                {result.worstWindow}
              </strong>{' '}
              requests in one {windowMs} ms span (limit {limit})
            </>,
          ],
        ]}
      />
      {result.worstWindow > limit && (
        <Note tone="warn">
          The server took {result.worstWindow} requests inside one window although the limit is {limit}.
        </Note>
      )}
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/ratelimit.ts</code>. Single client, one process; a limiter shared
        by many servers also needs a shared store, and that is where most of the cost lives.
      </ModelNote>
    </div>
  );
}
