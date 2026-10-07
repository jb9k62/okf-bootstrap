// The (fictional) carriers Parcel tracker follows. ADR-0003 chose polling because only two
// of the five offer webhooks.

export const CARRIERS = ['swiftpost', 'northline', 'parcelbee', 'kestrel', 'blueroute'] as const;
export type Carrier = (typeof CARRIERS)[number];

// Webhooks are not used yet: every carrier is polled, these two included.
export const WEBHOOK_CARRIERS: readonly Carrier[] = ['swiftpost', 'kestrel'];
