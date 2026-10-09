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

A project's bundle is a folder of markdown. The viewer turns it into one `viz.html` that
anyone can open without installing anything. To do that, the page needs six things: a graph
library (Cytoscape), a markdown renderer (marked), Mermaid for diagrams, a syntax
highlighter, the ranking behind its search box, and any React widgets the project wrote.

The usual way to ship all that is an application with a build. But then every project would
need a build step before it could read its own docs, which is the opposite of what the skill
promises.

## Decision

We will keep `viz.html` a single generated file with no build step. Its parts reach the page
in two ways:

- **Inlined:** the ranking (`okf-rank.mts`) and the project's built widget bundle.
- **Loaded from a CDN:** Cytoscape, marked, Mermaid and highlight.js, each pinned to an exact
  version with a subresource-integrity hash, so a changed file does not run.

The viewer gets no bundler, and no network fetch beyond those four script tags.

## Consequences

### Positive

- A project reads its docs by opening one file. There is nothing to install and nothing to
  serve.
- The search box and `okf-search` run the same ranking from one source, because
  `okf-rank.mts` is inlined with its types stripped. That is why the file must stay pure,
  with no imports ([the tools](/okf-bootstrap/tools.md)).
- The integrity hashes turn a compromised CDN into a load failure, not a silent change.

### Trade-offs

- The page needs the network to load its libraries, so the render gate cannot run
  air-gapped. The parse gate can. Exit code 2 means "could not run", never "passed".
- The widget bundle has to be built before the viewer can inline it, so `okf:view` and
  `okf:mermaid:render` build the workspace first.
- The page is large, because it carries the ranking and the widgets.

## Alternatives considered

| Option | Why rejected |
|---|---|
| A bundler (Vite/Rollup) for the viewer | It adds a build step to every project that wants to read its own docs, and a toolchain to keep working |
| Vendor the libraries into the page | The output would be much larger, and every library upgrade would become a change to this repository instead of a pinned version |
| A small server that renders on demand | The bundle is meant to be shareable as one file, including from a checkout with no runtime |
