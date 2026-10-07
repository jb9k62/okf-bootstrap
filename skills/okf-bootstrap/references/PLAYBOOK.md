# OKF Bootstrap Playbook

The reference for standing up and maintaining an **OKF knowledge bundle + tooling** in any
project. When asked to *"bootstrap an okf for project X"*, the `okf-bootstrap` skill follows the
procedure below. This skill folder is the canonical template.

It models the **app-knowledge** flavour: knowledge *about* a project (architecture, domain,
API, decisions, and guided tours of them), with minimal frontmatter (`type`, `title`,
`description`, `tags`, `generated`, ...). The spec it implements is vendored at
[okf-spec/SPEC.md](okf-spec/SPEC.md).

---

## What's in this skill

Paths are relative to the skill directory.

| Path | Purpose |
|------|---------|
| `SKILL.md` | The skill entry: when to use, invocation, procedure, rules. |
| `references/PLAYBOOK.md` | This file: the full procedure, conventions, review checklist, version migration. |
| `references/EXPLAINERS.md` | Guided tours, quizzes and widgets: why, how, and the review checklist. |
| `references/okf-spec/` | The OKF spec (`SPEC.md`, its `LICENSE.md`), vendored from upstream; `UPSTREAM.json` records the commit and version. |
| `assets/bootstrap.mts` | Turnkey scaffold: copies templates + tools into a target project. |
| `assets/okf-view.mts` | The validator + viewer, based on the Google `knowledge-catalog` reference viewer; also the render gate under `--check-render`. |
| `assets/okf-mermaid.mts` | Parses every mermaid block in the bundle with mermaid-cli (`mmdc`); self-contained. |
| `assets/okf-search.mts` | Ranked search over the bundle that understands trust tier, staleness, tags and links; see "Finding concepts". |
| `assets/okf-core.mts` | Parsing shared by the viewer and search: frontmatter, trust tier, staleness, links. |
| `assets/okf-rank.mts` | The ranking itself: pure, with no imports. `okf-search` runs it, and the viewer inlines it (types stripped) for its search box. |
| `assets/okf-edukai.mts` | The memory bundle's tool (`new`, `verify`, `supersede`, `index`, `recheck`); `verify` and `recheck` also work on a design bundle with `--bundle okf`. |
| `assets/okf-edukai-hook.mts` | What the harness hooks run (`brief`, `cites`, `debt`) and the lesson-state rules; no dependencies. The validator imports its `check` rules. |
| `assets/templates/edukai/`, `assets/templates/edukai-recheck.yml` | The memory bundle's `index.md` and `log.md` (scaffolded by `--edukai`), and a CI workflow to copy by hand. |
| `assets/templates/okf/` | `index.md`, `log.md` (reserved), `adr/readme.md`, `adr/template.md`. |
| `assets/templates/concept.md` | Ready-to-fill reference concept (scaffolded as `okf-concept-template.md`). |
| `assets/templates/explainer.md` | Ready-to-fill guided tour (scaffolded as `okf-explainer-template.md`). |
| `assets/templates/okf-widgets/` | The React widget package (scaffolded to `packages/okf-widgets` by `--widgets`). |
| `assets/templates/package-json-scripts.md` | The `okf:` npm scripts and CLI reference. |

All the tools are TypeScript that Node 24+ runs directly (type stripping): no build step,
and `.mts` is always ESM, so a project's `package.json` `"type"` is never touched.

---

## Bootstrap procedure for "bootstrap an okf for project X"

### Fast path: run the scaffold

```bash
# target = the project directory (where you want okf/ + scripts/)
node <skill dir>/assets/bootstrap.mts <project-dir> --name "Project Name"
```

This creates:
- `okf/index.md`, `okf/log.md`
- `okf/adr/readme.md`, `okf/adr/template.md`
- `okf/design/` and `okf/<slug>/` (blank, with `.gitkeep`)
- `scripts/okf-view.mts` (the validator + viewer), `scripts/okf-mermaid.mts` (the Mermaid parse checker), `scripts/okf-search.mts` (search), `scripts/okf-core.mts` (parsing), `scripts/okf-rank.mts` (the ranking; also run by the viewer's search box), and `scripts/okf-edukai.mts` with `scripts/okf-edukai-hook.mts` (pins and re-checks; the memory bundle's tool)
- `okf-concept-template.md` and `okf-explainer-template.md` (authoring aids, kept *outside* the bundle so they are not scanned)
- with `--widgets`: `packages/okf-widgets/`, added to the npm `workspaces`
- with `--edukai`: `edukai/index.md` and `edukai/log.md`, the `edukai:` scripts, and a marked snippet in `AGENTS.md`
- adds `okf:validate`, `okf:fix`, `okf:view`, `okf:mermaid`, `okf:mermaid:render`, `okf:search`, `okf:recheck` (and with widgets,
  `okf:widgets:build`, `okf:widgets:test`, `okf:widgets:typecheck`) to `package.json`, plus
  `yaml` as a devDependency

Then install and verify:

```bash
cd <project-dir>
npm install
npm install -D @mermaid-js/mermaid-cli@11 playwright && npx playwright install chromium
npm run okf:validate        # expect: 0 issues (types, links, timestamps)
npm run okf:view            # writes okf/viz.html, open it in a browser
npm run okf:mermaid         # every mermaid block parses in mmdc
npm run okf:mermaid:render  # every diagram, quiz and widget works (headless Chromium)
```

Re-running the scaffold is safe: `okf/index.md`, `okf/log.md`, the ADR index and template, and
the two authoring templates are kept if they exist (the run lists what it kept), and only
`--force` replaces them. `packages/okf-widgets` is never replaced, not even by `--force`: it is
the project's code once scaffolded. The `scripts/okf-*.mts` tools are generated copies and are
always refreshed (and old `.mjs` copies removed), so `--tools-only` is the way to pull newer
tooling into a project whose bundle is already written.

### Manual path (what the scaffold does, step by step)

1. **Create the bundle dir** `okf/` in the project root.
2. **Skeleton**, copied from `templates/`:
   - `index.md`: the root index. Frontmatter is only `okf_version: "0.2"`; `index.md` and
     `log.md` are **reserved** and do **not** need a `type`.
   - `log.md`: dated update history.
   - `adr/readme.md` and `adr/template.md`: the decisions area.
3. **Copy the tools** `okf-view.mts`, `okf-mermaid.mts`, `okf-search.mts`, `okf-core.mts` and
   `okf-rank.mts` to `scripts/` (from the skill's `assets/`).
4. **Add npm scripts** to `package.json` (and `yaml` as a devDependency; no `"type"` change,
   the tools are `.mts`):
   ```jsonc
   "okf:validate":       "node scripts/okf-view.mts okf --validate",
   "okf:fix":            "node scripts/okf-view.mts okf --validate --fix",
   "okf:view":           "node scripts/okf-view.mts okf",
   "okf:mermaid":        "node scripts/okf-mermaid.mts okf",
   "okf:mermaid:render": "node scripts/okf-view.mts okf --check-render",
   "okf:search":         "node scripts/okf-search.mts"
   ```
5. **Author the first concepts** in `okf/<slug>/` (overview, architecture, domain model, API)
   and record the first ADR, including the one for using OKF itself (see the checklist below).
   Every non-reserved `.md` needs a `type`.
6. **Validate and view**: `npm run okf:validate` (0 issues: types and links), then
   `npm run okf:view`, then the two Mermaid gates (see the
   [Mermaid](#mermaid-two-gates) section).
7. **Git commit** the bundle (`okf/`), the tool (`scripts/`), and the `package.json` changes.
   `okf/viz.html` is generated; either gitignore it or commit it and regenerate on demand.

---

## Writing and review checklist

Lessons from reviewing a bundle written for a real project. Apply these before calling a
concept done, and before adding a `verified` entry to it.

- **Check every claim against the code, git history, and the brief before adding `verified`.**
  A review of one bundle caught, among other things:
  - a backwards claim about prefix matching (the text said `shoes` matches `shoe`, but a
    prefix fallback only reaches forward: `shoe` matches `shoes`, not the other way round)
  - wrong diff stats quoted for a commit
  - a browser API named in the text that the client didn't actually use
  - "anything else is a 400" when the code actually ignores unknown query parameters
  - an API response example whose numbers didn't match the sample data
  An unreviewed guess reads exactly like a checked fact once it's in a tidy concept file, so
  the check has to happen before `verified` goes on, not after.
- **Keep concepts short. Link instead of repeating.** If two concepts would say the same
  thing, say it once and link to it. A summary document (a project's `SOLUTION.md`, a
  README) should link into the bundle rather than duplicate its content.
- **Use plain, simple words.** No "heterogeneous", no "deterministic" where "always the same"
  will do, no em dashes (use a comma, colon, or full stop instead), and follow the project's
  own spelling and style rules (for example, South African spelling in some projects).
- **Record the choice to use OKF as an ADR**, in the project's own bundle. It's a real
  architectural decision (where does design documentation live, and why) and it should be
  reviewable like any other: the context (docs scattered or missing, agents writing much of
  the code), the decision (one OKF bundle in the repo, validated in CI), and the alternatives
  rejected (a wiki, a docs site, READMEs alone) with why.
- **After writing, run `okf:view`, open `viz.html`, and confirm every Mermaid diagram
  renders.** A diagram can look fine in the source and still fail to render (a bad `%%{init}%%`
  line, a stray character) and the viewer shows a visible error for that case, but only if you
  look. The scaffolded `npm run okf:mermaid:render` does this automatically: it opens the
  generated `viz.html` in headless Chromium and walks every concept, failing if any diagram
  ends in an error state, times out, or a concept renders a different number of figures than
  its markdown parses to. Add `--strict` when you also want conformance issues to fail the
  same command.

---

- **An explainer that is wrong is worse than none.** Tours, quizzes and widgets get the same
  claim-by-claim check, and a widget's model gets a test pinned to the real code's cases. See
  [EXPLAINERS.md](EXPLAINERS.md).

## Bundle structure and conventions

A knowledge bundle is a tree of `.md` files under `okf/`. Suggested layout:

```
okf/
  index.md                 # root index (reserved)
  log.md                   # update history (reserved)
  adr/                      # architectural decisions
    readme.md               # decision records index
    template.md              # copy this to record a decision
    0001-<title>.md          # one decision each
  design/                   # working design notes (may be non-concepts, see note below)
  <project-slug>/           # the system itself: overview, architecture, domain model, API
  ideas/                    # research or working notes
```

### Frontmatter (minimal, OKF v0.2 §11)

Every non-reserved concept needs a **parseable YAML block starting on line 1** with a
**non-empty `type`**. `title`, `description`, and `tags` are recommended. The viewer also
reads: `status` (`draft`, `stable` (the default), or `deprecated`), `generated: {by, at}`,
`verified` (a list of `{by, at}`), `stale_after`, and `sources` (a list, each entry needing a
`resource`).

```yaml
---
type: Application          # see the palette below for recognised type values
title: Concept title
description: One sentence.
tags: [t1, t2]
generated: { by: pi-coding-agent/0.87, at: 2026-08-09T10:00:00Z }
sources:
  - resource: path/to/file.ts
---
```

**Timestamps** (`generated.at`, `verified[].at`, `stale_after`) are ISO 8601 datetimes with an
explicit offset, such as `2026-06-30T14:00:00Z` (SPEC §5). A bare date is reported as a
`timestamp` issue. **Actors** (`generated.by`, `verified[].by`) are `<producer>/<version>` for
agents and tools, and `human:<id>` for people (SPEC §7).

Don't add `status` until it needs to be something other than `stable`, and don't add
`verified` until a person has actually reviewed the text (see the checklist above): the
viewer's "unverified" badge is only useful while it's honest.

Recognised `type` values drive the node palette: `BigQuery Dataset`, `BigQuery Table`,
`Reference`, `API Reference`, `Application`, `Architecture`, `Data Model`, `Process`,
`Architectural Decision`, `Metric`, `Playbook`, and `Explainer` (not a spec type: this skill's
guided tours, coloured so they stand out in the graph). Any other string falls back to a
neutral grey.

**Reserved files**: the bundle root's own `index.md` and `log.md` are skipped by the
validator; they don't need a `type`. The match is on the bundle-relative path, so a nested
`design/index.md` is an ordinary concept and does need one. Any *other* `.md` without a
`type` is reported as a conformance issue, and `--strict` exits 1 on any issue. Reserved
files still have their links checked, since `index.md` is where most bundle links live.

### Links

- **Bundle-root** (recommended): `[Descriptive text](/path/concept.md)`, resolved against the
  bundle root. Use these only for concepts inside the bundle, and write descriptive link text
  rather than the raw path (the viewer replaces raw-path link text with the concept's title
  anyway). Bundle-root links don't resolve when browsing the markdown on GitHub; the viewer
  resolves them.
- **Relative**: `[./other.md](./other.md)`, resolved against the document's directory.
- Files outside the bundle (a README, source code) aren't bundle links: cite them in
  `sources`, or as a plain code path in the text.
- External URLs (`https://…`) are ignored in the graph.
- Every internal link to an existing concept becomes a **graph edge** (deduped, one per
  source to target pair).
- A link whose target file is **not in the bundle** is reported as a `dangling-link`
  issue. Without that check a typo or a missed rename just disappears from the graph,
  which looks identical to a concept nobody linked yet.
- Links written inside a code span or a fenced block are shown verbatim rather than
  rendered, so they are neither edges nor dangling-link issues. That is how a concept
  documents link syntax without tripping the validator.

### Trust tier and staleness (derived, not authored)

The viewer derives per concept:
- **Trust tier**: `unverified` (no `verified`), `human-reviewed` (any `verified.by` starts
  with `human:`), else `machine-confirmed`.
- **Stale**: true when `stale_after` is a date on or before today.

### Finding concepts (`okf-search.mts`)

Before reading files, ask the bundle. `npm run okf:search -- <command>` (default bundle
`okf/`; `--bundle <dir>` for another) ranks concepts by BM25F over title, tags, path,
description, headings and body, then applies the spec: stale (§5.5) and `deprecated` (§5.4)
concepts are demoted and flagged, never hidden; `human-reviewed` outranks `machine-confirmed`
outranks `unverified` (§5.3); concepts others link to get a small boost. `--explain` shows the
arithmetic. Add `--json` for agents.

```bash
npm run okf:search -- facets                          # the tags, types, trust tiers in use; start here
npm run okf:search -- search "retry backoff" --fresh  # ranked; --tag, --type, --status, --trust human,machine
npm run okf:search -- show parcel-tracker/retry-policy --outline   # headings only
npm run okf:search -- show parcel-tracker/overview --section "What it does"   # one section, not the file
npm run okf:search -- related adr/0003-full-jitter-retries   # links, backlinks, shared tags
npm run okf:search -- stale --expires-within 14d      # the review queue
```

The workflow for an agent: `facets` to learn the vocabulary, `search` with filters, `show
--outline` then `show --section` to read only what is needed, `related` to follow links. Prefer
`--fresh` or check the `freshness` field before relying on a concept; a stale one may be out of
date. A cache under `node_modules/.cache/okf-search/` (or the OS temp dir) is keyed by each
file's mtime and size, re-checked on every run; `--no-cache` skips it. Files it cannot index
(bad frontmatter, no `type`) are named on stderr; `--strict` makes that exit 1.

### Two bundles: design (`okf/`) and memory (`edukai/`)

`bootstrap.mts --edukai` (or `--tools-only --edukai` later) adds a second OKF bundle,
`edukai/`: what agents have learned, as **lessons** (`type: Lesson`, one claim each, in
`<domain>/lessons/YYYY-MM-DD-short-claim.md`) and one `type: Overview` per domain. It is
written by agents for agents, and its rules are in the separate `edukai` skill. Keep the two
apart: how the system is designed, for people, goes in `okf/`; a fact an agent found out, for
the next agent, goes in `edukai/`.

What the design bundle shares with it:

- **Supersede pointers.** When one concept replaces another (an ADR, most often), the new one
  gets `supersedes: /adr/0002-old.md`, and the old one `status: deprecated` and
  `superseded_by: /adr/0007-new.md`. Both are bundle-root paths ending `.md`.
  `okf:validate` reports a `supersede` issue when the two do not name each other, the old one
  is not deprecated, a target is missing, or the chain loops. Search flags the old concept as
  replaced. Never delete the old concept.
- **`okf:recheck`.** `node scripts/okf-edukai.mts verify <concept> --bundle okf --by human:<id>`
  pins a digest of each file in the concept's `sources` and sets `verified` and `stale_after`.
  After that, `npm run okf:recheck` lists the concept as `suspect` when a pinned file changes
  and `broken` when one disappears (`-- --strict` exits 1 on those, never on `stale`). Only
  pin what a person has reviewed: `verify` writes a `verified` entry.
- **The validator** reads both bundles: `lesson`, `supersede` and `budget` issues apply to any
  bundle that uses those types or keys.

### Mermaid (two gates)

Inline ` ```mermaid ` blocks in a concept body render in the viewer's detail panel (Mermaid
loads from a CDN). Set `fill`, `stroke`, and `color` on every `classDef`, and keep any
`%%{init:…}%%` directive on a single line: a directive that spills onto following lines
parses as a bad directive.

**ER diagrams get a key.** Mermaid's crow's-foot symbols (`||--o{`) are hard to remember, so
every `erDiagram` is followed by a small generated key: each relationship read out in words
from both sides (up to six; a bigger diagram gets the first few and a count), then the symbols
that diagram uses and what they mean, `PK`/`FK`, and the line style when it mixes solid and
dashed. The viewer shows it under the diagram and draws each symbol as the diagram does; the
`sql-erd` widget says the same things in the same words. It is markdown (between `<!-- okf:erd-legend -->` markers), so GitHub and editors show
it too. Do not write it by hand: `okf:validate` reports a missing or out-of-date key as an
`erd-legend` issue, and `npm run okf:fix` writes or refreshes every one. A complicated schema
(more than a handful of tables), or a reader who asks, also gets the `sql-erd` widget: see
[EXPLAINERS.md](EXPLAINERS.md#sql-schemas-the-sql-erd-widget).

Two gates, each catching what the other cannot:

Both gates share one exit-code contract, so a green run always means the same thing:

| Exit | Meaning | What to do |
|---|---|---|
| 0 | every diagram checked and fine | nothing |
| 1 | a diagram is broken | fix the markdown; the output names file and line, or file and concept (the render gate also fails here when a diagram's pan/zoom controls are missing or dead) |
| 2 | the gate could not run | fix the setup; **nothing is proven about the diagrams** |

1. **Parse gate** - `npm run okf:mermaid` (`scripts/okf-mermaid.mts`) extracts every
   top-level ```mermaid fenced block (with file + line) and runs each one through
   mermaid-cli (`mmdc`), so only diagrams the real Mermaid parser accepts pass.
   Unclosed fences fail without ever invoking `mmdc`. A fence nested inside a wider
   fence is an example rather than a diagram and is skipped, matching what the viewer
   renders; `~~~mermaid` counts. `mmdc` is resolved from PATH, else from a
   `node_modules/.bin` at or above the bundle, and the binary that answered
   `--version` is the one that gets spawned, so running the script directly works as
   well as `npm run`. Flags: `--json` for machine output, `--timeout <s>` of wall clock
   per diagram (default 60), `--jobs <n>` parallel `mmdc` runs (default 2 - each one
   spawns a browser, so keep this low in constrained CI).
2. **Render gate** - `npm run okf:mermaid:render` (`scripts/okf-view.mts --check-render`)
   builds the widgets (when the project has them), writes `viz.html`, opens it in headless Chromium via the project-local `playwright`
   (falling back to `playwright-core`), walks every concept, and fails if any diagram
   ends in `error`, never leaves `pending` (20s per concept), or a concept renders a
   different number of figures than its markdown parses to. It also checks the pan/zoom
   wiring: a rendered diagram with no canvas or toolbar, or a zoom-in click that leaves
   the diagram's transform unchanged, is a failure. It catches what the parse
   gate cannot: viewer-specific `mermaid.initialize` options, theming directives, a
   CDN that the viewer cannot reach, and controls that were drawn but never wired.
   The same walk checks the explainer features: every quiz question renders and a click on a
   correct answer reveals its feedback and moves the score; a malformed question shows its
   error; every ` ```widget ` block mounts, and the control each widget marks `data-probe`
   changes what the widget shows when clicked.
   No `playwright`, no Chromium, or CDN libraries that never load are exit 2, with the
   fix printed.

Notes:

- Both gates are on **Mermaid 11**: the viewer pins `mermaid@11.17.2` and `mmdc` 11.x
  bundles its own 11.x, so a diagram that one accepts is a diagram the other accepts.
  Keep them on the same major when bumping either.
- Chromium's sandbox does not start under root, and also does not start on distros
  that restrict unprivileged user namespaces (Ubuntu 23.10+ with AppArmor). The parse
  gate renders one trivial diagram before checking anything, retries it with
  `--no-sandbox`, and reports which mode it settled on - so a browser that cannot
  start is exit 2 rather than a bundle that looks full of syntax errors. A headless box
  may also need `npx playwright install-deps chromium` for Chromium's system libraries.
- The two gates cover different files. The parse gate walks every `.md` in the bundle,
  including `index.md` and `log.md`; the render gate walks the concept graph, which those
  reserved files are not part of. The viewer never renders their bodies at all, so put
  diagrams in concepts: one in `index.md` parses but is shown nowhere.
- The render gate needs network access, because the viewer fetches Mermaid from a CDN.
  On an air-gapped runner, run the parse gate there and the render gate elsewhere;
  do not read its exit 2 as a pass.
- Binary pinning: `mmdc` honours `PUPPETEER_EXECUTABLE_PATH`; the render gate uses
  whatever Chromium `npx playwright install chromium` downloaded for the
  project-local playwright version. If a browser refuses to launch, run that install
  command (or re-run the gate on a machine where it worked) before editing the tools.
- `okf-mermaid.mts` is deliberately self-contained (its own walk and fence extraction)
  so it can live in a project with no other tooling.

### Design working notes are often *not* concepts

A file without a `type` is excluded from the graph, but it is also a conformance issue, so
"untyped on purpose" and "0 issues before committing" cannot both hold. Pick one per file:

- keep it in the bundle and give it a `type` (`Reference` suits a working note), so it is
  a real, if minor, concept; or
- keep it **outside** `okf/` (a `docs/notes/` or `design/` folder in the project) so the
  validator never walks it.

A scratch file parked inside the bundle without a type leaves a permanent issue in the
report, which trains everyone to ignore the report.

---

## Viewer features (`okf-view.mts`)

Based on the viewer in `GoogleCloudPlatform/knowledge-catalog`, not a verbatim copy. It walks
the bundle, checks conformance, builds a concept graph, and writes one self-contained
`viz.html`: **Cytoscape** for the graph, **marked** for concept bodies, **Mermaid** for inline
diagrams, all loaded from a CDN, so there's no build step. Beyond the reference viewer, this
version adds:

- a comfortable reading width and type
- the title shown once, not repeated
- the description as a lead line, tags as chips
- a collapsible "Sources and review" block
- tables that scroll sideways when they're wide
- each Mermaid diagram rendered on its own, with a visible error and its source if it fails
- pan/zoom on every Mermaid diagram: a toolbar (zoom out, zoom level, zoom in, fit,
  expand), drag to pan, Ctrl/Cmd + wheel to zoom at the pointer, double-click to fit,
  and an expand mode that covers the window until Esc or the close button. A bare
  wheel still scrolls the page, so a tall diagram cannot trap the reader
- an IDE-style status bar pinned to the bottom of the reading pane: it slides in once
  the concept header scrolls out of view and shows the concept type, its title, the
  section you are in, reading progress, and a "Top" button
- `--check-render`: after writing the viewer, open it in headless Chromium and audit that
  every Mermaid diagram settles into `rendered` with its pan/zoom controls attached, and
  that a zoom-in click actually moves the diagram (see [Mermaid (two gates)](#mermaid-two-gates))
- CDN scripts pinned with subresource-integrity hashes, so a changed file does not run
- URL hash deep links (`#app/overview`), so Back/Forward and reload land on the right concept
- opening the first `Application` concept by default
- raw-path link text replaced by the linked concept's title
- graph nodes sized by incoming links, with neighbour focus when a node is selected
- a legend
- ranked search, the same ranking as `okf-search` run in the page: a results list with each
  concept's trust, freshness and best-matching line, non-matches dimmed, a Match column in the
  table; a mode switch to a plain "contains" match; type, trust and freshness filters that combine
- a reading view toggle
- a theme that follows the system setting and is remembered
- the page title taken from the bundle's `index.md` H1
- **callouts**: a blockquote starting `[!note]`, `[!tip]`, `[!important]`, `[!warning]`,
  `[!caution]`, `[!definition]`, `[!example]` or `[!edge-case]` becomes a styled box
- **quizzes**: a ` ```quiz ` block becomes click-to-check questions with feedback and a score
- **widgets**: a ` ```widget ` block (name on the first line, optional data below it) mounts a React component from the project's
  `packages/okf-widgets` bundle, inlined into `viz.html` (so the page stays one file); a
  missing bundle or an unknown name shows a visible error, never a blank
- heading ids, so `[text](#section)` links scroll within a concept
- the bundle's declared `okf_version` reported, with a note when it is not the version the
  tool implements

```bash
node scripts/okf-view.mts okf                # validate + write okf/viz.html
node scripts/okf-view.mts okf --validate     # validate only
node scripts/okf-view.mts okf --fix         # first write the key under every ER diagram (see above)
node scripts/okf-view.mts okf --strict       # exit 1 on any issue
node scripts/okf-view.mts okf --out PATH     # custom output path
node scripts/okf-view.mts okf --check-render # + headless-browser audit: diagrams, quizzes, widgets
node scripts/okf-view.mts okf --widgets PATH # inline this widget bundle (default: packages/okf-widgets/dist/okf-widgets.js)
```

Validation report prints: bundle path, okf_version, valid concept count, graph edge count,
reserved-file count, issue count (missing/unparseable `type`, unreadable file, dangling
link, timestamp without an offset, ER diagram without its current key), trust-tier breakdown, and status breakdown. On success it writes `viz.html` and
prints its size.

`viz.html` renders bundle markdown as HTML, inline HTML included, and does not sanitise
it: it is built from content the same people wrote and publish. Generate it from your own
bundle, not from markdown you received.

### Keep it in sync

If the upstream Google reference viewer or a project's improved fork of `okf-view.mts` gets
better, port the change here (and `okf-mermaid.mts` the same way), and update this list and
`templates/package-json-scripts.md` to match the actual behaviour.

---

## Moving a bundle to a new OKF version

The spec says a minor bump is backward compatible (new optional fields, new headings) and a
major bump may rename required fields or reserved files (SPEC §12). Consumers read other
versions best-effort, so nothing breaks the day a new version ships; a bundle moves when its
owners choose to.

**In a project** (what an agent does when asked to "move the bundle to OKF vX"):

1. Refresh the tools: run the scaffold with `--tools-only` from an up-to-date skill.
   `npm run okf:validate` now prints the bundle's declared `okf_version` next to the version
   the tool implements.
2. Read the new spec's "Changes from v<old>" section in
   [okf-spec/SPEC.md](okf-spec/SPEC.md). Make a list of every rule that changed and what each
   means for this bundle (renamed fields, new required fields, changed formats).
3. Apply the changes concept by concept, with `npm run okf:validate` after each batch. Keep
   the edits mechanical; do not rewrite content in the same pass.
4. Set `okf_version` in the root `index.md` to the new version, and add a dated `log.md` entry
   naming the version change and anything that needed judgement.
5. Run every gate, and record the move as an ADR if a breaking change forced a real decision.

**In the okf-bootstrap repository** (maintainers): `npm run spec -- status` compares the
vendored spec with upstream (exit 1 when `SPEC.md` moved); `npm run spec -- update` moves the
`vendor/knowledge-catalog` submodule, re-vendors `SPEC.md`, and, when the version changed,
prints a checklist of the tools, templates and docs that name the old version.
