---
type: Architectural Decision
title: "ADR-0002: Keep design docs and agent memory in two separate bundles"
description: Why okf/ and edukai/ stay apart, with different readers, units and rules.
tags: [adr, edukai, memory]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:00:00Z }
sources:
  - resource: skills/okf-bootstrap/SKILL.md
  - resource: skills/edukai/SKILL.md
  - resource: skills/okf-bootstrap/assets/okf-edukai.mts
---

# ADR-0002: Keep design docs and agent memory in two separate bundles

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** the maintainers

## Context

The skill scaffolds a design bundle, `okf/`, for people: one concept per topic, many claims,
reviewed before it is trusted. Agents also accumulate facts as they work: that a command has
a trap, that a file must not be edited, that a test pins an example. Those facts have a
different reader (the next agent, through harness hooks), a different unit (one claim with the
files it rests on), and a different trust rule (confirmed by a script or an agent, not by a
person).

Putting both in one bundle would force one set of rules onto two kinds of writing, and would
put agent-sized claims in front of a human reader who did not ask for them.

## Decision

We will keep the two kinds of knowledge in two OKF bundles: `okf/` for design docs written
for people, and `edukai/` for lessons written by agents for agents. They share the OKF format
and some machinery, and never share a folder.

## Consequences

### Positive

- Each bundle keeps the rules that fit it: the design bundle is short concepts and links, the
  memory bundle is one claim per lesson with a re-runnable check.
- The harness hooks can read the memory bundle without pulling the design bundle into every
  tool result, and `okf/` can be rendered for a person without lesson noise.
- The shared parts still work across both: a concept can carry `supersedes` /
  `superseded_by`, and `okf:recheck` reports a concept whose pinned `sources` changed.

### Trade-offs

- Two bundles to scaffold, index and keep current, and a writer has to decide which one a
  piece of knowledge belongs in.
- The demo has to carry both, which is why `examples/demo/` holds `okf/` and `edukai/` side by
  side.

## Alternatives considered

| Option | Why rejected |
|---|---|
| One bundle with a `type: Lesson` mixed in | The validator rules and the reader's expectations differ; a lesson in a design bundle either gets human-doc rules it cannot meet, or weakens them for everyone |
| Keep lessons outside OKF, as plain notes | Loses the digest pinning, the checks, the staleness rules and the ranked search that make a lesson worth trusting |
| One bundle per agent session | Memory that resets each session is not memory |
