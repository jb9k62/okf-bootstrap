---
type: Overview
title: The okf-bootstrap codebase
description: The invariants the tools and adapters must keep, and why each one is load-bearing
tags: [overview, codebase, invariants]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:35:00Z }
---

okf-bootstrap is a handful of tools plus two harness adapters. Most of the design is in what
each file must not do, because each tool runs in a place with different constraints.

`okf-rank.mts` imports nothing at all. The viewer reads it, strips its types and inlines it
into `viz.html` as a plain script, so the same ranking serves the command line and the search
box. One import would break that. `okf-edukai-hook.mts` is almost as strict: only `node:`
built-ins and `./okf-rank.mts`, never `yaml` or `okf-core.mts`, because it runs from an
installed plugin where the project's `node_modules` may not exist and its output is put in
front of an agent.

The viewer is one generated file with no build step. Its ranking and the project's widget
bundle are inlined, while Cytoscape, marked, Mermaid and highlight.js load from a CDN pinned by
integrity hash. That mix is why the render gate needs network and the parse gate does not.

Both adapters resolve the hook core from `skills/okf-bootstrap/assets/`, so moving that file
breaks the pi extension and the Claude Code hook together. And the demo bundle pins every
registered widget to a tour, which a test enforces, so a new widget is not done until a demo
tour uses it.

## Current understanding

- [okf-rank.mts imports nothing so the viewer can inline it](/codebase-okf-bootstrap/lessons/2026-10-08-rank-has-no-imports.md)
- [okf-edukai-hook.mts imports only node: built-ins and okf-rank.mts](/codebase-okf-bootstrap/lessons/2026-10-08-hook-is-dependency-free.md)
- [The viewer loads its libraries from a pinned CDN](/codebase-okf-bootstrap/lessons/2026-10-08-viewer-uses-a-pinned-cdn.md)
- [The harness adapters resolve the memory hook from the skill assets](/codebase-okf-bootstrap/lessons/2026-10-08-adapters-resolve-from-assets.md)
- [Every registered widget must appear in a demo tour](/codebase-okf-bootstrap/lessons/2026-10-08-every-widget-has-a-tour.md)

## Open questions

- None recorded yet.
