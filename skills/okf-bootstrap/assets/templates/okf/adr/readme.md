---
type: Reference
title: Decision records
description: What an ADR is, the decisions recorded so far, and how to add one.
tags: [adr, architecture, decisions]
generated: { by: okf-bootstrap/{{VERSION}}, at: {{NOW}} }
---

# Decision records

An Architectural Decision Record (ADR) captures one significant decision: its context, the
choice, the alternatives rejected, and the consequences accepted. With ADRs, "why is it like
this?" never needs someone who was there. The format follows Michael Nygard's *Documenting
Architecture Decisions*.

## Recorded decisions

| ADR | Decision | Status |
|---|---|---|
| - | None yet. Record the first one and add a row here. | - |

## Adding one

- Copy the [template](/adr/template.md) to `NNNN-short-title.md` and add it to the table above,
  linking the number (`0001`) to the new file.
- Record one decision, with at least one rejected alternative and why. Without alternatives, an
  ADR explains nothing.
- Keep it to about a page, written for a reader who doesn't share your context.
- Record choices that are costly to reverse or likely to be questioned (stack, module
  boundaries, data model, API contract), not every small one.
- Statuses: **proposed**, **accepted**, **superseded** or **deprecated**. Update the status
  instead of rewriting history.
- To supersede a record, write the new one and point the two at each other in their
  frontmatter: `supersedes: /adr/NNNN-old.md` on the new record, and `status: deprecated` with
  `superseded_by: /adr/NNNN-new.md` on the old. `npm run okf:validate` reports a pair that does
  not match, and the search flags the old record as replaced.
