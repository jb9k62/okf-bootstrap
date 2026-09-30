# Explainers: tours, micro-worlds and quizzes

How to write OKF concepts whose job is **understanding**, not reference: guided tours with
callouts, interactive React widgets, and self-check quizzes. Read this before writing an
`Explainer` concept or a widget. The authoring template is
`assets/templates/explainer.md` (scaffolded as `okf-explainer-template.md`); the widget
package template is `assets/templates/okf-widgets/` (scaffolded with `--widgets`).

## Why this exists

Geoffrey Litt, ["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck.html)
(July 2026): agents now write code faster than people can absorb it. Understanding still
matters, and less for *verification* (agents increasingly check their own work) than for
**participation**: a person who has lost the plot can no longer steer, spot the next idea, or
talk about the system with the rest of the team. Without it a project piles up *cognitive
debt*. His answer is to use the agent to build understanding too: "agents can write code to
help us understand code". He names four devices, and this skill supports all of them:

| Device | In the article | In an OKF bundle |
| --- | --- | --- |
| **Explainer docs** | background first, intuition before details, interactive figures, "literate diffs" in a sensible order | an `Explainer` concept, from `okf-explainer-template.md` |
| **Quizzes** | a "speed regulator on the AI loop": "I won't send code to others until I can pass the quiz" (after Andy Matuschak's work on spaced repetition) | a fenced ` ```quiz ` block, rendered click-to-check |
| **Micro-worlds** | Seymour Papert's "Mathland": to learn a system, live in it. A step-through debugger, a migration you drive by hand | a fenced ` ```widget ` block, a React component in `packages/okf-widgets` |
| **Shared spaces** | shared mental models and vocabulary between agents and people | the bundle itself: one graph, one set of defined terms, linked not repeated |

The idea goes back to Alan Kay: computers as a medium for *dynamic simulations* that help
people understand complex things. "The point was always to augment, not just automate."

## When to write one

- A change or mechanism someone will have to build on, review, or explain to others.
- A concept people keep getting wrong (time zones, isolation, caching, concurrency, money).
- Onboarding: "start here" for the system.
- After a large agent-written change, **before** it is shared: the quiz is the gate.

Not every concept needs one. Reference concepts (API, data model, decisions) stay short and
factual; the explainer links to them and adds the path through them.

## The shape: background, intuition, details, check

1. **Opening paragraph**: who it is for, what they will be able to do afterwards, how to
   read it, and that there are widgets and a quiz.
2. **Background**: the existing system and the problem, before the change. Define each term
   once with a `[!definition]` callout, then use exactly that word everywhere.
3. **Intuition**: the idea in plain words and one picture before any code. A Mermaid diagram
   for structure; a widget for behaviour.
4. **Details**: the real code in the order the reader needs it, not file order (the "literate
   diff"). Short excerpts, each followed by why. Invariants as `[!important]`, traps as
   `[!warning]` or `[!caution]`, edge cases as `[!edge-case]`.
5. **Quiz**: the check, last.

Keep an explainer to one idea's worth of material. Two ideas make two tours that link to each
other (and both belong in `index.md`).

## Callouts

A blockquote whose first line is `[!type] Optional title`:

```markdown
> [!definition] Tenant
> One customer of a shared system.
```

Types: `note`, `tip`, `important`, `warning`, `caution` (the GitHub alert set) plus
`definition`, `example`, `edge-case`. An unknown type stays a plain blockquote with its marker
visible, and the render gate counts it, so a typo shows up.

## Quizzes

````markdown
```quiz
A question that needs the mental model, not recall of a sentence.
- [ ] A plausible wrong answer
~ Why it is wrong.
- [x] The right answer
~ Why it is right, with one fact the reader did not have.
---
Next question.
- [x] Right
~ Why.
- [ ] Wrong
~ Why not.
```
````

- Questions are separated by a `---` line. Options are `- [ ]` / `- [x]`; a `~` line after an
  option is its feedback. Text is plain (markdown inside shows literally).
- **Exactly one** option is marked correct; otherwise the viewer shows an error in place of
  the question, and the render gate counts it.
- Write **wrong answers that are real misconceptions**, and feedback on every option that
  points back at the idea that corrects it. A quiz whose wrong answers are silly teaches
  nothing and passes everyone.
- Ask about consequences ("what happens if...", "why does X matter?"), not definitions.
- Five to seven questions for a full tour; two or three for a short one.

## Micro-worlds (widgets)

A widget is a small, self-contained simulation of one idea, embedded in a concept:

````markdown
```widget
retry-backoff
```
````

The first line is the widget's name. Anything below it is data for that widget, and most
widgets take none. The viewer mounts the React component registered under that name in
`packages/okf-widgets/src/index.tsx` (a workspace package, built to one IIFE and inlined into
`viz.html`, so the viewer stays a single file). The package's `README.md` has the step-by-step
for adding one. The two widgets it ships with are **worked examples**, not a library: the
package belongs to the project once scaffolded, and its widgets should be about the project.

### What makes a good widget

- **One idea.** Name the single thing the reader should come away with before writing any
  code. The widget's caption is "Try it: ..." and the concept tells the reader what to try.
- **Presets for the edge cases.** Buttons that jump straight to the cases worth seeing, each
  with a note explaining what it shows. Free controls (sliders, selects, toggles) come second.
- **Let the reader remove a safeguard.** The most useful control switches off the thing that
  makes the system correct (jitter, a cap, a filter, a branch in a query) and shows what
  breaks. That teaches why it exists better than any sentence.
- **Run the real code.** Import the project's own pure modules through the `@app` alias
  (`vite.config.ts`), so the explainer cannot drift from the product. Only pure code: no I/O,
  no framework side effects.
- **Otherwise, a labelled model.** When the real logic cannot run in a browser (SQL, a server
  policy, another language), mirror it in `src/models/`, say so on screen (`ModelNote`), and
  pin the model with a test that uses **the same cases as the real code's tests**. If they
  disagree, the model is wrong.
- **Derive, do not store.** Keep only the inputs in state; compute everything shown from them
  on each render. Seed any randomness, so the same settings always show the same picture.
- **Visible invariants.** When the reader breaks an invariant, say so with a `Note tone="warn"`
  (`role="status"`), so tests and screen readers see it too.
- **One `data-probe` control** (the `probe` prop of `Presets`). The render gate clicks it and
  fails the build if the widget's text does not change, which catches a widget that mounts but
  is dead.
- **Both themes.** Style only with the viewer's CSS variables (`--surface`, `--border`,
  `--accent`, `--text-muted`, ...) via the classes in `widgets.css`.

### SQL schemas: the `sql-erd` widget

A Mermaid `erDiagram` shows the shape; it cannot say whether the design is any good, how two
tables join, or what a delete does. For a schema that is complicated (more than a handful of
tables, or several relationships per table), or whenever the reader asks, put the schema's SQL
under the widget name. Every ER diagram still gets its generated key (`okf:fix`); the widget is
in addition, not instead.

````markdown
```widget
sql-erd
-- scenario: Parcel tracker | The three tables the service runs on today.
CREATE TABLE carrier (id text PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE parcel (id uuid PRIMARY KEY, carrier_id text NOT NULL REFERENCES carrier (id));

-- scenario: Parcel ops | The same service grown into a depot network.
CREATE TABLE depot (...);
```
````

- **Scenarios**: each `-- scenario: Title | blurb` comment starts one, so the block stays valid
  SQL. Write a small one (a parcel tracker, a small business) and a grown-up one (parcel
  operations, a large business); the larger one marks the tables the first did not have.
  With no marker the whole block is one scenario.
- **Copy the real schema**: `CREATE TABLE`, `CREATE [UNIQUE] INDEX` and
  `ALTER TABLE ... ADD FOREIGN KEY` are read; everything else is skipped, so a dump works. The
  diagram's ends come from the constraints: NOT NULL key is `||`, nullable is `|o`, a unique
  key is one-to-one.
- **Design review**: green for what is well designed, amber for what is not, each with the
  rule behind it (entity and referential integrity, indexed keys, junction tables, 1NF
  repeating groups, 3NF copied attributes, exact money, time zones). They are heuristics:
  check a finding against the real schema before the text around the widget relies on it.
- **Join path** writes the SQL between two tables and warns where rows multiply. **Delete
  impact** follows `ON DELETE` to show what cascades, what is nulled and what is refused.
- **Switch off a safeguard** (foreign keys, indexes) and **Edit the SQL** let the reader break
  the schema and watch the review fail, which teaches more than the passing version.

Write the concept text around it the usual way: what to try, then a `[!tip] What to notice`.
If the schema in the SQL and the diagram above it can disagree, say which one is the source.

### Checks

- `npm run okf:widgets:typecheck`, `npm run okf:widgets:test`: the models and each widget's
  key interaction (Testing Library).
- `npm run okf:mermaid:render`: builds the widgets, then mounts every widget block in the
  bundle, clicks each probe, and fails on an unknown name, a crash, a missing probe, or a
  probe that changes nothing.
- Screenshot each widget in light and dark and look at it. The gates prove it works, not that
  it reads well.

## Review checklist for an explainer

- [ ] Opens with who it is for and what they will understand.
- [ ] Background before the change; every term defined once and used consistently.
- [ ] The intuition comes before the code, with a picture or a widget.
- [ ] Each widget has a prompt ("try X, notice Y") and a `[!tip] What to notice` after it.
- [ ] Details are in reading order, with why after each excerpt.
- [ ] Every claim was checked against the code and tests (the playbook's writing checklist
      applies in full: an explainer that is wrong is worse than none).
- [ ] The quiz has one correct option per question, plausible wrong options, and feedback on
      every option.
- [ ] Linked from `index.md`, and links out to the reference concepts instead of repeating them.
- [ ] `okf:validate`, `okf:mermaid` and `okf:mermaid:render` pass.
