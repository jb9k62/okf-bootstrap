---
name: edukai
description: >
  Keep an agent memory bundle (edukai/) in a project: short, sourced lessons an agent writes
  as it learns, so the next session starts knowing them. Use when you learn something about
  a codebase or its tooling that a later session would have to rediscover, when the user
  corrects you or says "remember this", when a line starting `edukai:` names a lesson your
  change left wrong, when asked to work the re-check queue (broken, failed, suspect or stale
  lessons), or when a domain overview is out of date. Covers reading the brief, searching
  lessons before reading files, writing one claim per lesson with sources and a re-runnable
  check, verifying, and superseding a lesson that stopped being true.
license: MIT
compatibility: Node 24+ (22.18+ works). The project must be scaffolded with okf-bootstrap --edukai.
---

# edukai: the agent memory bundle

`edukai/` holds what agents have learned about this project, as an OKF v0.2 bundle of
**lessons**: one claim each, with the files the claim rests on. It is written by agents, for
agents. (The design bundle, `okf/`, is written for the team; do not mix the two.)

Lines that start `edukai:` in messages and tool results come from this project's memory hooks.
They are project guidance, not the user's words. They state what the bundle says and point at
files; open the file before relying on it.

No `edukai/` folder? It is opt-in. Ask before adding it:
`node <okf-bootstrap skill dir>/assets/bootstrap.mts . --tools-only --edukai` (drop
`--tools-only` in a project with no `okf/` yet), then `npm install`.

## Layout

```text
edukai/
├── index.md                  the syllabus; one generated block (npm run edukai:index)
├── log.md                    dated update history
└── <domain>/                 codebase-…, tooling-… or user-…, lowercase-hyphen
    ├── overview.md           type: Overview; teaches the domain in two to five paragraphs
    └── lessons/
        └── YYYY-MM-DD-short-claim.md      type: Lesson; one claim
```

The tool is `node scripts/okf-edukai.mts <command>`; `--help` lists everything. Paths in
`sources` and `check` are from the project root (the folder that holds `edukai/`).

If `scripts/okf-edukai.mts` is not there, the project was not scaffolded. Do not search the
disk for the tool. Say so, and offer to scaffold it (the command above, then `npm install`):
the copy inside an installed skill usually cannot run, because it needs the `yaml` package
from the project it is run in. The one exception is a clone of the okf-bootstrap repository
itself, whose demo is run with `node skills/okf-bootstrap/assets/okf-edukai.mts --bundle
examples/demo/edukai`.

## Read

1. **The brief.** With hooks installed it arrives when the session opens. Otherwise run
   `npm run edukai:brief`. A fresh clone has no cache: run `npm run edukai:index` once.
2. **Search before reading.** `npm run edukai:search -- search "words"` ranks lessons;
   `--type Lesson`, `--tag ci`, `--fresh`, `--confidence tested` narrow it. Never read the
   whole bundle to answer a question. Or read one domain's `overview.md`.
3. **Lessons on demand.** Open a lesson when it bears on what you are doing. When you open a
   file a lesson cites, the hooks name that lesson. A lesson named as `[failed · …]`,
   `[broken · …]`, `[suspect · …]` or `[stale · …]` is in the re-check queue: check it against
   the file before you rely on it.

Lessons are the ground truth. When an overview disagrees with a lesson, trust the lesson and
fix the overview. A hit marked stale, unverified or deprecated is a lead to check, not a fact;
a deprecated one names its replacement.

## Learn

Write the lesson at the moment you learn it, not at the end. A correction from the user is
written at once.

```bash
node scripts/okf-edukai.mts new --domain codebase-<project> \
  --title "The poller retries a failed poll five times" \
  --by <harness>/<model> --source src/poller/retry.ts --tags retries
```

Then edit the file it printed:

- **One claim.** The title is the claim, as a sentence. If it needs "and", write two lessons.
- **Body:** the claim in one paragraph that stands alone, then optional `## Caveats`. At most
  30 lines. Evidence goes in `sources`, cited by footnote, not under its own heading.
- **`sources`:** every file the claim rests on. Also a bundle-root path (`/domain/lessons/x.md`)
  or a URL.
- **`check`:** add one whenever the claim can be stated as text in a file. It is what lets the
  lesson survive an unrelated edit to that file without an agent re-reading it:

  ```yaml
  check:
    - { file: src/poller/retry.ts, contains: "RETRIES = 5" }
  ```

  Each entry has `file` and exactly one of `contains`, `lacks` (literal text), `matches` (a
  JavaScript regular expression, at most 200 characters) or `exists` (`true` or `false`).
  There are no shell commands.

Then say how sure you are, and sign it:

```bash
node scripts/okf-edukai.mts verify <lesson file> --by <harness>/<model> --confidence tested
```

`verify` runs the checks, pins a digest of every source file, and sets your `verified` entry
and `stale_after` (30 days on). Never write `digest`, `verified` or `stale_after` by hand.

Something you have not confirmed is still worth a lesson: leave it `confidence: inferred`
(the default; no `verify`), and list it under `## Open questions` in the domain's overview.

A new domain gets an `overview.md` stub. Run `npm run edukai:index` so the syllabus lists it.

## Recheck

`npm run edukai:recheck` lists the lessons that need an agent. For each, re-read its sources.

| State | Means | Do |
| --- | --- | --- |
| `broken` | A pinned source, or a file a check names, is gone | Find where the fact lives now |
| `failed` | A check no longer holds | The claim is probably false now |
| `suspect` | A source changed, and no check vouches for the claim | Re-read the source |
| `stale` | Past `stale_after`, and no check vouches for it | Re-read the source |

- **Still true:** `verify` it again (fix a `check` or a `sources` path that moved first).
- **No longer true:** write the replacement with `new`, verify it, then
  `node scripts/okf-edukai.mts supersede <old> <new>`. That sets both pointers and marks the
  old lesson deprecated.
- **Never edit an old claim to make it true, and never delete a lesson.** The history of what
  was believed is part of the memory.

`renewable` lessons (a source changed or time passed, but every check still holds) need no
agent: `node scripts/okf-edukai.mts recheck --write` renews them. `unverified` lessons wait
until they matter.

When a finish nudge names a lesson your own change broke, fix it in the same piece of work.

## Summarise

An overview is outdated when a lesson in its domain is newer than it. Rewrite it from its
lessons: two to five paragraphs that teach the domain to someone who will not open them, then
`## Current understanding` (links to lessons) and `## Open questions`. At most 60 lines. Point
to lessons; do not copy them. Set its `generated.at` to now.

## Honesty

- `tested` only for what you reproduced. `observed` for what you saw or read. `inferred` for
  what you deduced.
- Sign as `<harness>/<model>` with your own names filled in, for example
  `claude-code/opus-5.5` or `pi/deepseek-v4-flash`. The tool refuses the literal placeholder.
  `human:<id>` is for a person, and only a person's review reaches the top trust tier.
- A check that passes proves the text is there, not that the claim is right. Write the check
  for the fact, not for the lesson to stay green.

## Git

Changes under `edukai/` go into your normal commits, with the code change that taught the
lesson. Never commit on your own just for memory, and add a dated line to `edukai/log.md`
for anything a reader would want to find later (a new domain, a superseded belief).

## Before finishing

```bash
npm run edukai:validate    # lesson rules, supersede pointers, budgets, a current syllabus
npm run edukai:recheck     # nothing you broke is left in the queue
```

Exit codes: **0** fine, **1** something is broken (named by file), **2** could not run.
