---
type: Lesson
title: The release version lives in four places that must match
description: package.json, both plugin manifests and bootstrap.mts all carry the version, and tests compare them.
tags: [release, versioning]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:17Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:52Z }
  - { by: process:edukai-recheck, at: 2026-10-08T20:16:39Z }
stale_after: 2026-11-07T20:16:39Z
sources:
  - resource: package.json
    digest: sha256:01441be84a9f1ca1
  - resource: package-lock.json
    digest: sha256:2c6e9f61ebb2b33c
  - resource: .claude-plugin/plugin.json
    digest: sha256:a46a772dcd4fb590
  - resource: .claude-plugin/marketplace.json
    digest: sha256:4fef78fd844166fa
  - resource: skills/okf-bootstrap/assets/bootstrap.mts
    digest: sha256:9fce9b0d9b8c9974
check:
  - { file: package.json, contains: '"version": "' }
  - { file: package-lock.json, contains: '"version": "' }
  - { file: .claude-plugin/plugin.json, contains: '"version": "' }
  - { file: .claude-plugin/marketplace.json, contains: '"version": "' }
  - { file: skills/okf-bootstrap/assets/bootstrap.mts, contains: "const VERSION = '" }
---

The release version lives in four places and they must match: `package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the `VERSION` constant in
`bootstrap.mts`, which is stamped into scaffolded frontmatter as the producer. `package-lock.json`
carries it too and is bumped with `package.json`. Tests compare them: `test/bootstrap.test.mts`
checks `VERSION` against `package.json` and the plugin manifest against `package.json`, and the
release-metadata test in `test/edukai.test.mts` checks `package.json`, both manifests and
`package-lock.json`. A release bumps all of them, adds a changelog entry, then tags.

## Caveats

- The checks prove a version field exists in each file, not that the values agree. The tests are
  what compare the values.
