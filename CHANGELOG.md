# Changelog

## Unreleased

- **edukai, an agent memory bundle** (opt-in: `bootstrap.mts --edukai`, or `--tools-only --edukai`
  in a project that already has `okf/`). A second OKF bundle, `edukai/`, holds what agents have
  learned as **lessons**: one claim each, with the files it rests on pinned by a content digest
  and, where the claim is text in a file, a `check` (`contains`, `lacks`, `matches`, `exists`)
  that code re-runs. The new `scripts/okf-edukai.mts` creates lessons (`new`), pins and signs
  them (`verify`), replaces them without deleting (`supersede`), builds the syllabus and the
  hooks' cache (`index`), and derives every lesson's state (`recheck`: fresh, renewable,
  suspect, stale, failed, broken, unverified, superseded; `--write` renews the ones whose checks
  still hold, `--strict` fails a build on broken, failed or suspect, never because time passed).
  New scripts: `edukai:validate`, `edukai:index`, `edukai:recheck`, `edukai:brief`,
  `edukai:search`, `edukai:view`. Spec: `docs/specs/edukai-memory-bundle.md`.
- **Memory hooks for both harnesses**: a Claude Code plugin hook (`hooks/hooks.json`) and a pi
  extension (`extensions/edukai.ts`, pi 1.0+) tell the agent what the bundle says when a session
  opens or is compacted, name the lessons that cite a file when it reads or edits that file, and
  stop it from finishing with a lesson its own edit just broke. Both call
  `okf-edukai-hook.mts`, which has no dependencies, reads only a JSON cache, and never runs
  project code. Silent in a project with no `edukai/` at or above the working folder, and on a
  Node older than 22.18. A lesson that is already failed, broken, suspect or stale is named as
  such when its file is read, and is never counted as the session's own breakage.
  `EDUKAI_NUDGE=0` turns the finish nudge off; `EDUKAI_DEBUG=1` shows hook errors. A fresh
  clone needs one `npm run edukai:index`.
- **A second skill, `edukai`**: what is worth a lesson, how sure to say you are, and what to do
  with one that failed its re-check. `npm run install-skill` now links every skill under `skills/`.
- **`okf:recheck`** for design bundles: `okf-edukai.mts verify <concept> --bundle okf --by <actor>`
  pins a concept's `sources`, and `npm run okf:recheck` reports when a pinned file changes.
- **Validator**: three new issue kinds on any bundle. `lesson` (a `type: Lesson` missing a
  required key, an unknown `confidence`, `inferred` with a `verified` entry, a malformed `check`),
  `supersede` (`supersedes` and `superseded_by` must name each other, the old concept must be
  `status: deprecated`, no cycles; ADRs can use them, and the ADR template now does) and `budget`
  (a Lesson body over 30 lines, an Overview over 60). `Lesson` and `Overview` get graph colours,
  and the report prints the confidence breakdown.
- **Search knows lessons**: `--confidence tested|observed|inferred`, and a superseded concept's
  badge says what replaced it.
- **Demo**: Parcel tracker gains a memory bundle (`examples/demo/edukai`, nine lessons, two wrong
  on purpose), a few source files for them to cite, ADR-0004, a tour of the lesson lifecycle,
  and a command-line walkthrough in `examples/demo/README.md` (`npm run demo:edukai`).
- **Fixed**: a race in the viewer's e2e tests, where a concept opened from the table could land
  in the middle of the next test.
- **One layout for every widget**: slider rows share a label, track and value grid; the presets
  sit above a divider, selected presets are tinted, notes carry an accent edge, and the result
  block is set off by a rule. Applies to all widgets, not only the HTTP one.
- **Tidier HTTP concurrency widget**: the sliders line up as label, track and value columns, the
  request list is a two-column grid, and the waterfall sits in its own bordered panel with
  white lanes so its edges are clear.
- **One look and one key for ER diagrams**: the three places that show an entity relationship
  diagram now agree. The generated key leads with each relationship in words ("each CARRIER is
  linked to zero or more PARCEL; each PARCEL is linked to exactly one CARRIER", up to six, then a
  count) instead of one worked example, and no longer explains the solid line when every line is
  solid. The viewer shows the key under the diagram instead of only when it is expanded, draws
  each symbol without the raw `||` text beside it, and restyles Mermaid's ER diagram to match the
  `sql-erd` widget (tinted table headers, accent-coloured `PK`/`FK`, heavier lines and line
  ends, light and dark). The widget keeps a key under its diagram (only the ends that schema
  uses, in the same words) and its line tooltips give the same sentence. Re-run `npm run
  okf:fix` to refresh existing keys.
- **Clearer demo tours**: all nine Parcel tracker tours now name who is affected (a customer,
  the on-call engineer, the courier's engineer, an analyst, a front-end developer), tell the
  problem one step at a time from their seats, and number the widget instructions with a
  preset to click and the figure to read at each, all in short, plain sentences. The cast lives
  in the overview. The
  explainer guide and template describe the pattern.
- **`okf-search`**: ranked, spec-aware search for agents and people (`npm run okf:search --`). BM25F over
  title, tags, path, description, headings and body, adjusted by trust tier, `stale_after`, `status`
  and inbound links (`--explain` shows how). Commands: `search`, `show` (`--outline`, `--section`),
  `related`, `facets`, `stale`; filters for tag, type, status, trust, freshness, expiry window and
  links; `--json` throughout. No daemon: a cache keyed by each file's mtime and size is re-checked on
  every run. The parsing the viewer and search share moved to `scripts/okf-core.mts`, and the ranking to
  `scripts/okf-rank.mts`; the scaffold copies both.
- **Ranked search in the viewer**: the search box runs the same ranking as `okf-search`, in the page.
  A results list shows each concept's trust, freshness and best-matching line (hover for the score
  arithmetic; arrows and Enter work), non-matches dim in the graph and drop out of the tree, and the
  table gains a Match column. New trust and freshness filters sit beside the type filter, and a
  mode switch keeps the old plain "contains" match.
- **Better on phones**: the viewer's top bar is now a search box and one swipeable row of
  controls (it used to fill half the screen), the graph is shorter and its colour key is a single
  line. Widgets get touch-sized controls, full-width sliders and two-column short lists on narrow
  screens, and native controls follow the accent colour.
- **Seven computer-science widgets**, with tours in the demo: `rate-limiter` (fixed window,
  sliding window and token bucket, stepped through), `binary-search` (and what an unsorted list
  does to it), `consistent-hash` (a ring against `hash % servers`, with virtual nodes),
  `cache-policy` (FIFO, LRU, LFU and
  the unbuildable optimum on one trace, with Belady's anomaly), `http-concurrency` (a waterfall
  of connections, handshakes and dependent requests; reads its requests from the block),
  `css-specificity` (the cascade's tie-breakers: `!important`, inline, layers, specificity,
  order; reads its rules from the block) and `bloom-filter` (the bits, the false-positive
  rate against its formula, and why a "yes" must be checked). Each has a pure model pinned by
  tests.
- **Widget kit**: `useWorld` keeps a widget's state and presets together (editing clears the
  active preset), plus `Choice`, `Slider`, `Toggle`, `BarChart`, `Scrubber` (step through a
  sequence) and `SourceProblem`.
  `models/source.ts` gives data-driven widgets one line convention. `retry-backoff` now uses
  the kit. The render test counts the demo's widget blocks instead of a fixed number, and fails if a
  registered widget has no demo tour.
- **ER diagram keys**: every Mermaid `erDiagram` is followed by a
  small generated key (what `||--o{` mean, the line style, `PK`/`FK`, one relationship read out
  in words), written into the markdown between `<!-- okf:erd-legend -->` markers. `okf:validate`
  reports a missing or out-of-date key as an `erd-legend` issue, and the new `okf:fix` script
  (`okf-view.mts --fix`) writes or refreshes every key, so no agent has to remember it. The demo's
  data model has one. The viewer draws each symbol in the key as the diagram draws it (crow's
  feet, bars, rings), with the text beside it for authoring. The key shows only over the expanded
  diagram (a panel in its corner), not in the reading pane.
- **`sql-erd` widget**: a micro-world for a SQL schema, for complicated schemas or on request.
  Put the `CREATE TABLE` statements under the widget name in the ` ```widget ` block. It shows
  scenarios (`-- scenario: Title | blurb`; a small schema, then the same business grown large,
  with the new tables marked), a diagram whose crow's-foot ends are derived from NOT NULL and
  UNIQUE, a design review (green for what is well designed, amber for what is not, each with the
  rule behind it), the join path between two tables as SQL with a warning where rows multiply,
  and the delete impact of a row (cascade, set null, refused). Two safeguards (foreign keys,
  indexes) switch off, and the SQL is editable, so the reader can break the schema and watch the
  review fail. The demo's data model has it, with a parcel tracker and a parcel ops scenario.
- **Widgets take data**: the first line of a ` ```widget ` block is still the name; the text
  below it now reaches the widget as `source` (`mount(element, name, source)`). Existing
  widgets and blocks are unaffected.
- **README** rewritten around screenshots of the viewer, a widget (before and after one click)
  and a quiz, in light and dark.
- **`npm run screenshots`** (`scripts/screenshots.mts`) regenerates `docs/images` from the
  demo bundle; the `screenshots` workflow runs it on `main` and commits changed images.
- **Demo** grown into the "Parcel tracker" bundle: 13 concepts (overview, architecture, data
  model, API, metric, runbook, three ADRs, two tours) showing types, trust tiers, a draft and
  a stale concept.
- **`npm run test:views`** (part of `npm run check`, and run in the CI `render` job where Chromium is installed) drives the layout dropdown, the view switcher, sorting, the
  neighbourhood and the colour modes in Chromium. It serves the viewer's libraries from
  `node_modules`, so it runs offline; set `OKF_CHROMIUM` to a browser binary if Playwright's
  isn't installed. Without a browser it skips.
- **Viewer views**: a Graph | Tree | Table switcher. The tree groups concepts by folder; the
  table is sortable (title, type, trust, freshness, verified date, links in and out) and takes
  the full window. Search and the type filter apply to all three. **Neighbourhood** shows only
  the open concept, with what links to it on the left and what it links to on the right.
  **Colour** switches nodes between type, trust (human reviewed, machine confirmed, unverified)
  and freshness (fresh, stale within 30 days, stale, no expiry).
- **Demo** now mixes trust and freshness: two concepts confirmed by CI, two with a future
  `stale_after`, one expiring within 30 days, alongside the human-reviewed, unverified and
  stale ones. The tree view shows the colour key above the list.
- **Viewer**: layout dropdown restored (force, concentric, breadth-first, circle, grid), as in
  the reference viewer.
- **Viewer**: Mermaid edge labels sit on the canvas colour in dark mode instead of grey boxes.

## 0.3.0 - 2026-09-30

First public release.

- **Interactive explainers.** The viewer renders callouts (`> [!definition]` and friends),
  ` ```quiz ` blocks as click-to-check questions, and ` ```widget ` blocks as React components
  from the project's `packages/okf-widgets`, inlined so `viz.html` stays one file. The render
  gate checks all three.
- **`--widgets`** scaffolds the widget package (registry, kit, styles, two worked examples with
  models and tests) as an npm workspace and wires `okf:widgets:*` scripts.
- **`okf-explainer-template.md`** and `references/EXPLAINERS.md`: guided tours after Geoffrey
  Litt's "Understanding is the new bottleneck".
- **TypeScript tools.** `bootstrap`, `okf-view` and `okf-mermaid` are `.mts`, run by Node 24+
  directly. Re-running the scaffold replaces old `scripts/okf-*.mjs` copies.
- **Spec conformance.** Timestamps must be ISO 8601 datetimes with an offset (SPEC §5):
  `generated.at: 2026-08-09` is now a `timestamp` issue. Templates stamp
  `okf-bootstrap/<version>` and a full datetime. The validator reports the bundle's declared
  `okf_version`.
- **Spec tracking.** The OKF spec is vendored in the skill, with a pinned submodule and
  `npm run spec -- status | update` for maintainers.
- `yaml` is added as a devDependency (was a dependency).
- Installable as a pi package, a Claude Code plugin (marketplace or `~/.claude/skills` clone),
  or with `npm run install-skill`.
