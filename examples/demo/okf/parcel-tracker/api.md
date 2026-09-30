---
type: API Reference
title: API
description: The routes customers call to track a parcel.
tags: [api, http]
generated: { by: example-agent/1.0, at: 2026-10-01T09:00:00Z }
---

# API

| Method | Path | Returns |
| --- | --- | --- |
| `POST` | `/parcels` | Starts tracking a number; `201` with the parcel, or `422` if no carrier claims it |
| `GET` | `/parcels/:id` | The parcel, its status, and its events newest first |
| `GET` | `/reports/weekly?week=2026-09-28` | The [weekly delivery report](/parcel-tracker/weekly-report.md) for one UTC week |

Statuses and events follow the [data model](/parcel-tracker/data-model.md). The API never calls
a carrier; a stale status means the [poller](/parcel-tracker/architecture.md) is behind.
