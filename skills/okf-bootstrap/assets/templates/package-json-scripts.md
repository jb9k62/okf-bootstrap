# package.json: scripts to add for the OKF tooling

Add these to the target project's `package.json` `scripts` block. They assume the viewer
tool lives at `scripts/okf-view.mts`, the mermaid parse checker at
`scripts/okf-mermaid.mts`, and the bundle at `okf/` (the defaults). The scaffold adds them
for you when a `package.json` is present; this is the reference for editing by hand.

## Dependencies

- Node 24+ (22.18+ works): the tools are TypeScript that Node runs directly.
- `yaml` (dev dep) - what `okf-view.mts` needs to parse frontmatter. The scaffold adds it
  for you; it still needs an `npm install`.
- `@mermaid-js/mermaid-cli@11` (dev dep) - provides `mmdc`, the real Mermaid parser
  behind `okf:mermaid`. Keep it on Mermaid 11, the major the viewer pins. First run
  downloads a Chrome build for puppeteer (~170 MB).
- `playwright` (dev dep) - drives headless Chromium for `okf:mermaid:render`.
  Also run `npx playwright install chromium` once. Without it that script exits 2:
  the gate cannot run, which is not the same as passing.

```bash
npm install
npm install -D @mermaid-js/mermaid-cli@11 playwright
npx playwright install chromium
```

The tools are `.mts` files, so they are ESM whatever `package.json` says: no
`"type": "module"` is needed, and adding one would change how the rest of the
project's `.js` files are loaded.

## Scripts

```jsonc
"scripts": {
  "okf:validate":       "node scripts/okf-view.mts okf --validate",
  "okf:fix":            "node scripts/okf-view.mts okf --validate --fix",
  "okf:view":           "node scripts/okf-view.mts okf",
  "okf:mermaid":        "node scripts/okf-mermaid.mts okf",
  "okf:mermaid:render": "node scripts/okf-view.mts okf --check-render",
  "okf:search":         "node scripts/okf-search.mts"
}
```

`okf:search` is not a gate; it is how an agent finds concepts without reading every file (`npm run
okf:search -- search "query" --fresh`; see the playbook's "Finding concepts"). It needs `okf-core.mts`
beside it in `scripts/`, as does `okf-view.mts`: copy all four tools, or let the scaffold.

`okf:fix` is not a gate: it rewrites the bundle's markdown so every ` ```mermaid ` `erDiagram`
has its generated relationship key below it. `okf:validate` fails until it has been run.

With widgets (`--widgets`), the package is an npm workspace and is built first:

```jsonc
"workspaces": ["packages/okf-widgets"],
"scripts": {
  "okf:view":              "npm run okf:widgets:build && node scripts/okf-view.mts okf",
  "okf:mermaid:render":    "npm run okf:widgets:build && node scripts/okf-view.mts okf --check-render",
  "okf:widgets:build":     "npm run build -w okf-widgets",
  "okf:widgets:test":      "npm test -w okf-widgets",
  "okf:widgets:typecheck": "npm run typecheck -w okf-widgets"
}
```

All four should pass before committing bundle changes: `okf:validate` checks frontmatter
link and timestamp conformance, `okf:mermaid` parses every mermaid block with `mmdc`, and
`okf:mermaid:render` opens the generated viewer headlessly and asserts every diagram
actually renders client-side, every quiz answers a click, and every widget mounts and
responds to its probe control.

Both mermaid gates use the same exit-code contract: **0** all good, **1** a diagram is
broken (a content problem, fix the markdown), **2** the gate could not run at all (a
setup problem: missing tool, browser that will not start, CDN unreachable). Exit 2 never
means the diagrams are fine.

## Direct CLI usage

```bash
node scripts/okf-view.mts okf            # validate + write okf/viz.html
node scripts/okf-view.mts okf --validate # validate only (no viz.html written)
node scripts/okf-view.mts okf --strict   # exit 1 if any conformance issue
node scripts/okf-view.mts okf --out docs/okf.html   # custom output path
node scripts/okf-view.mts okf --check-render        # + browser check: diagrams, quizzes, widgets
node scripts/okf-view.mts okf --widgets path/to/okf-widgets.js  # inline another widget bundle
node scripts/okf-mermaid.mts okf           # parse every mermaid block via mmdc
node scripts/okf-mermaid.mts okf --json    # machine-readable report
node scripts/okf-mermaid.mts okf --jobs 4  # more parallel mmdc runs (each spawns a browser)
```

`okf-view.mts` flags: `--out <file>` (default `<bundle>/viz.html`), `--validate`
(validate only), `--check-render` (browser render check after writing the viewer),
`--strict` (exit 1 when there are conformance issues).

`okf-mermaid.mts` flags: `--json`, `--timeout <seconds>` (wall clock per diagram,
default 60), `--jobs <n>` (parallel mmdc runs, default 2). Exit codes: 0 all parse,
1 parse errors, 2 setup problem (bundle missing, `mmdc` not found, or `mmdc` cannot
render at all).

## What it validates

`okf-view.mts` (OKF v0.2 §11): while walking the bundle it reports, per non-reserved
`.md` file, whether it has a **non-empty `type`** in a **parseable YAML frontmatter**
block. The bundle root's own `index.md` and `log.md` are reserved and do not need a type
(a nested `design/index.md` is an ordinary concept and does). It also reports
**dangling links**: an internal link whose target file is not in the bundle, which would
otherwise just vanish from the graph. Links written inside code spans or fenced blocks
are not links and are ignored. It derives a trust tier (`unverified` /
`human-reviewed` / `machine-confirmed` from `verified.by`) and staleness
(`stale_after`), and counts graph edges from internal links.

`okf-mermaid.mts`: extracts every top-level ```` ```mermaid ```` fenced block (with file
+ line numbers) and runs it through `mmdc`, so only diagrams the real Mermaid parser
accepts pass. A fence nested inside another fence is an example, not a diagram, and is
skipped; `~~~mermaid` counts. It resolves `mmdc` from PATH, else from a
`node_modules/.bin` at or above the bundle, and spawns the binary it probed, so a direct
`node scripts/okf-mermaid.mts okf` works as well as `npm run`. Before checking anything
it renders one trivial diagram to prove the browser starts, retrying with
`--no-sandbox` (needed under root, and on distros that restrict unprivileged user
namespaces such as Ubuntu 23.10+). A browser that cannot start is then reported as a
setup problem, not as a bundle full of syntax errors.

`okf-view.mts --check-render`: the client-side guarantee. After writing `viz.html` it
opens the file in headless Chromium via the project-local `playwright` (falling back to
`playwright-core`), walks every concept through the viewer's `show()`, and fails (1) if
any diagram ends in an error state, never leaves `pending` (20s per concept), or a
concept renders a different number of figures than its markdown parses to. It exits 2,
naming the fix, when it could not run: no `playwright`, no Chromium, or the viewer's CDN
libraries never loaded. Because the viewer fetches Mermaid from a CDN, this gate needs
network access - on an air-gapped runner, run the parse gate there and the render gate
elsewhere rather than reading exit 2 as a pass.