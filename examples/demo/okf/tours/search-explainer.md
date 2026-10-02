---
type: Explainer
title: "Guided tour: how many looks does it take?"
description: "Why binary search needs a logarithm of the work that linear search does, and why it quietly gives the wrong answer on a list that is not sorted. A widget steps through each comparison. Closes with a quiz."
tags: [explainer, guided-tour, algorithms, searching]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

This tour is for anyone who looks things up in a list. After it, you will know why binary
search is so fast, and how it fails without warning. A parcel's events are stored
[newest first](/parcel-tracker/api.md), so finding one by time is a search. A [quiz](#quiz)
closes it.

## Who is affected

| Person | What searching a history means to them |
| --- | --- |
| **Amira**, a customer | Has a dozen events; any search is instant |
| **Sam**, on call | Supports a customer with a hundred thousand events, where scanning is slow |
| **Lee**, an analyst | Loads events from a file, and does not know if they are in order |

## Background

Linear search looks at each item in turn. Binary search looks at the middle item. Because the
list is in order, it can drop the half that cannot hold the target. Then it repeats.

> [!definition] Precondition
> What must be true for an algorithm to give the right answer. For binary search: the list is
> sorted. If not, it still runs and still answers, but the answer may be wrong.

## The problem, one step at a time

1. **Amira looks for the event at 14:05.** Twelve events: checking each is instant.
2. **A business customer has a hundred thousand events.** Checking each takes up to a hundred
   thousand looks. *Sam* gets a slow-request alert.
3. **The list is in time order, so start in the middle.** Drop the half that is too late,
   and repeat. About seventeen looks in all.
4. **Lee's file is not in order.** Binary search still answers: "not there". But it is there;
   the search dropped the half that held it.
5. **Nothing in the answer says it is wrong.** The only fix is to know the list is sorted.

## The picture

Each look halves what is left, so a million items take only about 20 looks.

```mermaid
flowchart LR
    A["1,000,000 items"] -->|"look at the middle"| B["500,000"]
    B --> C["250,000"]
    C --> D["... 20 looks in all"]

    classDef neutral fill:#e0e7ff,stroke:#3730a3,color:#1e1b4b
    classDef good fill:#dcfce7,stroke:#166534,color:#0f2417
    class A,B,C neutral
    class D good
```

Try it, in three steps. The ringed range is what could still hold the target. Each slider
step is one look.

1. **Fast.** Open on **Binary search, 64 items** and drag the slider. The range halves each
   time; 90 is found in 5 looks.
2. **Slow.** Click **Linear search, the same list**. The same 90 takes 46 looks.
3. **Lee's file.** Click **Binary search on an unsorted list**. The 3 is plainly there, but
   binary search says it is missing. Switch to **Linear**: it is found at position 6.

```widget
binary-search
```

> [!tip] What to notice
> 5 looks against 46. On the unsorted list, binary search reports a present value as missing.
> The widget warns you only because it also checks the order and runs a linear search.

## Details

> [!important] The rule
> Check or guarantee that the list is sorted. If you are not sure, note that sorting costs
> more than one linear search; it pays off only over many lookups.

> [!warning] A bug that looks like missing data
> A search that misses a present value looks like missing data. Before blaming the store,
> check whether the list was in order.

> [!edge-case] Small lists
> For a few items, linear search is as fast, and needs no sorting. The widget counts looks;
> on real hardware, a short scan can be even faster than the count suggests.

## Quiz

Three questions on the ideas above.

```quiz
About how many comparisons does binary search need for one million sorted items, at most?
- [ ] About 500,000
~ That is linear search's average: half the list.
- [x] About 20
~ Each look halves the range, and a million halves to one in 20 steps.
- [ ] About 1,000
~ That is the square root, which is not how halving works.
---
Binary search says a number is not in a list, but linear search finds it. What is the most likely cause?
- [ ] The number is in the list twice
~ Duplicates do not make a present value disappear.
- [x] The list was not sorted
~ Binary search trusted the order and dropped the half that held the number.
- [ ] Binary search only finds even numbers
~ It finds any value, as long as the list is in order.
---
You search a list of 8 unsorted items once. Which is the better plan?
- [ ] Sort it, then binary search
~ Sorting costs more than the one scan it replaces.
- [x] Linear search
~ One pass is the cheapest way to search once. Sorting pays off over many lookups.
- [ ] Binary search anyway
~ It may miss a present value on an unsorted list.
```
