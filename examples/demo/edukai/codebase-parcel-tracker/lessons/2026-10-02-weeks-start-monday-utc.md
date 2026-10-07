---
type: Lesson
title: Report weeks start on Monday 00:00 UTC
description: weekStartUtc returns the Monday 00:00 UTC before a date, for every carrier and customer.
tags: [time, weeks, report]
confidence: tested
generated: { by: claude-code/opus-5.5, at: 2026-10-02T11:00:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-10-02T11:00:00Z }
stale_after: 2026-11-01T11:00:00Z
sources:
  - id: week
    resource: src/report/week.ts
    digest: sha256:502a9b050a17bfbb
  - id: adr
    resource: okf/adr/0002-weeks-on-the-utc-clock.md
    digest: sha256:2ab3745022cb0611
---

The weekly report groups by weeks that start on Monday 00:00 UTC. `weekStartUtc(date)` returns
that instant for any date, so a Monday morning east of UTC can still fall in the week
before.[^week] The decision and its cost are recorded in the design bundle.[^adr]

[^week]: The week function
[^adr]: ADR-0002 in the design bundle
