---
type: Architectural Decision
title: "ADR-0002: Weeks run on the UTC clock"
description: The weekly report groups by ISO week in UTC, not by each customer's local week.
tags: [adr, time, weeks]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

# ADR-0002: Weeks run on the UTC clock

- **Status:** accepted

## Decision

A week is Monday 00:00 to Sunday 23:59:59.999 **UTC**, for every carrier and every customer.
The [weekly report](/parcel-tracker/weekly-report.md) uses it.

## Consequences

One week means the same instant everywhere, so weeks can be compared across carriers. The
cost: for a few hours each Monday, the local calendar and the week disagree. The
[weeks tour](/tours/week-explainer.md) shows it with a widget.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Each carrier's local week | Weeks overlap across carriers; totals double count |
