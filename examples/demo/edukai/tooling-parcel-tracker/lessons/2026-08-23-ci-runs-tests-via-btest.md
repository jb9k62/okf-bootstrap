---
type: Lesson
title: CI runs tests via btest, not make
description: The suite runs through btest. make test is only a wrapper around it.
tags: [testing, ci]
confidence: tested
generated: { by: claude-code/opus-5.5, at: 2026-08-23T10:12:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-08-23T10:12:00Z }
  - { by: process:edukai-recheck, at: 2026-10-06T00:00:00Z }
stale_after: 2026-11-05T00:00:00Z
supersedes: /tooling-parcel-tracker/lessons/2026-08-20-tests-run-via-make.md
sources:
  - id: ci
    resource: .github/workflows/ci.yml
    digest: sha256:64e7950abbe1f1ce
  - id: make
    resource: Makefile
    digest: sha256:533ba53fa27926a1
check:
  - { file: .github/workflows/ci.yml, contains: "btest run" }
---

CI runs the suite with `btest run --shard auto`, not through `make`.[^ci] `make test` still
exists but only calls `btest run`.[^make]

## Caveats

- Local runs through the old make target still pass, so habit gives false confidence.

[^ci]: The CI workflow
[^make]: The Makefile
