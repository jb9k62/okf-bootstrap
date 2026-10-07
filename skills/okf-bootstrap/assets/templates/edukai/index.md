---
okf_version: "0.2"
---

# {{PROJECT_NAME}}: agent memory

What agents have learned while working on {{PROJECT_NAME}}, kept so the next session starts
knowing it. This is the **memory bundle**. The design bundle, written for the team, is in
`okf/`.

## Domains

One line per domain, written by `npm run edukai:index`. Do not edit between the markers.

<!-- edukai:index -->
*No domains yet. The first lesson creates one.*
<!-- /edukai:index -->

## How it is kept

- A **lesson** is one claim, with the files it rests on, in
  `<domain>/lessons/YYYY-MM-DD-short-claim.md`. Each domain has one `overview.md`.
- `npm run edukai:recheck` lists the lessons that need an agent: a cited file is gone, a check
  no longer holds, a source changed, or the lesson is past its `stale_after`.
- A lesson that stopped being true is superseded by a new one, never edited or deleted.
- `npm run edukai:search -- search "words"` finds a lesson; `npm run edukai:validate` checks
  the bundle.

Update history: [log.md](/log.md).
