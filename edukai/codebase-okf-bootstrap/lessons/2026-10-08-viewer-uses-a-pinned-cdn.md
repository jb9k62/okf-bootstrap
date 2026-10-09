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

`viz.html` does not carry its big libraries. Cytoscape, marked, Mermaid and highlight.js load
from jsdelivr and cdnjs when the page opens. Each URL names an exact version and carries a
subresource-integrity hash, so a CDN file that has changed does not run. This is why the
render gate needs network access, and why it exits 2 without it. The ranking and the widget
bundle are handled differently: they are inlined, so the page stays one file with no build
step.

## Caveats

- To bump a library, change three things together: the URL, the integrity hash and the
  devDependency. `test/views.e2e.mts` serves the pinned versions from `node_modules` when
  they are installed, and fails when the two drift apart.
- The parse gate runs offline; the render gate cannot. Read exit 2 as "unproven", never as a
  pass.
