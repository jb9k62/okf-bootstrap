# okf-widgets

Interactive React widgets ("micro-worlds") for this project's OKF bundle. A concept embeds one
with a fenced block whose language is `widget`. The first line is the widget's name; anything
below it is data for that widget, which most widgets ignore:

````markdown
```widget
retry-backoff
```
````

A widget that takes data (`sql-erd` reads a schema's SQL, `http-concurrency` its requests,
`css-specificity` its rules) gets the text below the name as its `source` prop, and the viewer
passes it through `mount(element, name, source)`. Data-driven widgets share one line convention
(`models/source.ts`): one record per line, `--` starts a comment.

`npm run okf:view` builds this package to one IIFE file (`dist/okf-widgets.js`) and inlines it
into `okf/viz.html`, so the viewer stays a single self-contained page. The package is
documentation tooling: it is not imported by the product and ships nothing to users.

This package was scaffolded by okf-bootstrap and now belongs to this project. The widgets it
came with are worked examples, each about one idea:

| Widget | The idea | Model |
| --- | --- | --- |
| `utc-week` | A week starts at Monday 00:00 UTC, not local midnight | `week.ts` |
| `retry-backoff` | Backoff spaces rounds out; only jitter spaces clients out | `backoff.ts` |
| `sql-erd` | A schema's shape, its design problems and delete impact | `ddl.ts`, `schema.ts`, `layout.ts` |
| `cache-policy` | An eviction policy is a bet on the traffic; more room can hurt FIFO | `cache.ts` |
| `http-concurrency` | Concurrency stops helping at the critical path; connections cost handshakes | `concurrency.ts` |
| `css-specificity` | The cascade's tie-breakers, and specificity counts in columns | `specificity.ts` |
| `bloom-filter` | "No" is certain, "yes" is only likely, and the bits fill up | `bloom.ts` |
| `rate-limiter` | A fixed window lets twice its limit through at the boundary | `ratelimit.ts` |
| `binary-search` | Halving beats scanning, but only on a sorted list | `search.ts` |
| `consistent-hash` | A ring moves a fraction of keys when a server joins; `hash % n` moves most | `ring.ts` |

 Keep them as references,
delete them, or replace them with widgets about this project's own ideas.

## Layout

| Path | What goes there |
| --- | --- |
| `src/index.tsx` | The registry (`WIDGETS`) and the `mount` / `unmountAll` / `names` API the viewer calls |
| `src/kit.tsx` | Shared pieces: `useWorld` (state plus presets), `Presets`, `Choice`, `Slider`, `Toggle`, `BarChart`, `Scrubber`, `Facts`, `Note`, `ModelNote`, `SourceProblem` |
| `src/widgets/*.tsx` | One component per widget, plus `widgets.test.tsx` |
| `src/models/*.ts` | Pure logic a widget draws, each with a `*.test.ts`. `ddl.ts`, `schema.ts` and `layout.ts` serve `sql-erd`: they read SQL, review the design and place the tables, and work for any schema. `source.ts` reads the block's data lines |
| `src/widgets.css` | Styles, built on the viewer's CSS variables so both themes work |

## Add a widget

1. **Pick one idea** the reader should come away with, and the edge cases that show it. A
   widget that teaches three things teaches none.
2. **Put the logic in a model**, or better, import the project's real code through `@app`
   (see `vite.config.ts` and `tsconfig.json`; point the alias at your source). Only pure
   modules: no I/O, no framework side effects. When the real logic cannot run in a browser
   (SQL, a server, another language), write a TypeScript model and pin it with a test that
   uses the **same cases as the real code's tests**.
3. **Write the component** in `src/widgets/`: `useWorld` with presets for the edge cases (each
   carrying its state and note), direct controls for free play, a result derived from the model on every render, and a `ModelNote` that says
   what is real code and what is a model.
4. **Mark one control `data-probe`** (the `probe` prop of `Presets` does it). The viewer's
   render gate (`npm run okf:mermaid:render`) clicks it and fails if the widget's text does
   not change.
5. **Register it** in `WIDGETS` in `src/index.tsx`, with the name concepts will use and a
   "Try it: ..." caption.
6. **Test the interaction it teaches** in `widgets.test.tsx`, then run `npm run typecheck`,
   `npm test` and the render gate.

## Checks

```bash
npm run typecheck -w okf-widgets
npm test -w okf-widgets
npm run okf:mermaid:render   # builds, then mounts every widget and clicks its probe
```

The viewer still renders when this package is not built: each widget block shows a build hint
instead of a crash. An unknown widget name shows the list of known names.
