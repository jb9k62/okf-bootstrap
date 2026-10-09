---
type: Architectural Decision
title: "ADR-0003: Run the tools from the skill's assets, not generated copies"
description: Why this repository's npm scripts point at skills/okf-bootstrap/assets/ instead of copying tools into scripts/.
tags: [adr, tooling, self-hosting]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:00:00Z }
sources:
  - resource: package.json
  - resource: skills/okf-bootstrap/assets/bootstrap.mts
  - resource: AGENTS.md
---

# ADR-0003: Run the tools from the skill's assets, not generated copies

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** the maintainers

## Context

In a scaffolded project, `bootstrap.mts` copies the tools to `scripts/okf-*.mts`, writes
`scripts/.okf-bootstrap.json`, and adds `okf:` npm scripts that run those copies. Later,
`npm run okf:update` compares the manifest against a release and refreshes them. There, the
copies are the product: a project that is not this repository has no other way to get the
tools.

This repository is different, because it is where those files come from. It already keeps
its maintainer tools in `scripts/` (`install-skill.mts`, `okf-spec.mts`, `screenshots.mts`),
and `npm run demo` already runs the tools straight from `skills/okf-bootstrap/assets/`.
Scaffolding into this repository would add a second copy of roughly nine thousand lines, to
be refreshed from the originals on every release.

## Decision

We will run this repository's own bundles with the tools where they live,
`skills/okf-bootstrap/assets/okf-*.mts`, and keep `scripts/` for maintainer tools only. The
repository gets no `scripts/okf-*.mts` copies, no `.okf-bootstrap.json` and no `okf:update`.

## Consequences

### Positive

- There is one copy of every tool. A change to `okf-view.mts` cannot leave a stale duplicate
  behind, and `npm run typecheck` checks the real file once.
- `scripts/` keeps one clear meaning, the one AGENTS.md gives it: maintainer tools.
- The bundle here is validated by exactly the code under review. That is the strongest form
  of dogfooding available.

### Trade-offs

- This repository never runs the copy-and-refresh path on itself (`bootstrap.mts` writing
  `scripts/`, `okf:update` applying a release). The tests cover that path in throwaway
  projects instead.
- The npm scripts name a path a scaffolded project does not have. Anyone comparing the two
  will see the difference and need it explained, which is this record's job.
- If a tool is ever renamed or moved under `assets/`, the scripts here break at once. That is
  the early warning we want.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Full scaffold: copies in `scripts/` plus the manifest | It duplicates the tools and needs a refresh commit on every release. The copies would be the same files under a second name |
| Symlink `scripts/okf-*.mts` to the assets | Symlinks are fragile across checkouts and platforms, and the manifest's hashes would describe a link, not the content |
| A build step that generates the copies | It adds the build step this project has chosen not to have |
