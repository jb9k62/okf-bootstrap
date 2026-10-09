---
type: Application
title: Overview
description: What okf-bootstrap ships, who it is for, and what it deliberately leaves out.
tags: [overview, skills, bundles]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:10:00Z }
sources:
  - resource: skills/okf-bootstrap/SKILL.md
  - resource: skills/edukai/SKILL.md
  - resource: README.md
  - resource: package.json
---

# Overview

okf-bootstrap is two agent skills, for [pi](https://pi.dev) and
[Claude Code](https://claude.com/claude-code), that set up and maintain knowledge bundles in
another project. It is not an application and has no runtime of its own. What ships is
markdown that tells an agent what to do, and a set of tools the agent runs in the target
project.

There are two bundles because there are two readers
([ADR-0002](/adr/0002-two-bundles-design-and-memory.md)):

| Bundle | Reader | Unit | Written when |
| --- | --- | --- | --- |
| `okf/` | the team, in a browser | a concept: one topic, many claims | the design changes |
| `edukai/` | the agent, through harness hooks | a lesson: one claim, with the files it rests on | an agent learns something |

## What ships

| Path | What it is |
| --- | --- |
| `skills/okf-bootstrap/` | The design-bundle skill: `SKILL.md`, the playbook and explainer guides, the vendored OKF spec, the tools and the templates |
| `skills/edukai/` | The memory-bundle skill: when a lesson is worth writing, how sure to be, and what to do with one that stopped being true |
| `skills/okf-bootstrap/assets/` | The tools (`okf-*.mts`, `okf-start.mjs`, `okf-update.mts`) and the templates a scaffold copies |
| `hooks/`, `extensions/` | The harness adapters: Claude Code hooks and a pi extension that read the memory bundle at the moments it matters |
| `scripts/` | Maintainer tools only: install the skill, refresh the vendored spec, regenerate screenshots |
| `test/` | Unit tests and Chromium end-to-end tests |
| `examples/demo/` | A made-up service documented with both bundles; the reference for a scaffolded project |
| `vendor/knowledge-catalog` | A git submodule pinning the upstream spec commit |

## What it leaves out

Each of these is a choice, not a gap.

- **No service and no library.** The tools are copied into the target project as
  `scripts/okf-*.mts` and run there. They read the project's own files and write `viz.html`
  next to the bundle. Nothing calls home.
- **No build step.** The tools are TypeScript that Node runs directly, so a project needs no
  compiler, and its `package.json` `"type"` is never changed. See
  [the tools](/okf-bootstrap/tools.md).
- **No hosted viewer.** `viz.html` is one self-contained file, and its libraries come from a
  pinned CDN ([ADR-0004](/adr/0004-viz-html-stays-one-file.md)).
- **No automatic writing.** The scaffold creates the skeleton and the gates. A person or an
  agent writes the concepts, and the skill's rule is that no claim goes in until it has been
  checked against the code.

## Reading on

- [Architecture](/okf-bootstrap/architecture.md): the parts and how a scaffolded project uses them
- [The tools](/okf-bootstrap/tools.md): one entry per script, and the rule each must keep
- [Quality gates](/okf-bootstrap/gates.md): the exit-code contract and what each gate proves
- [Testing and CI](/okf-bootstrap/testing.md): how this repository checks itself
