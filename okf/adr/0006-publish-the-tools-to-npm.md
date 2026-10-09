---
type: Architectural Decision
title: "ADR-0006: Publish the tools to npm as @jb9k62/good2go"
description: Why a project should depend on the tools as an npm package instead of holding copies in scripts/, what that costs, and what stays with the skill.
tags: [adr, distribution, npm, tooling]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-09T12:00:00Z }
sources:
  - resource: package.json
  - resource: skills/okf-bootstrap/assets/bootstrap.mts
  - resource: skills/okf-bootstrap/assets/okf-update.mts
  - resource: skills/okf-bootstrap/assets/okf-mermaid.mts
  - resource: scripts/install-skill.mts
  - resource: README.md
---

# ADR-0006: Publish the tools to npm as @jb9k62/good2go

- **Status:** proposed
- **Date:** 2026-10-09
- **Deciders:** the maintainers

## Context

Two things are distributed today, by two routes.

**The skills and the harness adapters** reach an agent as a pi package, a Claude Code plugin,
or a clone linked by `scripts/install-skill.mts`.

**The tools** reach a project as copies. `bootstrap.mts` copies eight TypeScript tools and
`okf-start.mjs` into the project's `scripts/`, about 9,500 lines, writes their hashes to
`scripts/.okf-bootstrap.json`, adds the `okf:` npm scripts, and adds `yaml` to the project's
own `devDependencies` because the copied viewer imports it.

Copies do not update themselves, so the skill ships an updater. `okf-update.mts` is 561 lines.
It clones a release tag into a temporary folder, compares hashes, keeps a script the project
edited and writes the release's copy beside it as `<name>.new`, backs files up in case it is
interrupted, and refuses to run on a dirty git tree. It needs git and the network, and
`--apply` runs code from the fetched tag.

The costs fall on the project:

- Thousands of lines of someone else's code are committed to its repository, and show up in
  its reviews, its searches and its line counts.
- An upgrade is a special command with its own rules, which no dependency tool (Dependabot,
  Renovate, `npm outdated`) knows about.
- The lockfile does not record which version of the tools a project runs. The manifest does,
  in a format only this skill reads.

A package registry already solves versioning, pinning and upgrades. What we looked at is
whether the tools can be an npm package. We found four facts that shape the answer:

- **Node will not strip types under `node_modules`.** A `.mts` file there fails with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; we reproduced it on Node 22.23, and Node's
  documentation states it as a rule. So the package must contain JavaScript, and publishing
  needs a compile step this project does not have. The step is small: the code is already
  erasable TypeScript, and `tsconfig.json` already sets `rewriteRelativeImportExtensions`.
- **The names are free.** `@jb9k62/good2go` and `good2go` returned 404 from the registry on
  2026-10-09, as did `okf-bootstrap`. The unscoped `okf` is taken. The `@jb9k62` scope
  belongs to whoever holds the npm user of that name, which we have not confirmed.
- **The memory hook cannot come from the project's `node_modules`.** It runs from an installed
  plugin, where `node_modules` may not exist, and it must never run code from the project.
- **`package.json` is marked `private`** and its workspace is a template, not a library.

## Decision

We will publish the tools to npm as `@jb9k62/good2go`, with a `good2go` command, and have a
scaffolded project depend on that package instead of holding copies. The project takes the
name **Good2Go**; the package is the first place the name is used.

In detail:

- **The package holds compiled JavaScript**, built from `skills/okf-bootstrap/assets/` when a
  release is published. Nothing compiled is committed. This repository keeps running the
  TypeScript sources directly ([ADR-0003](/adr/0003-run-the-tools-from-the-skill-assets.md)).
- **One command, with subcommands** for what the copied scripts do now: `good2go init`,
  `validate`, `view`, `mermaid`, `search`, `recheck`, and the memory tool's commands. The
  generated npm scripts call it, for example `"okf:validate": "good2go validate design"`.
- **`yaml` becomes the package's dependency.** The scaffolder stops editing the project's
  dependencies for it. `@mermaid-js/mermaid-cli` stays optional and is still found on `PATH`
  or in `node_modules/.bin`.
- **Upgrading is `npm update`.** The lockfile pins the version, and a project's usual
  dependency tooling proposes new ones.
- **A project without a `package.json`** runs a pinned `npx @jb9k62/good2go@<version> …`.
- **Templates are still copied**, because they become the project's own files: the bundle
  skeletons, the authoring aids and the widget workspace. `good2go init` copies them from the
  package and never overwrites an authored file without `--force`.
- **The skills and the adapters stay with the plugin.** `SKILL.md`, `hooks/` and `extensions/`
  keep their routes, and the plugin keeps its own copy of the hook, still free of
  dependencies. The skill's job becomes running `good2go init` and guiding the writing.
- **`okf-update.mts` shrinks.** Its script-refresh half goes. What remains is a report of the
  templates a release changed, written under `.okf-update/` for a hand diff.
- **Old projects migrate once.** A tools-only run removes each `scripts/okf-*` file whose hash
  still matches the manifest, rewrites the npm scripts, and adds the dependency. A script the
  project edited is kept and named, never deleted.
- **Releases are published from CI**, from a version tag, with npm provenance.

Renaming the repository, the skills and the plugin to match Good2Go is not decided here.

## Consequences

### Positive

- A project's repository holds its own knowledge and a one-line dependency, not the tools.
- Versions, pins, upgrade proposals and security advisories work the way they do for every
  other dependency, with no command to learn.
- Most of the updater, and its hardest cases (edited scripts, backups, interrupted applies),
  go away.
- The tools work without an agent: `npx @jb9k62/good2go init` scaffolds a project by hand.
- The `node --import ./scripts/okf-start.mjs` prefix on every script goes too. It exists to
  cache stripped TypeScript, and there is none left to strip.

### Trade-offs

- There is a build step at publish time, and a new way to ship something broken: the compiled
  package can differ from the sources the tests ran. CI must test the packed tarball.
- A project can no longer edit a tool in place. Today it can, and the updater respects it.
- The tools become a download from a registry. A project that is offline or vendors nothing
  from npm is worse off than with committed copies.
- The plugin's hook and the project's package can be different versions, and the hook reads a
  cache the package writes. The same gap exists today between a plugin and scaffolded copies;
  the cache needs a format version that the hook checks.
- Two names are in play, Good2Go for the package and okf-bootstrap for the repository, skill
  and plugin, until the wider rename is decided.
- The version already lives in four places that must match. Publishing adds a fifth thing to
  get right, the tag that triggers it.
- A scoped package is private by default, so it must be published with `--access public`.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Keep copying into `scripts/` and keep `okf:update` | It works, and it is what this record sets out to replace: committed copies, a bespoke updater, and upgrades no dependency tool can see |
| Publish the TypeScript sources to npm | Node refuses to strip types under `node_modules`, so the package would not run |
| A git dependency on a release tag | It also installs under `node_modules`, so it needs compiled output committed to the repository, or a build on every install with the development dependencies present |
| One bundled JavaScript file per tool, downloaded from a release | It removes the dependency on `yaml` but keeps a custom download and update path, and adds a bundler, which this project has declined for the viewer ([ADR-0004](/adr/0004-viz-html-stays-one-file.md)) |
| An unscoped name, `good2go` or `okf-bootstrap` | Both are free, but a scope ties the package to its owner and cannot be confused with, or squatted next to, someone else's |
| Put the skills in the npm package too | The harnesses load skills and hooks from their own plugin systems, and a hook must run where `node_modules` may not exist |
