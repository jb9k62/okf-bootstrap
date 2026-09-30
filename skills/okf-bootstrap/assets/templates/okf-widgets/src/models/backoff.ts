/**
 * Exponential backoff with an optional cap and "full jitter", and what a crowd of clients
 * does with it. The retry-backoff widget draws this; backoff.test.ts pins it.
 *
 * The random source is a seeded generator, so the widget, the tests and the reader all see
 * the same crowd for the same settings.
 */

export interface BackoffSettings {
  /** Delay before the first retry, in ms. */
  baseMs: number;
  /** Retries after the first failure. */
  retries: number;
  /** Ceiling on any one delay, or null for none. */
  capMs: number | null;
  /** Full jitter: each delay is uniform in [0, computed delay). */
  jitter: boolean;
}

/** The un-jittered delay before retry `n` (0-based): base * 2^n, capped. */
export function delayFor(n: number, settings: BackoffSettings): number {
  const raw = settings.baseMs * 2 ** n;
  return settings.capMs === null ? raw : Math.min(raw, settings.capMs);
}

/** A small, fast, seeded generator (mulberry32). Returns numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The instants (ms after the shared failure) at which one client sends each retry. */
export function retryTimes(
  settings: BackoffSettings,
  random: () => number,
): number[] {
  const times: number[] = [];
  let at = 0;
  for (let n = 0; n < settings.retries; n++) {
    const delay = delayFor(n, settings);
    at += settings.jitter ? Math.floor(random() * delay) : delay;
    times.push(at);
  }
  return times;
}

/**
 * Every client fails at the same instant (a server blip) and retries on its own schedule.
 * Returns the retry count per time bucket, and the worst bucket: the load spike the server
 * sees on its way back up.
 */
export function crowd(
  settings: BackoffSettings,
  clients: number,
  bucketMs: number,
  seed = 1,
): { buckets: number[]; peak: number; lastRetryMs: number } {
  const random = seeded(seed);
  const all = Array.from({ length: clients }, () => retryTimes(settings, random)).flat();
  const lastRetryMs = all.length ? Math.max(...all) : 0;
  const buckets = new Array<number>(Math.floor(lastRetryMs / bucketMs) + 1).fill(0);
  for (const at of all) buckets[Math.floor(at / bucketMs)]! += 1;
  return { buckets, peak: Math.max(0, ...buckets), lastRetryMs };
}
