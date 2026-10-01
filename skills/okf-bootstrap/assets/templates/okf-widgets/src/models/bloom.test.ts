import { describe, expect, it } from 'vitest';
import {
  add,
  bitsPerKeyFor,
  create,
  expectedFalsePositiveRate,
  filled,
  has,
  measure,
  optimalK,
  positions,
} from './bloom.ts';

describe('bloom filter', () => {
  it('never forgets a key it was given (no false negatives)', () => {
    const filter = create(256, 3);
    const keys = Array.from({ length: 40 }, (_, i) => `evt-${i}`);
    keys.forEach((key) => add(filter, key));
    expect(keys.every((key) => has(filter, key))).toBe(true);
  });

  it('says no to everything while empty', () => {
    expect(has(create(64, 3), 'anything')).toBe(false);
  });

  it('maps a key to k positions inside the array, the same ones every time', () => {
    const first = positions('evt-1', 100, 5);
    expect(first).toHaveLength(5);
    expect(first.every((p) => p >= 0 && p < 100)).toBe(true);
    expect(positions('evt-1', 100, 5)).toEqual(first);
  });

  it('fills every bit when overloaded, so everything is a "maybe"', () => {
    const { filter, measuredRate } = measure(64, 3, 400);
    expect(filled(filter)).toBe(64);
    expect(measuredRate).toBe(1);
  });
});

describe('false-positive rate', () => {
  it('matches the formula closely at a sensible size', () => {
    const m = 4096;
    const n = 400;
    const k = optimalK(m, n);
    const expected = expectedFalsePositiveRate(m, k, n);
    const { measuredRate } = measure(m, k, n, 20000);
    expect(Math.abs(measuredRate - expected)).toBeLessThan(0.01);
  });

  it('tracks the formula with one hash too, where a weak hash on similar keys would not', () => {
    // evt-0, evt-1, ... differ only in their last characters; an unmixed FNV-1a spreads them
    // badly over the low bits and measured about 14% here against 9.3% by formula.
    const { measuredRate } = measure(1024, 1, 100, 20000);
    expect(Math.abs(measuredRate - expectedFalsePositiveRate(1024, 1, 100))).toBeLessThan(0.02);
  });

  it('is minimised near the optimal k', () => {
    const [m, n] = [1024, 100];
    const best = optimalK(m, n);
    expect(best).toBe(7);
    const rate = (k: number) => expectedFalsePositiveRate(m, k, n);
    expect(rate(best)).toBeLessThan(rate(1));
    expect(rate(best)).toBeLessThan(rate(20));
  });

  it('needs about 9.6 bits per key for 1%', () => {
    expect(bitsPerKeyFor(0.01)).toBeCloseTo(9.585, 2);
  });

  it('is zero with no keys', () => {
    expect(expectedFalsePositiveRate(100, 3, 0)).toBe(0);
    expect(optimalK(100, 0)).toBe(1);
  });
});
