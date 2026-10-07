---
type: Lesson
title: The poller times out a carrier call after ten seconds
description: One carrier response may take up to ten seconds before the poll counts as failed.
tags: [poller, timeouts]
confidence: observed
generated: { by: pi/deepseek-v4-flash, at: 2026-10-03T14:20:00Z }
verified:
  - { by: pi/deepseek-v4-flash, at: 2026-10-03T14:20:00Z }
stale_after: 2026-11-02T14:20:00Z
sources:
  - id: config
    resource: src/poller/config.ts
    digest: sha256:9713487bf06c85ec
check:
  - { file: src/poller/config.ts, contains: "TIMEOUT_MS = 10_000" }
---

The poller waits up to ten seconds for one carrier response before it counts the poll as failed
and the retry policy takes over.[^config]

[^config]: The poller settings
