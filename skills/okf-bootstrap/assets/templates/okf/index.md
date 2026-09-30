---
okf_version: "0.2"
---

# {{PROJECT_NAME}}

Architecture, contracts, and decisions for {{PROJECT_NAME}}, in
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
Start at the overview and follow links down to the detail you need.

## Application

Write these first, then link each one here as it lands:

* `{{PROJECT_SLUG}}/overview.md` - what the app does, what it leaves out, and reading paths
* `{{PROJECT_SLUG}}/architecture.md` - components and how they fit together
* `{{PROJECT_SLUG}}/domain-model.md` - the entities and how they relate
* `{{PROJECT_SLUG}}/api.md` - the routes or interfaces exposed

Use a bundle-root link with descriptive text, as the entries below do. They start as
plain paths because `npm run okf:validate` reports a link whose target file does not
exist yet, and a fresh bundle should validate clean.

## Decisions

* [Decision records](/adr/readme.md) - what an ADR is, and how to add one
* [ADR template](/adr/template.md) - starting point for a new record

## Viewer

`npm run okf:validate` checks the bundle against the spec (frontmatter and links). `npm run okf:view` also writes `okf/viz.html`
(gitignored): a concept graph beside a reading pane. Open it in a browser; its libraries load
from a CDN.

Update history: [log.md](/log.md).
