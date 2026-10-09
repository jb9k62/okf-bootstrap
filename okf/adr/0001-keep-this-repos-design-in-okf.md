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
bundle that shows what one looks like. It had no bundle of its own. What the repository knew
about its own design was spread across `README.md`, `AGENTS.md` and `CHANGELOG.md`, and the
reasons behind the tools lived only in the code, the tests and the git history.

That is the very problem the skill exists to fix. The tools are large (the viewer alone is
over four thousand lines), and agents write most of the changes. Someone new to the
repository has to work out for themselves why each piece has the shape it has.

There is a second problem. A documentation tool that its own authors do not use has barely
been tested. The demo proves the format renders. It does not prove the format is worth
writing in.

## Decision

We will keep this repository's design knowledge in an `okf/` bundle at the repository root.
The same tools the skill scaffolds will validate and render it. The choices behind the
tooling will be recorded here, and not only in commit messages.

## Consequences

### Positive

- The skill is used on a real bundle that changes with the code, so a defect in the format or
  the validator shows up here first.
- The bundle is written to the same checklist the skill gives other projects, including its
  first rule: no claim goes in until it has been checked against the code.
- `npm run check` validates both bundles, and CI runs it. A broken link or a missing `type`
  fails the build, so the bundle's shape cannot rot unnoticed.

### Trade-offs

- The bundle is one more thing to keep current when the tools change, and a stale concept is
  worse than none. Validation checks a concept's shape, not whether it is still true.
  `npm run okf:recheck` can report a concept whose pinned sources have changed, but no concept
  here is pinned yet. Until one is, catching a stale concept is a reviewer's job.
- The commands here differ from a scaffolded project's. The tools run from
  `skills/okf-bootstrap/assets/`, not from copies under `scripts/`
  ([ADR-0003](/adr/0003-run-the-tools-from-the-skill-assets.md)).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Leave documentation in README and AGENTS.md | Those files hold instructions and a summary. Neither is a place for the reasoning behind a decision, and neither is checked for broken links or stale claims |
| A wiki or a docs site | It sits apart from the code and from review, so it drifts. The skill's own advice is that design docs live next to the code and are reviewed like code |
| Documentation inside the demo bundle | The demo is made up, and tests pin its claims. Mixing the real repository into it would blur both |
