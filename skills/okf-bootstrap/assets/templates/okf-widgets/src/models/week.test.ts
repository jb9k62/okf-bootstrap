import { describe, expect, it } from 'vitest';
import {
  localDate,
  localMidnight,
  weekLabel,
  weekStartUtc,
  zoneOffsetMs,
} from './week.ts';

// If the real logic lives elsewhere (a SQL date_trunc, a server), copy its test cases here so
// the model and the real code are pinned to the same answers.
describe('weekStartUtc', () => {
  it.each([
    ['2026-09-21T00:00:00.000Z', '2026-09-21'],
    ['2026-09-27T23:59:59.999Z', '2026-09-21'],
    ['2026-09-28T00:00:00.001Z', '2026-09-28'],
    ['2026-12-31T23:59:59.999Z', '2026-12-28'],
    ['2027-01-01T00:00:00.000Z', '2026-12-28'],
    // Monday 00:30 in Johannesburg is Sunday 22:30 UTC: the previous week.
    ['2026-09-20T22:30:00.000Z', '2026-09-14'],
  ])('maps %s to %s', (instant, expected) => {
    expect(weekStartUtc(Date.parse(instant))).toBe(expected);
  });

  it('labels a week across a year boundary', () => {
    expect(weekLabel('2026-12-28')).toBe('Mon 28 Dec to Sun 3 Jan');
  });
});

describe('time zone helpers', () => {
  it('reads Johannesburg as UTC+2 and New York as UTC-4 in September', () => {
    const instant = Date.parse('2026-09-21T12:00:00.000Z');
    expect(zoneOffsetMs(instant, 'Africa/Johannesburg')).toBe(2 * 3600_000);
    expect(zoneOffsetMs(instant, 'America/New_York')).toBe(-4 * 3600_000);
  });

  it('finds local midnight across a daylight saving change in Auckland', () => {
    // New Zealand moves to NZDT (UTC+13) on Sunday 27 September 2026.
    expect(
      new Date(localMidnight('2026-09-28', 'Pacific/Auckland')).toISOString(),
    ).toBe('2026-09-27T11:00:00.000Z');
    expect(
      new Date(localMidnight('2026-09-26', 'Pacific/Auckland')).toISOString(),
    ).toBe('2026-09-25T12:00:00.000Z');
  });

  it('gives the local date of an instant', () => {
    expect(
      localDate(Date.parse('2026-09-20T22:30:00.000Z'), 'Africa/Johannesburg'),
    ).toBe('2026-09-21');
  });
});
