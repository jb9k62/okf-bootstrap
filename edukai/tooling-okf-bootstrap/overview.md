---
type: Overview
title: Working in the okf-bootstrap repository
description: How to build, test and release the skill, and the traps that are easy to miss
tags: [overview, tooling, ci]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:35:00Z }
---

This repository is an npm workspace: two agent skills, their tools and their tests. If you
remember one command, make it `npm run check`, and run it before you finish. It typechecks the
tools and the widget workspace, runs the unit tests and the Chromium view tests, and validates
this repository's own `okf/` and `edukai/` bundles. One warning: the browser tests skip when
there is no Chromium, so a green run does not prove the views render.

The tools are TypeScript, and Node runs them directly by stripping the types. There is no
build step. That is why only erasable TypeScript is allowed, and why imports name the real
`.mts` extension. A scaffold copies the tools into a project's `scripts/`. This repository
does not: it runs them from `skills/okf-bootstrap/assets/`, so there is never a second copy to
fall behind.

Two things are easy to break by accident. First, the demo's memory lessons hold digests of
files under `examples/demo/`. Edit one of those files and a lesson changes state, and so does
a report that a test pins. Second, the release version is written in four places
(`package.json`, both plugin manifests and `bootstrap.mts`), and tests compare them.

Last, never edit the vendored OKF spec by hand. `npm run spec -- status` tells you whether
upstream has moved, and `npm run spec -- update` brings the new version in.

## Current understanding

- [Run npm run check before finishing](/tooling-okf-bootstrap/lessons/2026-10-08-run-npm-check.md)
- [The tools are TypeScript that Node runs with no build step](/tooling-okf-bootstrap/lessons/2026-10-08-typescript-runs-directly.md)
- [The demo's lessons pin digests of files under examples/demo](/tooling-okf-bootstrap/lessons/2026-10-08-demo-lessons-are-pinned.md)
- [The release version lives in four places that must match](/tooling-okf-bootstrap/lessons/2026-10-08-version-in-four-places.md)
- [The vendored OKF spec is refreshed with npm run spec, never by hand](/tooling-okf-bootstrap/lessons/2026-10-08-spec-is-vendored.md)

## Open questions

- None recorded yet.
