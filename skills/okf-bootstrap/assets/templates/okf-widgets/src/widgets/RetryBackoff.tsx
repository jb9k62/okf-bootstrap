/**
 * Example micro-world: a crowd of clients all fail at once and retry with exponential backoff.
 * The reader switches the safeguards (jitter, a cap) off and on and watches the load spike the
 * server sees on its way back up. It teaches why each safeguard exists by letting the reader
 * remove it, which is the most useful move a widget can offer.
 */

import { useState } from 'react';
import { Facts, ModelNote, Note, Presets } from '../kit.tsx';
import { crowd, delayFor, type BackoffSettings } from '../models/backoff.ts';

const BUCKET_MS = 50;

interface Preset {
  id: string;
  label: string;
  settings: BackoffSettings;
  clients: number;
  note: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: 'herd',
    label: 'No jitter: the thundering herd',
    settings: { baseMs: 500, retries: 5, capMs: null, jitter: false },
    clients: 100,
    note: 'Every client computes the same delays, so all 100 retries of each round land in the same instant. Backoff alone spaces the rounds out, not the clients.',
  },
  {
    id: 'jitter',
    label: 'Full jitter',
    settings: { baseMs: 500, retries: 5, capMs: null, jitter: true },
    clients: 100,
    note: 'Each delay is random between zero and the computed delay. The same retries are now spread out, and the peak drops to about a quarter. Jitter needs room: with delays that are short next to the spike, it has almost nowhere to spread the clients.',
  },
  {
    id: 'uncapped',
    label: 'Eight retries, no cap',
    settings: { baseMs: 500, retries: 8, capMs: null, jitter: true },
    clients: 100,
    note: 'Doubling adds up: the last retry waits 64 s on its own. A cap bounds how long a client can go quiet.',
  },
];

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export default function RetryBackoff() {
  const first = PRESETS[0]!;
  const [settings, setSettings] = useState<BackoffSettings>(first.settings);
  const [clients, setClients] = useState(first.clients);
  const [presetId, setPresetId] = useState<string | null>(first.id);

  const result = crowd(settings, clients, BUCKET_MS);
  const preset = PRESETS.find((candidate) => candidate.id === presetId) ?? null;
  const change = (next: Partial<BackoffSettings>) => {
    setSettings({ ...settings, ...next });
    setPresetId(null);
  };

  return (
    <div>
      <Presets
        presets={PRESETS}
        active={presetId}
        probe="jitter"
        onChoose={(candidate) => {
          setSettings(candidate.settings);
          setClients(candidate.clients);
          setPresetId(candidate.id);
        }}
      />

      <div className="okfw-columns">
        <section>
          <label className="okfw-row">
            Clients{' '}
            <input
              type="range"
              aria-label="Clients"
              min={1}
              max={200}
              value={clients}
              onChange={(event) => {
                setClients(Number(event.target.value));
                setPresetId(null);
              }}
            />{' '}
            {clients}
          </label>
          <label className="okfw-row">
            Retries{' '}
            <input
              type="number"
              aria-label="Retries"
              min={1}
              max={10}
              value={settings.retries}
              onChange={(event) =>
                change({ retries: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })
              }
            />
          </label>
          <label className="okfw-toggle">
            <input
              type="checkbox"
              checked={settings.jitter}
              onChange={(event) => change({ jitter: event.target.checked })}
            />{' '}
            Full jitter
            <span className="okfw-reason">each delay is random in [0, delay)</span>
          </label>
          <label className="okfw-toggle">
            <input
              type="checkbox"
              checked={settings.capMs !== null}
              onChange={(event) => change({ capMs: event.target.checked ? 2000 : null })}
            />{' '}
            Cap each delay at 2 s
          </label>
        </section>
        <section>
          <h4>Delay before each retry (before jitter)</h4>
          <ol className="okfw-plain">
            {Array.from({ length: settings.retries }, (_, n) => (
              <li key={n}>
                retry {n + 1}: {seconds(delayFor(n, settings))}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <h4>Retries reaching the server, per {BUCKET_MS} ms</h4>
      <div className="okfw-bars" aria-hidden="true">
        {result.buckets.map((count, index) => (
          <span
            key={index}
            style={{ height: `${result.peak ? (count / result.peak) * 100 : 0}%` }}
          />
        ))}
      </div>
      <Facts
        testId="backoff-result"
        rows={[
          [
            `Worst ${BUCKET_MS} ms`,
            <>
              <strong className="okfw-big" data-bad={result.peak > clients / 2}>
                {result.peak}
              </strong>{' '}
              retries at once
            </>,
          ],
          ['Last retry', `${seconds(result.lastRetryMs)} after the failure`],
        ]}
      />
      {!settings.jitter && clients > 1 && (
        <Note tone="warn">
          Every client retries in lockstep, so each round hits the server as one spike.
        </Note>
      )}
      {preset && <Note>{preset.note}</Note>}
      <ModelNote>
        A model: <code>models/backoff.ts</code>, with a seeded random source so the same
        settings always draw the same crowd.
      </ModelNote>
    </div>
  );
}
