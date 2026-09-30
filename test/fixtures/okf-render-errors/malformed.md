---
type: Fixture
title: Malformed markup
description: Authoring mistakes the viewer must show rather than hide, for the render gate.
tags: [fixture, render-gate]
render_expect: { quizQuestions: 3, quizErrors: 2, knownCallouts: 1, unknownCallouts: 1 }
---

# Malformed markup

> [!note] A known callout
> This one becomes a styled callout.

> [!nonsense] An unknown callout
> This one must stay an ordinary blockquote, with its marker visible.

```quiz
A question with no option marked correct.
- [ ] First
- [ ] Second
---
A question with two options marked correct.
- [x] First
- [x] Second
---
A well-formed question, so the click check still has something to answer.
- [ ] Wrong
~ Not this one.
- [x] Right
~ This one.
```
