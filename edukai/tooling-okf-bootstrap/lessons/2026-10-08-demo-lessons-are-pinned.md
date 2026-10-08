---
type: Lesson
title: The demo's lessons pin digests of files under examples/demo
description: Editing a demo source file changes a lesson's state and the report a test pins, so expect to update both.
tags: [demo, edukai]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:17Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:51Z }
  - { by: process:edukai-recheck, at: 2026-10-08T20:16:39Z }
stale_after: 2026-11-07T20:16:39Z
sources:
  - resource: examples/demo/README.md
    digest: sha256:b1f5f8712bd5b6d7
  - resource: test/edukai.test.mts
    digest: sha256:294e602ce1b4a4ce
check:
  - { file: examples/demo/README.md, contains: "changed on purpose" }
---

`examples/demo/edukai/` holds lessons whose `sources` pin digests of files under
`examples/demo/`. Editing one of those files changes a lesson's state, which changes the brief
and the re-check report that `test/edukai.test.mts` pins. Three files were changed on purpose
after the lessons were written, so the demo always has something for the re-check to find;
`examples/demo/README.md` lists them: a comment added to `src/poller/carriers.ts`, the timeout
in `src/poller/config.ts` going from `10_000` to `8_000`, and `scripts/seed.ts` being deleted.

## Caveats

- Update the lesson, or the pinned report, in the same change as a demo edit.
- The demo clock is fixed at `2026-10-15T00:00:00Z`, so the output does not drift with the real
  date.
