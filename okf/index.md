---
okf_version: "0.2"
---

# okf-bootstrap

Design notes for **okf-bootstrap** itself: the two agent skills that scaffold an OKF bundle
into another project, and the tools, gates and harness adapters that keep it honest. This is
the repository's own bundle, kept in the format the skill asks other projects to use
([ADR-0001](/adr/0001-keep-this-repos-design-in-okf.md)).

Start with the overview, then the tools and the gates. The tours explain the ideas a reader
usually has to reconstruct from the code.

## The skill

* [Overview](/okf-bootstrap/overview.md) - what ships, who it is for, and what it leaves out
* [Architecture](/okf-bootstrap/architecture.md) - the two skills, the tools, the adapters and the demo
* [The tools](/okf-bootstrap/tools.md) - the scripts, what each does, and the rule each must keep
* [Quality gates](/okf-bootstrap/gates.md) - the exit-code contract, and what each gate can and cannot prove
* [The viewer](/okf-bootstrap/viewer.md) - one self-contained `viz.html`, and how the ranking reaches the page
* [Agent memory](/okf-bootstrap/agent-memory.md) - the `edukai/` bundle, its checks, and the hooks that hand it back
* [Testing and CI](/okf-bootstrap/testing.md) - how the tools, the demo and this bundle are checked

## Guided tours

* [Guided tour: why the tools start fast](/tours/compile-cache-explainer.md) - the caches the
  tools keep, and what a cache should keep
* [Guided tour: what a gate can prove](/tours/gates-explainer.md) - pass, broken, or could not run

## Decisions

* [Decision records](/adr/readme.md) - the choices behind the layout, the two bundles and the viewer

## The demo

`examples/demo/` is a fictional parcel-tracking service documented with the same tooling: a
design bundle, a memory bundle, and the lessons that go with them. `npm run demo` renders it,
and `examples/demo/README.md` walks through the memory bundle. It is the reference for what a
scaffolded project looks like.

Update history: [log.md](/log.md).
