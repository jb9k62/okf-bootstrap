---
type: Lesson
title: The API never calls a carrier
description: The API only reads the store. Talking to carriers is the poller's job.
tags: [api, architecture]
confidence: observed
generated: { by: claude-code/opus-5.5, at: 2026-09-01T00:00:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-09-01T00:00:00Z }
stale_after: 2026-10-01T00:00:00Z
sources:
  - id: api
    resource: okf/parcel-tracker/api.md
    digest: sha256:2e32aed3299cbd5b
---

The API never calls a carrier: it only reads what the poller stored. A stale status on the page
means the poller is behind, not that the API failed.[^api]

## Caveats

- Read from the design bundle, not from API code: the demo has none.

[^api]: The API concept in the design bundle
