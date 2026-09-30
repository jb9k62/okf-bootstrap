# okf-bootstrap

[![ci](https://github.com/jb9k62/okf-bootstrap/actions/workflows/ci.yml/badge.svg)](https://github.com/jb9k62/okf-bootstrap/actions/workflows/ci.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
![node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933.svg)

**Design docs your agents write, and your team can actually follow.** An agent skill for
[pi](https://pi.dev) and [Claude Code](https://claude.com/claude-code) that sets up an
[OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(Open Knowledge Format) knowledge bundle in any project: plain markdown next to the code,
checked like code, and rendered as one self-contained page with a concept graph, diagrams,
and interactive explainers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/viewer-dark.png">
  <img alt="The OKF viewer: a graph of the bundle's concepts on the left, coloured by type, and the Architecture concept open on the right with its human-reviewed badge and a Mermaid diagram with pan and zoom controls" src="docs/images/viewer-light.png">
</picture>

<sub>The viewer on the [demo bundle](examples/demo/okf): a fictional parcel-tracking service
with 13 concepts. Every internal link is an edge; the selected concept's neighbours stay lit.</sub>

## What you get

| | |
| --- | --- |
| **A doc pack** | `okf/` with an index, a dated log, decision records (ADRs) and concept folders, plus templates for concepts and guided tours |
| **A validator** | Every concept has a type, every internal link resolves, every timestamp is a real datetime; trust tiers (unverified, human-reviewed) and staleness derived from frontmatter |
| **A viewer** | One `viz.html` with no build step: searchable graph with switchable layouts, tree and table views, a neighbourhood focus, colouring by type, trust or freshness, reading pane, Mermaid diagrams with pan and zoom, light and dark themes, deep links |
| **Quality gates** | Diagrams parsed by the real Mermaid parser, then rendered in headless Chromium, with quizzes and widgets clicked; one exit-code contract (0 pass, 1 broken, 2 could not run) |
| **Interactive explainers** | Callouts, click-to-check quizzes, and React widgets that let a reader change the inputs and watch the system respond |

## Explainers that teach

Agents now write code faster than people can absorb it. Geoffrey Litt's
["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck.html)
argues for using the agent to build understanding too: explainer docs that go background,
intuition, details; **quizzes** as a speed regulator ("I won't send code to others until I can
pass the quiz"); and **micro-worlds** where you learn a system by living in it. This skill
makes all three first-class in the bundle.

**Widgets** are small React simulations embedded in a concept with a ` ```widget ` block. The
best ones let the reader switch off a safeguard and see what breaks. Here, a hundred clients
retry after an outage: without jitter every round lands as one spike; with it, the same
retries spread out and the peak drops to about a quarter.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/widget-herd-dark.png">
        <img alt="The retry widget with no jitter: five thin spikes, 100 retries at once, and a warning that every client retries in lockstep" src="docs/images/widget-herd-light.png">
      </picture>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/widget-jitter-dark.png">
        <img alt="The same widget with full jitter: retries spread across the timeline, and a worst case of 23 at once" src="docs/images/widget-jitter-light.png">
      </picture>
    </td>
  </tr>
  <tr>
    <td align="center"><sub>No jitter: the thundering herd</sub></td>
    <td align="center"><sub>One click later: full jitter</sub></td>
  </tr>
</table>

**Quizzes** are a ` ```quiz ` block: a question, options, one marked correct, and feedback on
every option that points back at the idea. The viewer scores them as you go.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/quiz-dark.png">
  <img alt="A quiz question after a wrong answer: the chosen option in red, the right one in green, and feedback explaining why" src="docs/images/quiz-light.png" width="640">
</picture>

````markdown
```quiz
A hundred clients use exponential backoff with no jitter. What does the server see?
- [ ] A steady trickle of retries
~ Longer waits space out the rounds. Within each round, every client computed the same delay.
- [x] A spike of all the clients at once, in every round
~ Every client started at the same instant with the same policy.
```
````

The two example widgets come with their models and tests, a small kit for building your own,
and a render gate that clicks every widget to prove it responds. See
[EXPLAINERS.md](skills/okf-bootstrap/references/EXPLAINERS.md) for how to write tours,
quizzes and widgets that teach.

## Install

Node 24+ is required: the tools are TypeScript that Node runs directly, with no build step.

**pi**, as a package (pin a tag for reproducible installs):

```bash
pi install git:github.com/jb9k62/okf-bootstrap@v0.3.0
```

**Claude Code**, as a plugin from this repo's marketplace:

```text
/plugin marketplace add jb9k62/okf-bootstrap
/plugin install okf-bootstrap@okf-bootstrap
```

or by cloning straight into your skills directory, where it loads as a local plugin:

```bash
git clone https://github.com/jb9k62/okf-bootstrap ~/.claude/skills/okf-bootstrap
```

**Anywhere else**: clone, then link the skill into every agent you use. A `git pull` then
updates them all.

```bash
git clone https://github.com/jb9k62/okf-bootstrap && cd okf-bootstrap
npm run install-skill     # ~/.claude/skills and ~/.pi/agent/skills; --claude, --pi, --agents, --copy
```

## Quick start

In the project you want documented, ask your agent:

> Bootstrap an okf for this project, with widgets.

> Write a guided tour of this change with a quiz, and a widget that shows how the cache
> expires.

Or invoke it directly (`/skill:okf-bootstrap` in pi, `/okf-bootstrap` in Claude Code), or run
the scaffold yourself:

```bash
node path/to/okf-bootstrap/skills/okf-bootstrap/assets/bootstrap.mts . --name "My App" --widgets
npm install
npm install -D @mermaid-js/mermaid-cli@11 playwright && npx playwright install chromium

npm run okf:validate        # types, links, timestamps: expect 0 issues
npm run okf:view            # writes okf/viz.html; open it in a browser
npm run okf:mermaid         # every diagram parses
npm run okf:mermaid:render  # every diagram renders, every quiz and widget works
```

Re-running the scaffold is safe: it keeps everything you wrote and refreshes only the tools.

## How it works

```text
your-project/
├── okf/
│   ├── index.md              # the bundle's front page (okf_version: "0.2")
│   ├── log.md                # dated update history
│   ├── adr/                  # decision records: readme, template, 0001-...
│   ├── design/               # working design notes
│   └── <your-app>/           # concepts: overview, architecture, data model, API, tours
├── scripts/
│   ├── okf-view.mts          # validator + viewer + render gate
│   └── okf-mermaid.mts       # Mermaid parse gate
├── packages/okf-widgets/     # with --widgets: your React widgets (an npm workspace)
├── okf-concept-template.md   # authoring aids, outside the bundle
└── okf-explainer-template.md
```

A concept is markdown with a little YAML frontmatter; only `type` is required:

```markdown
---
type: Architecture
title: Architecture
description: The parts and how one status update flows through them.
generated: { by: my-agent/1.0, at: 2026-10-01T09:00:00Z }
---
```

Every gate exits **0** when everything checked is fine, **1** when something is broken (the
file and line are named), and **2** when it could not run at all (no browser, CDN
unreachable). A 2 is never a pass. The
[playbook](skills/okf-bootstrap/references/PLAYBOOK.md) has the full conventions and the
review checklist; [SKILL.md](skills/okf-bootstrap/SKILL.md) is what the agents read.

## Try the demo

```bash
git clone https://github.com/jb9k62/okf-bootstrap && cd okf-bootstrap
npm install
npm run demo                # builds the widgets, writes examples/demo/okf/viz.html
```

## Development

This repository is an npm workspace: the root holds the skill, its tools and tests; the widget
template is a workspace member, so it is typechecked, tested and built here too.

```bash
npm install
npm run check               # tsc on the tools and widgets, node:test, vitest
npm run test:render         # browser gates on the demo and an error fixture, and a fresh
                            # consumer project (needs npx playwright install chromium)
npm run screenshots         # regenerate docs/images from the demo bundle
```

The tools are `.mts` files run by Node's type stripping, so only erasable TypeScript is
allowed (`erasableSyntaxOnly`): no enums, namespaces or parameter properties.

**Screenshots** follow the viewer as it improves: `npm run screenshots` rebuilds every image
in `docs/images` (light and dark), and the
[screenshots workflow](.github/workflows/screenshots.yml) does the same on `main` whenever the
viewer, the widgets, the demo or the script change, committing the result if any image
differs. Run it by hand from the Actions tab after anything else that changes the look. To
add a shot, add an entry to `SHOTS` in [`scripts/screenshots.mts`](scripts/screenshots.mts).

**The OKF spec** is tracked two ways: `vendor/knowledge-catalog` is a shallow submodule
pinned to an upstream commit, and `skills/okf-bootstrap/references/okf-spec/` holds a copy of
`SPEC.md` from it (installs do not fetch submodules, and the skill must always be able to read
the spec). CI checks weekly whether upstream moved.

```bash
npm run spec -- status      # pinned vs upstream; exit 1 when SPEC.md moved
npm run spec -- update      # move the pin, re-vendor, print a migration checklist
```

## Releases

Versions are git tags; see [CHANGELOG.md](CHANGELOG.md). To release, bump `version` in
`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `VERSION`
in `assets/bootstrap.mts` (the tests check they agree), add a changelog entry, then tag.

## Licence

MIT, see [LICENSE](LICENSE). The vendored OKF spec is Apache-2.0, see [NOTICE](NOTICE). The
viewer is based on the reference viewer in
[GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog).
