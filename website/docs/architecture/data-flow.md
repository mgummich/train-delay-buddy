---
id: data-flow
title: Data flow
sidebar_position: 4
---

# Data flow

End-to-end traces for the two core flows: creating a journey and polling its status.

## Flow 1 — Create a new journey

```mermaid
flowchart TD
  A([User taps Start]) --> B["POST /v1/journeys\nuseCreateJourney()"]
  B --> C{Rate limit?}
  C -->|exceeded| C1["429 + Retry-After"]
  C -->|ok| D{Idempotency\nhit?}
  D -->|hit| D1["200 cached response"]
  D -->|miss| E{Capacity\ncheck}
  E -->|at cap| E1["503 at-capacity"]
  E -->|ok| F["HAFAS.GetTrain()"]
  F -->|failure| F1["502 / circuit breaker"]
  F -->|ok| G["routing.BFS()"]
  G -->|no route| G1["404 no-route"]
  G -->|ok| H["store.Create()\nPostgres INSERT + Valkey SET"]
  H --> I["PollerManager.Start()\nspawns goroutine"]
  I --> J["201 Created\n{id, summary, legs} + ETag"]
```

The poller immediately performs its first tick (no 30-second wait) so the first poll from the client returns up-to-date data.

## Flow 2 — Poll for updates

```mermaid
flowchart TD
  A([Client · every 30 s]) --> B["GET /v1/journeys/{id}/summary\nIf-None-Match: etag"]
  B --> C["store.GetSummary(id)"]
  C --> D{Valkey hit?}
  D -->|hit ~1 ms| E["Compute ETag\netag_epoch:etag_counter"]
  D -->|miss| F["Postgres SELECT\nrefill Valkey"]
  F --> E
  E --> G{ETag matches\nIf-None-Match?}
  G -->|yes| G1["304 Not Modified\nempty body"]
  G -->|no| G2["200 OK + summary JSON\n+ new ETag"]
```

Concurrently, the poller goroutine (independent of the client) ticks every 30 s:

```mermaid
flowchart TD
  A([poller.tick]) --> B["Lock journey.id in Valkey\nTTL 25 s"]
  B --> C["Read current state from Valkey"]
  C --> D["Submit HAFAS tripUpdate tasks\nto WorkerPool · coalesced by tripId"]
  D --> E["ApplyTripUpdates\nrealtime deltas → leg timestamps"]
  E --> F["ComputeSummary\nETA · status · nextStep"]
  F --> G["routing.BFS\nfresh alternatives"]
  G --> H{Changed?}
  H -->|no| H1["Release lock · exit"]
  H -->|yes| I["Bump etag_counter\nValkey SET + Postgres UPDATE\nemit metrics"]
  I --> H1
```

Client and poller never interact directly. They share state via Valkey. The 30-second client polls are *almost always* 304 in steady state; the **content of the journey changes** is driven by the poller alone.

## Failure paths

| Failure | Backend response | Frontend behaviour |
|---------|-------------------|--------------------|
| HAFAS down (circuit breaker open) | 503 `urn:verspbegl:error:hafas-unavailable` | Banner: "Live data unavailable — retrying", keep showing last-known data |
| Valkey down | 500 `urn:verspbegl:error:internal` + log | Generic error banner, manual retry available |
| Postgres down | `/readyz` returns 503 | Same — backend keeps serving the last Valkey snapshot until journey TTL |
| Network offline | `fetch` rejects | OfflineStateLoader takes over, reads from IndexedDB |
| Rate limit hit | 429 + Retry-After | Banner with countdown; subsequent calls suppressed until Retry-After elapses |
| Idempotency replay | 200 OK from Valkey-cached response | Indistinguishable from a normal success — by design |

## TTLs and retention

| Object | TTL | Where |
|--------|-----|-------|
| Active journey | `JOURNEY_TTL_HOURS` (default 2 h since last poll) | Valkey + Postgres (`terminated_at` set by GC job) |
| Idempotency key | 10 minutes | Valkey only |
| Station search | 5 minutes | Valkey only |
| Per-journey poller goroutine | Bound to journey lifetime | In-memory |
| Per-journey lock | 25 s | Valkey (auto-expires if tick crashes mid-flight) |

A background goroutine ("janitor") sweeps every 5 minutes for journeys with `terminated_at IS NULL AND last_polled_at < now() - JOURNEY_TTL_HOURS`. It stops the poller and sets `terminated_at`, freeing capacity.
