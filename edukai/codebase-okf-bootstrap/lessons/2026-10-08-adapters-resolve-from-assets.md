---
type: Lesson
title: The harness adapters resolve the memory hook from the skill assets
description: Both the pi extension and the Claude Code hook load okf-edukai-hook.mts from skills/okf-bootstrap/assets/.
tags: [hooks, adapters]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:18Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:52Z }
stale_after: 2026-11-07T20:07:52Z
sources:
  - resource: extensions/edukai.ts
    digest: sha256:3c183f07f96cd5d4
  - resource: hooks/edukai-hook.mjs
    digest: sha256:732780960a7e6ef3
check:
  - { file: extensions/edukai.ts, contains: "'../skills/okf-bootstrap/assets/okf-edukai-hook.mts'" }
  - { file: hooks/edukai-hook.mjs, contains: "'../skills/okf-bootstrap/assets/okf-edukai-hook.mts'" }
---

Both harness adapters resolve the memory hook's core from this repository's skill assets.
`extensions/edukai.ts` (the pi adapter) computes the path from `import.meta.url`, and
`hooks/edukai-hook.mjs` (what Claude Code runs) imports
`../skills/okf-bootstrap/assets/okf-edukai-hook.mts` relative to itself. Neither runs code from
the project, both load the compile cache first, and both are quiet in a project with no
`edukai/index.md`.

## Caveats

- Moving `okf-edukai-hook.mts` under `assets/` breaks both adapters at once. That is the
  intended early warning, but it is not caught by a test that runs inside this repository.
