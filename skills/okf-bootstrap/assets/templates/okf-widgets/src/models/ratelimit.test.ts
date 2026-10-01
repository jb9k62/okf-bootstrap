import { describe, expect, it } from 'vitest';
import { parseTimes, run } from './ratelimit.ts';

// Five requests at the very end of one window, five at the start of the next.
const BOUNDARY = [900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080];

describe('run', () => {
  it('lets a fixed window pass twice the limit across its boundary', () => {
    const result = run('fixed', 5, 1000, BOUNDARY);
    expect(result.allowed).toBe(10);
    expect(result.worstWindow).toBe(10);
  });

  it('holds a sliding window to the limit in any window', () => {
    const result = run('sliding', 5, 1000, BOUNDARY);
    expect(result.allowed).toBe(5);
    expect(result.worstWindow).toBe(5);
  });

  it('lets a full token bucket take a burst up to its size, then only the refill rate', () => {
    const burst = Array.from({ length: 8 }, () => 0);
    expect(run('bucket', 5, 1000, burst).allowed).toBe(5);
    const steady = Array.from({ length: 20 }, (_, i) => i * 200); // 5 per second
    expect(run('bucket', 5, 1000, steady).allowed).toBe(20);
    const fast = Array.from({ length: 20 }, (_, i) => i * 100); // 10 per second
    expect(run('bucket', 5, 1000, fast).allowed).toBeLessThan(15);
  });

  it('resets a fixed window at the boundary and a sliding one only as old requests age out', () => {
    const times = [0, 1, 2, 3, 4, 5, 1000, 1001];
    expect(run('fixed', 5, 1000, times).decisions.map((d) => d.allowed)).toEqual([
      true, true, true, true, true, false, true, true,
    ]);
    expect(run('sliding', 5, 1000, [0, 1, 2, 3, 4, 500, 1000, 1001]).decisions.map((d) => d.allowed)).toEqual([
      true, true, true, true, true, false, true, true,
    ]);
  });

  it('handles no requests', () => {
    expect(run('bucket', 5, 1000, [])).toEqual({ decisions: [], allowed: 0, worstWindow: 0 });
  });
});

describe('parseTimes', () => {
  it('reads, sorts and drops junk', () => {
    expect(parseTimes('30, 10 x 20 -5')).toEqual([10, 20, 30]);
  });
});
