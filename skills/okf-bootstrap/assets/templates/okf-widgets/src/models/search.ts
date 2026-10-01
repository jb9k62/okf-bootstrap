/**
 * Linear and binary search over a list, step by step. The binary-search widget draws this;
 * search.test.ts pins it. Binary search is only correct on sorted input, and this runs it on
 * whatever it is given so the widget can show what happens when the precondition breaks.
 */

export type Method = 'linear' | 'binary';

export interface Step {
  /** The index compared at this step. */
  index: number;
  /** The range still being searched (inclusive), for binary search; the whole tail for linear. */
  lo: number;
  hi: number;
  value: number;
  outcome: 'found' | 'low' | 'high' | 'miss';
}

export interface Result {
  steps: Step[];
  /** Index of the match, or -1. */
  found: number;
}

export function parseList(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export const isSorted = (list: readonly number[]): boolean =>
  list.every((value, i) => i === 0 || list[i - 1]! <= value);

export function search(method: Method, list: readonly number[], target: number): Result {
  const steps: Step[] = [];
  if (method === 'linear') {
    for (let i = 0; i < list.length; i++) {
      const value = list[i]!;
      const hit = value === target;
      steps.push({ index: i, lo: i, hi: list.length - 1, value, outcome: hit ? 'found' : 'miss' });
      if (hit) return { steps, found: i };
    }
    return { steps, found: -1 };
  }
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = list[mid]!;
    const outcome = value === target ? 'found' : value < target ? 'low' : 'high';
    steps.push({ index: mid, lo, hi, value, outcome });
    if (outcome === 'found') return { steps, found: mid };
    if (outcome === 'low') lo = mid + 1;
    else hi = mid - 1;
  }
  return { steps, found: -1 };
}
