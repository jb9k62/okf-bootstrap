---
type: Reference
title: Retry policy
description: The retry settings a client uses when a call fails, and why each exists.
tags: [retries, reliability]
---

# Retry policy

| Setting | Value | Why |
| --- | --- | --- |
| Retries | 5 | Enough to ride out a restart, few enough to give up in about half a minute |
| Base delay | 500 ms | The first wait; each later one doubles |
| Jitter | full | Spreads clients out, so a recovering server does not meet them all at once |
| Cap | 2 s per wait | Bounds how long a client can go quiet |

The [guided tour](/demo/retries-explainer.md) explains each row with a widget.
