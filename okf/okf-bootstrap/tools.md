---
type: Reference
title: The tools
description: One entry per script under assets/, what it does, and the rule it must keep.
tags: [tools, scripts, reference]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:15:00Z }
sources:
  - resource: skills/okf-bootstrap/assets/bootstrap.mts
  - resource: skills/okf-bootstrap/assets/okf-view.mts
  - resource: skills/okf-bootstrap/assets/okf-mermaid.mts
  - resource: skills/okf-bootstrap/assets/okf-search.mts
  - resource: skills/okf-bootstrap/assets/okf-core.mts
  - resource: skills/okf-bootstrap/assets/okf-rank.mts
  - resource: skills/okf-bootstrap/assets/okf-edukai.mts
  - resource: skills/okf-bootstrap/assets/okf-edukai-hook.mts
  - resource: skills/okf-bootstrap/assets/okf-start.mjs
  - resource: skills/okf-bootstrap/assets/okf-update.mts
  - resource: AGENTS.md
---

# The tools

Everything under `skills/okf-bootstrap/assets/` is TypeScript that Node 24 runs directly (type
stripping), except `okf-start.mjs`, which is plain JavaScript because it has to load before
anything can be stripped. A scaffold copies nine of these files into a project's `scripts/`
and records their hashes in `scripts/.okf-bootstrap.json`.

| File | What it does |
| --- | --- |
| `bootstrap.mts` | The scaffold: writes the bundle skeleton, copies the tools, edits `package.json`, writes the manifest. `--widgets`, `--edukai`, `--tools-only`, `--no-scripts`, `--force`. Not copied into projects |
| `okf-view.mts` | The validator and the viewer, and the render gate under `--check-render`. `--validate`, `--fix`, `--strict`, `--out`, `--widgets` |
| `okf-mermaid.mts` | The Mermaid parse gate: extracts every fenced `mermaid` block and runs it through `mmdc`. `--json`, `--timeout`, `--jobs` |
| `okf-search.mts` | Ranked, freshness-aware search over a bundle. Commands `facets`, `search`, `show`, `related`, `stale`; `--bundle`, `--json`, `--explain`, `--no-cache`, `--strict` |
| `okf-core.mts` | Parsing shared by the viewer and search: frontmatter, trust tier, staleness, links. Loads `yaml` on the first parse, so a search answered from its cache never loads it |
| `okf-rank.mts` | The ranking and its inverted index. Run by `okf-search`, and inlined into `viz.html` for the viewer's search box |
| `okf-edukai.mts` | The memory bundle's tool: `new`, `verify`, `supersede`, `index`, `recheck`. `verify`, `supersede` and `recheck` also work on a design bundle with `--bundle okf` |
| `okf-edukai-hook.mts` | What the harness adapters run (`brief`, `cites`, `debt`, `hook`) and the code that derives a lesson's state |
| `okf-start.mjs` | Loaded first by every npm script: turns on Node's compile cache, so a tool's TypeScript is stripped once and not on every run |
| `okf-update.mts` | Brings a project's generated tools up to a release. A dry run by default; `--apply` refuses on a dirty tree and keeps a script that was edited |

## The rules each must keep

These are not style preferences; each one is load-bearing, and the test suite enforces the
first two.

- **`okf-rank.mts` stays pure.** No imports, and nothing that touches `fs`, `path`, `process`
  or the DOM. The viewer inlines it into the page with its types stripped, so one ranking
  serves the CLI and the search box. An import here would either break the page or force a
  bundler ([ADR-0004](/adr/0004-viz-html-stays-one-file.md)).
- **`okf-edukai-hook.mts` stays dependency-free.** It imports only `node:` built-ins and
  `./okf-rank.mts`, never `okf-core.mts` or `yaml`, and never runs code from the project. It
  runs from an installed plugin where the project's `node_modules` may not exist, and its
  output is put in front of an agent. A test runs it outside the repository to prove it.
- **Tools stay dependency-light.** Nothing under `assets/` imports from outside `assets/`, and
  templates are resolved relative to the tool's own file, so a copy in a project's `scripts/`
  works the same as the original.
- **Erasable TypeScript only.** No enums, namespaces or parameter properties, and imports name
  the real `.mts` extension. `tsconfig.json` sets `erasableSyntaxOnly`, and the tools run with
  no build step.
- **`okf-start.mjs` stays plain.** No TypeScript and no imports beyond `node:` built-ins: a
  tool must still run without it, only slower.
- **Exit codes are the contract.** Every gate returns 0 (pass), 1 (broken, named by file) or
  2 (could not run). Never 0 when the check did not run; see
  [quality gates](/okf-bootstrap/gates.md).

## Why generated copies

A project receives copies rather than a dependency, so it can read and change them, and so the
tools keep working when this repository is not installed. `okf-update.mts` reads the manifest
to tell a generated file from one the project edited. This repository itself runs the tools
where they live instead ([ADR-0003](/adr/0003-run-the-tools-from-the-skill-assets.md)).
