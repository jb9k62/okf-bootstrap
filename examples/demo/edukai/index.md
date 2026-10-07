---
okf_version: "0.2"
---

# Parcel tracker: agent memory

What agents have learned while working on **Parcel tracker**, kept so the next session starts
knowing it. This is the demo's **memory bundle**: nine lessons in two domains, two of them
wrong on purpose so the re-check has something to find. The design bundle, written for the
team, is in `examples/demo/okf/`. The walkthrough is `examples/demo/README.md`.

## Domains

One line per domain, written by `npm run demo:edukai:brief`. Do not edit between the markers.

<!-- edukai:index -->
* [Parcel tracker's code](/codebase-parcel-tracker/overview.md) - How the poller, the report and the API behave, as agents have found them in the code
* [Parcel tracker's tooling](/tooling-parcel-tracker/overview.md) - How to run the tests and set up local data, and which old habits no longer work
<!-- /edukai:index -->

## How it is kept

- A **lesson** is one claim, with the files it rests on, in
  `<domain>/lessons/YYYY-MM-DD-short-claim.md`. Each domain has one `overview.md`.
- `npm run demo:edukai:recheck` lists the lessons that need an agent: a cited file is gone, a
  check no longer holds, a source changed, or the lesson is past its `stale_after`.
- A lesson that stopped being true is superseded by a new one, never edited or deleted.

Paths in a lesson's `sources` and `check` are from the demo's project root, `examples/demo/`.
The demo clock is `2026-10-15T00:00:00Z`.

Update history: [log.md](/log.md).
