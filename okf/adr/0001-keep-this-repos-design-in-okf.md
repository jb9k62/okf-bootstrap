---
type: Architectural Decision
title: "ADR-0001: Keep this repository's design knowledge in an OKF bundle"
description: Why okf-bootstrap documents itself with the tooling it ships, and what that replaced.
tags: [adr, documentation, dogfooding]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:00:00Z }
sources:
  - resource: AGENTS.md
  - resource: README.md
  - resource: CHANGELOG.md
---

# ADR-0001: Keep this repository's design knowledge in an OKF bundle

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** the maintainers

## Context

okf-bootstrap ships a skill that scaffolds an OKF bundle into other projects, and a demo
bundle that shows what one looks like. It had no bundle of its own: the repository's design
knowledge lived in `README.md`, `AGENTS.md` and `CHANGELOG.md`, and the reasoning behind the
tools existed only in the code, the tests and the git history.

That is the situation the skill exists to fix. The tools are large (the viewer alone is over
four thousand lines), agents write most of the changes, and a person arriving at the
repository has to reconstruct why the pieces are shaped the way they are. Shipping a
documentation tool and not using it is also the weakest possible test of it: the demo proves
the format renders, not that it is worth writing.

## Decision

We will keep this repository's design knowledge in an `okf/` bundle at the repository root,
validated and rendered by the same tools the skill scaffolds, and we will record the choices
behind the tooling here rather than only in commit messages.

## Consequences

### Positive

- The skill is exercised on a real, non-fictional bundle that changes with the code, so a
  defect in the format or the validator shows up here first.
- The bundle's claims are checked against the code by the same writing checklist the skill
  gives other projects, including the rule that no claim goes in unchecked.
- `npm run okf:validate` and the memory re-check run in this repository's CI, so the bundle
  cannot rot silently.

### Trade-offs

- The bundle is another thing to keep current when the tools change, and a stale concept is
  worse than none. The `okf:recheck` gate is what keeps that honest.
- The repository's own commands differ from a scaffolded project's: the tools run from
  `skills/okf-bootstrap/assets/`, not from copies under `scripts/`
  ([ADR-0003](/adr/0003-run-the-tools-from-the-skill-assets.md)).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Leave documentation in README and AGENTS.md | Those files are instructions and a summary; neither is a place for the reasoning behind a decision, and neither is checked for broken links or stale claims |
| A wiki or a docs site | Separated from the code and from review, so it drifts; the skill's own guidance is that design docs live next to the code and are reviewed like code |
| Documentation inside the demo bundle | The demo is fictional and its claims are pinned by tests; mixing the real repository into it would blur both |
