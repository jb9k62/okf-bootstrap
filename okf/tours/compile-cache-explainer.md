---
type: Explainer
title: "Guided tour: why the tools start fast"
description: "The two caches the tools keep, what each one is keyed on, and why they never choose what to throw away. A widget contrasts them with the eviction policies a cache usually has. Closes with a quiz."
tags: [explainer, guided-tour, caching, tooling]
generated: { by: pi/deepseek-ai/DeepSeek-V4.1-Flash, at: 2026-10-08T20:30:00Z }
sources:
  - resource: skills/okf-bootstrap/assets/okf-start.mjs
  - resource: hooks/compile-cache.mjs
  - resource: skills/okf-bootstrap/assets/okf-search.mts
---

This tour is for anyone who runs the tools or wonders why the npm scripts load a file before
the tool. After it, you will know what the two caches are, what each is keyed on, and why
neither has to decide what to throw away. There is a widget and a [quiz](#quiz) at the end.

## Who is affected

| Person | What a slow start means to them |
| --- | --- |
| **A maintainer** | Runs `npm run check` and the gates many times a day; a second saved per run adds up |
| **An agent** | Runs `edukai:brief` and a search on nearly every session, and pays whatever they cost before it can work |
| **A hook** | Runs on session start, on every read and edit, and on finish, each with a five-second timeout |

## Background

> [!definition] Compile cache
> Node strips TypeScript from a file before running it. The stripped result is thrown away when
> the process exits, so the next run strips the same file again. Node's compile cache keeps
> that stripped code on disk, keyed by the file's content, and reuses it.

The tools are TypeScript with no build step: Node 24 runs a `.mts` file directly. That is the
point of the design, but it has a cost, and for a hook that runs on every file read the cost is
most of the work. The project's answer is a cache, in two places:

- `okf-start.mjs` is loaded first by every npm script (`node --import ./scripts/okf-start.mjs
  scripts/okf-search.mts`). It turns the compile cache on under the project's own
  `node_modules/.cache/okf-compile`, or in a private folder under the temp directory when
  there is no `node_modules` to write to.
- `hooks/compile-cache.mjs` does the same for the memory hooks, in a private temp folder
  (`edukai-<uid>`, mode `0700`), because a hook may run where the project cannot be written to.

There is a third cache, of a different kind: `okf-search.mts` keeps an inverted index on disk
so a search does not re-read and re-parse every file.

## The problem, one step at a time

1. **A hook starts.** It is plain JavaScript, then imports the TypeScript core. Node strips the
   core's types. The process exits. The stripped code is gone.
2. **The next read starts it again.** Same file, same stripping, for a hook that is meant to
   cost almost nothing.
3. **Turn on the compile cache.** The stripped code is written under a private folder and
   reused on the next start. The tool's behaviour is unchanged; only the start is cheaper.
4. **The cache can be wrong after an upgrade.** It is keyed by the file's content, so a changed
   tool is a cache miss and gets stripped again. There is no stale-code path.
5. **A search is a different problem.** Reading the whole bundle for one query is the expense
   there, so the index is cached separately, keyed by each file's size, modification time and
   change time, plus a hash of the code that wrote it.
6. **If anything does not match, the file is read again.** A deleted cache costs time, never
   correctness.

## The picture

Both caches are keyed on identity: the content of the code, or the timestamp of the file. A
mismatch means "recompute", not "keep the older entry".

```mermaid
flowchart LR
    start["npm run okf:search"] --> load["load okf-start.mjs"]
    load --> on["enable compile cache"]
    on --> tool["run the tool"]
    tool --> idx{"index cache<br/>key matches?"}
    idx -->|"yes"| fast["answer from the index"]
    idx -->|"no"| read["read and parse the bundle"]
    read --> write["write a new index"]

    classDef neutral fill:#e0e7ff,stroke:#3730a3,color:#1e1b4b
    classDef good fill:#dcfce7,stroke:#166534,color:#0f2417
    classDef work fill:#fef3c7,stroke:#b45309,color:#3b2503
    class start,load,on,tool,idx neutral
    class fast good
    class read,write work
```

Try it, in three steps. This widget runs the cache policies a general-purpose cache might use,
so the contrast is visible: those caches must *choose* a victim, and the choice can be wrong.

1. **Belady's anomaly.** Click it and read the comparison table. With FIFO, a cache with room
   for four entries does worse than one with room for three on this trace. A cache that throws
   out by age can be hurt by having more room.
2. **A scan pushes out the hot keys.** Two keys are used constantly, then a one-off scan reads
   six keys it will never use again. LRU treats each scan key as recent and drops the hot ones.
   Switch to LFU and the scan only churns itself.
3. **What this project does instead.** Neither of our caches has this problem, because neither
   chooses a victim. The compile cache is keyed by the content of the file; the index cache is
   keyed by each file's size and timestamps and the hash of the tool that wrote it. A mismatch
   is a miss, and a miss recomputes. There is nothing to evict and no wrong answer to keep.

```widget
cache-policy
```

> [!tip] What to notice
> The table's two worst cases are both policies that guess which entry is least valuable. Our
> caches never guess: they only ever answer for an exact key, and any other key is a miss.

## Details

> [!important] A cache is an optimisation, never a source of truth
> Delete `node_modules/.cache/` and everything still works; it is only slower. That is why a
> read-only checkout, or a machine where the temp folder cannot be made private, simply runs
> without a cache instead of failing.

> [!warning] Do not cache what can be planted
> A cache holds code Node will run, so it lives somewhere private: under the project's own
> `node_modules`, or in a folder owned by the user with no group or world access. A shared
> temp folder is not used.

> [!edge-case] A file written as the cache is written
> Version control tools avoid the "racily clean" case, where a file's timestamp is so close to
> the cache's that the two cannot be ordered. `okf-search.mts` applies the same rule: a file
> modified close to when the cache was written is read again rather than trusted.

## Quiz

Three questions on the ideas above.

```quiz
A cache with room for four entries does worse than one with room for three. What does that show?
- [ ] The trace was too short to be meaningful
~ The trace is fixed and the comparison is exact; the size change is the whole difference.
- [x] A policy that evicts by age can be hurt by extra room
~ FIFO evicts whatever arrived first, so more room changes which entry is old at the wrong moment.
- [ ] Caches should always be sized in powers of two
~ Size is not the issue; the replacement rule is.
---
Why does this project's search cache never have to choose what to evict?
- [ ] It is small enough to hold everything
~ Bundles grow; the design does not rely on smallness.
- [x] It is keyed on the files, so a changed file is simply a miss
~ The cache answers only for an exact key: each file's size, timestamps and the tool's hash.
- [ ] It evicts the least recently used entry, like LRU
~ There is no eviction at all; a mismatch means recompute.
---
The compile cache holds stripped TypeScript keyed by the file's content. A tool is upgraded. What happens?
- [ ] The old stripped code is reused, and the new tool does not take effect
~ That would be a correctness bug, and it is not how the cache is keyed.
- [x] The content no longer matches, so the file is stripped again
~ A content key makes an edit a miss; a cache can only be stale in ways its key cannot see.
- [ ] The cache is deleted and rebuilt from scratch every run
~ That would defeat the cache; only the changed file misses.
```
