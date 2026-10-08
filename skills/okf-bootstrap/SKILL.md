---
name: okf-bootstrap
description: >
  Scaffold and maintain an OKF (Open Knowledge Format) knowledge bundle in any project:
  an okf/ doc pack (index, log, ADRs, concepts), a validator and self-contained graph viewer
  (viz.html), Mermaid parse and render gates, and optional interactive explainers: callouts,
  click-to-check quizzes and React "micro-world" widgets that let a reader play with how the
  system behaves. Use when asked to "bootstrap an okf" or set up structured design docs, when
  writing a guided tour, tutorial or explainer of code or a change (especially agent-written
  code someone must understand before building on it), when adding a quiz or interactive
  widget to docs, or when moving a bundle to a new OKF spec version.
license: MIT
compatibility: Node 24+ (runs TypeScript directly). npm. Chromium via playwright for the render gate.
---

# OKF Bootstrap

Scaffolds the **app-knowledge** flavour of an [OKF](references/okf-spec/SPEC.md) doc pack into
a project and keeps it honest: an `okf/` bundle (index, dated log, ADR area, `design/` and
`<slug>/` concept dirs), the `okf-view.mts` validator + graph viewer, the `okf-mermaid.mts`
parse checker, the `okf-search.mts` freshness-aware search, the `okf:` npm scripts, and optionally `packages/okf-widgets` for interactive
explainers and `edukai/`, a second bundle for what agents learn (see "Two bundles"). It models knowledge *about* a project: decisions, architecture, domain model, API,
and the guided tours that make them understandable.

Read these as the task needs them (paths relative to this file):

| File | When |
| --- | --- |
| [references/PLAYBOOK.md](references/PLAYBOOK.md) | Any bundle work: layout, frontmatter, links, the gates, the review checklist, version migration |
| [references/EXPLAINERS.md](references/EXPLAINERS.md) | Before writing an `Explainer` concept, a quiz, or a widget |
| [references/okf-spec/SPEC.md](references/okf-spec/SPEC.md) | The OKF spec itself (vendored; `UPSTREAM.json` says which commit) |
| `assets/templates/okf-widgets/README.md` | Before adding or changing a widget |

## Invocation

pi: `/skill:okf-bootstrap [targetDir] [flags]`. Claude Code: `/okf-bootstrap [targetDir] [flags]`
(or `/okf-bootstrap:okf-bootstrap` when installed as a plugin). Or just ask: "bootstrap an okf
for this project", "write an explainer for this change with a quiz", "add a widget that shows X".

The scaffold is `assets/bootstrap.mts`. It resolves its templates relative to itself, so run it
from anywhere with the skill directory's absolute path:

```bash
node <skill dir>/assets/bootstrap.mts <targetDir> --name "Project Name" [--widgets]
```

| Flag | Effect |
| --- | --- |
| `--name` | Title for `okf/index.md` (default: the target's folder name) |
| `--slug` | Concept dir id (default: kebab-case of the name) |
| `--widgets` | Also scaffold `packages/okf-widgets` (React micro-worlds), add it to the npm workspaces, and build it before `okf:view` and the render gate |
| `--edukai` | Also scaffold `edukai/`, the agent memory bundle (see "Two bundles"), add the `edukai:` scripts, and write a short marked snippet into `AGENTS.md` once |
| `--tools-only` | Refresh `scripts/okf-*.mts`, `scripts/okf-start.mjs` (the compile-cache preload the scripts load) and the `okf:` scripts only; add `--widgets` to add widgets, or `--edukai` to add the memory bundle, to a project that already has `okf/` |
| `--no-scripts` | Leave `package.json` alone |
| `--force` | Replace the authored files (index, log, ADR index and template, authoring templates) with fresh templates. Never touches `packages/okf-widgets` |

A plain re-run keeps every authored file and lists what it kept, so re-running to pick up newer
tooling never costs `log.md`'s history. The `scripts/okf-*.mts` tools are generated copies: always
refreshed, and older `.mjs` copies are removed.

## Procedure

1. **Scaffold.** Run the command above. Pass `--widgets` when the project will have explainers
   (tours, tutorials, onboarding); it can be added later with `--tools-only --widgets`.
2. **Install.** The tools are `.mts`: Node 24+ runs them with no build and no `"type"` change.
   ```bash
   npm install                      # yaml (added as a devDependency), and the widget workspace
   npm install -D @mermaid-js/mermaid-cli@11 playwright
   npx playwright install chromium
   ```
   Without the last two, the Mermaid gates exit 2 ("could not run"): a failure, never a pass.
3. **Author.**
   - First ADR: `okf/adr/0001-...` recording the decision to keep design knowledge in an OKF
     bundle (where it lives, why, what was rejected). Copy `okf/adr/template.md` and add a row
     to `okf/adr/readme.md`.
   - First concepts in `okf/<slug>/`: overview, architecture, domain model, API. Start from
     `okf-concept-template.md`. Every non-reserved `.md` needs a `type`, every internal link
     must resolve, and every timestamp is an ISO 8601 datetime with an offset.
   - Explainers: start from `okf-explainer-template.md` and follow
     [EXPLAINERS.md](references/EXPLAINERS.md): background, intuition, details, then a quiz.
   - **Check every claim against the code before it goes in** (the playbook's checklist).
4. **Verify.** All must pass before committing:
   ```bash
   npm run okf:fix               # writes the relationship key under every ER diagram
   npm run okf:validate          # frontmatter, links, timestamps, ER keys: expect 0 issues
   npm run okf:view              # (builds widgets,) validates, writes okf/viz.html
   npm run okf:mermaid           # every mermaid block parses in mmdc
   npm run okf:mermaid:render    # headless Chromium: diagrams, quizzes, widgets all work
   npm run okf:widgets:typecheck && npm run okf:widgets:test   # with --widgets
   ```
   Exit codes are shared: **0** pass, **1** something is broken (file and line named), **2**
   the gate could not run. Read 2 as "unproven", never as "fine". Then open `viz.html` and
   look, in light and dark: the gates prove it works, not that it reads well.
5. **Commit** `okf/`, `scripts/`, `packages/okf-widgets/`, the two authoring templates and
   `package.json`. Gitignore `okf/viz.html` (generated).

## Two bundles

The scaffold can set up two OKF bundles. They stay separate because they have different
readers and different rules.

| | Design bundle, `okf/` | Memory bundle, `edukai/` (with `--edukai`) |
| --- | --- | --- |
| Reader | The team, in `viz.html` | The agent, through harness hooks |
| Unit | A concept: one topic, many claims | A lesson: one claim, with the files it rests on |
| Written | When the design changes | Whenever an agent learns something |
| Trust aim | Reviewed by a person | Confirmed by a script or an agent |

This skill covers the design bundle. Reading and writing lessons is the **`edukai` skill**
(installed beside this one); use it for anything under `edukai/`. Never put lessons in `okf/`,
or design docs in `edukai/`. Two things from the memory side also work on a design bundle:
`supersedes` / `superseded_by` in frontmatter (an ADR that replaces another; the validator
checks the pair), and `npm run okf:recheck`, which reports concepts whose pinned `sources`
changed (`node scripts/okf-edukai.mts verify <concept> --bundle okf --by <actor>` pins them).

## Finding things in a bundle

Do not read a whole bundle to answer a question. `npm run okf:search -- <command>` ranks
concepts by text and by what the spec says about them (trust tier, stale, deprecated, links):
`facets` (the tags and types in use), `search "query" [--fresh --tag t --trust human --cites src/file.ts]`,
`show <id> --outline` then `--section <heading>`, `related <id>`, `stale`. Add `--json`. The
viewer's search box runs the same ranking. Treat a
`stale` or `unverified` hit as a lead to check, not a fact. Details: the playbook's "Finding concepts".

## Writing rules (short version)

- Root `index.md` and `log.md` are reserved (no `type`). Every other `.md` needs YAML
  frontmatter on line 1 with a non-empty `type`. Working notes without a type live outside
  `okf/`.
- `generated: { by: <agent>/<version>, at: 2026-06-30T14:00:00Z }`. Omit `status` while it is
  `stable`; add `verified` only after a person has actually reviewed the text.
- Short concepts, plain words, link instead of repeating. Bundle-root links
  (`[text](/path/concept.md)`) or relative ones; a link to a missing file is an issue.
- Mermaid: `fill`, `stroke` and `color` on every `classDef`; any `%%{init}%%` on one line.
- Every `erDiagram` is followed by the generated key that reads each relationship in words and explains `||--o{`
  and friends. Never write it by hand: run `npm run okf:fix`; `okf:validate` fails without it.
  For a complicated schema, or when asked, add a ` ```widget ` with `sql-erd` and the schema's
  SQL (scenarios, design review, join paths, delete impact): see EXPLAINERS.md.
- Callouts `> [!definition] Term`; quizzes in a ` ```quiz ` block (exactly one `- [x]` per
  question); widgets in a ` ```widget ` block naming a registered widget.

## Widgets: what ships and what is yours

`packages/okf-widgets` is copied into the project and **becomes the project's code**. It ships
a registry (`src/index.tsx`), a kit (`useWorld`, `Presets`, `Choice`, `Slider`, `Toggle`,
`Scrubber`, `Facts`, `BarChart`, `Note`, `ModelNote`, `SourceProblem`), styles built on the viewer's theme
variables, and ten worked examples with pure, tested models: `utc-week`, `retry-backoff`,
`sql-erd` (takes a schema's SQL from the block), and the computer-science set `cache-policy`,
`http-concurrency` (takes requests from the block), `css-specificity` (takes rules from the
block), `bloom-filter`, `rate-limiter`, `binary-search` and `consistent-hash`. Keep the examples as references or delete them; write the project's
own widgets next to them, importing the project's real pure code through the `@app` alias
where possible. Its `README.md` has the step-by-step.

## OKF spec version

The spec is vendored at `references/okf-spec/` (`UPSTREAM.json` records the upstream commit
and version); the viewer implements `OKF_VERSION` and reports a bundle that declares another.
To move a project's bundle to a new version, follow the playbook's "Moving a bundle to a new
OKF version" section. Maintainers update the vendored spec with `npm run spec -- status` and
`npm run spec -- update` in the okf-bootstrap repository.
