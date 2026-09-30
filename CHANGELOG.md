# Changelog

## Unreleased

- **README** rewritten around screenshots of the viewer, a widget (before and after one click)
  and a quiz, in light and dark.
- **`npm run screenshots`** (`scripts/screenshots.mts`) regenerates `docs/images` from the
  demo bundle; the `screenshots` workflow runs it on `main` and commits changed images.
- **Demo** grown into the "Parcel tracker" bundle: 13 concepts (overview, architecture, data
  model, API, metric, runbook, three ADRs, two tours) showing types, trust tiers, a draft and
  a stale concept.
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
