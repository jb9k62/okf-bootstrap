# ADR-0001: Move the viewer's controls and lists to React, in stages

- **Status:** proposed (not started; pick up later)
- **Date:** 2026-10-02
- **Deciders:** to be decided by the maintainer

## Context

`okf-view.mts` writes one self-contained `viz.html`. Its client script is about 3,200 lines of
imperative DOM code in a template literal: no build step, no bundler, libraries inlined or
loaded from a pinned CDN. That rule is in `AGENTS.md`, and it is why the viewer is easy to ship
and to open from anywhere.

Adding ranked search to the viewer showed what the style costs. Every control reads and writes
shared state by hand (`applyFilters`, `refreshLists`, `sort`, `userSorted`, the neighbourhood
flag, the colour mode), and each new control has to be wired into all of them in the right
order. Wiring the search in meant checking by hand that state such as `sort` was declared before
the handlers that read it. The client
script also cannot use backticks, `${` or backslashes, because it sits inside a template
literal, which makes ordinary JavaScript awkward to write.

The widgets (`templates/okf-widgets`) are already React, with their own build, tests and
typecheck, inlined into `viz.html` as a pre-built bundle. So React and a build step already
exist in the project; they just stop short of the viewer.

The question: should the whole viewer become a React application that still ships as one HTML
file?

## Decision

Not as a rewrite. If we proceed, we move the **controls and lists** to React in stages, and
leave the libraries that own their own DOM alone:

1. Keep Cytoscape (graph), marked (markdown) and Mermaid (diagrams) as they are, behind refs.
2. Build a small React app for the search box and results list, the filters, the tree, the
   table and the concept header. It takes the viewer's data (`window.BUNDLE`) and `OKF_RANK` as
   props.
3. Build it the way the widgets are built, with the same workspace pattern, and inline the output
   into `viz.html`. The generated file stays a single file and needs no network beyond the
   existing pinned CDN scripts.
4. Move one view at a time, starting with search and filters. `test/views.e2e.mts` is the safety
   net, so each step must leave it green.
5. Start with a spike on step 2's first piece, and judge it on three things before going
   further: bundle size added to `viz.html`, how much simpler the state handling gets, and
   whether the e2e tests pass unchanged.

## Consequences

### Positive

- State becomes declarative: filters, sort, mode and the selected concept are data, and the
  lists derive from them. That removes the class of ordering bugs described above.
- Ordinary components, types and tests for the UI. The client script stops being a string.
- One ecosystem for the widgets and the viewer, shared components (`Choice`, `Slider` and so
  on can be reused), and a larger pool of contributors who already know React.
- The ranking is already a pure module shared between Node and the page, so it drops into
  React as a plain function.

### Trade-offs

- **The build.** The viewer today is TypeScript Node runs directly. A React viewer needs a
  build to produce its inlined bundle, as the widgets do, so the maintainer's workflow gains a
  step (`npm run build` before the demo and the render gate), and `AGENTS.md`'s "no build step"
  line must be amended for the viewer's UI bundle. The tools themselves (`okf-view.mts`,
  `okf-search.mts` and the rest) stay build-free.
- **Size.** React and ReactDOM add to every `viz.html`. We have not measured it; a spike should.
  The widget bundle is only inlined when the project has widgets, but the viewer's UI would
  always be present.
- **Imperative libraries.** Cytoscape and Mermaid manage their own DOM, so they live behind refs
  and effects. This is the fiddliest part of any port and the part that gains least, which is
  why it is left out.
- **Migration risk.** A big-bang rewrite of 3,200 lines would be hard to review and could
  regress behaviour that the e2e tests do not cover (phone layout, diagram expand, reading
  view). Staging limits that, but it means the old and new code coexist for a while.
- **No user-visible gain by itself.** This is a maintainability change. It should not displace
  features users are waiting for.

## Alternatives considered

| Option | Why rejected |
| --- | --- |
| Full React rewrite of the viewer | Largest risk and size, and it ports the Cytoscape and Mermaid glue, which benefits least. |
| Stay as is | Cheapest now, but each new control repeats the wiring cost. Fine if the viewer stops growing; it has not. |
| React without a build (`htm` or hand-written `createElement`) | Keeps one step fewer, but loses JSX and types, and is awkward to read and review. |
| A lighter reactive library (Preact, Svelte or Solid) | Smaller output, but a second UI ecosystem next to the React widgets that already exist. Worth revisiting only if the spike shows React's size is a problem. |
| Small refactor: one state object and a `render()` function, still plain JS | No build, no dependency, and it would remove most of the ordering bugs. It is the fallback if the spike goes badly, and could even be a first step. |
