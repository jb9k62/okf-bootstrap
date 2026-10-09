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

The skill scaffolds a design bundle, `okf/`, for people. A concept there covers one topic,
makes many claims, and is reviewed before it is trusted.

Agents pick up a different kind of knowledge as they work: this command has a trap, that file
must not be edited, this test pins that example. These facts differ from design docs in three
ways:

- **The reader** is the next agent, reached through harness hooks.
- **The unit** is one claim, with the files it rests on.
- **The trust rule** is confirmation by a script or an agent, not review by a person.

One bundle would force one set of rules onto two kinds of writing. It would also put
agent-sized facts in front of a human reader who never asked for them.

## Decision

We will keep the two kinds of knowledge in two OKF bundles: `okf/` holds design docs written
for people, and `edukai/` holds lessons written by agents for agents. The two share the OKF
format and some machinery. They never share a folder.

## Consequences

### Positive

- Each bundle keeps the rules that fit it. The design bundle is short concepts and links. The
  memory bundle is one claim per lesson, with a check that can be run again.
- Each reader gets only what is theirs. The hooks read the memory bundle without pulling the
  design bundle into every tool result, and `okf/` renders for a person with no lesson noise.
- The shared machinery still works on both. A concept can carry `supersedes` and
  `superseded_by`, and `okf:recheck` reports a concept whose pinned `sources` changed.

### Trade-offs

- There are two bundles to scaffold, index and keep current, and a writer has to decide which
  one a piece of knowledge belongs in.
- The demo has to carry both, which is why `examples/demo/` holds `okf/` and `edukai/` side by
  side.

## Alternatives considered

| Option | Why rejected |
|---|---|
| One bundle with a `type: Lesson` mixed in | The validator's rules and the reader's expectations differ. A lesson in a design bundle either gets human-doc rules it cannot meet, or weakens those rules for everyone |
| Keep lessons outside OKF, as plain notes | That loses the digest pinning, the checks, the staleness rules and the ranked search, which are what make a lesson worth trusting |
| One bundle per agent session | Memory that resets each session is not memory |
