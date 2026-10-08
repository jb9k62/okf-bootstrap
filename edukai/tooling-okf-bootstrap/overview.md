---
type: Overview
title: Working in the okf-bootstrap repository
description: How to build, test and release the skill, and the traps that are easy to miss
tags: [overview, tooling, ci]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:35:00Z }
---

This repository is an npm workspace holding two agent skills, their tools and their tests. The
one command that matters before finishing is `npm run check`: it typechecks the tools and the
widget workspace, runs the unit tests and the Chromium view tests, and validates this
repository's own `okf/` and `edukai/` bundles. The browser tests skip without Chromium, so a
green run does not prove the views render.

The tools are TypeScript that Node runs by type stripping. There is no build step, which is why
only erasable TypeScript is allowed and why imports name the real `.mts` extension. The
scaffold copies the tools into a project's `scripts/`; this repository runs them from
`skills/okf-bootstrap/assets/` instead, so a change is never left behind in a duplicate.

Two things are easy to break by accident. The demo's memory lessons pin digests of files under
`examples/demo/`, so editing one of those files changes a lesson's state and the report a test
pins. And the release version lives in four places (`package.json`, both plugin manifests and
`bootstrap.mts`), which tests compare. The vendored OKF spec is never hand-edited: `npm run
spec -- status` says whether it has moved upstream, and `npm run spec -- update` re-vendors it.

## Current understanding

- [Run npm run check before finishing](/tooling-okf-bootstrap/lessons/2026-10-08-run-npm-check.md)
- [The tools are TypeScript that Node runs with no build step](/tooling-okf-bootstrap/lessons/2026-10-08-typescript-runs-directly.md)
- [The demo's lessons pin digests of files under examples/demo](/tooling-okf-bootstrap/lessons/2026-10-08-demo-lessons-are-pinned.md)
- [The release version lives in four places that must match](/tooling-okf-bootstrap/lessons/2026-10-08-version-in-four-places.md)
- [The vendored OKF spec is refreshed with npm run spec, never by hand](/tooling-okf-bootstrap/lessons/2026-10-08-spec-is-vendored.md)

## Open questions

- None recorded yet.
