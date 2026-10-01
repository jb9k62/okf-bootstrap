import { describe, expect, it } from 'vitest';
import { parseTrace, simulate, type Policy } from './cache.ts';

const misses = (policy: Policy, capacity: number, trace: string) =>
  simulate(policy, capacity, parseTrace(trace)).misses;

// Belady's reference string: the classic example of a policy that gets worse with more memory.
const BELADY = '1 2 3 4 1 2 5 1 2 3 4 5';

describe('simulate', () => {
  it("shows Belady's anomaly: FIFO misses more with four frames than three", () => {
    expect(misses('fifo', 3, BELADY)).toBe(9);
    expect(misses('fifo', 4, BELADY)).toBe(10);
  });

  it('never gets worse with more memory under LRU or OPT (stack algorithms)', () => {
    expect(misses('lru', 3, BELADY)).toBe(10);
    expect(misses('lru', 4, BELADY)).toBe(8);
    expect(misses('opt', 3, BELADY)).toBe(7);
    expect(misses('opt', 4, BELADY)).toBe(6);
  });

  it('keeps hot keys under LFU through a one-off scan, where LRU loses them', () => {
    const trace = 'a a a b b b s1 s2 s3 a b';
    expect(simulate('lru', 3, parseTrace(trace)).steps.slice(-2).map((s) => s.hit)).toEqual([false, false]);
    expect(simulate('lfu', 3, parseTrace(trace)).steps.slice(-2).map((s) => s.hit)).toEqual([true, true]);
  });

  it('gives LRU and FIFO no hits when a loop is one key larger than the cache', () => {
    const loop = '1 2 3 4 1 2 3 4 1 2 3 4';
    expect(simulate('lru', 3, parseTrace(loop)).hits).toBe(0);
    expect(simulate('fifo', 3, parseTrace(loop)).hits).toBe(0);
    expect(simulate('opt', 3, parseTrace(loop)).hits).toBeGreaterThan(3);
  });

  it('records what each step evicted and what is left', () => {
    const { steps } = simulate('lru', 2, ['a', 'b', 'a', 'c']);
    expect(steps.map((s) => [s.hit, s.evicted])).toEqual([
      [false, null],
      [false, null],
      [true, null],
      [false, 'b'],
    ]);
    expect(steps[3]!.contents).toEqual(['a', 'c']);
  });

  it('caches nothing at capacity zero, and handles an empty trace', () => {
    expect(simulate('lru', 0, ['a', 'a']).hits).toBe(0);
    expect(simulate('lru', 3, []).hitRate).toBe(0);
  });
});

describe('parseTrace', () => {
  it('accepts spaces and commas', () => {
    expect(parseTrace('a, b  c,d')).toEqual(['a', 'b', 'c', 'd']);
  });
});
