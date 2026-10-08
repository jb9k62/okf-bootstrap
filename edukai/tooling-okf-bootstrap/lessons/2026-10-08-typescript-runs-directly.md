---
type: Lesson
title: The tools are TypeScript that Node runs with no build step
description: The tools run by type stripping, so only erasable TypeScript is allowed and no package.json "type" change is needed.
tags: [typescript, node]
confidence: tested
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:17Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:52Z }
  - { by: process:edukai-recheck, at: 2026-10-08T20:16:39Z }
stale_after: 2026-11-07T20:16:39Z
sources:
  - resource: tsconfig.json
    digest: sha256:04b6d82970b64440
  - resource: package.json
    digest: sha256:01441be84a9f1ca1
check:
  - { file: tsconfig.json, matches: erasableSyntaxOnly }
  - { file: package.json, matches: '"node": ">=24"' }
---

Every tool under `skills/okf-bootstrap/assets/` is TypeScript that Node runs directly by type
stripping: there is no build step, and a target project's `package.json` `"type"` is never
changed. `tsconfig.json` sets `erasableSyntaxOnly`, so only syntax Node can strip is allowed
(no enums, namespaces or parameter properties), and imports name the real `.mts` extension.
`package.json` declares Node `>=24`; 22.18+ also runs the tools.

## Caveats

- The check proves the flag is set, not that every file obeys it. `npm run typecheck` proves
  that.
- `.mts` is always ESM, whatever the nearest `package.json` says. A plain `.ts` file would not
  have that guarantee.
