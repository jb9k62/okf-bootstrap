# Spec: edukai, the agent memory bundle

| | |
| --- | --- |
| Status | Implemented in 0.4.0. Where the build departs from this text is listed in [ADR-0002](../adr/0002-agent-memory-as-a-second-bundle.md). |
| Target release | okf-bootstrap 0.4.0 |
| Written against | `main` at `f0e4f32` (0.3.0 plus `okf-search`), pi 1.0.4 (`@earendil-works/pi-coding-agent`), Claude Code 2.1.292, OKF v0.2 |

This file is written to be executed: [section 14](#14-tasks) is an ordered task list, each task
names its files and how to tell it is done. Sections 3 to 13 are the contract the tasks build.

## 1. Summary

okf-bootstrap sets up one OKF bundle today: `okf/`, design docs an agent writes so people can
follow the system. This change adds a second, opt-in bundle: `edukai/`, what the agent itself has
learned, kept so the next session starts knowing it.

Both are OKF v0.2 bundles and the same validator reads both. They stay separate because they
have different readers and different rules.

| | Design bundle | Memory bundle |
| --- | --- | --- |
| Folder | `okf/` | `edukai/` |
| Reader | The team, in `viz.html` | The agent, through hooks |
| Unit | A concept: one topic, many claims | A lesson: one claim |
| Written | When the design changes | Whenever the agent learns something |
| Trust aim | Reviewed by a person | Confirmed by a script or an agent |
| Changed by this spec | Supersede pointers, `okf:recheck` | New |

What makes the memory bundle maintain itself:

1. **A tool**, `okf-edukai.mts`, does every part that needs no model: creating lesson files,
   pinning what a lesson depends on, re-checking, building the index.
2. **Harness adapters** for Claude Code (hooks) and pi (an extension) call that tool at three
   moments: when a session opens, when the agent touches a file a lesson cites, and when the
   agent tries to finish with a lesson it has just broken.
3. **A skill**, `edukai`, covers the parts that need judgement: what is worth a lesson, how sure
   we are, and what to do with a lesson that failed its re-check.

## 2. Goals and non-goals

Goals:

- An agent in a project with `edukai/` gets the relevant lessons without a person asking.
- A lesson that has gone wrong is found by code, and named to the agent that broke it.
- Everything fits OKF v0.2 as it stands. No vendored spec change.
- Existing `okf/` bundles keep working with no migration. The memory bundle is opt-in.
- One core, two thin adapters. All logic is tested once, in the core.

Not in this release (each is a decision from the review, with its reason in section 15):

- Matching the user's prompt against lessons inside a hook (`UserPromptSubmit`,
  `before_agent_start`). The agent searches instead; see section 8.
- Hooks that commit to git.
- A nightly headless agent that clears the re-check queue. The workflow template reports only.
- The personal, cross-project bundle (`~/.edukai/`, or wherever `EDUKAI_HOME` points). Its
  location is decided; the rest is task L2.
- The raw notebook and its distil step.
- Retiring a domain to `archive/`.
- A widget for the lesson lifecycle, and any new control in the viewer.

## 3. Names

`okf` names the format and the design side. `edukai` names the memory side. They never swap. In
prose, say "design bundle" and "memory bundle".

| Thing | Name |
| --- | --- |
| Memory bundle folder | `edukai/` |
| Cache and session files | `node_modules/.cache/edukai/`, the place `okf-search` already uses |
| Scaffold flag | `--edukai` |
| The tool | `okf-edukai.mts` and `okf-edukai-hook.mts` in `skills/okf-bootstrap/assets/`, both copied to `scripts/` |
| npm scripts | `edukai:validate`, `edukai:index`, `edukai:recheck`, `edukai:brief`, `edukai:search`, `edukai:view`, `okf:recheck` |
| Concept types | `Lesson`, `Overview` |
| Frontmatter keys added | `confidence`, `supersedes`, `superseded_by`, `check`, and `digest` on a `sources` entry |
| Lesson file | `edukai/<domain>/lessons/YYYY-MM-DD-short-claim.md` |
| Domain folder | lowercase-hyphen with a prefix: `codebase-…`, `tooling-…`, `user-…` |
| The skill | `skills/edukai/` (name `edukai`) |
| Claude Code adapter | `hooks/hooks.json` |
| pi adapter | `extensions/edukai.ts` |
| Actor for the scripted re-check | `process:edukai-recheck` |
| Validator issue kinds added | `lesson`, `supersede`, `budget` |

## 4. Layout in a project

```text
your-project/
├── okf/                         design bundle, unchanged
├── edukai/                      memory bundle (with --edukai)
│   ├── index.md                 reserved; the syllabus; one generated block
│   ├── log.md                   reserved; dated update history
│   └── <domain>/
│       ├── overview.md          type: Overview
│       └── lessons/
│           └── YYYY-MM-DD-short-claim.md      type: Lesson
└── scripts/
    ├── okf-view.mts
    ├── okf-mermaid.mts
    ├── okf-search.mts           works on either bundle with --bundle
    ├── okf-core.mts
    ├── okf-rank.mts
    ├── okf-edukai.mts           always copied, so okf:recheck works without --edukai
    └── okf-edukai-hook.mts
```

**Project root.** A path in `sources` or `check` is resolved against the project root, which is
the parent folder of the bundle unless `--root <dir>` says otherwise. It is not the git top
level, so a bundle in a subfolder (the demo, a monorepo package) works. A path that resolves
outside the root is an error.

There is no per-domain `log.md`: `okf-view.mts` reserves only the bundle root's `index.md` and
`log.md`, so a nested one would need a `type`. Re-check history is the `verified` list plus git.

## 5. The lesson format

A lesson is an OKF concept. Keys marked *ext* are extensions, which OKF §4.1 allows.

```markdown
---
type: Lesson
title: CI runs tests via btest, not make
description: The suite runs through btest. make test is a deprecated wrapper around it.
tags: [testing, ci]
confidence: tested
generated: { by: claude-code/opus-5.5, at: 2026-08-23T10:12:00Z }
verified:
  - { by: claude-code/opus-5.5, at: 2026-08-23T10:12:00Z }
stale_after: 2026-09-22T10:12:00Z
supersedes: /tooling-parcel-tracker/lessons/2026-08-20-tests-run-via-make.md
sources:
  - id: ci
    resource: .github/workflows/ci.yml
    digest: sha256:3f1c9a0b5d2e4f67
check:
  - { file: .github/workflows/ci.yml, contains: "btest run" }
---

As of 2026-08-22 the suite runs through `btest`, which shards unit and integration tests
across containers.[^ci] `make test` still exists but only calls `btest`.

## Caveats

- Local runs through the old make target still pass, so habit gives false confidence.

[^ci]: The CI workflow
```

| Key | Rule |
| --- | --- |
| `type` | `Lesson` |
| `title`, `description` | Required. The title is the claim, as a sentence. If it needs "and", split the lesson. |
| `confidence` *ext* | Required. `tested` (reproduced it), `observed` (saw or read it), `inferred` (deduced it). |
| `generated` | Required. `by` is `<harness>/<model>` for an agent, `human:<id>` for a person. |
| `verified` | Required unless `confidence: inferred`. An inferred lesson must have none. One entry per actor: a new check by the same actor replaces its entry. |
| `stale_after` | Required when `verified` is present. Set by the tool: the latest check plus 30 days. |
| `sources` | Required, at least one. `resource` is a path from the project root, a bundle-root path starting with `/` (another concept in this bundle), or a URL. |
| `sources[].digest` *ext* | Written by the tool for a `resource` that is a file under the project root: `sha256:` plus the first 16 hex characters of the SHA-256 of the file's bytes, with CRLF read as LF. Never hand-written. |
| `supersedes`, `superseded_by` *ext* | Bundle-root paths ending `.md`. See below. |
| `check` *ext* | Optional list. Each entry has `file` (from the project root) and exactly one of `contains`, `lacks` (literal substrings), `matches` (a JavaScript regular expression, at most 200 characters, stopped and failed after 200 ms), or `exists` (`true` or `false`). Files over 1 MB fail the check. No shell commands, ever. |
| Body | The claim in one paragraph that stands alone, then optional `## Caveats`. At most 30 lines. Evidence is `sources`, cited by footnote (OKF §5.1), so there is no `## Evidence` heading. |

**Supersede, never delete.** When a fact changes, write a new lesson. Then the old lesson gets
`status: deprecated` and `superseded_by`, the new one gets `supersedes`. The two pointers must
name each other, both files must exist, and there are no cycles. These three keys apply to any
concept type, so an ADR can use them too.

**Overview.** One per domain, `type: Overview`, at `edukai/<domain>/overview.md`. Two to five
paragraphs that teach the domain to someone who will not open the lessons, then
`## Current understanding` (links to lessons) and `## Open questions`. At most 60 body lines. It
is prose, so an agent writes it. It is *outdated* when a lesson in its domain has a
`generated.at` later than its own.

**Syllabus.** `edukai/index.md` keeps `okf_version` in its frontmatter and has one generated
block between `<!-- edukai:index -->` and `<!-- /edukai:index -->`: one line per domain, in the
form OKF §8 gives, linking the overview. Text outside the block is kept.

## 6. Lesson states

Derived on every run, never stored. First match wins.

| State | When | Who acts |
| --- | --- | --- |
| `superseded` | `status: deprecated` | Nobody |
| `broken` | A pinned source file, or a file a check names, is missing (unless the check is `exists: false`) | Agent |
| `failed` | A check does not hold | Agent |
| `suspect` | A source's digest no longer matches, and the lesson has no checks | Agent |
| `stale` | Now is on or after `stale_after`, and the lesson has no checks | Agent |
| `renewable` | A digest no longer matches or `stale_after` has passed, and the lesson has at least one check, all of which hold | The tool, with `--write` |
| `unverified` | `confidence: inferred` | Agent, when it matters |
| `fresh` | None of the above | Nobody |

A source with no `digest` is not compared, so a lesson that was never verified (every `inferred`
one) cannot be `suspect`. An outdated overview is listed with the queue in the report, and like
`stale` it never fails `--strict`.

The **queue** is `broken`, `failed`, `suspect` and `stale`. A check is what lets a lesson survive
an unrelated edit to its file without an agent re-reading it, so the skill asks for one wherever
the claim can be stated as text in a file.

## 7. The tool: `okf-edukai.mts`

Two files, erasable TypeScript, same conventions as the other tools (`AGENTS.md`). They follow
the split `okf-search` introduced: shared parsing comes from `okf-core.mts`, and one file carries
a purity rule that a test enforces, as `okf-rank.mts` does.

| File | Runs | May import |
| --- | --- | --- |
| `okf-edukai.mts` | In the project, from `scripts/` | `okf-core.mts` (so `yaml`), `okf-rank.mts`, `okf-edukai-hook.mts` |
| `okf-edukai-hook.mts` | From the installed plugin or package, where `node_modules` may not exist | `node:` built-ins and `okf-rank.mts` only |

**The hard rule for `okf-edukai-hook.mts`.** It holds the commands the adapters call (`brief`,
`cites`, `debt`, `hook`) and the code that derives a lesson's state, which `okf-edukai.mts`
imports for `recheck`. It reads only the cache and the files the cache names. It never parses
YAML, so it must never import `okf-core.mts`, and it never runs code from the project.

**Reuse, do not rewrite.** From `okf-core.mts`: `parseDocument`, `listMarkdown`, `RESERVED`,
`normalizeVerified`, `trustTier`, `errorMessage`. From `okf-rank.mts`: `freshness`,
`freshnessLabel` and `DAY`, so "stale" means the same instant and reads the same way in
`recheck`, in `okf-search stale` and in the viewer. From `okf-search.mts`, copy the shape, not
the code: `VALUE_FLAGS` and `BOOL_FLAGS` argument parsing, a `UsageError` that exits 2, and one
`print(options, data, text)` so every command has `--json`.

```text
node scripts/okf-edukai.mts <command> [arguments] [--bundle <dir>] [flags]      --bundle defaults to edukai
node <plugin>/…/okf-edukai-hook.mts <brief|cites|debt|hook> [arguments] [--bundle <dir>] [flags]
```

| Command | Does | Writes |
| --- | --- | --- |
| `new --domain <d> --title <t> --by <actor> [--confidence <c>]` | Creates the lesson file with frontmatter filled in and prints its path. A new domain also gets an `overview.md` stub. Default confidence: `inferred`. | Lesson, maybe overview |
| `verify <file> --by <actor> [--confidence <c>] [--days <n>]` | Runs the checks (exit 1 if one fails), pins every file source, sets this actor's `verified` entry and `stale_after`. Works on any concept, so with `--bundle okf` it pins a design concept. | That file |
| `supersede <old> <new>` | Sets both pointers and the old file's `status: deprecated`. | Both files |
| `index [--check]` | Rebuilds the generated block in `index.md` and the cache. With `--check`, writes nothing and exits 1 if `index.md` would change. | `index.md`, cache |
| `recheck [--write] [--strict] [--json]` | Reports every concept's state. With `--write`, renews each `renewable` one: re-pins, sets the `process:edukai-recheck` entry, moves `stale_after`. Never edits a claim. | With `--write` only |
| `brief`, `cites <path> [--edited]`, `debt` (hook file) | Text for the agent (below). Take `--session <id>`. The path may be absolute or relative to the working folder. | Session file |
| `hook` (hook file) | The Claude Code adapter: reads the hook JSON on stdin, runs one of the three above, prints the reply JSON. | Session file |

Every command takes `--bundle <dir>`, `--root <dir>` and `--now <ISO datetime>` (for tests and
the demo). `new`, `verify`, `supersede` and `recheck --write` rewrite the cache when they finish.
The cache describes the memory bundle only: a command run with another `--bundle` (for example
`okf`) leaves it alone, and the hook commands only ever read the bundle named `edukai`.

**Exit codes** follow the repo's contract. `0`: ran, nothing wrong. `1`: something is broken,
named by file. `2`: could not run (no bundle, `yaml` missing, bad flags). For `recheck`, exit 1
needs `--strict` and counts only `broken`, `failed` and `suspect`. `stale` and `unverified` never
fail a build: a pull request must not go red because time passed.

**Rewriting frontmatter.** Use the `yaml` package's document API so comments, key order and flow
maps survive. Writing a file whose values did not change must leave it byte-identical.

**The cache.** `okf-search` already solved where a cache lives and when to trust it. Use the
same rules, in `okf-edukai-hook.mts`:

- **Where:** `<root>/node_modules/.cache/edukai/` when the project root has `node_modules`,
  otherwise a per-user folder in the temp dir that must be owned by this user and private
  (mode `0700`), or no cache at all. The hook puts this file's text in front of an agent, so
  another user must not be able to plant one. Nothing is added to `.gitignore`.
- **Writing:** to a temporary name with the `wx` flag, then rename, so a reader never sees half
  a file and a planted link is never written through.
- **Trusting a file's entry:** same `size`, `mtime` and `ctime`, and not modified within two
  seconds of the cache being written (the "racily clean" rule in `okf-search.mts`).
- **Version:** a plain `"schema": 1`. Not a hash of the code, as `okf-search` uses, because two
  copies of the code read this cache: the project's and the plugin's.

```json
{ "schema": 1, "written": 1760486400000,
  "files": { "codebase-x/lessons/2026-10-02-a.md": { "size": 812, "mtime": 1760486300000, "ctime": 1760486300000 } },
  "domains": [{ "id": "codebase-x", "title": "…", "description": "…", "lessons": 6 }],
  "lessons": [{ "id": "codebase-x/lessons/2026-10-02-a", "title": "…", "confidence": "tested",
                "status": "stable", "stale_after": "…",
                "sources": [{ "path": "src/a.ts", "digest": "sha256:…" }],
                "checks": [{ "file": "src/a.ts", "contains": "…" }] }] }
```

One thing differs from `okf-search`, which re-parses changed files on every run. The hook file
cannot parse YAML, so it cannot heal the cache. When the `files` map no longer matches the
folder, the hook commands still answer from it and add one line to the brief:
`edukai: the index is out of date. Run npm run edukai:index.` An unknown `schema` is treated as
no cache. With no cache, `brief` prints only
`edukai: this project keeps agent memory in edukai/, but it has no index yet. Run npm run edukai:index.`
and `cites` and `debt` print nothing. A fresh clone is in this state until that command is run.
Every command in `okf-edukai.mts` re-parses what changed and rewrites the cache as it starts,
the way `okf-search` does, so any use of the project tool heals it.

**Output for the agent.** Plain text, short, pointers and titles only, never lesson bodies.

```text
brief   (at most 2,000 characters)
edukai: this project keeps agent memory in edukai/ (9 lessons, 2 domains).
- codebase-parcel-tracker (6): <description>. edukai/codebase-parcel-tracker/overview.md
- tooling-parcel-tracker (3): <description>. edukai/tooling-parcel-tracker/overview.md
Needs an agent: 1 failed, 1 broken, 1 stale. Run npm run edukai:recheck for the list.
Find a lesson: npm run edukai:search -- search "<words>". Read a domain's overview before
working in it. Use the edukai skill to record what you learn.

cites <path>   (at most 3 lessons; nothing if none, or if all were already shown this session)
edukai: 1 lesson cites src/poller/retry.ts
- [tested] The poller retries a failed poll five times (edukai/codebase-parcel-tracker/lessons/2026-10-02-poller-retries-five-times.md)

debt   (nothing unless a lesson citing a file this session edited is now broken, failed or suspect)
edukai: your changes left 1 lesson wrong. Fix it before you finish: supersede it, or verify it.
- [failed] The poller retries a failed poll five times: check "RETRIES = 5" no longer holds in src/poller/retry.ts
```

**Session file**, `sessions/<id>.json` beside the cache: `{ shown: [], edited: [], nudged: [] }`. `cites`
adds to `shown`, and to `edited` when called for an edit. `debt` adds to `nudged`, never names
a lesson twice in one session, and lists at most 5 with a count of the rest. `brief` deletes session files older than 7 days.

**Limits.** A hook command must answer in under 200 ms for a bundle of 500 lessons. `brief`
hashes at most 2,000 source files and says so if it stopped early.

## 8. Finding lessons: `okf-search`

`okf-search.mts` takes `--bundle`, so it already works on the memory bundle with no change:

```jsonc
"edukai:search": "node --import ./scripts/okf-start.mjs scripts/okf-search.mts --bundle edukai"
```

This is how an agent finds a lesson that no file path leads to, and it replaces an earlier
"recall at scale" rule. It also fits the memory bundle unusually well, because its ranking
already reads the fields this spec sets:

| What the lesson says | What `okf-search` does with it today |
| --- | --- |
| `status: deprecated` (a superseded lesson) | Ranked at half weight and flagged, never hidden |
| No `verified` (every `inferred` lesson) | Lowest trust tier, ranked below verified lessons |
| `stale_after` in the past | Demoted and labelled, for example `stale 14d` |
| `--type Lesson`, `--tag ci`, `--fresh`, `--trust machine` | Filters that work as they are |
| Links from an overview to its lessons | A small boost for each lesson an overview points to |

The skill tells the agent to search before reading, as the okf-bootstrap skill now does: never
read a whole bundle to answer a question, and treat a stale or unverified hit as a lead to
check.

**Two queues, one meaning.** `okf-search stale` lists concepts past `stale_after`. `recheck`
lists those too, and adds what only it can see: a changed source, a failed check, a missing
file. The docs name `recheck` as the queue to work, and `stale` as a quick look.

**Optional additions to search**, small and additive, keeping `okf-rank.mts` pure:

- Carry `confidence` and `superseded_by` in `EntryMeta`, show "replaced by `<id>`" in a result's
  badge, and add a `--confidence` filter.
- `okf-view.mts` inlines `okf-rank.mts`, so the viewer's results list would show the same badge.

**Prompt matching, later.** The reason it was cut is gone: there is now a real ranking, and it
has no imports, so the hook file could run it over cached term counts. It stays out of this
release because the cached index would have to be shared between `okf-search` and the hooks,
and because a pointer added to every prompt must first be shown to help. An agent that searches
on its own is the cheaper thing to try first.

## 9. Validator changes: `okf-view.mts`

Small and targeted, per the repo rule against rewriting this file. They apply to any bundle.

| Issue kind | Reported when |
| --- | --- |
| `lesson` | A `type: Lesson` breaks a rule in the table in section 5: missing key, unknown `confidence`, `inferred` with `verified`, `verified` without `stale_after`, a `check` entry with no `file` or with other than one test. |
| `supersede` | A pointer names a missing file, the two do not name each other, the superseded file is not `status: deprecated`, or there is a cycle. |
| `budget` | A `Lesson` body is over 30 lines, or an `Overview` body is over 60. Leading and trailing blank lines are not counted. |

Also: add `Lesson` and `Overview` to `TYPE_PALETTE`, and print the confidence breakdown in the
validation report next to trust tiers when the bundle has lessons.

No new viewer controls. The viewer now has ranked search with trust and freshness filters, and
they work on the memory bundle as they are. `docs/adr/0001-react-for-the-viewer.md` proposes
moving the viewer's controls to React because each new one is costly to wire by hand, so a
confidence colour mode waits for that decision.

## 10. Harness adapters

The adapters hold no logic. Each finds `<project>/edukai/index.md`; if it is missing they do
nothing, because both load in every project once installed. Any error is swallowed (exit 0, no
output) unless `EDUKAI_DEBUG=1`. `EDUKAI_NUDGE=0` turns the finish nudge off.

| Moment | Claude Code | pi | Core command |
| --- | --- | --- | --- |
| Session opens, or context was compacted | `SessionStart` (every `source`) | `session_start`, `session_compact` | `brief` |
| Agent read a file | `PostToolUse`, matcher `Read` | `tool_result`, `toolName` `read` | `cites` |
| Agent edited a file | `PostToolUse`, matcher `Edit\|Write\|NotebookEdit` | `tool_result`, `edit` or `write` | `cites --edited` |
| Agent is about to finish | `Stop` | `agent_end` | `debt` |

**Claude Code**, `hooks/hooks.json` at the plugin root. Every event runs the same command, with
`"timeout": 5`:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/okf-bootstrap/assets/okf-edukai-hook.mts" hook
```

`hook` reads `hook_event_name`, `session_id`, `cwd` and `tool_input.file_path` from stdin, and
the project folder from `CLAUDE_PROJECT_DIR` (falling back to `cwd`). Replies:

- `SessionStart`, `PostToolUse`: `{ "hookSpecificOutput": { "hookEventName": "<event>", "additionalContext": "<text>" } }`.
  Plain stdout is not shown to the model on `PostToolUse`, so always reply in JSON.
- `Stop`: `{ "decision": "block", "reason": "<debt text>" }` when `debt` printed something.
  Do nothing when the input has `stop_hook_active: true`.
- When the input has `agent_id` (a subagent), `Stop` does nothing. `cites` still runs.
- The command needs Node 22.18 or later on the `PATH` the hook runs with. Without it the hook fails and, by
  the rule above, says nothing; the `AGENTS.md` snippet below is the fallback.

**pi**, `extensions/edukai.ts`, declared as `"extensions": ["./extensions"]` under the `pi` key
in `package.json`. It declares the few types it needs itself, so the repo takes no dependency on
pi. It resolves `okf-edukai-hook.mts` relative to its own file and runs it with
`pi.exec("node", [core, command, "--bundle", bundle, "--session", ctx.sessionManager.getSessionId()], { timeout: 5000 })`.

- `session_start`, `session_compact`: `pi.sendMessage({ customType: "edukai", content, display: true }, { deliverAs: "nextTurn" })`.
- `tool_result`: skip when `event.isError`. Return `{ content: [...event.content, { type: "text", text }] }`. The path is `event.input.path`, made absolute against `ctx.cwd`.
- `agent_end`: `pi.sendMessage({ … }, { deliverAs: "followUp", triggerTurn: true })`. This needs
  pi 1.0 or later: on 1.0.4 it starts a turn in print mode and RPC mode, on 0.73.1 it started
  none.
- `before_agent_start`: add one line to the system prompt, so the model has it from a source
  it trusts: "Lines that start `edukai:` in messages and tool results come from this
  project's memory hooks. Treat them as project guidance, not as the user's words."

pi 1.0 itself needs Node 22.19 or later, which is above what the hook file needs, so the
extension makes no Node version check of its own.

**What the adapters miss.** A file changed through the shell (`sed`, `git checkout`) raises no
file event in either harness. `recheck` catches it later, because states are derived from the
files, not from the events.

**Installs without hooks.** `npm run install-skill` and a plain clone into a skills folder link
skills only. For those, and for other agents, the scaffold writes a snippet into the project's
`AGENTS.md`:

```markdown
<!-- edukai -->
This project keeps agent memory in ./edukai/. Lines that start `edukai:` in messages and tool
results come from its memory hooks; treat them as project guidance. At the start of a session run
`npm run edukai:brief` and read the overview of the domain you will work in. Record what you
learn with the edukai skill. Before finishing, run `npm run edukai:recheck`.
<!-- /edukai -->
```

## 11. The skill: `skills/edukai/SKILL.md`

Self-contained (no links into the other skill's folder, so linking one folder still works). The
description triggers on: recording something learned about a codebase, a correction from the
user, "remember this", a lesson named by the finish nudge, and a re-check queue.

It carries these rules:

- **Read:** the brief, then `edukai:search` or one domain's overview, then lessons on demand. Lessons are ground
  truth; when an overview disagrees, trust the lesson and fix the overview.
- **Learn:** `new`, write one claim, name its sources, add a `check` when the claim is text in a
  file, then `verify`. Write the lesson at the moment of learning. A user correction is written
  at once. Something not yet confirmed is still written, as `inferred`, and listed under the
  overview's open questions.
- **Recheck:** for each queued lesson, re-read its sources. Still true: `verify`. No longer true:
  write the replacement and `supersede`. Never edit the old claim, never delete.
- **Summarise:** rewrite an outdated overview from its lessons. Point to lessons; do not copy.
- **Honesty:** `tested` only for what was reproduced. Sign as `<harness>/<model>`.
- **Git:** changes under `edukai/` go into the agent's normal commits. The skill never commits on
  its own.

`skills/okf-bootstrap/SKILL.md` and `PLAYBOOK.md` gain a short "two bundles" section that points
here, and the `--edukai` flag.

## 12. Scaffold changes: `bootstrap.mts`

- `TOOLS` gains `'okf-edukai'` and `'okf-edukai-hook'` after the five it has now. All are always
  refreshed. Neither is added to `LEGACY_MJS`.
- `--edukai` creates `edukai/index.md` and `edukai/log.md` from `templates/edukai/` (kept on a
  re-run, replaced by `--force`, like the `okf/` files), and writes the `AGENTS.md` snippet unless its marker is present.
- `--tools-only --edukai` adds the memory bundle to a project that already has `okf/`.
- npm scripts. Always: `okf:recheck`. When `edukai/` exists (the pattern `hasWidgets` uses):

```jsonc
"okf:recheck":     "node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts recheck --bundle okf",
"edukai:validate": "node --import ./scripts/okf-start.mjs scripts/okf-view.mts edukai --validate --strict && node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index --check",
"edukai:index":    "node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index",
"edukai:recheck":  "node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts recheck",
"edukai:brief":    "node --import ./scripts/okf-start.mjs scripts/okf-edukai.mts index && node --import ./scripts/okf-start.mjs scripts/okf-edukai-hook.mts brief",
"edukai:search":   "node --import ./scripts/okf-start.mjs scripts/okf-search.mts --bundle edukai",
"edukai:view":     "node --import ./scripts/okf-start.mjs scripts/okf-view.mts edukai"
```

- A new template, `templates/edukai-recheck.yml`, is a GitHub workflow the scaffold prints the
  path of but does not install: `recheck --strict` on pull requests for both bundles, and a
  weekly report-only run. It never writes to the repo.
- `VERSION` becomes `0.4.0`, with `package.json`, `plugin.json` and `marketplace.json`.

## 13. The demo: Parcel tracker's memory

The demo must let someone see edukai work in two minutes without a harness. Today the demo is
docs only, with no code for a lesson to cite, so it gains a few small real files. Every lesson's
claim must be true of those files, except the two that are wrong on purpose.

**Source files**, under `examples/demo/` (the demo's project root):

| File | Holds |
| --- | --- |
| `src/poller/retry.ts` | `RETRIES = 5`, `BASE_MS = 500`, `CAP_MS = 2_000`, a full-jitter delay function. Matches `okf/parcel-tracker/retry-policy.md`. |
| `src/poller/config.ts` | `TIMEOUT_MS = 8_000` |
| `src/poller/carriers.ts` | Five fictional carriers; `WEBHOOK_CARRIERS` lists two. Matches ADR-0003. |
| `src/report/week.ts` | `weekStartUtc(date)`: Monday 00:00 UTC. Matches ADR-0002. |
| `.github/workflows/ci.yml` | One step: `btest run --shard auto`. Inert here; GitHub reads only the repo root. |
| `Makefile` | `test:` calls `btest run`. |

**Memory bundle**, `examples/demo/edukai/`, authored with the tool using `--now` so dates are
fixed. The demo clock is `2026-10-15T00:00:00Z`.

| # | Lesson (domain / file) | Set-up | State on the demo clock |
| --- | --- | --- | --- |
| 1 | `codebase-parcel-tracker` / `2026-10-02-poller-retries-five-times` | `tested`; cites `src/poller/retry.ts`; check `contains: "RETRIES = 5"` | `fresh` |
| 2 | … / `2026-10-02-weeks-start-monday-utc` | `tested`; cites `src/report/week.ts` and `okf/adr/0002-weeks-on-the-utc-clock.md` | `fresh` |
| 3 | … / `2026-10-03-two-carriers-have-webhooks` | `observed`; check on `WEBHOOK_CARRIERS`; a comment added to `carriers.ts` after pinning | `renewable` |
| 4 | … / `2026-10-03-poller-timeout-is-ten-seconds` | `observed`; check `contains: "TIMEOUT_MS = 10_000"`, but the file says `8_000` | `failed` |
| 5 | … / `2026-10-04-notifier-sends-one-message-per-status-change` | `inferred`; cites `okf/parcel-tracker/architecture.md`; no check | `unverified` |
| 6 | … / `2026-09-01-api-never-calls-a-carrier` | `observed`; cites `okf/parcel-tracker/api.md`; no check; `stale_after` 2026-10-01 | `stale` |
| 7 | `tooling-parcel-tracker` / `2026-08-20-tests-run-via-make` | superseded by 8 | `superseded` |
| 8 | … / `2026-08-23-ci-runs-tests-via-btest` | `tested`; supersedes 7; check `contains: "btest run"` in the workflow; a second `verified` entry by `process:edukai-recheck` on 2026-10-06, which moved `stale_after` to 2026-11-05 | `fresh` |
| 9 | … / `2026-09-10-seed-script-loads-sample-parcels` | `observed`; cites `scripts/seed.ts`, which does not exist | `broken` |

Lessons 7 and 8 are the running example from section 5. Lessons 2, 5 and 6 cite the design bundle, which
shows how the two bundles connect. Each domain has an `overview.md` that is current; lesson 5 is
under "Open questions" in its overview.

**Expected report**, pinned by a test:

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

**Root npm scripts.** `E` below stands for
`node skills/okf-bootstrap/assets/okf-edukai.mts` and `H` for `okf-edukai-hook.mts` beside it.
Every call also passes
`--bundle examples/demo/edukai --now 2026-10-15T00:00:00Z`. None changes a tracked file: `index`
finds the committed `index.md` already current and writes only the ignored cache.

```jsonc
"demo:edukai":         "npm run demo:edukai:brief && npm run demo:edukai:recheck",
"demo:edukai:brief":   "E index && H brief",
"demo:edukai:recheck": "E recheck",
"demo:edukai:search":  "node skills/okf-bootstrap/assets/okf-search.mts --bundle examples/demo/edukai --now 2026-10-15T00:00:00Z",
"demo:edukai:view":    "node skills/okf-bootstrap/assets/okf-view.mts examples/demo/edukai"
```

**`examples/demo/README.md`** (new) is the walkthrough: the two bundles in one paragraph, then

1. `npm run demo:edukai:brief`: what an agent is told when a session opens.
2. `H cites examples/demo/src/poller/retry.ts`, written out in full: what it is told when it
   opens that file.
3. `npm run demo:edukai:recheck`: the report above, with one sentence on each of the three
   queued lessons and what an agent would do about it.
4. Break one yourself: change `RETRIES = 5` to `4`, run the re-check, see lesson 1 go `failed`,
   then `git checkout` the file.
5. `npm run demo:edukai:search -- search "tests"`: lesson 8 first, lesson 7 below it and
   flagged deprecated. Then `-- stale`, and how its list differs from the re-check's: it
   knows dates only, so it misses lesson 4 and still lists the superseded lesson 7.
6. A short transcript of the same three moments inside Claude Code and inside pi.

**In the demo's design bundle** (`examples/demo/okf/`):

- `adr/0004-agent-memory-in-a-second-bundle.md`: context, decision, and the rejected
  alternatives (lessons inside `okf/`, a wiki, the harness's own memory files). Row in
  `adr/readme.md`.
- `tours/memory-explainer.md`, `type: Explainer`, in the shape `EXPLAINERS.md` now asks for,
  using the cast defined in the demo's overview: who is affected (for example the on-call
  engineer, who is told something that stopped being true last week), the problem one step at
  a time, background (an agent starts each session knowing nothing), intuition (a lesson is
  one fact with a receipt), a state diagram of section 6, a sequence diagram of one session naming both
  harnesses, who checks the checker, and a quiz. One quiz question: "A file a lesson cites
  changed last night and the lesson has no check. Is it wrong, stale or suspect?"
- A link in `index.md` and an entry in `log.md`.

## 14. Tasks

In order. Each is one commit-sized change. Run `npm run check` after each.

**A. Format and validation**

- [ ] **A1. Validator rules.** `okf-view.mts`: the `lesson`, `supersede` and `budget` issues,
  the two palette entries, the confidence line in the report. *Done when:* new cases in
  `test/bootstrap.test.mts` (`okf-view validation`) show each issue kind firing on a scratch
  bundle and a valid lesson passing `--strict`.
- [ ] **A2. Fixture.** `test/fixtures/edukai-errors/`: one file per rule broken. *Done when:* a
  test asserts the exact issue list.

**B. The tool**

- [ ] **B1. Skeleton and parsing.** `okf-edukai.mts` and `okf-edukai-hook.mts`: argument parsing
  in the `okf-search.mts` shape, the bundle walk from `okf-core.mts`, path confinement,
  `--bundle`, `--root`, `--now`, `--json`, exit codes. *Done when:* `--help` works, an unknown
  flag exits 2, and `npm run typecheck` covers both files.
- [ ] **B2. `new`, `verify`, `supersede`.** *Done when:* tests cover the digest (including CRLF),
  each check kind, one `verified` entry per actor, byte-identical rewrite of an unchanged file,
  a path escaping the root being refused, and the output passing `okf-view --validate --strict`.
- [ ] **B3. States and `recheck`.** *Done when:* a test builds one lesson per state in section 6
  and asserts the report, `--strict` exit codes, `--json`, and that `--write` changes only
  `renewable` files.
- [ ] **B4. `index` and the cache.** *Done when:* tests cover the generated block (text outside
  it kept), `--check`, and the cache cases `test/search.test.mts` covers for its own: rebuilt
  from a corrupt file, an edit picked up, a same-size edit with an unchanged mtime not trusted.
  Tests give each run a working folder with an empty `node_modules`, as the search tests do, so
  the cache lands in the scratch folder.
- [ ] **B5. `brief`, `cites`, `debt`, session file.** *Done when:* tests cover the caps, no
  repeat within a session, `debt` naming a lesson once, pruning, and a 500-lesson bundle
  answered within the budget (modelled on the 600-concept test in `test/search.test.mts`).
- [ ] **B6. The dependency rule.** *Done when:* one test reads `okf-edukai-hook.mts` and fails
  on any import other than `node:` built-ins and `./okf-rank.mts`, and another copies those two
  files to a folder outside the repo (`os.tmpdir()`), where `yaml` cannot resolve, and runs
  `brief`, `cites`, `debt` and `hook` against a prepared cache with exit 0.
- [ ] **B7. Search on the memory bundle.** The `edukai:search` script. *Done when:* a test runs
  `okf-search.mts --bundle` on a scratch memory bundle and shows a superseded lesson ranked
  below its replacement and an `inferred` lesson below a verified twin. No code change is
  expected; if one is needed, that is a finding.
- [ ] **B8. Optional: search knows lessons.** `confidence` and `superseded_by` in `EntryMeta`,
  the "replaced by" badge, `--confidence`. *Done when:* `test/search.test.mts` covers them and
  `okf-rank.mts` still has no imports.

**C. Adapters**

- [ ] **C1. `hook`.** *Done when:* tests pipe a recorded `SessionStart`, `PostToolUse` (read and
  edit) and `Stop` payload in and assert the reply JSON, silence with no bundle, silence on
  malformed input, and no nudge when `agent_id` is present.
- [ ] **C2. `hooks/hooks.json`.** *Done when:* a test parses it and checks every command points
  at a file that exists. Then, by hand in Claude Code: brief on start, a lesson on reading
  `examples/demo/src/poller/retry.ts`, a nudge after changing `RETRIES`.
- [ ] **C3. `extensions/edukai.ts`** and the `pi` key in `package.json`; add `extensions/*.ts` to
  `tsconfig.json`. *Done when:* it typechecks, and the same three moments work by hand in pi.
- [ ] **C4. `scripts/install-skill.mts`** links every folder under `skills/`. *Done when:* its
  flags behave as before for both skills.

**D. Skill and scaffold**

- [ ] **D1. `skills/edukai/SKILL.md`.** *Done when:* the release-metadata test covers its
  frontmatter (name, description at most 1,024 characters).
- [ ] **D2. `bootstrap.mts`** per section 12, with `templates/edukai/index.md`, `log.md` and
  `templates/edukai-recheck.yml`. *Done when:* tests cover `--edukai`, `--tools-only --edukai`,
  a re-run keeping authored files, the `AGENTS.md` snippet written once, and a
  scaffolded project where `new`, `verify` and `edukai:validate` all pass.
- [ ] **D3. Supersede in ADRs.** `templates/okf/adr/template.md` and `readme.md` use the
  frontmatter pointers. *Done when:* a scaffolded bundle still validates clean.

**E. The demo**

- [ ] **E1. Source files** from the first table in section 13.
- [ ] **E2. Memory bundle**: the nine lessons, two overviews, `index.md`, `log.md`, written with
  the tool. Lessons 3, 4 and 9 are verified first against a source that agrees with them; the
  source is then changed (a comment added, `10_000` to `8_000`, the file deleted). Lesson 6 is
  verified with `--now 2026-09-01T00:00:00Z`. *Done when:* `okf-view examples/demo/edukai --validate --strict` passes, and a test
  pins the expected report in section 13 line for line.
- [ ] **E3. Root scripts and `examples/demo/README.md`.** *Done when:* each command in the
  walkthrough prints what the README says it prints.
- [ ] **E4. ADR-0004 and the tour.** The tour uses the overview's cast and the "who is
  affected" and step-by-step parts `EXPLAINERS.md` now asks for. *Done when:* `npm run demo`,
  the Mermaid gates and the render tests pass. Tests and the README caption that count the
  demo's concepts are updated.
- [ ] **E5. Viewer on the memory bundle.** Run `npm run demo:edukai:view` and look, light and
  dark, including the ranked search box and its trust and freshness filters. Fix what is wrong
  for a bundle with no `Application` concept. Optional: a screenshot in
  `scripts/screenshots.mts`.

**F. Docs and release**

- [ ] **F1. `README.md`**: tagline for two bundles, a row in "What you get", an "Agent memory"
  section of about fifteen lines after "Explainers that teach" linking the tour and the demo
  README, `--edukai` in Quick start, `edukai/` in the tree.
- [ ] **F2. `AGENTS.md`** (layout table; `okf-edukai-hook.mts` gets a "must stay" rule beside
  the one for `okf-rank.mts`; both new files join the "copied into user projects" list),
  `SKILL.md`, `PLAYBOOK.md`, `templates/package-json-scripts.md`, `templates/concept.md` (a note
  that `sources` now feeds `okf:recheck`), `CHANGELOG.md`.
- [ ] **F3. Version 0.4.0** in the four places.
- [ ] **F5. `docs/adr/0002-agent-memory-as-a-second-bundle.md`**, this repo's own record of the
  decision, beside ADR-0001. It links this spec.

**Done** means: `npm run check`, `npm run test:render` and `npm run test:views` pass; the demo
walkthrough matches its README; C2 and C3 were checked by hand in both harnesses.

## 15. Review

A critical pass over the design notes this spec came from. Each finding changed the spec.

| # | Problem found | What the spec does instead |
| --- | --- | --- |
| 1 | "Did a cited file change" was going to ask git for the file's last commit time. A shallow CI checkout makes every file look just changed, and uncommitted edits are invisible. | A content digest pinned at verify time (section 5). Works with no git at all. |
| 2 | Any edit to a cited file would flag its lessons, most of them falsely. That noise teaches agents to ignore the flag. | A lesson with passing checks is `renewable`, not `suspect`, and the tool renews it. |
| 3 | A nightly job adding a `verified` entry to every lesson would rewrite the whole bundle daily. | `recheck` is read-only by default; `--write` touches only `renewable` lessons, one entry per actor. |
| 4 | The hooks were going to run the tool from the plugin folder, where `yaml` is not installed. Running the project's copy instead would let a cloned repo execute code through a trusted plugin. | The hook commands are dependency-free, read a JSON cache, and never run project code (section 7, task B6). |
| 5 | Parsing hundreds of lessons on every file read is too slow for a hook. | Same cache; a 200 ms budget. |
| 6 | A hook that commits would commit on whatever branch the user is on, mid-rebase included. | No hook commits. The skill puts memory changes in normal commits. |
| 7 | `Stop` fires at the end of every turn, not of the session, so "block once per session" was the wrong rule. | The nudge names only lessons this session's own edits broke, each once (section 7). |
| 8 | Prompt matching by keyword would add loosely related pointers to every prompt. | Left out until there is a real search to build it on. |
| 9 | A per-domain `log.md` is not a reserved file in this validator and would need a `type`. | Dropped. |
| 10 | The 40-line lesson budget counted frontmatter, which is longer in OKF. | The budget is 30 body lines. |
| 11 | CI failing on `stale` would turn unrelated pull requests red as time passes. | `--strict` ignores `stale` and `unverified`. |
| 12 | The demo had no code, so no lesson could cite or check anything. | The demo gains six small source files (section 13). |
| 13 | The notebook added a second pipeline and its own state for little gain once writing a lesson is one command. | Left out. An unconfirmed thought is an `inferred` lesson. |
| 14 | The pi extension would have pulled pi's packages into this repo's typecheck. | It declares the few types it uses. |
| 15 | `check` as free shell would be code execution from a markdown file. | Four fixed, read-only test kinds, confined to the project root. |
| 16 | A fresh clone has no cache, and the first draft of this spec did not say what the hooks do then. | `brief` prints one line asking for `edukai:index`; the other two stay quiet (section 7). |
| 17 | In the first draft, demo lesson 8 would have been `renewable`, not `fresh`: its 30 days ran out before the demo clock. | It carries a later entry from the scripted re-check, which also shows that signature in the demo. |

**Second pass, after `okf-search` landed** (commits `9cf66f7` to `f0e4f32`):

| # | Problem found | What the spec does instead |
| --- | --- | --- |
| 18 | The spec said nothing could be imported from `okf-view.mts`, so the tool would carry its own parser. `okf-core.mts` now exports that parser. | `okf-edukai.mts` imports it (section 7). |
| 19 | `okf-core.mts` imports `yaml` at the top, so one file could no longer hold both the project commands and the hook commands. | Two files, with an import rule on the hook file that a test enforces, the way `okf-rank.mts` is kept pure. |
| 20 | The spec invented a `.edukai/` folder and its own cache rules. `okf-search` already has a cache place and trust rules, including why a planted cache matters. | Same place and rules (section 7). No `.gitignore` change. |
| 21 | Prompt matching was cut for lack of a search. A ranked, freshness-aware one now exists and runs on any bundle. | `edukai:search`, named in the brief and the skill (section 8). Matching inside a hook stays out, for the reasons given there. |
| 22 | The spec had its own wording for staleness. | `freshness` and `freshnessLabel` from `okf-rank.mts`. |
| 23 | An optional viewer colour mode was planned. ADR-0001 says each new viewer control is costly and proposes React. | No new viewer controls. |
| 24 | The tour outline predated the cast and step-by-step pattern the demo tours now follow. | Task E4 follows it. |

**Still weak, accepted for now:**

- The agent writes the lesson, its check, and its first `verified` entry. A wrong lesson with a
  matching check stays `fresh`. Only `human:` review reaches the top trust tier, and nothing in
  this release asks for it.
- A digest covers a whole file. A lesson about one function goes `suspect` when another function
  changes, unless it has a check.
- `matches` runs an agent-written regular expression. It gets 200 ms on a file; one that runs
  out is a failed check ("took over 200 ms to run"), so it reaches the queue instead of
  stalling a hook.
- Lessons are only as findable as file paths make them. A lesson with only URL sources is seen
  through its overview or not at all.
- Hooks fail silently by design, so a broken install looks like an empty memory. `EDUKAI_DEBUG`
  and the `AGENTS.md` snippet are the only safety nets.

**Harness checks** (run 2026-10-07 with the probes in `docs/specs/edukai-probes/`):

| Assumption | Claude Code 2.1.292, Sonnet 5.5 and Haiku 4.5 | pi 1.0.4, DeepSeek V4 Flash (`deepinfra`) |
| --- | --- | --- |
| A plugin's `hooks/hooks.json` is loaded | Yes, with `--plugin-dir`. Not checked for a marketplace install or a clone into the skills folder. | n/a (`-e` used; a package's `extensions` entry not checked) |
| The hook can find itself and the project | `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PROJECT_DIR` are both set; the hook's working folder is the project | The extension resolves its own path with `import.meta.url`; `ctx.cwd` is the project |
| Text given at session start reaches the model | Yes, both models repeated it | Yes, with `deliverAs: "nextTurn"` |
| Text given after a read or an edit reaches the model | Yes, both models, through `additionalContext`. `tool_input.file_path` is absolute. | Yes, appended to `content` as `{ type: "text", text }`. `event.input.path` is relative to `ctx.cwd`. |
| The agent can be given one more turn at the end | Yes. `decision: "block"` continued the turn, and the model acted on the reason (Sonnet). | Yes, from inside `agent_end`, in print mode and RPC mode |
| A session id is available | `session_id` on every event | `ctx.sessionManager.getSessionId()` |
| The hook file runs as `.mts` | Yes, on Node 22.23.1 | `pi.exec("node", …)` works; same Node |

What the checks changed:

- `Stop` input does carry `stop_hook_active`: `false` the first time, `true` on the stop that
  follows a block. The hook must do nothing when it is `true`, as a second guard beside the
  session file's `nudged` list.
- This machine has Node 22.23.1, not 24, and the tools run. Section 10 now asks the hooks for
  Node 22.18 or later, the floor `templates/package-json-scripts.md` already gives, and pi 1.0 needs
  22.19 itself, so the extension checks nothing.
- The pi finish nudge depends on the pi version. On 0.73.1 a follow-up sent from inside
  `agent_end` started no turn; on 1.0.4 it does. The adapter states pi 1.0 as its floor.
- **The model may not trust hook text.** In pi, DeepSeek saw all three texts but called them
  "injected file text" and "not a token I received", and in one of three nudge runs it
  declined the instruction as "not part of your request". The Claude models followed the same
  text without comment. A model is right to be wary of instructions that appear inside a tool
  result, so the hooks must not rely on being obeyed: section 10 now has the pi extension
  declare the `edukai:` prefix in the system prompt, the skill and the `AGENTS.md` snippet say
  the same, and hook text states facts and points at files instead of giving orders where it
  can. How well this works is a task-C3 check, not a settled point.

Tasks C2 and C3 are checked by hand with these models: Claude Code with Sonnet 5.5 and Haiku
4.5, pi with DeepSeek V4 Flash.

**Still to confirm while building:**

- Claude Code loads `hooks/hooks.json` for a marketplace install and for a clone into the
  skills folder, not only for `--plugin-dir`.
- In pi: the finish nudge in the interactive terminal, loading through the package's
  `extensions` entry, and whether declaring the `edukai:` prefix in the system prompt is
  enough for a wary model to act on hook text.
- The `yaml` document API round-trips this repo's frontmatter style byte for byte.
- The viewer opens a bundle that has no `Application` concept.

**Decided by the owner (2026-10-07):**

- The agent searches by hand in this release. Running the search from a hook is future work;
  see "Later" below.
- A fresh clone needing one `npm run edukai:index` before the hooks have anything to read is
  acceptable. No generated cache file is committed.
- The memory bundle stays opt-in (`--edukai`) for now. It may become the default in a later
  release; see L3.
- The personal bundle lives in the home folder at `~/.edukai/` by default. The location is
  configurable and must be documented. Building it is still future work; see L2.

**Later** (open tasks, not part of 0.4.0):

- [ ] **L1. Search from a hook.** On `UserPromptSubmit` and `before_agent_start`, rank the
  prompt against the memory bundle with `okf-rank.mts` and add at most three pointers. Needs a
  term-count index the hook file can read without `yaml`, a score floor so weak matches add
  nothing, and a measure of whether the pointers help before it is on by default.

- [ ] **L2. The personal bundle.** A memory bundle of the same shape for what is not about one
  codebase: preferences, people, cross-project tooling. Default location `~/.edukai/`,
  overridden by the `EDUKAI_HOME` environment variable, and by a `--home <dir>` flag on the
  tool. Document both in the README and the skill. Still to design: how the brief and `cites`
  merge two bundles, how the split rule is worded for the agent (about this codebase goes in
  the project, anything else goes in the personal one), and how a private bundle is kept out
  of a shared repo's commits.

- [ ] **L3. Memory by default.** A plain `bootstrap` creates both bundles unless told
  `--no-edukai`. Revisit after the memory bundle has been used in real projects.

No questions are open.
