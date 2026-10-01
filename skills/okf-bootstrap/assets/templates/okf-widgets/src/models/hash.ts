/**
 * A small string hash for the models that place keys (bloom.ts, ring.ts). FNV-1a alone is weak
 * in its low bits for similar strings such as `evt-1`, `evt-2`, and both models take the hash
 * modulo a small number, so the result is passed through a finaliser (MurmurHash3's fmix32)
 * that spreads every input bit over the output.
 */

/** A well-mixed 32-bit hash of `text`. A different `seed` gives an independent-looking hash. */
export function hash32(text: string, seed = 0): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}
