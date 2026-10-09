# Bundle update log

## 2026-10-09
* **Proposed**: two decision records, neither implemented yet. Bundles named for what they
  hold, with `design/` as the default and an optional `ops/`
  ([ADR-0005](/adr/0005-name-bundles-by-what-they-hold.md)), and the tools published to npm
  as `@jb9k62/good2go` ([ADR-0006](/adr/0006-publish-the-tools-to-npm.md)).

## 2026-10-08
* **Creation**: Established the okf-bootstrap OKF v0.2 bundle: root `index.md`, `log.md`, the
  ADR area, and the first concepts and tours.
* **Self-hosting**: the tools run from `skills/okf-bootstrap/assets/`, not from generated
  copies under `scripts/`, so this bundle is checked by the same tools it ships
  ([ADR-0003](/adr/0003-run-the-tools-from-the-skill-assets.md)).
* **Memory bundle**: added `edukai/` beside this bundle, with the first lessons about the
  repository ([ADR-0002](/adr/0002-two-bundles-design-and-memory.md)).
* **Copy-edit**: rewrote the prose of the concepts, decision records and tours to be plainer
  and to teach as they go. Diagrams, quizzes and frontmatter are unchanged. Corrected four
  claims on the way: `okf:recheck` has nothing to report until a concept is pinned (ADR-0001),
  CI validates the bundles but does not run the memory re-check (ADR-0001), `npm run check`
  includes the Chromium view tests, and tests compare the version in all four places
  ([testing and CI](/okf-bootstrap/testing.md)).
