---
type: Explainer
title: "Guided tour: which week is it?"
description: "Why a week that starts at Monday 00:00 UTC puts some local Mondays in the previous week, with a widget to scrub time across zones."
tags: [explainer, guided-tour, time, weeks]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
cast: [Amira, Lee, Sam]
cast_source: ../cast.json
---

A short tour for anyone who groups data by week. The
[weekly delivery report](/parcel-tracker/weekly-report.md) uses weeks on the UTC clock
([ADR-0002](/adr/0002-weeks-on-the-utc-clock.md)), so a week starts at the same instant for
everyone. After this tour, you will know why a local Monday can still count as last week. A
[quiz](#quiz) closes it.

## Who is affected

| Person | Where | What the week boundary means to them |
| --- | --- | --- |
| **Amira**, a customer | Johannesburg | Got a parcel on Monday morning: surely this week's |
| **Lee**, an analyst | New York | Reads the report on Monday, and expects last week's total to be final |
| **Sam**, on call | Auckland | Is asked on Tuesday why a number changed |

Each is right by their own clock. The report must pick one clock for all.

## Background

> [!definition] UTC week
> Monday 00:00 to Sunday 23:59:59.999, on the UTC clock.

> [!definition] Instant
> One moment in time, the same everywhere. "Monday 00:30 in Johannesburg" and "Sunday 22:30
> UTC" are one instant.

## The problem, one step at a time

1. **Amira gets her parcel at 00:30 on Monday, Johannesburg time.** The scan is stored as one
   instant.
2. **The report converts it to UTC.** There, it is Sunday 22:30.
3. **So it counts towards last week.** *Amira* thinks it is this week's. *Lee* sees it in last
   week's total.
4. **Each customer's own clock would be worse.** The same Monday could fall in different
   weeks for different people, and no two totals would agree. *Sam* would be explaining that
   on Tuesday.

The cost: a confusing few hours each Monday. The gain: one answer for everyone.

## Try it, in three steps

The widget shows UTC days above local days for the zone you pick. The blue band is the
instant's week.

1. **Amira's delivery.** The first preset, **Monday 00:30 in Johannesburg**, is her parcel.
   The marker is on Monday locally, but on Sunday in UTC. The week follows UTC.
2. **Lee's evening.** Click **Sunday evening in New York**. It is Sunday for Lee, but already
   Monday in UTC, so it counts towards the *next* week.
3. **Sam's edge cases.** Click **Sunday 23:59:59.999 UTC**: the last millisecond of a week.
   Then **New Year in Auckland**: a week that spans 1 January.

```widget
utc-week
```

> [!tip] What to notice
> The week follows the UTC row. Zones ahead of UTC (Johannesburg) reach Monday before the week
> turns. Zones behind it (New York) reach the new week on Sunday evening.

## Quiz

```quiz
It is Monday 00:30 in Johannesburg (UTC+2). Which week does an answer given now count towards?
- [ ] This week, because it is Monday
~ It is Monday locally. In UTC it is still Sunday 22:30.
- [x] Last week, because the UTC week has not turned over yet
~ The week turns at Monday 00:00 UTC, which is 02:00 in Johannesburg.
---
It is Sunday 21:30 in New York (UTC-4). Which week is it?
- [ ] This week, because it is still Sunday locally
~ Locally it is Sunday; in UTC it is already Monday 01:30.
- [x] Next week, because Monday has started in UTC
~ Zones behind UTC reach the new week on Sunday evening.
```
