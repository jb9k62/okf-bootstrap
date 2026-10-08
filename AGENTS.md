# AGENTS.md

This repo holds two **agent skills** (for pi and Claude Code) that scaffold
[OKF](skills/okf-bootstrap/references/okf-spec/SPEC.md) knowledge bundles into other projects:
`okf/`, design docs for the team, and `edukai/`, what agents have learned (the memory bundle).
It is not an app. What ships is `skills/`, `hooks/` and `extensions/`; everything else (tests,
scripts, demo, docs) supports them.

## Layout

| Path | What it is |
| --- | --- |
| `skills/okf-bootstrap/SKILL.md` | The skill's entry point and its user-facing contract. Frontmatter `description` drives triggering |
| `skills/okf-bootstrap/assets/bootstrap.mts` | Scaffolder: copies templates into a target project |
| `skills/okf-bootstrap/assets/okf-view.mts` | Validator + graph viewer; emits one self-contained `viz.html` (~3000 lines) |
| `skills/okf-bootstrap/assets/okf-mermaid.mts` | Mermaid parse gate and headless-Chromium render gate |
| `skills/okf-bootstrap/assets/okf-search.mts` | Ranked, freshness-aware search (`search`, `show`, `related`, `facets`, `stale`) with an on-disk cache |
| `skills/okf-bootstrap/assets/okf-rank.mts` | The ranking and its inverted index: pure, no imports. Run by `okf-search` and inlined (types stripped) into `viz.html` for its search box |
| `skills/okf-bootstrap/assets/okf-core.mts` | Parsing shared by the viewer and search: frontmatter, trust tier, staleness, links. Loads `yaml` on the first parse, so a search answered from its cache never loads it |
| `skills/okf-bootstrap/assets/okf-edukai.mts` | The memory bundle's tool: `new`, `verify`, `supersede`, `index`, `recheck`. Writes the cache the hooks read |
| `skills/okf-bootstrap/assets/okf-start.mjs` | Copied as `scripts/okf-start.mjs` and loaded first by every scaffolded npm script: Node's compile cache, so the tools' TypeScript is stripped once |
| `skills/okf-bootstrap/assets/okf-edukai-hook.mts` | What the harness adapters run (`brief`, `cites`, `debt`, `hook`) and the code that derives a lesson's state. No dependencies |
| `skills/edukai/SKILL.md` | The memory skill: what is worth a lesson, how sure we are, what to do with one that failed its re-check |
| `hooks/hooks.json`, `hooks/edukai-hook.mjs` | Claude Code adapter: on SessionStart, PostToolUse and Stop it runs the launcher, plain JavaScript that exits quietly on a Node too old for TypeScript and otherwise calls `okf-edukai-hook.mts` |
| `hooks/compile-cache.mjs` | Loaded first by both adapters: turns on Node's compile cache in a private per-user folder, so the hook's TypeScript is stripped once and not on every call |
| `extensions/edukai.ts` | pi adapter: the same three moments. Declares the few pi types it uses |
| `skills/okf-bootstrap/assets/templates/` | Files copied into target projects (`okf/`, concept and explainer templates, `okf-widgets/` React workspace) |
| `skills/okf-bootstrap/references/` | `PLAYBOOK.md`, `EXPLAINERS.md`, and the vendored OKF spec |
| `examples/demo/okf/` | "Parcel tracker" demo bundle; used by `npm run demo`, tests and screenshots |
| `examples/demo/edukai/`, `examples/demo/src/` | The demo's memory bundle and the small source files its lessons cite; `examples/demo/README.md` is the walkthrough |
| `test/` | `bootstrap.test.mts`, `search.test.mts`, `edukai.test.mts` (unit), `render.e2e.mts` and `views.e2e.mts` (Chromium) |
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
npm run demo:edukai   # the memory bundle: the session brief, then the re-check report
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
- **npm scripts start through `okf-start.mjs`** (`node --import ./scripts/okf-start.mjs scripts/okf-….mts`):
  plain JavaScript that turns on Node's compile cache in a private folder. Keep it free of
  TypeScript and of imports beyond `node:` built-ins; a tool must still run without it.
- **Tools must stay dependency-light.** `bootstrap.mts`, `okf-view.mts`, `okf-mermaid.mts`,
  `okf-search.mts`, `okf-core.mts`, `okf-rank.mts`, `okf-edukai.mts` and `okf-edukai-hook.mts` are copied into user projects as `scripts/okf-*.mts`. Don't import anything from outside
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

- **`okf-rank.mts` must stay pure** (no imports, no `fs`/`path`/`process`/DOM): the viewer inlines
  it into the page, so one ranking serves the CLI and the search box.

- **`okf-edukai-hook.mts` must stay dependency-free**: it imports only `node:` built-ins and
  `./okf-rank.mts`, never `okf-core.mts` or `yaml`, and never runs code from the project. It
  runs from an installed plugin where `node_modules` may not exist, and its output is put in
  front of an agent. A test enforces the imports and runs it outside the repo.
- **The demo's memory bundle is pinned.** Lessons in `examples/demo/edukai/` hold digests of
  files under `examples/demo/` (source files, and `okf/adr/0002-…` and `okf/parcel-tracker/api.md`).
  Editing one of those changes a lesson's state and the report a test pins; the three changes
  made on purpose are listed in `examples/demo/README.md`.

- **Skill behaviour or flags**: update `SKILL.md` (and `PLAYBOOK.md` if it touches authoring
  rules) in the same change, plus a test in `test/bootstrap.test.mts` for scaffolder changes.
- **Viewer features**: add to `test/views.e2e.mts` and show the demo bundle exercising it
  (add to `examples/demo/okf` if nothing there covers it).
- **User-visible changes**: add a line under `## Unreleased` in `CHANGELOG.md`.
- **Releases**: the version lives in four places and they must match: `package.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `VERSION` in `bootstrap.mts`.
- **Vendored OKF spec**: never hand-edit `references/okf-spec/` or `vendor/`. Use
  `npm run spec -- update` (copies `SPEC.md`, `LICENSE.md`, writes `UPSTREAM.json`). CI
  runs `spec status` weekly and fails when upstream moves.
- **Screenshots**: don't edit `docs/images/`; the `screenshots` workflow regenerates them
  and commits them to the `chore/screenshots` branch (never to `main`), with a pull request
  to merge. Run `npm run screenshots` only if you need them locally.

## CI

`.github/workflows/ci.yml`: `check` (Node 24 and 26), `render` (Chromium e2e), and `spec`
(vendored spec freshness). Keep `npm run check` green locally before pushing.

## Don't

- Commit `node_modules/`, `dist/`, `.cache/` or any `viz.html`; all are gitignored.
- Write claims into demo or template docs that the code doesn't back up; the skill's own
  rule is to check every claim against the code.
- Reformat or rewrite `okf-view.mts` wholesale. It is large; make targeted edits.
