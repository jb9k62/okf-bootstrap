---
type: Application
title: Parcel tracker
description: Follows parcels across courier companies and tells customers where their delivery is.
tags: [overview, parcels]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
verified:
  - { by: "human:sam", at: 2026-10-01T15:30:00Z }
---

# Parcel tracker

Customers paste a tracking number from any of the couriers we support, and Parcel tracker
shows one timeline: collected, in transit, out for delivery, delivered. It polls each courier
for new events, stores them, and notifies the customer when the status changes.

## What it does

- Accepts a tracking number and works out which carrier it belongs to.
- Polls each carrier's API on a schedule, following the [retry policy](/parcel-tracker/retry-policy.md)
  when a carrier fails, so a carrier outage does not turn into a stampede when it recovers.
- Stores every tracking event, and derives the parcel's current status from them (see the
  [data model](/parcel-tracker/data-model.md)).
- Publishes a [weekly delivery report](/parcel-tracker/weekly-report.md) of on-time rates per
  carrier.

## What it leaves out

- No booking or labels: it only tracks parcels that already exist.
- No carrier webhooks yet; polling is simpler to run and is covered by
  [ADR-0003](/adr/0003-full-jitter-retries.md).

## Reading paths

- New to the code: [architecture](/parcel-tracker/architecture.md), then the
  [API](/parcel-tracker/api.md).
- Changing how polling retries: the [retries tour](/tours/retries-explainer.md) first.
- Working on the report: the [weeks tour](/tours/week-explainer.md) and
  [ADR-0002](/adr/0002-weeks-on-the-utc-clock.md).
