import { describe, expect, it } from 'vitest';
import { isSorted, parseList, search } from './search.ts';

const sorted = Array.from({ length: 1024 }, (_, i) => i * 2);

describe('search', () => {
  it('finds a value in at most log2(n) + 1 steps with binary search, and n with linear', () => {
    const binary = search('binary', sorted, 2046);
    expect(binary.found).toBe(1023);
    expect(binary.steps.length).toBeLessThanOrEqual(11);
    expect(search('linear', sorted, 2046).steps).toHaveLength(1024);
  });

  it('halves the range each step', () => {
    const { steps } = search('binary', [1, 3, 5, 7, 9, 11, 13], 13);
    expect(steps.map((s) => [s.lo, s.hi, s.index, s.outcome])).toEqual([
      [0, 6, 3, 'low'],
      [4, 6, 5, 'low'],
      [6, 6, 6, 'found'],
    ]);
  });

  it('reports a miss with -1 in both methods', () => {
    expect(search('binary', [1, 3, 5], 4).found).toBe(-1);
    expect(search('linear', [1, 3, 5], 4).found).toBe(-1);
    expect(search('binary', [], 1)).toEqual({ steps: [], found: -1 });
  });

  it('misses a value that is present when the list is not sorted', () => {
    const list = [9, 1, 8, 2, 7, 3];
    expect(isSorted(list)).toBe(false);
    expect(search('linear', list, 1).found).toBe(1);
    expect(search('binary', list, 1).found).toBe(-1);
  });
});

describe('parseList', () => {
  it('reads numbers and drops junk', () => {
    expect(parseList('3, 1 x 2')).toEqual([3, 1, 2]);
  });
});
