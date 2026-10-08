# ADR-0002: Agent memory as a second, opt-in bundle

- **Status:** accepted (implemented in 0.4.0)
- **Date:** 2026-10-07
- **Deciders:** the maintainer
- **Spec:** [docs/specs/edukai-memory-bundle.md](../specs/edukai-memory-bundle.md)

## Context

okf-bootstrap set up one OKF bundle: `okf/`, design docs an agent writes so people can follow
the system. There was a second thing worth keeping: what the agent itself has learned about a
project, so the next session starts knowing it. Until now that was at best prose rules in an
`AGENTS.md`. Nothing checked them, and nothing told an agent that a fact it had written down a
week ago had since stopped being true.

The two kinds of knowledge have different readers (the team; the agent), different units (a
concept with many claims; a lesson with one) and different trust aims (reviewed by a person;
confirmed by a script). But both fit OKF v0.2 as it stands, and this repo already has a
validator, a ranked search and a viewer that read any OKF bundle.

## Decision

Add a second, opt-in bundle, `edukai/`, to this repo's scaffold (`--edukai`), built from three
parts:

1. **A tool** (`okf-edukai.mts`) for everything that needs no model: creating lesson files,
   pinning the files a lesson rests on by content digest, re-running a lesson's checks, deriving
   its state, and building the syllabus.
2. **Two thin harness adapters**, a Claude Code plugin hook and a pi extension, which call one
   dependency-free file (`okf-edukai-hook.mts`) when a session opens, when the agent touches a
   file a lesson cites, and when it is about to finish with a lesson it has just broken.
3. **A skill** (`edukai`) for the parts that need judgement.

The reasoning behind each rule, and the review that shaped them, is in section 15 of the spec.

## Consequences

### Positive

- One validator, search and viewer serve both bundles; `supersedes` pointers and `okf:recheck`
  came back to the design side for free.
- A lesson that has gone wrong is found by code and named to the agent that broke it. This was
  checked in both harnesses on 2026-10-07 (see "What was checked" below).
- Existing `okf/` bundles need no migration.

### Trade-offs

- `okf-view.mts` now imports the `check` rules from `okf-edukai-hook.mts`, so a project that
  copies the tools by hand needs seven files, not five.
- The hook file may import nothing but `node:` built-ins and `okf-rank.mts`. That rule costs a
  second file and a cache the hook cannot heal: a fresh clone needs one `npm run edukai:index`.
- Hooks fail silently by design, so a broken install looks like an empty memory.
  `EDUKAI_DEBUG=1` and the `AGENTS.md` snippet are the safety nets.
- The agent writes the lesson, its check and its first `verified` entry. A wrong lesson with a
  matching check stays fresh.

## What was checked

| | Claude Code 2.1.292 | pi 1.0.4 |
| --- | --- | --- |
| How it was loaded | `--plugin-dir` at this repo, and as a clone in the skills folder | `-e extensions/edukai.ts` |
| Models | Sonnet 5.5, Haiku 4.5 | DeepSeek V4 Flash (`deepinfra`) |
| Brief when the session opens | Reached the model; quoted back | Reached the model (as a message on the next turn) |
| Lesson named on reading a cited file | Reached the model; quoted back | Appended to the tool result |
| Finish nudge after breaking a lesson | Blocked the stop once; the model loaded the `edukai` skill and followed it | Started one follow-up turn; the model wrote the replacement lesson, verified it and superseded the old one |

A clone in Claude Code's skills folder loads as a local plugin (`okf-bootstrap@skills-dir`):
both skills are listed and the SessionStart hook answers.

Not checked: a Claude Code marketplace install; pi loading the extension through `pi install`
of the package (only `-e`, with a file and with the package folder); pi's interactive terminal
(only print mode).

One thing the pi run showed: on a project with no `scripts/okf-edukai.mts` (the demo), the
model searched the whole disk for the tool. The skill now says where the tool ships and not to
search for it, and the tool refuses a literal `<harness>/<model>` signature, which the same
run produced.

## Where the build departs from the spec

An adversarial review on 2026-10-07 found problems the spec had not foreseen. Each is fixed in
the code and differs from the spec's text:

| Spec | Built | Why |
| --- | --- | --- |
| Every Claude Code hook runs `node …/okf-edukai-hook.mts hook` | It runs `node …/hooks/edukai-hook.mjs`, which calls the same code | On a Node older than 22.18 the `.mts` cannot load, and Claude Code showed a hook error in every project instead of silence |
| `cites` prints `[confidence] title` | A lesson in the queue is printed as `[failed · observed] title: reason` | Otherwise the hook hands the agent a lesson the re-check already knows is wrong, as if it were current |
| `debt` names lessons citing a file the session edited that are now wrong | It leaves out lessons that were already wrong when the session first read the file | The nudge said "your changes left N lessons wrong" for breakage the session did not cause, and blocked the stop for it |
| The adapters look for `<project>/edukai/index.md` | They take the nearest `edukai/index.md` at or above the working folder | A session started in a subfolder looked like a project with no memory |
| The session file is `{ shown, edited, nudged }` | It also has `prior`, and is changed under a lock | Parallel tool calls run hooks in parallel; an edit lost in that race was a nudge that never fired |
| A lesson may be `status: deprecated` on its own | The validator wants `superseded_by` with it | A hand-set status hid a failing lesson from the re-check |

Also from the review: every piece of bundle text that reaches the agent (titles, ids, check
text, paths) is flattened to one line, so a lesson cannot forge a second `edukai:` line.

Fixed since: a `matches` regular expression now gets 200 ms, and one that runs out is reported
as a failed check instead of stalling a hook until its 5-second timeout.

Known and not fixed: on a file system that ignores case, a path written in
another case finds no lesson; a project with no `node_modules` keeps its cache in the temp
dir, so a harness whose shell tool uses a different `TMPDIR` than its hooks would never see an
index; `bootstrap.mts --edukai` cannot yet make a memory bundle without a design bundle.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| A separate repository for the memory side | It would need its own validator, search and scaffold, all of which exist here |
| Lessons as concepts inside `okf/` | Different readers and rules; hundreds of one-claim files would bury the design docs |
| Rely on each harness's own memory files | No shared format, nothing pins a claim to a file, and a lesson learned in one harness is invisible in the other |
| A hook that matches each prompt against lessons | Left for later (spec, L1): a pointer added to every prompt must first be shown to help |
