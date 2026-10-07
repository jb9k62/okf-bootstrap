// How the poller waits between retries of a failed carrier poll.
// The settings match okf/parcel-tracker/retry-policy.md and ADR-0003.

export const RETRIES = 5;
export const BASE_MS = 500;
export const CAP_MS = 2_000;

/**
 * Full jitter: a random wait between zero and the capped exponential delay, so pollers that
 * failed together do not retry together. `attempt` counts from 1.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const backoff = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1));
  return Math.floor(random() * backoff);
}
