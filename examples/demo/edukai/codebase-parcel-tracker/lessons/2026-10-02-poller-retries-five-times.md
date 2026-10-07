---
type: Lesson
title: The poller retries a failed poll five times
description: A failed carrier poll is retried five times, with full jitter and a 2 s cap.
tags: [retries, poller]
confidence: tested
generated: { by: claude-code/opus-5.5, at: 2026-10-02T09:30:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-10-02T09:30:00Z }
stale_after: 2026-11-01T09:30:00Z
sources:
  - id: retry
    resource: src/poller/retry.ts
    digest: sha256:3319b24f6e7a7c8c
check:
  - { file: src/poller/retry.ts, contains: "RETRIES = 5" }
---

The poller retries a failed carrier poll five times. Each wait is full jitter over a capped
exponential delay: 500 ms base, 2 s cap.[^retry]

## Caveats

- The check covers the retry count only. The base delay and the cap are in the same file.

[^retry]: The retry settings and the delay function
