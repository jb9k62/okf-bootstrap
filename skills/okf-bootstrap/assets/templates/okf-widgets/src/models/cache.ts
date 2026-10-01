/**
 * Cache replacement policies run over a trace of requests. The cache-policy widget draws this;
 * cache.test.ts pins it, including Belady's anomaly, the textbook case where more memory makes
 * FIFO worse.
 *
 * Every policy is a pure function of (capacity, trace), so the widget can run all of them on
 * the same trace and compare.
 */

export type Policy = 'fifo' | 'lru' | 'lfu' | 'opt';

export const POLICIES: readonly { id: Policy; label: string; rule: string }[] = [
  { id: 'fifo', label: 'FIFO', rule: 'evict whatever has been in the cache longest' },
  { id: 'lru', label: 'LRU', rule: 'evict whatever was used least recently' },
  { id: 'lfu', label: 'LFU', rule: 'evict whatever has been used least often' },
  { id: 'opt', label: 'OPT', rule: 'evict whatever is needed furthest in the future (needs a crystal ball)' },
];

export interface Step {
  key: string;
  hit: boolean;
  /** The key pushed out to make room, if any. */
  evicted: string | null;
  /** Cache contents after this access, first = next to go for FIFO and LRU. */
  contents: string[];
}

export interface Run {
  steps: Step[];
  hits: number;
  misses: number;
  hitRate: number;
}

/** Parse "a b c" or "a, b, c" into keys. */
export function parseTrace(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

/**
 * Run `policy` with room for `capacity` entries. A hit leaves the cache's membership alone;
 * a miss inserts the key, evicting one entry first when full. Capacity below 1 caches nothing.
 */
export function simulate(policy: Policy, capacity: number, trace: readonly string[]): Run {
  // `order` is insertion order for FIFO and recency order (oldest use first) for the others.
  let order: string[] = [];
  const uses = new Map<string, number>();
  const steps: Step[] = [];
  let hits = 0;

  trace.forEach((key, at) => {
    const hit = order.includes(key);
    let evicted: string | null = null;
    if (hit) {
      hits++;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      if (policy !== 'fifo') order = [...order.filter((k) => k !== key), key];
    } else if (capacity >= 1) {
      if (order.length >= capacity) {
        evicted = victim(policy, order, uses, trace, at);
        order = order.filter((k) => k !== evicted);
        uses.delete(evicted);
      }
      order = [...order, key];
      uses.set(key, 1);
    }
    steps.push({ key, hit, evicted, contents: [...order] });
  });

  const misses = trace.length - hits;
  return { steps, hits, misses, hitRate: trace.length ? hits / trace.length : 0 };
}

function victim(
  policy: Policy,
  order: readonly string[],
  uses: ReadonlyMap<string, number>,
  trace: readonly string[],
  at: number,
): string {
  if (policy === 'lfu') {
    // Fewest uses; among equals the one used longest ago (earliest in `order`).
    return order.reduce((best, k) => ((uses.get(k) ?? 0) < (uses.get(best) ?? 0) ? k : best));
  }
  if (policy === 'opt') {
    const nextUse = (k: string) => {
      const next = trace.indexOf(k, at + 1);
      return next === -1 ? Infinity : next;
    };
    return order.reduce((best, k) => (nextUse(k) > nextUse(best) ? k : best));
  }
  return order[0]!;
}
