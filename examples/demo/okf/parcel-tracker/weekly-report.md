---
type: Metric
title: Weekly delivery report
description: On-time delivery rate per carrier, per UTC week.
tags: [metric, report, weeks]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
stale_after: 2026-09-01T00:00:00Z
---

# Weekly delivery report

**On-time rate** = parcels delivered by their promised date ÷ parcels due that week, per
carrier. Weeks run Monday 00:00 to Sunday 23:59:59.999 **UTC**
([ADR-0002](/adr/0002-weeks-on-the-utc-clock.md)), so a delivery at Monday 00:30 in
Johannesburg counts towards the previous week. The [weeks tour](/tours/week-explainer.md) has
a widget that shows why.

The events come from the [data model](/parcel-tracker/data-model.md); the report is served by
the [API](/parcel-tracker/api.md).

> [!warning] Past its review date
> This definition was due for review on 1 September. The viewer marks it stale until someone
> checks it and moves `stale_after` on.
