---
type: Lesson
title: Tests run via make test
description: The test suite is run with make test.
tags: [testing]
confidence: observed
status: deprecated
generated: { by: claude-code/opus-5.5, at: 2026-08-20T09:00:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-08-20T09:00:00Z }
stale_after: 2026-09-19T09:00:00Z
superseded_by: /tooling-parcel-tracker/lessons/2026-08-23-ci-runs-tests-via-btest.md
sources:
  - id: make
    resource: Makefile
    digest: sha256:533ba53fa27926a1
---

The test suite is run with `make test`: the `Makefile` has a `test` target and nothing else in
the repository starts the tests.[^make]

[^make]: The Makefile
