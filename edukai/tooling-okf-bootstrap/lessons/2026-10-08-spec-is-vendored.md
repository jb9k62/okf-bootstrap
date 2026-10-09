---
type: Lesson
title: The vendored OKF spec is refreshed with npm run spec, never by hand
description: The spec is pinned by a submodule and a vendored copy; npm run spec -- status/update moves it.
tags: [spec, vendor]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:17Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:52Z }
stale_after: 2026-11-07T20:07:52Z
sources:
  - resource: skills/okf-bootstrap/references/okf-spec/UPSTREAM.json
    digest: sha256:c381ee8d8c1ab7dd
  - resource: scripts/okf-spec.mts
    digest: sha256:d1644dc95ca03447
check:
  - { file: skills/okf-bootstrap/references/okf-spec/UPSTREAM.json, exists: true }
---

The OKF spec lives here in two forms, and neither is edited by hand.
`vendor/knowledge-catalog` is a shallow git submodule pinned to an upstream commit.
`skills/okf-bootstrap/references/okf-spec/` holds `SPEC.md` and `LICENSE.md` copied from it,
with `UPSTREAM.json` recording the commit and version. Let the script do both jobs.
`npm run spec -- status` compares the pin with upstream and exits 1 when `SPEC.md` has moved.
`npm run spec -- update` moves the submodule and copies the files in again. CI runs
`spec status` weekly, so an upstream change shows up without anyone looking for it.

## Caveats

- `status` exits 2 when it cannot reach upstream. That means "unproven", not "current".
