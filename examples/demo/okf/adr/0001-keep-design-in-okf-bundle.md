---
type: Architectural Decision
title: "ADR-0001: Keep design knowledge in an OKF bundle"
description: Design docs live in okf/ next to the code, validated in CI, instead of a wiki.
tags: [adr, documentation]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

# ADR-0001: Keep design knowledge in an OKF bundle

- **Status:** accepted

## Context

Much of the code is written with agents. The team needs to understand it before building on
it, and the wiki had drifted from the code.

## Decision

Design knowledge lives in `okf/`, reviewed in the same pull requests as the code, and checked
by `okf:validate` and the render gates in CI. Tours with quizzes explain the parts people
keep getting wrong.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Wiki | Not reviewed with the code; drifted within months |
| READMEs only | No links between ideas, no place for decisions |
