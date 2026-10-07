---
type: Architectural Decision
title: "ADR-0004: Agent memory in a second bundle"
description: What agents learn about Parcel tracker is kept as lessons in edukai/, beside the design bundle and apart from it.
tags: [adr, memory, agents]
generated: { by: example-agent/1.0, at: 2026-10-07T09:00:00Z }
---

# ADR-0004: Agent memory in a second bundle

- **Status:** accepted

## Context

Agents write much of Parcel tracker, and each session starts knowing nothing. The same facts
were being rediscovered: that CI runs `btest`, not `make`; that only two carriers have
webhooks. Worse, an agent that had been told something a week earlier could not know it had
since stopped being true.

The design bundle in `okf/` ([ADR-0001](/adr/0001-keep-design-in-okf-bundle.md)) is the wrong
place for this. It is written for the team and reviewed by people. A concept there covers one
topic and makes many claims, so no script can say which claim a changed file broke.

## Decision

Keep what agents learn in a second OKF bundle, `edukai/`, the **memory bundle**. Its unit is a
**lesson**: one claim, the files it rests on (pinned by a content digest), and where possible
a check that code can re-run. A tool derives each lesson's state from the files, and harness
hooks tell an agent about a lesson when it opens the file the lesson cites. The
[memory tour](/tours/memory-explainer.md) walks through it.

## Consequences

### Positive

- A lesson that has gone wrong is found by code, and named to the agent whose edit broke it.
- Both bundles are OKF v0.2, so one validator, one search and one viewer read both.

### Trade-offs

- Two bundles to keep apart. The rule: about how the system is designed, for people, goes in
  `okf/`; a fact an agent found out, for the next agent, goes in `edukai/`.
- The agent writes the lesson, its check and its first `verified` entry. A wrong lesson with a
  matching check stays fresh until a person reads it.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Lessons inside `okf/` | Different readers and rules. Hundreds of one-claim files would bury the design docs, and a team does not review each one |
| A wiki | Not next to the code, so nothing can check a claim against the file it is about |
| The harness's own memory files | One file per harness, in no shared format: nothing pins a claim to a file, and a lesson learned in one harness is invisible in the other |
