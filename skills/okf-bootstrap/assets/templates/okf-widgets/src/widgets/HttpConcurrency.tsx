/**
 * Micro-world: a client fetching a set of requests through a limited number of connections.
 * The reader moves the concurrency limit and watches the waterfall. Two lessons fall out of it:
 * more connections stop helping once the work is spread thin (the critical path, set by
 * requests that wait for each other, is the floor), and a connection is not free (each new one
 * pays a handshake, which is what HTTP/2's single multiplexed connection avoids).
 *
 * The request set comes from the concept's block (`id ms [after=a,b]` per line), so the same
 * widget can show a page load or a poller; with no data it shows a typical page load.
 */

import { Facts, ModelNote, Note, Presets, SourceProblem, Slider, Toggle, useWorld, type WorldPreset } from '../kit.tsx';
import { parseRequests, schedule, type Request } from '../models/concurrency.ts';
import { dataLines } from '../models/source.ts';

const PAGE_LOAD = `
-- A page load: the HTML names everything else, and some files name more files.
html 120
css  150 after=html
js   200 after=html
font 180 after=css
api  160 after=js
img1 100 after=html
img2 100 after=html
img3 100 after=html
img4 100 after=html
img5 100 after=html
img6 100 after=html
`;

interface State {
  limit: number;
  setupMs: number;
  shared: boolean;
}

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'serial',
    label: 'One at a time',
    state: { limit: 1, setupMs: 40, shared: false },
    note: 'Every request waits for the one before it, so the total is the work added up plus one handshake. This is the baseline everything else is measured against.',
  },
  {
    id: 'six',
    label: 'Six connections (HTTP/1.1)',
    state: { limit: 6, setupMs: 40, shared: false },
    note: 'The usual browser limit per host. Requests that were queued now run side by side, but each of the six connections pays its own handshake, and anything that waits for another request still waits.',
  },
  {
    id: 'many',
    label: 'Unlimited connections',
    state: { limit: 16, setupMs: 40, shared: false },
    note: 'Nothing queues any more, yet the total barely moves: the longest chain of requests that wait for each other sets a floor. Spending more connections cannot buy time back. Compare the handshake bars: the extra connections each paid for nothing.',
  },
  {
    id: 'multiplex',
    label: 'One connection, many streams (HTTP/2)',
    state: { limit: 16, setupMs: 40, shared: true },
    note: 'One handshake, then every ready request goes at once. The floor is the same critical path, reached on one connection instead of many.',
  },
];

const ms = (value: number) => `${Math.round(value)} ms`;

export default function HttpConcurrency({ source }: { source: string }) {
  const world = useWorld(PRESETS, 1);
  let requests: Request[];
  try {
    requests = parseRequests(dataLines(source.trim() === '' ? PAGE_LOAD : source));
  } catch (error) {
    return <SourceProblem error={error} />;
  }
  if (requests.length === 0) {
    return <SourceProblem error='no requests: give one per line as "id ms [after=a,b]"' />;
  }

  const { limit, setupMs, shared } = world.state;
  let result;
  let serial;
  try {
    result = schedule(requests, world.state);
    serial = schedule(requests, { ...world.state, limit: 1 });
  } catch (error) {
    return <SourceProblem error={error} />;
  }
  const lanes = Math.max(0, ...result.bars.map((bar) => bar.lane)) + 1;
  const floor = Math.max(result.criticalPathMs, result.workMs / limit);
  const longestWait = Math.max(0, ...result.bars.map((bar) => bar.queuedMs));
  const scale = (t: number) => `${(t / result.totalMs) * 100}%`;

  return (
    <div>
      <Presets presets={PRESETS} active={world.preset?.id ?? null} probe="multiplex" onChoose={world.choose} />

      <div className="okfw-columns">
        <section className="okfw-http-controls">
          <Slider
            label={shared ? 'Streams in flight' : 'Connections'}
            value={limit}
            min={1}
            max={16}
            onChange={(next) => world.set({ limit: next })}
          />
          <Slider
            label="Handshake"
            value={setupMs}
            min={0}
            max={200}
            step={10}
            format={ms}
            onChange={(next) => world.set({ setupMs: next })}
          />
          <Toggle
            label="Share one connection"
            reason="HTTP/2: a single handshake, requests interleaved as streams"
            checked={shared}
            onChange={(next) => world.set({ shared: next })}
          />
        </section>
        <section>
          <h4>Requests ({requests.length})</h4>
          <ul className="okfw-plain okfw-http-requests">
            {requests.map((request) => (
              <li key={request.id}>
                <code>{request.id}</code>
                <span>
                  {ms(request.ms)}
                  {request.after.length > 0 && <span className="okfw-muted"> after {request.after.join(', ')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <h4>Waterfall: one row per {shared ? 'stream' : 'connection'}</h4>
      <div className="okfw-gantt" role="img" aria-label={`Waterfall of ${requests.length} requests finishing in ${ms(result.totalMs)}`}>
        {Array.from({ length: lanes }, (_, lane) => (
          <div className="okfw-track" key={lane}>
            {result.bars
              .filter((bar) => bar.lane === lane)
              .map((bar) => (
                <span key={bar.id}>
                  {bar.sendAt > bar.start && (
                    <span
                      className="okfw-gantt-setup"
                      style={{ left: scale(bar.start), width: scale(bar.sendAt - bar.start) }}
                      title={`handshake ${ms(bar.sendAt - bar.start)}`}
                    />
                  )}
                  <span
                    className="okfw-gantt-bar"
                    style={{ left: scale(bar.sendAt), width: scale(bar.end - bar.sendAt) }}
                    title={`${bar.id}: ${ms(bar.end - bar.sendAt)}, started at ${ms(bar.start)}${bar.queuedMs ? `, waited ${ms(bar.queuedMs)} for a free connection` : ''}`}
                  >
                    {bar.id}
                  </span>
                </span>
              ))}
          </div>
        ))}
        {shared && setupMs > 0 && (
          <div className="okfw-track">
            <span className="okfw-gantt-setup" style={{ left: 0, width: scale(setupMs) }} title={`handshake ${ms(setupMs)}`} />
          </div>
        )}
      </div>
      <p className="okfw-reason okfw-gantt-axis">
        <span>0 ms</span>
        <span>{ms(result.totalMs)}</span>
      </p>

      <Facts
        testId="http-result"
        rows={[
          [
            'Total time',
            <>
              <strong className="okfw-big">{ms(result.totalMs)}</strong>{' '}
              <span className="okfw-muted">
                ({(serial.totalMs / result.totalMs).toFixed(1)}x faster than one at a time)
              </span>
            </>,
          ],
          [
            'Floor',
            `${ms(floor)}: the longer of the longest chain of waiting requests (${ms(result.criticalPathMs)}) and the work shared out (${ms(result.workMs / limit)})`,
          ],
          ['Connections opened', String(result.connections)],
          ['Longest wait for a connection', ms(longestWait)],
        ]}
      />
      {limit > 1 && result.totalMs > floor && longestWait === 0 && !shared && (
        <Note tone="warn">
          Nothing is queueing, so more connections cannot help. The time above the floor is
          handshakes.
        </Note>
      )}
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/concurrency.ts</code>. Every request takes its stated time whatever
        else is in flight; a real server and network slow down under load, so this overstates
        what unlimited concurrency buys.
      </ModelNote>
    </div>
  );
}
