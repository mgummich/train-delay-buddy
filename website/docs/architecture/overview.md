---
id: overview
title: Architecture overview
sidebar_position: 1
---

# Architecture overview

```mermaid
graph TD
  Browser["Browser\nReact 19 SPA / PWA"]

  subgraph Proxy["Reverse proxy"]
    Nginx["Nginx\nprod :80  ·  dev: Vite :5173"]
  end

  subgraph BE["Backend — Go + chi"]
    MW["Middleware\nRequest-Id · CORS · Logging · Rate-limit"]
    Handlers["HTTP handlers\nPOST /v1/journeys\nGET  /v1/journeys/{id}/summary\nGET  /v1/journeys/{id}/legs\nGET  /v1/journeys/{id}/alternatives\nDELETE /v1/journeys/{id}"]
    Poller["PollerManager\ngoroutine / journey · 30 s tick"]
    Pool["WorkerPool\n50 goroutines · 200-deep queue"]
  end

  HAFAS["HAFAS API\ndb.transport.rest"]
  Valkey["Valkey L1\nhot cache · ETag counters\nstation search · idempotency"]
  Postgres["PostgreSQL L2\ndurable store\nmigrations on boot"]

  Browser -->|HTTP| Nginx
  Nginx   -->|proxy /v1/*| MW
  MW      --> Handlers
  Handlers --> Poller
  Poller  --> Pool
  Pool    -->|tripUpdate| HAFAS
  Poller  -->|read/write| Valkey
  Poller  -->|write| Postgres
  Handlers -->|read| Valkey
  Valkey  -->|miss fallback| Postgres
```

## Layers

| Layer | Responsibility | Lives in |
|-------|----------------|----------|
| HTTP | Routing, content negotiation, RFC 7807 errors | `internal/api/{handlers,middleware}` |
| Domain | Journey / Leg / Summary types, status derivation, filters | `internal/journey/{model,compute}.go` |
| Routing | BFS over HAFAS legs, ETA scoring | `internal/routing` |
| HAFAS adapter | REST client, mapper, breaker, worker pool | `internal/hafas` |
| Persistence | Valkey L1 (JSON + ETag counter), Postgres L2 (canonical) | `internal/journey/store.go` |
| Observability | Prometheus, structured logs, health probes | `internal/metrics`, `internal/api/handlers/health.go` |

## Why this shape

- **Per-journey goroutines.** Each active journey owns one goroutine with a 30 s ticker; state under per-journey Valkey lock. No fan-out, no work-stealing. Bounded by `MAX_ACTIVE_JOURNEYS` (default 2000).
- **Bounded HAFAS concurrency.** Global `WorkerPool` (default 50 goroutines, 200-deep queue). Full queue → `Submit()` returns `false`, caller backs off. Prevents thundering herd during DB nationwide incidents.
- **Circuit breaker.** 5 consecutive HAFAS failures → open. Probe every 30 s closes. While open: fail fast with `urn:verspbegl:error:hafas-unavailable`.
- **ETag polling.** Frontend re-polls `/summary` every 30 s with `If-None-Match`. Backend → 304 when unchanged (dominant case) — minimal bandwidth + CPU.
- **Two-tier cache.** Valkey serves polls at sub-ms; Postgres is durable truth on cold miss / restart / replica recovery.

## Why not …

| Question | Answer |
|----------|--------|
| WebSockets / SSE? | 30 s poll + ETag is cheap. WS adds infra complexity (LB stickiness, lifecycle) for marginal gain. |
| Job queue (NATS/Kafka)? | Natural unit of work is *one journey, one ticker*. Queue would re-marshal that pattern with hops. |
| GraphQL? | Three flat endpoints → three UI surfaces. GraphQL = 80 KB client overhead with no expressivity win. |
| Why Go? | Bounded-concurrency goroutines, tiny static binaries, mature HTTP, zero GC pauses in polling hot path. |
| Why React + Vite, not Next.js? | Single-user PWA, not content site. SSR/edge buys nothing. Vite cold start ~400 ms, HMR instant. |

## Module boundaries

Backend: strict `internal/api` → `internal/journey` → `internal/hafas`. Lower must not import upper. Enforced by Go package visibility.

Frontend mirrors via folder convention: `screens/` → `hooks/` → `api/`+`lib/`. Never reverse.

Continue with [Backend deep-dive](./backend), [Frontend deep-dive](./frontend), or [Data flow](./data-flow).
