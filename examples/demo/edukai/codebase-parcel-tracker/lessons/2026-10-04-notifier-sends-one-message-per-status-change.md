---
type: Lesson
title: The notifier sends one message per status change
description: A customer gets one message when the status changes, not one per tracking event.
tags: [notifier]
confidence: inferred
generated: { by: claude-code/opus-5.5, at: 2026-10-04T08:45:00Z }
sources:
  - id: arch
    resource: okf/parcel-tracker/architecture.md
---

The notifier sends one message per status change, never one per tracking event, so a parcel
scanned three times in a depot produces no messages.[^arch]

## Caveats

- Deduced from one line of the architecture concept. There is no notifier code in the demo to
  read.

[^arch]: The architecture concept in the design bundle
