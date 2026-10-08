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

`okf-edukai-hook.mts` imports only `node:` built-ins and `./okf-rank.mts`. It never imports
`okf-core.mts` or `yaml`, and never runs code from the project. It has to stay that way: it
runs from an installed plugin where the project's `node_modules` may not exist, and its output
is put in front of an agent. `test/edukai.test.mts` runs it from outside the repository to
prove it does not depend on this one.

## Caveats

- The check proves the two specific imports are absent or present. It cannot prove no other
  dependency crept in; the test that runs the hook outside the repository is the real guard.
