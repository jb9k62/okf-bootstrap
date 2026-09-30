---
okf_version: "0.2"
---

# OKF bootstrap demo

A small bundle that shows what the viewer can do beyond reference docs: guided tours with
callouts, interactive widgets and a self-check quiz. Build it with `npm run demo` from the
repository root, then open `examples/demo/okf/viz.html`.

## Tours

* [Guided tour: retries without a stampede](/demo/retries-explainer.md) - backoff, jitter
  and caps, with a widget that lets you remove each safeguard
* [Guided tour: which week is it?](/demo/week-explainer.md) - why a week that starts on the
  UTC clock surprises people in other time zones

## Reference

* [Retry policy](/demo/retry-policy.md) - the settings a client uses, in one table
