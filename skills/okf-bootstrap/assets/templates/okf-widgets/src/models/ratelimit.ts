/**
 * Three ways to limit a client to N requests per window, run over the same arrival times. The
 * rate-limiter widget draws this; ratelimit.test.ts pins it, including the burst a fixed window
 * lets through at its boundary.
 *
 * Times are in milliseconds and must be non-decreasing.
 */

export type Limiter = 'fixed' | 'sliding' | 'bucket';

export const LIMITERS: readonly { id: Limiter; label: string; rule: string }[] = [
  { id: 'fixed', label: 'Fixed window', rule: 'count requests per clock-aligned window; the count resets at each boundary' },
  { id: 'sliding', label: 'Sliding window', rule: 'allow if fewer than the limit were allowed in the last window' },
  { id: 'bucket', label: 'Token bucket', rule: 'a bucket holds up to the limit and refills steadily; each request takes one token' },
];

export interface Decision {
  at: number;
  allowed: boolean;
  /** What the limiter holds after this request: requests counted (windows) or tokens left (bucket). */
  state: number;
}

export interface Result {
  decisions: Decision[];
  allowed: number;
  /** Most requests allowed in any span of one window: the worst burst the server saw. */
  worstWindow: number;
}

export function parseTimes(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

/** Run `limiter` allowing `limit` requests per `windowMs`. */
export function run(limiter: Limiter, limit: number, windowMs: number, times: readonly number[]): Result {
  const decisions: Decision[] = [];
  const allowedAt: number[] = [];
  let windowStart = 0;
  let count = 0;
  let tokens = limit;
  let last = times[0] ?? 0;

  for (const at of times) {
    let allowed: boolean;
    let state: number;
    if (limiter === 'fixed') {
      const start = Math.floor(at / windowMs) * windowMs;
      if (start !== windowStart) {
        windowStart = start;
        count = 0;
      }
      allowed = count < limit;
      if (allowed) count++;
      state = count;
    } else if (limiter === 'sliding') {
      while (allowedAt.length > 0 && allowedAt[0]! <= at - windowMs) allowedAt.shift();
      allowed = allowedAt.length < limit;
      state = allowedAt.length + (allowed ? 1 : 0);
    } else {
      tokens = Math.min(limit, tokens + ((at - last) * limit) / windowMs);
      last = at;
      allowed = tokens >= 1;
      if (allowed) tokens -= 1;
      state = Math.floor(tokens * 100) / 100;
    }
    if (allowed) allowedAt.push(at);
    decisions.push({ at, allowed, state });
  }

  // Sliding window over the allowed times, for the burst figure (same for every limiter).
  let worstWindow = 0;
  let from = 0;
  for (let i = 0; i < allowedAt.length; i++) {
    while (allowedAt[i]! - allowedAt[from]! >= windowMs) from++;
    worstWindow = Math.max(worstWindow, i - from + 1);
  }
  return { decisions, allowed: allowedAt.length, worstWindow };
}
