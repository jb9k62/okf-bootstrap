---
type: Lesson
title: okf-rank.mts imports nothing so the viewer can inline it
description: The ranking is pure TypeScript with no imports, which is what lets one copy run in Node and in the page.
tags: [viewer, ranking]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:18Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:08:56Z }
stale_after: 2026-11-07T20:08:56Z
sources:
  - resource: skills/okf-bootstrap/assets/okf-rank.mts
    digest: sha256:02fa0a839b584bd9
check:
  - { file: skills/okf-bootstrap/assets/okf-rank.mts, lacks: "import " }
---

`okf-rank.mts` imports nothing, and touches no `fs`, `path`, `process` or DOM. That is what
lets `okf-view.mts` read it, strip its types with Node's `stripTypeScriptTypes`, remove its
`export ` prefixes and inline it into `viz.html` as a plain script, so one ranking serves both
`okf-search` and the viewer's search box.

## Caveats

- "No imports" is not "no dependencies": it uses only language built-ins, which is exactly why
  both a Node module and a browser script can run it.
- A comment in the file mentions imports, so a check for the word alone would be wrong. The
  check looks for `import ` with a trailing space, which only a real import statement has.
