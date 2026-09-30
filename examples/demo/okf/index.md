---
okf_version: "0.2"
---

# Parcel tracker

The knowledge bundle for **Parcel tracker**, a small (fictional) service that follows parcels
across courier companies and tells customers where their delivery is. It is the demo for
[okf-bootstrap](https://github.com/jb9k62/okf-bootstrap): reference concepts, decision
records, and two guided tours with interactive widgets and quizzes. Build it with
`npm run demo`, then open `examples/demo/okf/viz.html`.

## Start here

* [Guided tour: retries without a stampede](/tours/retries-explainer.md) - why every client
  waits a different amount after a failure, with a widget to remove each safeguard
* [Guided tour: which week is it?](/tours/week-explainer.md) - why the weekly report puts some
  local Mondays in last week

## The service

* [Overview](/parcel-tracker/overview.md) - what it does and what it leaves out
* [Architecture](/parcel-tracker/architecture.md) - the parts and how a status update flows
* [Data model](/parcel-tracker/data-model.md) - parcels, tracking events and carriers
* [API](/parcel-tracker/api.md) - the routes customers and carriers call
* [Retry policy](/parcel-tracker/retry-policy.md) - how the poller retries a carrier
* [Weekly delivery report](/parcel-tracker/weekly-report.md) - on-time rate per UTC week
* [Runbook: a carrier is down](/parcel-tracker/runbook-carrier-outage.md)

## Decisions

* [Decision records](/adr/readme.md)
