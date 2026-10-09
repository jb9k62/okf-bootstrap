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

A release has one version, written in four places that must match: `package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the `VERSION` constant
in `bootstrap.mts`, which is stamped into scaffolded frontmatter as the producer.
`package-lock.json` carries it too and is bumped with `package.json`. Tests catch a
mismatch: `test/bootstrap.test.mts` compares `VERSION` and the plugin manifest with
`package.json`, and the release-metadata test in `test/edukai.test.mts` compares
`package.json`, both manifests and `package-lock.json`. To release, bump all of them, add a
changelog entry, then tag.

## Caveats

- The checks here only prove that each file has a version field. They do not compare the
  values; the tests do.
