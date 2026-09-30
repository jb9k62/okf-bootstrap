---
type: Explainer
title: "Guided tour: which week is it?"
description: "Why a week that starts at Monday 00:00 UTC puts some local Mondays in the previous week, with a widget to scrub time across zones."
tags: [explainer, guided-tour, time, weeks]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

A short tour for anyone who groups data by week. When a week is defined on the UTC clock, it
starts at the same instant for everyone, which is the point, and it is how the
[weekly delivery report](/parcel-tracker/weekly-report.md) counts
([ADR-0002](/adr/0002-weeks-on-the-utc-clock.md)). It also means the local calendar
and the week can disagree for a few hours each Monday.

## Intuition

> [!definition] UTC week
> The seven days from Monday 00:00 to Sunday 23:59:59.999, measured on the UTC clock.

The widget draws the UTC days above the local days for the zone you pick. The blue band is
the week the instant falls in. Pick **Monday 00:30 in Johannesburg** and compare the two rows.

```widget
utc-week
```

> [!tip] What to notice
> The marker sits on a Monday in the local row and on a Sunday in the UTC row. The week follows
> the UTC row, so this Monday belongs to last week.

## Quiz

```quiz
It is Monday 00:30 in Johannesburg (UTC+2). Which week does an answer given now count towards?
- [ ] This week, because it is Monday
~ It is Monday on the local clock. On the UTC clock it is still Sunday 22:30.
- [x] Last week, because the UTC week has not turned over yet
~ The week turns over at Monday 00:00 UTC, which is 02:00 in Johannesburg.
---
It is Sunday 21:30 in New York (UTC-4). Which week is it?
- [ ] This week, because it is still Sunday locally
~ Locally it is Sunday; in UTC it is already Monday 01:30.
- [x] Next week, because Monday has started in UTC
~ Zones behind UTC reach the new week on Sunday evening.
```
