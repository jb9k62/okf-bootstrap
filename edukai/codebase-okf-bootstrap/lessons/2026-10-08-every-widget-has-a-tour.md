---
type: Lesson
title: Every registered widget must appear in a demo tour
description: A test reads the widget registry and fails if the demo bundle has no tour using a widget.
tags: [widgets, testing]
confidence: observed
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:03:18Z }
verified:
  - { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:07:52Z }
stale_after: 2026-11-07T20:07:52Z
sources:
  - resource: test/render.e2e.mts
    digest: sha256:b5978cce219e718b
  - resource: skills/okf-bootstrap/assets/templates/okf-widgets/src/index.tsx
    digest: sha256:f7e413c9df9697e9
check:
  - { file: test/render.e2e.mts, contains: "the demo has no tour using widget" }
---

A widget is not finished until a tour in the demo bundle uses it. `test/render.e2e.mts` reads
the widget registry in `templates/okf-widgets/src/index.tsx` and fails when a registered
widget appears in no tour under `examples/demo/okf`. The same test counts the demo's
` ```widget ` blocks against the render gate's report, so the gate cannot quietly skip one.
When you register a widget, add a demo tour that uses it in the same change.

## Caveats

- The rule covers the demo bundle only. This repository's own `okf/` tours may use just some
  of the registered widgets.
