---
type: Reference
title: ADR template
description: Starting point for a new decision record.
tags: [adr, template]
generated: { by: okf-bootstrap/{{VERSION}}, at: {{NOW}} }
---

# ADR-NNNN: Short, action-oriented title

Copy to `/adr/NNNN-short-title.md`, set the frontmatter `type` to `Architectural Decision`, add
it to [Decision records](/adr/readme.md), and delete this paragraph and the next.

When this record replaces an earlier one, say so in the frontmatter of both, not in prose:
`supersedes: /adr/NNNN-old-title.md` here, and `status: deprecated` with
`superseded_by: /adr/NNNN-this-title.md` on the old one. `npm run okf:validate` checks that
the two name each other.

- **Status:** proposed | accepted | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** who made the call

## Context

The problem, the constraints, and why a decision is needed now.

## Decision

One or two sentences: "We will use X to achieve Y."

## Consequences

### Positive

- What this gains.

### Trade-offs

- What it costs. Future readers use this to judge when to revisit the decision.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Alternative A | Reason |
