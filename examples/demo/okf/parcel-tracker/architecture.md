---
type: Architecture
title: Architecture
description: The API, the poller, the store and the notifier, and how one status update flows through them.
tags: [architecture]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
verified:
  - { by: "human:sam", at: 2026-10-01T15:30:00Z }
---

# Architecture

Four parts, one database. The API serves customers; everything else happens in the poller,
which is the only part that talks to carriers.

```mermaid
flowchart LR
    C["Customer app"] -->|"GET /parcels/:id"| A["API"]
    A --> DB[("Postgres")]
    P["Poller"] -->|"poll, with backoff + jitter"| K["Carrier APIs"]
    P -->|"new events"| DB
    DB -->|"status changed"| N["Notifier"]
    N -->|"push, email"| C

    classDef ours fill:#e0e7ff,stroke:#3730a3,color:#1e1b4b
    classDef theirs fill:#fef3c7,stroke:#92400e,color:#3a2408
    classDef store fill:#dcfce7,stroke:#166534,color:#0f2417
    class A,P,N ours
    class C,K theirs
    class DB store
```

- **API**: read-mostly; see [API](/parcel-tracker/api.md).
- **Poller**: one loop per carrier. A failed poll is retried under the
  [retry policy](/parcel-tracker/retry-policy.md); a carrier that stays down follows the
  [runbook](/parcel-tracker/runbook-carrier-outage.md).
- **Store**: parcels and their tracking events, described in the
  [data model](/parcel-tracker/data-model.md).
- **Notifier**: sends one message per status change, never one per event.
