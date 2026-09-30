---
type: Playbook
title: "Runbook: a carrier is down"
description: What to check and do when one carrier's API keeps failing.
tags: [runbook, operations]
status: draft
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

# Runbook: a carrier is down

1. Confirm it is the carrier, not us: other carriers' polls are succeeding.
2. Do nothing to the poller. The [retry policy](/parcel-tracker/retry-policy.md) already backs
   off with jitter, so the carrier will not be flooded when it comes back.
3. If it has been down for over an hour, show a banner for that carrier's parcels.
4. When it recovers, watch the poll success rate; it should climb gradually, not spike.

See the [architecture](/parcel-tracker/architecture.md) for where the poller sits.
