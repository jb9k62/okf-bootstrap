---
type: Reference
title: The viewer
description: How one viz.html is built, what it inlines, and what it loads from a CDN.
tags: [viewer, viz, search]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:20:00Z }
sources:
  - resource: skills/okf-bootstrap/assets/okf-view.mts
  - resource: skills/okf-bootstrap/assets/okf-rank.mts
  - resource: skills/okf-bootstrap/assets/templates/okf-widgets/README.md
  - resource: test/views.e2e.mts
---

# The viewer

`okf-view.mts` walks a bundle, checks it, builds a graph of its concepts, and writes one
`viz.html` next to the bundle (or wherever `--out` says). The file is generated, so it is
gitignored. A project builds it again with `npm run okf:view`.

## One file, two sources of content

The page is one file, but its parts arrive in two ways
([ADR-0004](/adr/0004-viz-html-stays-one-file.md)):

- **Inlined when the page is generated.** The viewer reads the ranking (`okf-rank.mts`) from
  beside the tool, strips its types with Node's `stripTypeScriptTypes`, and removes its
  `export ` prefixes so it runs as a plain script. The project's built widget bundle is
  inlined the same way. Both are guarded against a literal `</script` in the source, which
  would end the block early.
- **Loaded from a CDN when the page opens.** Cytoscape (the graph), marked (markdown), Mermaid
  (diagrams) and highlight.js load from jsdelivr and cdnjs. Each is pinned to an exact version
  with a subresource-integrity hash, so a changed file does not run. This is why the render
  gate needs network access.

Inlining the ranking puts one demand on it: `okf-rank.mts` must stay pure, with no imports. It
has to be valid as a plain script in the page and as a module in Node. In return, one ranking
serves both `okf-search` and the search box, so the two cannot disagree.

## The widget bundle

A ` ```widget ` block names a widget registered in the project's `packages/okf-widgets`. The
viewer mounts it by calling the bundle's `mount(element, name, source)`, passing whatever
follows the name in the block. The bundle is inlined so the page stays one file. Its default
path is `packages/okf-widgets/dist/okf-widgets.js` relative to the tool, and `--widgets`
overrides that.

A widget that cannot mount never leaves a blank space. Without a built bundle, the block
shows a build hint. With an unknown name, it lists the registered ones.

The template package ships ten worked example widgets, each with a pure model and a test. Once
scaffolded, it is the project's code: the examples are there to learn from, and a project
writes its own widgets beside them.

## What the page does

- **A concept graph with a reading pane.** Nodes are sized by incoming links, and selecting
  one focuses its neighbours. Layouts switch between graph, tree and table, and colour
  switches between type, trust and freshness.
- **Ranked search in a modal**, with the same ranking as `okf-search`: results on the left, a
  preview on the right, with type, trust and freshness filters and a plain "contains" mode.
- **Mermaid diagrams**, rendered one at a time. A diagram that fails shows a visible error
  and its source. Each has pan/zoom controls, which the render gate checks are wired.
- **Callouts** (`> [!definition] Term`), click-to-check quizzes, and widgets.
- **Deep links.** Headings have ids and the URL hash names the concept (`#slug/concept`), so
  Back and reload land on the right one. The page title comes from the bundle's `index.md`
  H1.
- **Small comforts.** A theme that follows the system setting and is remembered, an IDE-style
  status bar with reading progress, and raw-path link text replaced by the linked concept's
  title.

## Versions

The viewer implements OKF v0.2. It reports the version a bundle declares and adds a note when
the two differ. It does not refuse another version; it reads it as best it can.

It pins Mermaid 11, and `okf-mermaid.mts` must stay on the same major. That way a diagram one
accepts is a diagram the other accepts.
