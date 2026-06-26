---
id: data-flow
title: Data flow
sidebar_position: 4
---

# Data flow

End-to-end traces for the two core flows.

## Flow 1 — Create

```mermaid
flowchart TD
  A([User taps Start]) --> B["POST /v1/journeys\nuseCreateJourney()"]
  B --> C{Rate limit?}
  C -->|exceeded| C1["429 + Retry-After"]
  C -->|ok| D{Idempotency hit?}
  D -->|hit| D1["200 cached response"]
  D -->|miss| E{Capacity check}
  E -->|at cap| E1["503 at-capacity"]
  E -->|ok| F["HAFAS.GetTrain()"]
  F -->|failure| F1["502 / breaker"]
  F -->|ok| G["routing.BFS()"]
  G -->|no route| G1["404 no-route"]
  G -->|ok| H["store.Create()\nPostgres INSERT + Valkey SET"]
  H --> I["PollerManager.Start()\nspawns goroutine"]
  I --> J["201 Created\n{id, summary, legs} + ETag"]
```

Poller performs first tick immediately (no 30 s wait) — first client poll returns fresh data.

## Flow 2 — Poll

```mermaid
flowchart TD
  A([Client · every 30 s]) --> B["GET /v1/journeys/{id}/summary\nIf-None-Match: etag"]
  B --> C["store.GetSummary(id)"]
  C --> D{Valkey hit?}
  D -->|hit ~1 ms| E["Compute ETag\netag_epoch:etag_counter"]
  D -->|miss| F["Postgres SELECT\nrefill Valkey"]
  F --> E
  E --> G{ETag matches If-None-Match?}
  G -->|yes| G1["304 Not Modified\nempty body"]
  G -->|no| G2["200 OK + summary JSON\n+ new ETag"]
```

Concurrently, poller (independent of client) every 30 s:

```mermaid
flowchart TD
  A([poller.tick]) --> B["Lock journey.id in Valkey\nTTL 25 s"]
  B --> C["Read state from Valkey"]
  C --> D["Submit HAFAS tripUpdate tasks\nto WorkerPool · coalesced by tripId"]
  D --> E["ApplyTripUpdates\nrealtime → leg timestamps"]
  E --> F["ComputeSummary\nETA · status · nextStep"]
  F --> G["routing.BFS\nfresh alternatives"]
  G --> H{Changed?}
  H -->|no| H1["Release lock · exit"]
  H -->|yes| I["Bump etag_counter\nValkey SET + Postgres UPDATE\nemit metrics"]
  I --> H1
```

Client + poller never interact directly. They share state via Valkey. Client polls are *almost always* 304 in steady state; **journey changes are driven by the poller alone.**

## Failure paths

| Failure | Backend | Frontend |
|---------|---------|----------|
| HAFAS down (breaker open) | 503 `urn:verspbegl:error:hafas-unavailable` | Banner: "Live data unavailable — retrying"; show last-known |
| Valkey down | 500 `urn:verspbegl:error:internal` + log | Generic error banner, manual retry |
| Postgres down | `/readyz` 503 | Same — backend keeps serving last Valkey snapshot until TTL |
| Network offline | `fetch` rejects | OfflineStateLoader reads IndexedDB |
| Rate limit | 429 + Retry-After | Banner + countdown; calls suppressed until Retry-After |
| Idempotency replay | 200 from Valkey-cached response | Indistinguishable from normal success — by design |

## TTLs

| Object | TTL | Where |
|--------|-----|-------|
| Active journey | `JOURNEY_TTL_HOURS` (default 2 h since last poll) | Valkey + Postgres (`terminated_at` set by GC) |
| Idempotency key | 10 min | Valkey only |
| Station search | 5 min | Valkey only |
| Per-journey poller goroutine | Bound to journey lifetime | In-memory |
| Per-journey lock | 25 s | Valkey (auto-expires on tick crash) |

Background janitor sweeps every 5 min for `terminated_at IS NULL AND last_polled_at < now() - JOURNEY_TTL_HOURS`. Stops poller, sets `terminated_at`, frees capacity.
