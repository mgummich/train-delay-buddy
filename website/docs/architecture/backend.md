---
id: backend
title: Backend internals
sidebar_position: 2
---

# Backend internals

The backend is a single Go binary (`./cmd/server`) that wires every dependency in `main.go` and starts a chi-based HTTP server. The code follows the standard Go project layout with all implementation under `internal/` (private to the module).

## Package map

```
backend/
├── cmd/server/main.go              # entry point — DI graph, HTTP server lifecycle
├── internal/
│   ├── api/
│   │   ├── handlers/               # one file per route group
│   │   │   ├── journeys.go         # POST/GET/DELETE /v1/journeys[/{id}]
│   │   │   ├── summary.go          # GET /v1/journeys/{id}/summary (ETag)
│   │   │   ├── legs.go             # GET /v1/journeys/{id}/legs
│   │   │   ├── alternatives.go     # GET/POST /v1/journeys/{id}/alternatives
│   │   │   ├── trains.go           # GET /v1/trains/{number}
│   │   │   ├── stations.go         # GET /v1/stations?q=
│   │   │   └── health.go           # /health and /readyz
│   │   └── middleware/             # rate-limit, request-id, CORS, logging
│   ├── config/                     # env-var binding with defaults + validation
│   ├── hafas/                      # HAFAS client, mapper, coalescer, circuit breaker
│   ├── journey/                    # domain types, store, poller, worker pool
│   ├── metrics/                    # Prometheus collectors (registered at package init)
│   ├── migrate/                    # SQL migration runner (numbered files, alphabetical)
│   ├── problem/                    # RFC 7807 application/problem+json helpers
│   ├── reqid/                      # X-Request-Id middleware + slog context value
│   └── routing/                    # BFS + ETA-based alternative scoring
├── migrations/001_initial.sql      # creates journeys table + indexes
├── migrations/002_optimize_journeys.sql  # HOT-update tuning, drops unused index
└── openapi.yaml                    # OpenAPI 3.1 source of truth
```

## Wiring (`cmd/server/main.go`)

The entry point performs strict ordering — *fail fast* on any infrastructure issue:

1. **Config** (`config.Load`) reads env vars, applies defaults, validates ranges. Failure → exit 1.
2. **Logger** (`slog.NewJSONHandler`) is wired with `LOG_LEVEL`. Every log line carries `request_id` and `journey_id` (when available) via `slog.Context`.
3. **Postgres** (`pgxpool.New`) opens the pool. Pool sizing comes from `DB_MAX_OPEN_CONNS` and `DB_MIN_CONNS`.
4. **Migrations** (`migrate.Run`) apply unapplied SQL files in alphabetical order under `MIGRATIONS_DIR`. Each file is applied in a transaction; the applied set is tracked in `schema_migrations`.
5. **Valkey** (`redis.NewClient` via `VALKEY_URL` or `REDIS_URL` fallback) opens the client. A `PING` runs immediately — failure → exit 1. The `go-redis` library is wire-compatible with Valkey; no protocol change is needed.
6. **HAFAS client** is constructed with `HAFAS_BASE_URL`, the worker pool, and the circuit breaker.
7. **Store** wraps Valkey + Postgres behind a single `journey.Store` interface.
8. **PollerManager** is constructed but does *not* start any goroutines yet. It will start one per journey when journeys are created (or hydrated from Postgres on cold start).
9. **HTTP server** binds the chi router with all middleware and handlers, listens on `:${PORT}`.
10. **Graceful shutdown** registers a signal handler for SIGINT/SIGTERM. The shutdown sequence: stop accepting new requests → wait for in-flight requests (5 s) → stop pollers → close Valkey → close Postgres.

## The poller

A `Poller` is a goroutine that owns one journey. It runs a `time.Ticker(30 * time.Second)` loop:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-ticker.C:
        if err := p.tick(ctx); err != nil {
            metrics.PollerErrors.Inc()
            slog.Error("poller tick failed", "journey_id", p.id, "err", err)
        }
    }
}
```

`tick()` does:

1. **Lock** — `Store.Lock(journeyID)` acquires a Valkey lock (TTL 25 s, slightly less than the tick interval).
2. **Fetch** — pulls the current journey snapshot from Valkey (or Postgres on cold miss).
3. **HAFAS** — for every leg, submits a `tripUpdate` task to the worker pool. Tasks are coalesced by trip ID so concurrent journeys sharing a train pay for HAFAS only once.
4. **Apply updates** — merges realtime arrival/departure timestamps into the leg model.
5. **Compute summary** — `compute.Summary(legs)` derives ETA, status (`ON_TIME` / `DELAYED` / `CRITICAL` / `INFEASIBLE`), and `nextStep` (the next user-visible event).
6. **BFS** — `routing.FindAlternatives(filters, legs, hafas)` returns up to 5 alternatives, scored by ETA delta and transfer buffer.
7. **Diff and persist** — if anything changed (summary fields, alt list contents, or leg timestamps), bump `etag_counter`, persist to Valkey + Postgres.
8. **Unlock**.

## The worker pool

`hafas.WorkerPool` is a bounded goroutine pool:

```go
type WorkerPool struct {
    queue chan task   // depth = HAFAS_QUEUE_DEPTH (default 200)
    sem   chan struct{} // capacity = HAFAS_WORKER_POOL_SIZE (default 50)
}

func (p *WorkerPool) Submit(t task) (ok bool) {
    select {
    case p.queue <- t:
        return true
    default:
        return false // backpressure: caller should retry later
    }
}
```

A pool of 50 workers drains the queue, each holding one `sem` slot. When the queue is full, `Submit` fails immediately rather than blocking — handlers translate this into `503 Service Unavailable` with `Retry-After`.

## The circuit breaker

```go
type Breaker struct {
    threshold int           // HAFAS_CB_THRESHOLD (default 5)
    state     atomic.Value  // closed | open | half-open
    failures  atomic.Int32
    probeAt   atomic.Int64
}
```

- **Closed**: requests flow normally. A success resets `failures`. A failure increments it; when `failures >= threshold`, the state flips to `open`.
- **Open**: every call short-circuits with `ErrCircuitOpen`. After `HAFAS_CB_PROBE_INTERVAL` (default 30 s), one probe request flips the state to `half-open`.
- **Half-open**: a single probe call decides the next state. Success → `closed`; failure → `open`, reset probe timer.

`GET /readyz` reports the breaker state. Production dashboards alert when `state=open` for more than 60 s.

## The BFS routing engine

`routing.FindAlternatives` runs a Breadth-First Search over the HAFAS-derived station graph from the user's *current location* (the next stop on their existing route) to the destination.

- Each node is `(station, eta)`.
- Each edge is one HAFAS-known leg starting at or after `eta + safety_buffer`.
- The search depth is bounded by `filters.maxTransfers + 1`.
- All candidate routes are scored by `(target_eta, transfer_buffer, leg_count)` lexicographically.

Routes are filtered by `dbOnly` (excludes non-DB operators) and `safetyLevel` (rejects routes whose minimum transfer buffer falls below the chosen threshold). The top 5 are returned.

## Database schema

A single table, created by migration 001 and optimised by migration 002:

```sql
CREATE TABLE journeys (
  id               TEXT PRIMARY KEY,
  install_id       TEXT NOT NULL,
  train_number     TEXT NOT NULL,
  destination_id   TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  filters_json     JSONB NOT NULL,
  summary_json     JSONB NOT NULL,
  legs_json        JSONB NOT NULL,
  stops_json       JSONB NOT NULL,
  etag_epoch       BIGINT NOT NULL,
  etag_counter     INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  terminated_at    TIMESTAMPTZ,
  last_polled_at   TIMESTAMPTZ
);

CREATE INDEX journeys_active_idx
  ON journeys (last_polled_at)
  WHERE terminated_at IS NULL;
```

See [Database](../database) for full schema, indexes, and direct-access tips.

## Observability

- **Logs**: structured JSON via `slog`. Each request line includes `request_id`, `method`, `path`, `status`, `duration_ms`, and any leftover error keys.
- **Metrics**: Prometheus collectors registered at package init. See [Operations → Monitoring](../operations/monitoring).
- **Tracing**: not yet wired. The interfaces (`context.Context` everywhere, `request_id` propagation) make adding OpenTelemetry an additive change.

## Graceful shutdown sequence

```
SIGTERM received
  ├─ Stop accepting new HTTP connections (http.Server.Shutdown ctx, 5 s)
  ├─ Cancel poller-manager context (all per-journey goroutines exit)
  ├─ Drain worker pool (close queue, wait for in-flight HAFAS calls, max 5 s)
  ├─ Flush Valkey pipelines
  └─ Close Postgres pool
```

Total shutdown budget: 10 seconds. Anything in-flight beyond that is dropped.
