---
type: Architectural Decision
title: "ADR-0005: Name each bundle for what it holds: design/, and an optional ops/"
description: Why the design bundle should move from okf/ to a configurable design/, and why knowledge about running the software gets its own optional bundle.
tags: [adr, bundles, layout, ops]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-09T12:00:00Z }
sources:
  - resource: skills/okf-bootstrap/assets/bootstrap.mts
  - resource: skills/okf-bootstrap/assets/okf-edukai.mts
  - resource: skills/okf-bootstrap/assets/okf-update.mts
  - resource: skills/okf-bootstrap/references/PLAYBOOK.md
---

# ADR-0005: Name each bundle for what it holds: design/, and an optional ops/

- **Status:** proposed
- **Date:** 2026-10-09
- **Deciders:** the maintainers

## Context

A scaffolded project has up to two bundles today. The design bundle lives in `okf/` and the
memory bundle lives in `edukai/` ([ADR-0002](/adr/0002-two-bundles-design-and-memory.md)).
Both are OKF bundles, so the name `okf/` says which *format* a folder uses, not what is in it.
With one bundle that was harmless. With two it is already odd, and a third would make it
misleading.

There is a third kind of knowledge that has no home yet: what surrounds the software. How to
operate it, the business processes it serves, who is on which team, who is responsible for
what, how an incident escalates, and the security rules nobody may break. It differs from
design docs in three ways:

- **The reader** is an operator, someone on call or a new joiner, who may never read the code.
- **The owner** is often not the team that writes the code, and the content changes when the
  organisation changes, not when the code does.
- **The sources** are mostly outside the repository (a policy, a rota, a contract), so a claim
  can rarely be pinned to the digest of a file here.

Many projects need none of this, so it must not be scaffolded by default.

The code fixes the names in several places, which is what a change has to undo:

- `bootstrap.mts` writes the skeleton to `path.join(target, 'okf')`, and every `okf:` npm
  script it adds passes the literal `okf` to the tool. `--tools-only` refuses to run without
  an `okf/` folder.
- `okf-update.mts` maps each template to a path beginning `okf/`.
- `okf-search.mts` and `okf-mermaid.mts` default their bundle to `okf`.
- `okf-edukai.mts` decides a bundle is the memory bundle when its folder is *named* `edukai`.
  A role is read from a folder name, so a renamed folder silently changes behaviour.
- The scaffold also creates a subfolder `okf/design/` for a project's first concepts
  (`PLAYBOOK.md`). A bundle named `design/` would contain a `design/design/`.

## Decision

We will name each bundle for what it holds. The design bundle is scaffolded as `design/`, and
a new, optional `ops/` bundle holds the knowledge about operating the software and the
organisation around it. Both names are defaults that a project can change.

In detail:

- **Three roles, three defaults.** `design` → `design/`, `ops` → `ops/`, `memory` →
  `edukai/`. `--ops` opts in to the third, as `--edukai` does for memory. A flag per role
  (`--design-dir`, `--ops-dir`) overrides the folder, for a project where `design/` already
  holds mock-ups or `ops/` already holds deployment files.
- **The manifest records the choice.** `scripts/.okf-bootstrap.json` gains a `bundles` map
  from role to folder. The tools read a bundle's role from that map and never from the
  folder's name. The npm scripts are generated from it.
- **An existing `okf/` is kept.** A manifest with no `bundles` map means `design: okf`. A
  re-run or an update never renames a folder; moving to `design/` is a `git mv` and one
  manifest edit that the project chooses to make.
- **`ops/` follows the design bundle's rules.** People write it and people review it. It gets
  its own index, log and viewer, and `ops:validate`, `ops:view`, `ops:search` and
  `ops:recheck` scripts, in the pattern the `edukai:` scripts already set. Its starter
  sections are runbooks, processes, people and teams, escalation, and security rules.
- **The `okf:` script names stay**, and point at the design bundle. `okf` remains the name of
  the format and of the tools.
- **The starter subfolder `design/` inside the bundle is renamed**, so no project gets
  `design/design/`.
- **This repository follows.** Its own `okf/` and `examples/demo/okf/` move to `design/` in
  the change that implements this record.

## Consequences

### Positive

- A folder's name tells a reader what they will find, and a writer where a new page belongs:
  how the software is built, how it is run, or what an agent learned.
- A project with a clashing folder can still adopt the skill, because no name is forced.
- A bundle's role stops depending on what its folder is called, which removes a silent
  failure that exists today for a renamed `edukai/`.
- Operational knowledge gains the validator, the link checks, the staleness rules and the
  viewer, without design-bundle readers having to wade through rotas.

### Trade-offs

- Every tool must learn to look a bundle up by role. That touches the scaffolder, the updater,
  search, the Mermaid gate, the memory tool and both skills' documentation.
- Two layouts will exist for a long time: old projects with `okf/`, new ones with `design/`.
  Documentation and error messages have to name the folder the project really has.
- A third bundle is a third thing to index and keep current, and a writer has one more
  boundary to judge. A runbook for one service sits close to that service's design page.
- `ops/` invites content that should not be public: names, phone numbers, escalation
  contacts. The skill has to say so plainly, and the starter pages should point at where such
  details live, not hold them.
- Pinned `sources` help less in `ops/`, because its sources are rarely files in the
  repository. Staleness there rests on review dates.
- Whether the memory hooks should put any of `ops/` (the security rules, for one) in front of
  an agent is not decided here.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Keep `okf/` as the design bundle's name | It names the format. Once `ops/` and `edukai/` sit beside it, all three are OKF and only one is called so |
| A fixed `design/`, not configurable | `design/` and `ops/` are common folder names. A project that already uses one could not adopt the skill without renaming its own files |
| One parent folder, `okf/design`, `okf/ops`, `okf/memory` | It tidies the project root, but it moves `edukai/` too, which the harness hooks and every existing project expect at the root, and it hides the docs one level further from a person browsing the repository |
| Put operations pages in a section of the design bundle | It cannot be optional in the same way, it mixes two sets of readers and owners in one index and one graph, and review by the code's authors is the wrong trust rule for a rota or a policy |
| Leave operations knowledge to a wiki | It loses the link checks, the staleness rules and the viewer, and it leaves that knowledge out of reach of the agents working in the repository |
