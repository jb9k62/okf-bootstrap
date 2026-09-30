---
type: Data Model
title: Data model
description: Carriers, parcels and tracking events, and how the current status is derived.
tags: [data-model, postgres]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
verified:
  - { by: "ci:schema-check", at: 2026-10-01T12:00:00Z }
stale_after: 2027-04-01T00:00:00Z
---

# Data model

```mermaid
erDiagram
    CARRIER ||--o{ PARCEL : carries
    PARCEL ||--o{ TRACKING_EVENT : has
    CARRIER {
        text id PK
        text name
        int poll_interval_s
    }
    PARCEL {
        uuid id PK
        text carrier_id FK
        text tracking_number
        text status
    }
    TRACKING_EVENT {
        uuid id PK
        uuid parcel_id FK
        timestamptz occurred_at
        text kind
    }
```

- A parcel's `status` is derived from its latest event by `occurred_at`, not by insert order:
  carriers often deliver events late and out of order.
- `occurred_at` is stored in UTC; the [weekly report](/parcel-tracker/weekly-report.md) groups
  by UTC week ([ADR-0002](/adr/0002-weeks-on-the-utc-clock.md)).
