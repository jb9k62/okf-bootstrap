---
type: Overview
title: Parcel tracker's code
description: How the poller, the report and the API behave, as agents have found them in the code
tags: [overview, poller, report]
generated: { by: claude-code/opus-5.5, at: 2026-10-04T17:00:00Z }
---

Parcel tracker follows parcels across five carriers. Almost everything that can go wrong
happens in the **poller**, the only part that talks to a carrier. The API only reads what the
poller stored, so a stale status on the page means the poller is behind.

The poller asks each carrier for news and treats a slow or failed answer as a failed poll. A
failed poll is retried a fixed number of times, each wait drawn at random under a capped
exponential delay, so pollers that failed together do not come back together. Polling exists
at all because most carriers cannot push: only two of the five offer webhooks.

The weekly report has one rule that surprises people: a week starts on Monday 00:00 **UTC**,
for everyone. A parcel delivered on a Monday morning east of UTC can count towards the week
before.

The settings live in `src/poller/` and `src/report/`. The design bundle (`okf/`) explains
why each was chosen; these lessons record what the code does today.

## Current understanding

- [The poller retries a failed poll five times](/codebase-parcel-tracker/lessons/2026-10-02-poller-retries-five-times.md)
- [The poller times out a carrier call after ten seconds](/codebase-parcel-tracker/lessons/2026-10-03-poller-timeout-is-ten-seconds.md)
- [Two of the five carriers offer webhooks](/codebase-parcel-tracker/lessons/2026-10-03-two-carriers-have-webhooks.md)
- [Report weeks start on Monday 00:00 UTC](/codebase-parcel-tracker/lessons/2026-10-02-weeks-start-monday-utc.md)
- [The API never calls a carrier](/codebase-parcel-tracker/lessons/2026-09-01-api-never-calls-a-carrier.md)

## Open questions

- Does the notifier really send one message per status change? It is
  [inferred](/codebase-parcel-tracker/lessons/2026-10-04-notifier-sends-one-message-per-status-change.md)
  from the architecture concept; nobody has read notifier code or watched it run.
- What happens to a poll after the fifth retry fails: is it dropped, or queued for the next
  schedule?
