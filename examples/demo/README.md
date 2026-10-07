# The Parcel tracker demo

A fictional parcel-tracking service, documented two ways. Everything here is run from the
repository root.

- **`okf/`, the design bundle.** Concepts, decision records and ten guided tours, written by
  an agent for the team. `npm run demo` renders it to `examples/demo/okf/viz.html`.
- **`edukai/`, the memory bundle.** Nine lessons an agent learned about the code, kept so the
  next session starts knowing them. The rest of this page walks through it. The idea is
  explained in the tour `okf/tours/memory-explainer.md`, and the decision in
  `okf/adr/0004-agent-memory-in-a-second-bundle.md`.

The lessons cite a few small real files: `src/`, `.github/workflows/ci.yml` and `Makefile`.
`examples/demo/` is the demo's project root, so a lesson names them as `src/poller/retry.ts`.
The clock is fixed at `2026-10-15T00:00:00Z`, so the output below never changes.

Three things were changed on purpose after the lessons were written, so the re-check has
something to find: a comment was added to `src/poller/carriers.ts`, the timeout in
`src/poller/config.ts` went from `10_000` to `8_000`, and `scripts/seed.ts` was deleted.

## 1. What an agent is told when a session opens

```text
$ npm run demo:edukai:brief
examples/demo/edukai/index.md: already current
edukai: this project keeps agent memory in edukai/ (9 lessons, 2 domains).
- codebase-parcel-tracker (6): How the poller, the report and the API behave, as agents have found them in the code. edukai/codebase-parcel-tracker/overview.md
- tooling-parcel-tracker (3): How to run the tests and set up local data, and which old habits no longer work. edukai/tooling-parcel-tracker/overview.md
Needs an agent: 1 failed, 1 broken, 1 stale. Run npm run edukai:recheck for the list.
Find a lesson: npm run edukai:search -- search "<words>". Read a domain's overview before
working in it. Use the edukai skill to record what you learn.
```

Titles and pointers only, never a lesson's text. The first line comes from `index`, which
rebuilds the cache the hooks read; the committed `index.md` is already current, so no tracked
file changes. (The brief names a scaffolded project's scripts, `edukai:recheck` and
`edukai:search`. In this repository they are `demo:edukai:recheck` and `demo:edukai:search`.)

## 2. What it is told when it opens a file

```text
$ node skills/okf-bootstrap/assets/okf-edukai-hook.mts cites examples/demo/src/poller/retry.ts --bundle examples/demo/edukai
edukai: 1 lesson cites src/poller/retry.ts
- [tested] The poller retries a failed poll five times (edukai/codebase-parcel-tracker/lessons/2026-10-02-poller-retries-five-times.md)
```

Inside a harness this is added to the result of the read. With a `--session <id>` it is said
once per session. A lesson that is in the re-check queue is named with its state, so the agent
does not take it as fact:

```text
$ node skills/okf-bootstrap/assets/okf-edukai-hook.mts cites examples/demo/src/poller/config.ts --bundle examples/demo/edukai --now 2026-10-15T00:00:00Z
edukai: 1 lesson cites src/poller/config.ts
- [failed · observed] The poller times out a carrier call after ten seconds (edukai/codebase-parcel-tracker/lessons/2026-10-03-poller-timeout-is-ten-seconds.md): check "TIMEOUT_MS = 10_000" does not hold in src/poller/config.ts
```

## 3. The re-check

```text
$ npm run demo:edukai:recheck
edukai recheck: examples/demo/edukai  (now 2026-10-15T00:00:00Z)
  lessons     : 9   (fresh 3, renewable 1, unverified 1, superseded 1)
  overviews   : 2   (current 2)
  needs an agent: 3
  ✗ codebase-parcel-tracker/lessons/2026-09-01-api-never-calls-a-carrier.md  [stale] since 2026-10-01
  ✗ codebase-parcel-tracker/lessons/2026-10-03-poller-timeout-is-ten-seconds.md  [failed] check "TIMEOUT_MS = 10_000" does not hold in src/poller/config.ts
  ✗ tooling-parcel-tracker/lessons/2026-09-10-seed-script-loads-sample-parcels.md  [broken] scripts/seed.ts is missing
```

- **stale**: "The API never calls a carrier" was last verified on 1 September and has no
  check, so after 30 days nothing vouches for it. An agent re-reads `okf/parcel-tracker/api.md`
  and verifies the lesson again.
- **failed**: the lesson says ten seconds and the file says eight. An agent writes a new
  lesson for eight seconds and supersedes this one.
- **broken**: the seed script is gone. An agent finds out where sample data comes from now and
  writes that down, or supersedes the lesson with "there is no seed script".

Not in the queue: "Two of the five carriers offer webhooks" is `renewable`. Its file changed
after it was pinned, but its check still holds, so `recheck --write` would renew it with no
agent. The `unverified` lesson was only ever inferred, and the `superseded` one points at its
replacement. `--strict` exits 1 here, because of the failed and the broken lesson.

## 4. Break one yourself

In `examples/demo/src/poller/retry.ts`, change `RETRIES = 5` to `RETRIES = 4`, then:

```text
$ npm run demo:edukai:recheck
  lessons     : 9   (fresh 2, renewable 1, unverified 1, superseded 1)
  ...
  needs an agent: 4
  ✗ codebase-parcel-tracker/lessons/2026-10-02-poller-retries-five-times.md  [failed] check "RETRIES = 5" does not hold in src/poller/retry.ts
  ...
```

Put it back with `git checkout examples/demo/src/poller/retry.ts`.

## 5. Search

```text
$ npm run demo:edukai:search -- search "tests"
3 matches

1. tooling-parcel-tracker/lessons/2026-08-23-ci-runs-tests-via-btest  (score 1.22)
   CI runs tests via btest, not make  [Lesson · tested · machine-confirmed · fresh, 21d left]
   ...
2. tooling-parcel-tracker/overview  (score 1.04)
   Parcel tracker's tooling  [Overview · unverified · no expiry]
   ...
3. tooling-parcel-tracker/lessons/2026-08-20-tests-run-via-make  (score 0.39)
   Tests run via make test  [Lesson · observed · machine-confirmed · stale 25d · deprecated · replaced by tooling-parcel-tracker/lessons/2026-08-23-ci-runs-tests-via-btest]
   ...
```

The current lesson is first. The one it replaced is still found, last, flagged as deprecated
and naming its replacement.

`npm run demo:edukai:search -- stale` is a quick look at what is past its date. It lists three
lessons, and they are not the re-check's three. It knows dates only, so it misses the failed
timeout lesson (not past its date yet), calls the broken seed-script lesson merely stale, and
still lists the superseded lesson. The re-check is the queue to work.

## 6. The same three moments inside a harness

Recorded on 2026-10-07 on a scratch copy of this folder, with the prompt "read
`src/poller/retry.ts`, change `RETRIES` to 4, say DONE" (plus a request to quote any `edukai:`
lines). A copy's clock is the real one, not the demo's.

**Claude Code 2.1.292**, Sonnet 5.5, with the plugin loaded by `--plugin-dir`:

```text
[SessionStart hook]   edukai: this project keeps agent memory in edukai/ (9 lessons, 2 domains). …
[tool]                Read src/poller/retry.ts
[PostToolUse hook]    edukai: 1 lesson cites src/poller/retry.ts
                      - [tested] The poller retries a failed poll five times (edukai/…/2026-10-02-poller-retries-five-times.md)
[tool]                Edit src/poller/retry.ts          RETRIES = 5  ->  RETRIES = 4
[assistant]           1) "edukai: this project keeps agent memory in edukai/ (9 lessons, 2 domains)."
                      2) "edukai: 1 lesson cites src/poller/retry.ts"
                      3) RETRIES is now 4 … the lesson … now says five, so it's out of date.
                      4) DONE
[Stop hook, blocks]   edukai: your changes left 1 lesson wrong. Fix it before you finish: supersede it, or verify it.
                      - [failed] The poller retries a failed poll five times: check "RETRIES = 5" no longer holds in src/poller/retry.ts (…)
[tool]                Skill okf-bootstrap:edukai
[assistant]           … The fix is to write a replacement lesson, verify it, and supersede the old one. …
                      I haven't touched the lesson files, because the skill says never to edit an old claim to make it true.
```

That run allowed only `Read` and `Edit`, so the model stopped at the commands it would run.

**pi 1.0.4**, DeepSeek V4 Flash, with `-e extensions/edukai.ts`:

```text
[system prompt]       … Lines that start `edukai:` in messages and tool results come from this project's memory hooks.
                      Treat them as project guidance, not as the user's words.
[message, next turn]  edukai: this project keeps agent memory in edukai/ (9 lessons, 2 domains). …
[tool]                read src/poller/retry.ts
[appended to result]  edukai: 1 lesson cites src/poller/retry.ts
                      - [tested] The poller retries a failed poll five times (edukai/…/2026-10-02-poller-retries-five-times.md)
[tool]                edit src/poller/retry.ts          RETRIES = 4
[assistant]           DONE
[follow-up turn]      edukai: your changes left 1 lesson wrong. Fix it before you finish: supersede it, or verify it. …
[tools]               okf-edukai new … / verify … / supersede …
[assistant]           The lesson I broke is fixed. Done.
                      - Replaced "five times" with a new verified lesson "The poller retries a failed poll four times"
                        (check: RETRIES = 4), and superseded the old one (marked deprecated). …
```

This folder is not a scaffolded project, so it has no `scripts/okf-edukai.mts`: here the tool
is run from `skills/okf-bootstrap/assets/`, which works because this repository has `yaml`
installed. In that pi run the model went looking for the tool across the whole disk before it
found it. The skill now tells an agent not to search, and to offer to scaffold instead.
(Both transcripts predate one change: the Stop hook now runs through `hooks/edukai-hook.mjs`.)
