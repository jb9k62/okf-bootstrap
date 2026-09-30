# okf-bootstrap

An agent skill for **pi** and **Claude Code** that sets up an
[OKF (Open Knowledge Format)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
knowledge bundle in any project, and keeps it honest:

- **An `okf/` doc pack**: index, dated log, decision records (ADRs), concept folders.
- **A validator and viewer**: frontmatter, links and timestamps checked against the spec, and
  one self-contained `viz.html` with a concept graph beside a reading pane.
- **Quality gates**: every Mermaid diagram parsed by the real parser, then rendered in
  headless Chromium; one exit-code contract (0 pass, 1 broken, 2 could not run).
- **Interactive explainers**: callouts, click-to-check **quizzes**, and React **widgets**
  ("micro-worlds") that let a reader change the inputs and watch the system respond.

The explainer features follow Geoffrey Litt's
["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck.html):
when agents write code faster than people can absorb it, use the agent to build understanding
too: explainer docs, quizzes as a speed regulator, and micro-worlds to explore.

## Install

Node 24+ is required: the tools are TypeScript that Node runs directly, with no build step.

### pi

```bash
pi install git:github.com/jb9k62/okf-bootstrap
```

It is a pi package (the `pi` key in `package.json` points at `skills/`).

### Claude Code

As a plugin, from this repo's marketplace:

```text
/plugin marketplace add jb9k62/okf-bootstrap
/plugin install okf-bootstrap@okf-bootstrap
```

Or clone it straight into your skills directory, where Claude Code loads it as a local plugin:

```bash
git clone https://github.com/jb9k62/okf-bootstrap ~/.claude/skills/okf-bootstrap
```

### Anywhere else: clone and link

```bash
git clone https://github.com/jb9k62/okf-bootstrap
cd okf-bootstrap
npm run install-skill        # symlinks the skill into ~/.claude/skills and ~/.pi/agent/skills
```

`npm run install-skill -- --claude`, `--pi` or `--agents` (the shared `~/.agents/skills`)
picks targets; `--copy` copies instead of linking. With a link, `git pull` updates every agent.

## Use

Ask your agent, in the project you want documented:

> Bootstrap an okf for this project, with widgets.

> Write a guided tour of this change, with a quiz, and a widget that shows how the cache
> expires.

Or invoke it: `/skill:okf-bootstrap` in pi, `/okf-bootstrap` in Claude Code. The skill runs
`skills/okf-bootstrap/assets/bootstrap.mts`, which you can also run yourself:

```bash
node /path/to/okf-bootstrap/skills/okf-bootstrap/assets/bootstrap.mts . --name "My App" --widgets
npm install
npm install -D @mermaid-js/mermaid-cli@11 playwright && npx playwright install chromium
npm run okf:view            # writes okf/viz.html
```

[`SKILL.md`](skills/okf-bootstrap/SKILL.md) is the entry point the agents read;
[`PLAYBOOK.md`](skills/okf-bootstrap/references/PLAYBOOK.md) has the conventions and gates, and
[`EXPLAINERS.md`](skills/okf-bootstrap/references/EXPLAINERS.md) covers tours, quizzes and
widgets.

### The widget package

`--widgets` copies [`okf-widgets`](skills/okf-bootstrap/assets/templates/okf-widgets/) into
the project as `packages/okf-widgets`, an npm workspace that builds to one IIFE the viewer
inlines. From then on it is the project's code. It ships a registry, a small kit (`Presets`,
`Facts`, `Note`, `ModelNote`), theme-aware styles, and two worked examples with models and tests:

| Widget | Teaches |
| --- | --- |
| `utc-week` | A week that starts on the UTC clock puts some local Mondays in last week |
| `retry-backoff` | Why retries need backoff, jitter and a cap: switch each off and watch the load spike |

Replace them with widgets about your own system, ideally importing its real pure code.

## Demo

```bash
npm install
npm run demo                 # builds the widgets and writes examples/demo/okf/viz.html
```

## Development

This repository is an npm workspace: the root holds the skill, its Node tools and tests; the
widget template is a workspace member, so it is typechecked, tested and built here too.

```bash
npm install
npm run check                # tsc on the tools, tsc on the widgets, node:test, vitest
npm run test:render          # the browser gates on the demo and the error fixture
                             # (needs npx playwright install chromium, and network for the CDN)
```

The Node tools are `.mts` files run by Node's type stripping, so only erasable TypeScript is
allowed (`erasableSyntaxOnly`): no enums, namespaces or parameter properties.

### Keeping up with the OKF spec

The spec is tracked two ways: `vendor/knowledge-catalog` is a shallow git submodule pinned to an
upstream commit, and `skills/okf-bootstrap/references/okf-spec/` holds a copy of `SPEC.md` from
that commit (installs do not fetch submodules, and the skill must always be able to read the
spec). Clone with `--recurse-submodules` if you want the submodule; nothing needs it at run time.

```bash
npm run spec -- status       # pinned vs upstream; exit 1 when SPEC.md moved upstream
npm run spec -- update       # move the pin, re-vendor, print a migration checklist
npm run spec -- update --dry-run
```

## Releases

Versions are git tags (`v0.3.0`). Pin one when installing, for example
`pi install git:github.com/jb9k62/okf-bootstrap@v0.3.0`, and see [CHANGELOG.md](CHANGELOG.md).
To release: bump `version` in `package.json`, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json` and `VERSION` in `assets/bootstrap.mts` (the tests check they
agree), add a changelog entry, then tag.

## Licence

MIT, see [LICENSE](LICENSE). The vendored OKF spec is Apache-2.0, see [NOTICE](NOTICE).
The viewer is based on the reference viewer in
[GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog).
