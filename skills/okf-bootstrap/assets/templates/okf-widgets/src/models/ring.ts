/**
 * Consistent hashing: nodes and keys hashed onto a ring, each key owned by the next node
 * clockwise. The consistent-hash widget draws this; ring.test.ts pins it.
 *
 * The comparison that matters is what happens to existing keys when a node joins: with
 * `hash % nodes` almost all of them move, on a ring only about 1/(n+1) do.
 */

export const RING_SIZE = 2 ** 32;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // FNV is weak in the low bits for similar strings; mix before using the position.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export const position = (text: string): number => fnv1a(text);

export interface Point {
  node: number;
  vnode: number;
  at: number;
}

/** Every virtual node of nodes 0..nodes-1 on the ring, in clockwise order. */
export function buildRing(nodes: number, vnodes: number): Point[] {
  const points: Point[] = [];
  for (let node = 0; node < nodes; node++) {
    for (let vnode = 0; vnode < vnodes; vnode++) {
      points.push({ node, vnode, at: position(`node-${node}#${vnode}`) });
    }
  }
  return points.sort((a, b) => a.at - b.at || a.node - b.node);
}

/** The node that owns `key`: first point at or after its position, wrapping round. */
export function owner(ring: readonly Point[], key: string): number {
  if (ring.length === 0) return -1;
  const at = position(key);
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid]!.at < at) lo = mid + 1;
    else hi = mid;
  }
  return ring[lo % ring.length]!.node;
}

export interface Placement {
  /** Keys per node. */
  load: number[];
  /** Fraction of keys that moved when one node was added. */
  movedRing: number;
  movedModulo: number;
  /** Heaviest node's load over the average: 1 is perfectly even. */
  imbalance: number;
}

export const keyNames = (count: number): string[] => Array.from({ length: count }, (_, i) => `key-${i}`);

export function place(nodes: number, vnodes: number, keys: number): Placement {
  const names = keyNames(keys);
  const before = buildRing(nodes, vnodes);
  const after = buildRing(nodes + 1, vnodes);
  const load = new Array<number>(nodes).fill(0);
  let movedRing = 0;
  let movedModulo = 0;
  for (const key of names) {
    const was = owner(before, key);
    load[was]! += 1;
    if (owner(after, key) !== was) movedRing++;
    if (position(key) % (nodes + 1) !== position(key) % nodes) movedModulo++;
  }
  const average = keys / nodes;
  return {
    load,
    movedRing: keys ? movedRing / keys : 0,
    movedModulo: keys ? movedModulo / keys : 0,
    imbalance: keys ? Math.max(...load) / average : 1,
  };
}
