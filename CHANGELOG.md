# Changelog

## Unreleased

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
