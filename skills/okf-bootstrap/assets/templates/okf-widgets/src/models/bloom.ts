/**
 * A Bloom filter: a bit array and k hash functions that answer "definitely not seen" or "maybe
 * seen", never "definitely seen". The bloom-filter widget draws this; bloom.test.ts pins it.
 *
 * Positions come from double hashing (h1 + i * h2 over two FNV-1a hashes), the standard way to
 * get k hashes from two without losing the false-positive rate.
 */

export interface Bloom {
  bits: Uint8Array;
  k: number;
}

function fnv1a(text: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The k bit positions `key` maps to in a filter of `m` bits (may repeat for small m). */
export function positions(key: string, m: number, k: number): number[] {
  const h1 = fnv1a(key, 0);
  const h2 = fnv1a(key, 0x9e3779b9) | 1; // odd, so the stride visits every bit when m is a power of two
  return Array.from({ length: k }, (_, i) => ((h1 + Math.imul(i, h2)) >>> 0) % m);
}

export function create(m: number, k: number): Bloom {
  return { bits: new Uint8Array(m), k };
}

export function add(filter: Bloom, key: string): void {
  for (const p of positions(key, filter.bits.length, filter.k)) filter.bits[p] = 1;
}

/** False means definitely never added; true means added, or a false positive. */
export function has(filter: Bloom, key: string): boolean {
  return positions(key, filter.bits.length, filter.k).every((p) => filter.bits[p] === 1);
}

export const filled = (filter: Bloom): number => filter.bits.reduce((n, b) => n + b, 0);

/** The textbook false-positive rate for n keys in m bits with k hashes: (1 - e^(-kn/m))^k. */
export function expectedFalsePositiveRate(m: number, k: number, n: number): number {
  return n === 0 ? 0 : (1 - Math.exp((-k * n) / m)) ** k;
}

/** The k that minimises the rate for n keys in m bits: (m / n) ln 2, at least 1. */
export function optimalK(m: number, n: number): number {
  return n === 0 ? 1 : Math.max(1, Math.round((m / n) * Math.LN2));
}

/** Bits per key needed for a target false-positive rate, with the best k. */
export const bitsPerKeyFor = (rate: number): number => -Math.log(rate) / Math.LN2 ** 2;

export interface Measured {
  filter: Bloom;
  falsePositives: number;
  probes: number;
  measuredRate: number;
}

/** Add `members` named `<prefix>0..`, then probe keys that were never added and count the "maybe"s. */
export function measure(m: number, k: number, n: number, probes = 2000): Measured {
  const filter = create(m, k);
  for (let i = 0; i < n; i++) add(filter, `evt-${i}`);
  let falsePositives = 0;
  for (let i = 0; i < probes; i++) if (has(filter, `other-${i}`)) falsePositives++;
  return { filter, falsePositives, probes, measuredRate: falsePositives / probes };
}
