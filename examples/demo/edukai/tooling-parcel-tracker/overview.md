---
type: Overview
title: Parcel tracker's tooling
description: How to run the tests and set up local data, and which old habits no longer work
tags: [overview, testing, tooling]
generated: { by: claude-code/opus-5.5, at: 2026-09-10T15:00:00Z }
---

The tests run through `btest`, in CI and locally. CI calls `btest run --shard auto`.
`make test` still works, but it is only a wrapper that calls `btest run`, so use `btest`
directly.

An earlier lesson said the tests ran through `make`. It was true of the Makefile and wrong
about CI. It is kept, marked deprecated, with a pointer to the lesson that replaced it: the
history of what was believed is part of the memory.

For local data there is a seed script that loads a few sample parcels.

## Current understanding

- [CI runs tests via btest, not make](/tooling-parcel-tracker/lessons/2026-08-23-ci-runs-tests-via-btest.md),
  which replaced
  [Tests run via make test](/tooling-parcel-tracker/lessons/2026-08-20-tests-run-via-make.md)
- [The seed script loads sample parcels](/tooling-parcel-tracker/lessons/2026-09-10-seed-script-loads-sample-parcels.md)

## Open questions

- Is there a way to run one shard locally, to reproduce a CI failure?
