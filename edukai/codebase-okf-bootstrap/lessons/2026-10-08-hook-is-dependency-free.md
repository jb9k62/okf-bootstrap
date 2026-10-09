---
type: Lesson
title: "okf-edukai-hook.mts imports only node: built-ins and okf-rank.mts"
description: The hook core never imports yaml or okf-core, because it runs from an installed plugin with no project node_modules.
tags: [hooks, edukai]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:18Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:08:56Z }
stale_after: 2026-11-07T20:08:56Z
sources:
  - resource: skills/okf-bootstrap/assets/okf-edukai-hook.mts
    digest: sha256:d92ed7f3e70e839e
check:
  - { file: skills/okf-bootstrap/assets/okf-edukai-hook.mts, contains: "from './okf-rank.mts'" }
  - { file: skills/okf-bootstrap/assets/okf-edukai-hook.mts, lacks: "from 'yaml'" }
---

`okf-edukai-hook.mts` may import two things: `node:` built-ins and `./okf-rank.mts`. It never
imports `okf-core.mts` or `yaml`, and it never runs code from the project. The reason is where
it runs: from an installed plugin, in a project whose `node_modules` may not exist, with its
output put in front of an agent. An import that works in this repository can fail there. Keep
it this way. `test/edukai.test.mts` runs the hook from outside the repository to prove it
stands on its own.

## Caveats

- The check only looks for the two imports it names. It cannot tell you that no other
  dependency crept in. The test that runs the hook outside the repository is the real guard.
