import { describe, expect, it } from 'vitest';
import { crowd, delayFor, retryTimes, seeded } from './backoff.ts';

const base = { baseMs: 100, retries: 5, capMs: null, jitter: false };

describe('delayFor', () => {
  it('doubles each retry, and the cap stops the growth', () => {
    expect([0, 1, 2, 3, 4].map((n) => delayFor(n, base))).toEqual([
      100, 200, 400, 800, 1600,
    ]);
    expect(delayFor(4, { ...base, capMs: 500 })).toBe(500);
  });
});

describe('retryTimes', () => {
  it('sums the delays without jitter', () => {
    expect(retryTimes(base, seeded(1))).toEqual([100, 300, 700, 1500, 3100]);
  });

  it('never waits longer than the un-jittered delay with jitter', () => {
    const times = retryTimes({ ...base, jitter: true }, seeded(7));
    const gaps = times.map((t, i) => t - (times[i - 1] ?? 0));
    gaps.forEach((gap, n) => expect(gap).toBeLessThan(delayFor(n, base)));
  });
});

describe('crowd', () => {
  const slow = { ...base, baseMs: 500 };

  it('lands every client in the same bucket without jitter', () => {
    expect(crowd(slow, 100, 50).peak).toBe(100);
  });

  it('spreads the same clients out with jitter', () => {
    expect(crowd({ ...slow, jitter: true }, 100, 50).peak).toBeLessThan(30);
  });

  it('barely helps when the delays are short next to the bucket', () => {
    // Jitter spreads each retry over [0, delay). A 100 ms base in 100 ms buckets has almost
    // nowhere to spread to, and the rounds start to pile into the same early buckets.
    expect(crowd({ ...base, jitter: true }, 100, 100).peak).toBeGreaterThan(100);
  });

  it('is the same crowd for the same seed', () => {
    const settings = { ...base, jitter: true };
    expect(crowd(settings, 20, 50, 3)).toEqual(crowd(settings, 20, 50, 3));
  });
});
