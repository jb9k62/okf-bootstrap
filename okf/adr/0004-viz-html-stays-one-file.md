---
type: Architectural Decision
title: "ADR-0004: Keep viz.html one self-contained file, with no bundler"
description: Why the viewer inlines the ranking and the widgets, loads its libraries from a pinned CDN, and never gains a build step.
tags: [adr, viewer, viz]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:00:00Z }
sources:
  - resource: skills/okf-bootstrap/assets/okf-view.mts
  - resource: skills/okf-bootstrap/assets/okf-rank.mts
  - resource: skills/okf-bootstrap/assets/templates/okf-widgets/package.json
---

# ADR-0004: Keep viz.html one self-contained file, with no bundler

- **Status:** accepted
- **Date:** 2026-10-08
- **Deciders:** the maintainers

## Context

A project's bundle is a folder of markdown; the viewer turns it into one `viz.html` that
someone can open without installing anything. The parts it needs are a graph library
(Cytoscape), a markdown renderer (marked), Mermaid for diagrams, a syntax highlighter, the
ranking that powers its search box, and any React widgets the project wrote.

Shipping that as an application with a build would mean every project needs a build step
before it can read its own docs, which is the opposite of what the skill promises.

## Decision

We will keep `viz.html` a single generated file with no build step. The ranking
(`okf-rank.mts`) and the project's built widget bundle are inlined into the page; Cytoscape,
marked, Mermaid and highlight.js load from a CDN, each pinned to an exact version with a
subresource-integrity hash so a changed file does not run. No bundler and no runtime network
fetch are added to the viewer itself.

## Consequences

### Positive

- A project reads its docs by opening one file; nothing to install, nothing to serve.
- `okf-rank.mts` is inlined with its types stripped, so the viewer's search box and
  `okf-search` run the same ranking from one source. That is why the file must stay pure, with
  no imports ([the tools](/okf-bootstrap/tools.md)).
- Pinned integrity hashes make a CDN compromise a load failure rather than a silent change.

### Trade-offs

- Diagrams need network access for Mermaid, so the render gate cannot run air-gapped; the
  parse gate can. Exit code 2 means "could not run", never "passed".
- The widget bundle has to be built before the viewer inlines it, so `okf:view` and
  `okf:mermaid:render` build the workspace first.
- The page is large, because it carries the ranking and the widgets.

## Alternatives considered

| Option | Why rejected |
|---|---|
| A bundler (Vite/Rollup) for the viewer | Adds a build step to every project that wants to read its own docs, and a toolchain to keep working |
| Vendor the libraries into the page | Much larger output, and every library upgrade becomes a change to this repository rather than a pinned version |
| A small server that renders on demand | The bundle is meant to be shareable as one file, including from a checkout with no runtime |
