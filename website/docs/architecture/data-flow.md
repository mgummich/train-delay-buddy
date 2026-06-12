---
id: data-flow
title: Data flow
sidebar_position: 4
---

# Data flow

End-to-end traces for the three flows that matter: creating a journey, polling its status, and switching to an alternative.

## Flow 1 — Create a new journey

```
User taps "Start"
   │
   ▼
Frontend: useCreateJourney() → POST /v1/journeys
   { trainNumber, destinationId, filters, X-Install-Id, Idempotency-Key }
   │
   ▼
Backend (handlers/journeys.go::Create):
   │
   ├─ rate-limit check (per Install-Id and per IP)
   │     └─ exceeded → 429 + Retry-After
   │
   ├─ idempotency check (Valkey lookup on Idempotency-Key)
   │     └─ hit  → return cached response
   │     └─ miss → proceed
   │
   ├─ capacity check (count of active journeys < MAX_ACTIVE_JOURNEYS)
   │     └─ at cap → 503 problem+json (urn:verspbegl:error:at-capacity)
   │
   ├─ HAFAS.GetTrain(trainNumber)
   │     └─ failure → 502 / circuit breaker
   │
   ├─ routing.BFS(currentStation, destination, filters)
   │     └─ no route → 404 problem+json (urn:verspbegl:error:no-route)
   │
   ├─ store.Create(journey) → Postgres INSERT + Valkey SET
   │
   ├─ poller-manager.Start(journey.id) → spawns goroutine
   │
   └─ 201 Created { id, summary, legs }
        + ETag header
        + Location: /v1/journeys/{id}
```

The poller immediately performs its first tick (no 30-second wait) so the first poll from the client returns up-to-date data.

## Flow 2 — Poll for updates

```
Every 30 seconds, frontend issues:
   GET /v1/journeys/{id}/summary
   If-None-Match: "<etag-from-previous-poll>"
   │
   ▼
Backend (handlers/summary.go::Get):
   │
   ├─ store.GetSummary(id)
   │     ├─ Valkey HIT  (fast path, ~1 ms)
   │     └─ Valkey MISS → Postgres SELECT, refill Valkey (rare)
   │
   ├─ Compute current ETag from (etag_epoch, etag_counter)
   │
   ├─ If header matches current ETag:
   │     └─ 304 Not Modified, empty body, no Cache-Control change
   │
   └─ Else:
         └─ 200 OK + summary JSON + new ETag
```

Concurrently, the poller goroutine (independent of the client) ticks every 30 s:

```
poller.tick():
   │
   ├─ Lock(journey.id) in Valkey (TTL 25 s)
   │
   ├─ Read current state from Valkey
   │
   ├─ For each leg, submit a HAFAS tripUpdate task to the worker pool
   │     └─ Tasks coalesced by trip ID across all journeys
   │
   ├─ Apply realtime arrival/departure deltas to legs
   │
   ├─ Compute new summary (ETA, status, nextStep)
   │
   ├─ Run BFS, get fresh alternatives list
   │
   ├─ Diff old vs. new
   │     ├─ Unchanged → release lock, exit
   │     └─ Changed   → bump etag_counter
   │                     persist (Valkey SET + Postgres UPDATE)
   │                     emit metrics
   │
   └─ Unlock
```

Client and poller never interact directly. They share state via Valkey. The 30-second client polls are *almost always* 304 in steady state; the **content of the journey changes** is driven by the poller alone.

## Flow 3 — Switch to an alternative

```
User taps an alternative card
   │
   ▼
Frontend: useSwitchAlternative() → POST /v1/journeys/{id}/switch
   { alternativeId }
   │
   ▼
Backend:
   │
   ├─ Validate alternativeId is in the current alternatives set
   │     └─ stale → 409 problem+json (urn:verspbegl:error:alternative-expired)
   │
   ├─ poller-manager.Switch(id, newRoute)
   │     ├─ Replace journey.legs with the chosen alternative
   │     ├─ Bump etag_counter
   │     └─ Persist
   │
   └─ 200 OK { summary, legs }
```

The next client poll arrives ~30 s later and returns a 200 with the new ETag. From the user's perspective, the timeline switches instantly because the React Query cache for the active journey is invalidated and refetched as part of the success handler.

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
