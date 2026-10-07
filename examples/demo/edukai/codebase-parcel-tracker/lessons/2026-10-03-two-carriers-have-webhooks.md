---
type: Lesson
title: Two of the five carriers offer webhooks
description: WEBHOOK_CARRIERS lists two carriers; the other three can only be polled.
tags: [carriers, webhooks]
confidence: observed
generated: { by: pi/deepseek-v4-flash, at: 2026-10-03T10:00:00Z }
verified:
  - { by: pi/deepseek-v4-flash, at: 2026-10-03T10:00:00Z }
stale_after: 2026-11-02T10:00:00Z
sources:
  - id: carriers
    resource: src/poller/carriers.ts
    digest: sha256:095930ea13bddf7b
check:
  - { file: src/poller/carriers.ts, matches: "WEBHOOK_CARRIERS[^=]*= \\['\\w+', '\\w+'\\]" }
---

Only two of the five carriers offer webhooks: `WEBHOOK_CARRIERS` lists two names, and the other
three can only be polled.[^carriers] It is why the poller exists.

[^carriers]: The carrier list
