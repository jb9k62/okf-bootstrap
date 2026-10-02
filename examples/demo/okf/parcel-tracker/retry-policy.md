---
type: Reference
title: Retry policy
description: The retry settings a client uses when a call fails, and why each exists.
tags: [retries, reliability]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
stale_after: 2026-10-20T00:00:00Z
verified:
  - { by: "human:sam", at: 2026-10-01T15:30:00Z }
---

# Retry policy

| Setting | Value | Why |
| --- | --- | --- |
| Retries | 5 | Enough to ride out a restart, few enough to give up in under ten seconds (0.5 + 1 + 2 + 2 + 2 s, once the cap applies) |
| Base delay | 500 ms | The first wait; each later one doubles |
| Jitter | full | Spreads clients out, so a recovering server does not meet them all at once |
| Cap | 2 s per wait | Bounds how long a client can go quiet |

The poller in the [architecture](/parcel-tracker/architecture.md) uses it, as decided in
[ADR-0003](/adr/0003-full-jitter-retries.md). The [guided tour](/tours/retries-explainer.md)
explains each row with a widget.
