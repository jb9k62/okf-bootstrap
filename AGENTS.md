# AGENTS.md

This repo is an **agent skill** (for pi and Claude Code) that scaffolds an
[OKF](skills/okf-bootstrap/references/okf-spec/SPEC.md) knowledge bundle into other projects.
It is not an app. What ships is `skills/okf-bootstrap/`; everything else (tests, scripts,
demo, docs) supports it.

## Layout

| Path | What it is |
| --- | --- |
| `skills/okf-bootstrap/SKILL.md` | The skill's entry point and its user-facing contract. Frontmatter `description` drives triggering |
| `skills/okf-bootstrap/assets/bootstrap.mts` | Scaffolder: copies templates into a target project |
| `skills/okf-bootstrap/assets/okf-view.mts` | Validator + graph viewer; emits one self-contained `viz.html` (~3000 lines) |
| `skills/okf-bootstrap/assets/okf-mermaid.mts` | Mermaid parse gate and headless-Chromium render gate |
| `skills/okf-bootstrap/assets/templates/` | Files copied into target projects (`okf/`, concept and explainer templates, `okf-widgets/` React workspace) |
| `skills/okf-bootstrap/references/` | `PLAYBOOK.md`, `EXPLAINERS.md`, and the vendored OKF spec |
| `examples/demo/okf/` | "Parcel tracker" demo bundle; used by `npm run demo`, tests and screenshots |
| `test/` | `bootstrap.test.mts` (unit), `render.e2e.mts` and `views.e2e.mts` (Chromium) |
| `scripts/` | Maintainer tools: `install-skill`, `okf-spec`, `screenshots` |
| `vendor/knowledge-catalog` | Shallow git submodule pinning the upstream spec commit |
| `docs/images/` | README screenshots, **generated** by `npm run screenshots` |

## Commands

Node >= 24 is required. TypeScript runs directly (type stripping), with no build step.

```bash
npm ci
npm run check         # typecheck + unit tests + widget tests + views e2e: run before finishing
npm run typecheck     # tsc for the tools, then the widget workspace
npm test              # node --test test/*.test.mts, plus the widget workspace's tests
npm run test:render   # Chromium: diagrams, quizzes, widgets (needs `npx playwright install chromium`)
npm run test:views    # Chromium: layouts, Graph/Tree/Table views, neighbourhood, colour modes
npm run demo          # build widgets, then render examples/demo/okf to viz.html
npm run spec -- status   # is the vendored OKF spec current? (0 yes, 1 moved, 2 offline)
```

The e2e tests skip without a browser; set `OKF_CHROMIUM` to a binary if Playwright's isn't
installed. They serve libraries from `node_modules`, so they run offline.

To see the viewer, run `npm run demo` and open `examples/demo/okf/viz.html` (gitignored).
For viewer changes, look at it in light **and** dark themes, in every view; passing tests
do not prove it reads well.

## Conventions

- **Erasable TypeScript only**: no enums, namespaces or parameter properties. Imports name
  the real `.mts` extension. `tsconfig.json` enforces this.
- **Tools must stay dependency-light.** `bootstrap.mts`, `okf-view.mts` and `okf-mermaid.mts`
  are copied into user projects as `scripts/okf-*.mts`. Don't import anything from outside
  `skills/okf-bootstrap/assets/`, and resolve templates relative to the file itself.
- **`viz.html` is one file**: no build step, libraries inlined. Don't add a bundler or a
  network fetch to the viewer.
- **Exit-code contract for every gate**: `0` pass, `1` broken (name file and line), `2`
  could not run. Never return 0 when a check didn't actually run.
- **Templates become the user's code.** Changes under `assets/templates/` affect projects
  that already scaffolded; a plain re-run keeps authored files and only `scripts/okf-*.mts`
  are refreshed. Don't make a re-run overwrite authored content (only `--force` does).
- **Widgets**: `templates/okf-widgets` is an npm workspace with its own tests and typecheck.
  Keep models pure and separately tested from the React components.
- **Spelling**: British ("colour", "licence", "neighbourhood"), matching the README and
  changelog.

## Changing things

- **Skill behaviour or flags**: update `SKILL.md` (and `PLAYBOOK.md` if it touches authoring
  rules) in the same change, plus a test in `test/bootstrap.test.mts` for scaffolder changes.
- **Viewer features**: add to `test/views.e2e.mts` and show the demo bundle exercising it
  (add to `examples/demo/okf` if nothing there covers it).
- **User-visible changes**: add a line under `## Unreleased` in `CHANGELOG.md`.
- **Releases**: the version lives in three places and they must match: `package.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
- **Vendored OKF spec**: never hand-edit `references/okf-spec/` or `vendor/`. Use
  `npm run spec -- update` (copies `SPEC.md`, `LICENSE.md`, writes `UPSTREAM.json`). CI
  runs `spec status` weekly and fails when upstream moves.
- **Screenshots**: don't edit `docs/images/`; the `screenshots` workflow regenerates and
  commits them on `main`. Run `npm run screenshots` only if you need them locally.

## CI

`.github/workflows/ci.yml`: `check` (Node 24 and 26), `render` (Chromium e2e), and `spec`
(vendored spec freshness). Keep `npm run check` green locally before pushing.

## Don't

- Commit `node_modules/`, `dist/`, `.cache/` or any `viz.html`; all are gitignored.
- Write claims into demo or template docs that the code doesn't back up; the skill's own
  rule is to check every claim against the code.
- Reformat or rewrite `okf-view.mts` wholesale. It is large; make targeted edits.
