---
type: Lesson
title: The viewer loads its libraries from a pinned CDN
description: Cytoscape, marked, Mermaid and highlight.js come from a CDN with integrity hashes, so the render gate needs network.
tags: [viewer, cdn]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:18Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:08:56Z }
stale_after: 2026-11-07T20:08:56Z
sources:
  - resource: skills/okf-bootstrap/assets/okf-view.mts
    digest: sha256:63fbc69d81627b43
  - resource: test/views.e2e.mts
    digest: sha256:0ea4c3e32eec1315
check:
  - { file: skills/okf-bootstrap/assets/okf-view.mts, contains: "cdn.jsdelivr.net/npm/mermaid@11.17.2" }
  - { file: skills/okf-bootstrap/assets/okf-view.mts, contains: 'integrity="sha384-' }
---

`viz.html` loads Cytoscape, marked, Mermaid and highlight.js from jsdelivr and cdnjs, each
pinned to an exact version and carrying a subresource-integrity hash, so a changed CDN file
does not run. That is why the render gate needs network access and exits 2 without it. The
ranking and the widget bundle are inlined instead, so the page stays one file with no build
step.

## Caveats

- Bumping a library means updating the URL, the integrity hash and the devDependency together.
  `test/views.e2e.mts` serves the pinned versions from `node_modules` when they are installed
  and fails on a drift between the two.
- The parse gate can run offline; the render gate cannot. Exit 2 is "unproven", not a pass.
