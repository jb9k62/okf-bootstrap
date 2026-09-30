---
type: Architectural Decision
title: "ADR-0003: Capped backoff with full jitter"
description: The poller retries a failing carrier with exponential backoff, full jitter and a 2 s cap.
tags: [adr, retries, reliability]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

# ADR-0003: Capped backoff with full jitter

- **Status:** accepted

## Decision

Poll carriers, and on failure retry under the [retry policy](/parcel-tracker/retry-policy.md):
exponential backoff from 500 ms, full jitter, each wait capped at 2 s.

## Consequences

A carrier coming back from an outage sees a gradual rise in polls rather than every poller at
once. The [retries tour](/tours/retries-explainer.md) lets you switch each safeguard off.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Carrier webhooks | Only two of five carriers offer them |
| Fixed-interval retries | Every poller retries in lockstep after an outage |
