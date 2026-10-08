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
`scripts/.okf-bootstrap.json`, and adds `okf:` npm scripts that run those copies.
`npm run okf:update` then compares the manifest against a release and refreshes them. The
copies are the product: a project that is not this repository has no other way to get the
tools.

This repository is the source of those files. It already keeps maintainer tools in `scripts/`
(`install-skill.mts`, `okf-spec.mts`, `screenshots.mts`), and its `npm run demo` already runs
the tools straight from `skills/okf-bootstrap/assets/`. Copying the tools in as well would
put a second copy of roughly ten thousand lines in the tree, refreshed from the originals on
every release.

## Decision

We will run this repository's own bundles with the tools where they live,
`skills/okf-bootstrap/assets/okf-*.mts`, and keep `scripts/` for maintainer tools only. The
repository gets no `scripts/okf-*.mts` copies, no `.okf-bootstrap.json` and no `okf:update`.

## Consequences

### Positive

- One copy of every tool: a change to `okf-view.mts` cannot leave a stale duplicate behind, and
  `npm run typecheck` checks the real file once.
- The repository's `scripts/` keeps a single, clear meaning, as AGENTS.md describes it.
- The self-hosted bundle is validated by exactly the code under review, which is the strongest
  form of dogfooding available here.

### Trade-offs

- This repository never exercises the copy-and-refresh path (`bootstrap.mts` writing
  `scripts/`, `okf:update` applying a release) on itself. The tests cover it in throwaway
  projects instead.
- The npm scripts name a path a scaffolded project does not have, so a reader comparing the
  two sees a difference that has to be explained, which is this record's job.
- If a tool is ever renamed or moved under `assets/`, the scripts here break at once; that is
  the intended early warning.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Full scaffold: copies in `scripts/` plus the manifest | Duplicates the tools and needs a refresh commit on every release; the copies would be the same files under a second name |
| Symlink `scripts/okf-*.mts` to the assets | Fragile across checkouts and platforms, and the manifest's hashes would describe a link rather than the content |
| A build step that generates the copies | Adds the build step the project deliberately does not have |
