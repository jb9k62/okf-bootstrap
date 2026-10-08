---
type: Reference
title: Agent memory
description: The edukai bundle, its lesson rules, and the hooks that hand a lesson back at the moment it matters.
tags: [edukai, memory, hooks]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:20:00Z }
sources:
  - resource: skills/edukai/SKILL.md
  - resource: skills/okf-bootstrap/assets/okf-edukai.mts
  - resource: skills/okf-bootstrap/assets/okf-edukai-hook.mts
  - resource: extensions/edukai.ts
  - resource: hooks/hooks.json
---

# Agent memory

`edukai/` is the second bundle: what agents have learned about a project, kept so the next
session starts knowing it. It is written by agents for agents, and it is kept apart from the
design bundle ([ADR-0002](/adr/0002-two-bundles-design-and-memory.md)). The rules for writing
one live in the `edukai` skill; this concept is about the machinery.

## Layout and a lesson

```text
edukai/
├── index.md                  the syllabus; one generated block (npm run edukai:index)
├── log.md                    dated update history
└── <domain>/                 codebase-…, tooling-… or user-, lowercase-hyphen
    ├── overview.md           type: Overview; teaches the domain in two to five paragraphs
    └── lessons/
        └── YYYY-MM-DD-short-claim.md   type: Lesson; one claim
```

A lesson is one claim, as a sentence, with the files it rests on. `okf-edukai.mts new` writes
the file; a person or an agent fills the body; `verify` runs the checks, pins a digest of every
file source, and records who verified it and when it goes stale.

- **`sources`** are paths from the project root, or bundle-root paths, or URLs. `verify` stores
  a content digest beside each file source.
- **`check`** is what lets a lesson survive an unrelated edit to a file it cites. Each entry
  has a `file` and exactly one of `contains`, `lacks` (literal text), `matches` (a JavaScript
  regular expression, at most 200 characters, given 200 ms) or `exists` (`true` or `false`).
  There are no shell commands.
- **`confidence`** is `tested` (reproduced it), `observed` (saw or read it) or `inferred`
  (deduced it). A lesson with no `verify` stays `inferred`.

## What a lesson's state means

`recheck` derives one state per lesson from the digests and the checks. Only the first four
need an agent.

| State | Means | What to do |
| --- | --- | --- |
| `broken` | a pinned source, or a file a check names, is gone | find where the fact lives now |
| `failed` | a check no longer holds | the claim is probably false now |
| `suspect` | a source changed, and no check vouches for the claim | re-read the source |
| `stale` | past `stale_after`, and no check vouches for it | re-read the source |
| `renewable` | a source changed or time passed, but every check still holds | `recheck --write` renews it; no agent needed |
| `unverified` | `confidence: inferred`, never verified | leave it until it matters |
| `fresh` | nothing to do | nothing |

A claim that is no longer true is **superseded**, never edited to match and never deleted: the
new lesson gets `supersedes: /old.md`, the old one `status: deprecated` and `superseded_by:
/new.md`. The history of what was believed is part of the memory.

## The hooks

Three moments matter, and both harnesses implement the same three from the same core file:

| Moment | Command | What it says |
| --- | --- | --- |
| a session opens, or is compacted | `brief` | the domains, their lesson counts and their overviews, plus what needs an agent. Titles and pointers only, never a lesson's text |
| the agent reads or edits a file a lesson cites | `cites` | the lessons that rest on that file, with the state of any that is in the re-check queue. Once per session |
| the agent is about to finish having broken a lesson | `debt` | the lesson its own change left wrong. Named once per session, so it cannot loop |

`hooks/hooks.json` wires the Claude Code plugin: SessionStart, PostToolUse on `Read` and on
`Edit|Write|NotebookEdit`, and Stop. `extensions/edukai.ts` is the pi adapter for
`session_start`/`session_compact`, `tool_result` and `agent_end`. Both resolve
`assets/okf-edukai-hook.mts` from this repository, run it with a five-second timeout, and stay
silent on any error. In a project with no `edukai/index.md` the hooks do nothing.

The core file must stay dependency-free because it runs from an installed plugin where the
project's `node_modules` may not exist: it imports only `node:` built-ins and `./okf-rank.mts`
([the tools](/okf-bootstrap/tools.md)).

## Where it is exercised

`examples/demo/edukai/` is a full memory bundle whose lessons pin real files under
`examples/demo/`. Three of those files were changed on purpose after the lessons were written,
so the re-check always has something to find. `npm run demo:edukai` runs the brief and the
re-check against a fixed clock, and `examples/demo/README.md` walks through it.
