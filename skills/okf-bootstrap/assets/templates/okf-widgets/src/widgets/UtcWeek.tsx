/**
 * Example micro-world: scrub an instant, pick the clock on the wall, and see which UTC week it
 * falls in. It teaches one idea that text only asserts: the week boundary is Monday 00:00 on
 * the UTC clock, not local midnight.
 *
 * The anatomy every widget shares:
 *   - presets that jump straight to the edge cases worth seeing (with a note on each)
 *   - direct controls (a slider, a select) for free exploration
 *   - the result, derived from a pure model on every render, never stored as state
 *   - a line saying what is real code and what is a model
 *   - one control marked data-probe, which the viewer's render gate clicks
 */

import { useState } from 'react';
import { Facts, ModelNote, Note, Presets } from '../kit.tsx';
import {
  addDays,
  DAY_MS,
  localDate,
  localMidnight,
  utcMidnight,
  weekLabel,
  weekStartUtc,
} from '../models/week.ts';

const ZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'Africa/Johannesburg', label: 'Johannesburg' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'Pacific/Auckland', label: 'Auckland' },
] as const;

type ZoneId = (typeof ZONES)[number]['id'];

interface Preset {
  id: string;
  label: string;
  instant: string;
  zone: ZoneId;
  note: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: 'jnb-monday',
    label: 'Monday 00:30 in Johannesburg',
    instant: '2026-09-20T22:30:00.000Z',
    zone: 'Africa/Johannesburg',
    note: 'Monday on the office clock, but still Sunday 22:30 in UTC, so it lands in the previous week.',
  },
  {
    id: 'last-ms',
    label: 'Sunday 23:59:59.999 UTC',
    instant: '2026-09-27T23:59:59.999Z',
    zone: 'UTC',
    note: 'The last millisecond of the week. One millisecond later is a new week.',
  },
  {
    id: 'ny-sunday',
    label: 'Sunday evening in New York',
    instant: '2026-09-28T01:30:00.000Z',
    zone: 'America/New_York',
    note: 'Sunday 21:30 locally is already Monday 01:30 in UTC: next week.',
  },
  {
    id: 'akl-new-year',
    label: 'New Year in Auckland',
    instant: '2026-12-31T11:00:00.000Z',
    zone: 'Pacific/Auckland',
    note: 'Midnight on 1 January in Auckland. The week started on Monday 28 December and runs across the year boundary.',
  },
];

const clockFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  });

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A ruler cell: the weekday letter over the day of the month, for a UTC midnight. */
function DayCell({ midnight }: { midnight: number }) {
  const date = new Date(midnight);
  return (
    <>
      <span>{date.getUTCDay() === 1 ? 'Mon' : LETTERS[date.getUTCDay()]}</span>
      <span>{date.getUTCDate()}</span>
    </>
  );
}

const STEP_MS = 30 * 60 * 1000;

export default function UtcWeek() {
  const first = PRESETS[0]!;
  const [instant, setInstant] = useState(Date.parse(first.instant));
  const [zone, setZone] = useState<ZoneId>(first.zone);
  const [presetId, setPresetId] = useState<string | null>(first.id);
  // The slider covers three weeks around the week of the last preset, so it stays steady
  // while the reader drags.
  const [anchorWeek, setAnchorWeek] = useState(weekStartUtc(instant));

  const rangeStart = utcMidnight(addDays(anchorWeek, -7));
  const rangeEnd = utcMidnight(addDays(anchorWeek, 14));
  const span = rangeEnd - rangeStart;
  const at = (ms: number) => `${((ms - rangeStart) / span) * 100}%`;
  const clip = (ms: number) => Math.min(Math.max(ms, rangeStart), rangeEnd);

  const weekStart = weekStartUtc(instant);
  const weekFrom = utcMidnight(weekStart);
  const weekTo = weekFrom + 7 * DAY_MS;
  const preset = PRESETS.find((candidate) => candidate.id === presetId) ?? null;

  const utcDays = Array.from({ length: 21 }, (_, index) => rangeStart + index * DAY_MS);

  // Local days that overlap the range, drawn on the same time axis as the UTC days.
  const firstLocal = localDate(rangeStart, zone);
  const localDays = Array.from({ length: 23 }, (_, index) => {
    const date = addDays(firstLocal, index - 1);
    return {
      date,
      start: localMidnight(date, zone),
      end: localMidnight(addDays(date, 1), zone),
    };
  }).filter((day) => day.end > rangeStart && day.start < rangeEnd);

  function choosePreset(next: Preset) {
    const ms = Date.parse(next.instant);
    setInstant(ms);
    setZone(next.zone);
    setPresetId(next.id);
    setAnchorWeek(weekStartUtc(ms));
  }

  return (
    <div>
      <Presets
        presets={PRESETS}
        active={presetId}
        probe="last-ms"
        onChoose={choosePreset}
      />

      <label className="okfw-row">
        Clock on the wall{' '}
        <select
          value={zone}
          onChange={(event) => {
            setZone(event.target.value as ZoneId);
            setPresetId(null);
          }}
        >
          {ZONES.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>

      <div className="okfw-ruler" aria-hidden="true">
        <div className="okfw-ruler-label">UTC</div>
        <div className="okfw-track">
          <div
            className="okfw-band"
            style={{
              left: at(clip(weekFrom)),
              width: `${((clip(weekTo) - clip(weekFrom)) / span) * 100}%`,
            }}
          />
          {utcDays.map((start) => (
            <div
              key={start}
              className="okfw-tick"
              data-strong={new Date(start).getUTCDay() === 1}
              style={{ left: at(start), width: at(rangeStart + DAY_MS) }}
            >
              <DayCell midnight={start} />
            </div>
          ))}
          <div className="okfw-marker" style={{ left: at(instant) }} />
        </div>
        {zone !== 'UTC' && (
          <>
            <div className="okfw-ruler-label">Local</div>
            <div className="okfw-track">
              {localDays.map((day) => (
                <div
                  key={day.date}
                  className="okfw-tick"
                  data-strong={new Date(utcMidnight(day.date)).getUTCDay() === 1}
                  style={{
                    left: at(clip(day.start)),
                    width: `${((clip(day.end) - clip(day.start)) / span) * 100}%`,
                  }}
                >
                  <DayCell midnight={utcMidnight(day.date)} />
                </div>
              ))}
              <div className="okfw-marker" style={{ left: at(instant) }} />
            </div>
          </>
        )}
      </div>

      <input
        className="okfw-slider"
        type="range"
        aria-label="Instant"
        min={rangeStart}
        max={rangeEnd - 1}
        step={STEP_MS}
        value={instant}
        onChange={(event) => {
          setInstant(Number(event.target.value));
          setPresetId(null);
        }}
      />

      <Facts
        rows={[
          ['On the wall clock', clockFormat(zone).format(instant)],
          ['In UTC', clockFormat('UTC').format(instant)],
          [
            'Falls in week',
            <>
              <strong data-testid="week-label">{weekLabel(weekStart)}</strong>{' '}
              <code>week_start = {weekStart}</code>
            </>,
          ],
        ]}
      />
      {preset && <Note>{preset.note}</Note>}
      <ModelNote>
        A model: <code>weekStartUtc</code> in <code>models/week.ts</code>, pinned by its test.
        Replace it with an import of your project&apos;s own function when it can run in a
        browser.
      </ModelNote>
    </div>
  );
}
