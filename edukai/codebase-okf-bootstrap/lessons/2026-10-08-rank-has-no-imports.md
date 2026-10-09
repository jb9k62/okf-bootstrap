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

`okf-rank.mts` imports nothing, and it never touches `fs`, `path`, `process` or the DOM. Keep
it that way, because the file runs in two places. `okf-search` loads it as a module in Node.
`okf-view.mts` reads the same file, strips its types with Node's `stripTypeScriptTypes`,
removes each `export ` prefix and inlines the result into `viz.html` as a plain script. One
ranking then serves both the command line and the viewer's search box.

## Caveats

- "No imports" is not "no dependencies". The file uses only language built-ins, and that is
  exactly why a Node module and a browser script can both run it.
- The check looks for `import ` with a trailing space, which only a real import statement
  has. A comment in the file mentions imports, so a check for the word alone would be wrong.
