---
type: Lesson
title: check-two-tests
description: A fixture.
confidence: inferred
generated: { by: test/1, at: 2026-10-01T00:00:00Z }
sources:
  - resource: src/a.ts
check:
  - { file: src/a.ts, contains: x, lacks: y }
---

One claim.
