---
id: backend
title: Backend internals
sidebar_position: 2
---

# Backend internals

Single Go binary (`./cmd/server`) wires every dependency in `main.go` and starts a chi HTTP server. Standard Go layout, implementation under `internal/` (module-private).

## Package map

```
backend/
├── cmd/server/main.go              # DI graph, HTTP lifecycle
├── internal/
│   ├── api/
│   │   ├── handlers/               # one file per route group
│   │   │   ├── journeys.go         # POST/GET/DELETE /v1/journeys[/{id}]
│   │   │   ├── summary.go          # GET /v1/journeys/{id}/summary (ETag)
│   │   │   ├── legs.go             # GET /v1/journeys/{id}/legs
│   │   │   ├── alternatives.go     # GET/POST /v1/journeys/{id}/alternatives
│   │   │   ├── trains.go           # GET /v1/trains/{number}
│   │   │   ├── stations.go         # GET /v1/stations?q=
│   │   │   └── health.go           # /health, /readyz
│   │   └── middleware/             # rate-limit, request-id, CORS, logging
│   ├── config/                     # env binding + defaults + validation
│   ├── hafas/                      # client, mapper, coalescer, circuit breaker
│   ├── journey/                    # domain types, store, poller, worker pool
│   ├── metrics/                    # Prometheus collectors (registered at init)
│   ├── migrate/                    # SQL runner (numbered, alphabetical)
│   ├── problem/                    # RFC 7807 helpers
│   ├── reqid/                      # X-Request-Id middleware + slog context
│   └── routing/                    # BFS + ETA-based alternative scoring
├── migrations/001_initial.sql
├── migrations/002_optimize_journeys.sql
└── openapi.yaml                    # OpenAPI 3.1 source of truth
```

## Wiring (`cmd/server/main.go`)

Strict ordering, fail-fast:

1. **Config** — `config.Load` reads env, applies defaults, validates ranges. Fail → exit 1.
2. **Logger** — `slog.NewJSONHandler` with `LOG_LEVEL`. Every line carries `request_id`, `journey_id` via `slog.Context`.
3. **Postgres** — `pgxpool.New`, sized by `DB_MAX_OPEN_CONNS` / `DB_MIN_CONNS`.
4. **Migrations** — `migrate.Run` applies unapplied files (alphabetical) under `MIGRATIONS_DIR`, each in a tx; tracked in `schema_migrations`.
5. **Valkey** — `redis.NewClient` via `VALKEY_URL` (fallback `REDIS_URL`). Immediate `PING`; failure → exit 1. `go-redis` is wire-compatible.
6. **HAFAS client** — `HAFAS_BASE_URL` + worker pool + circuit breaker.
7. **Store** — wraps Valkey + Postgres behind one `journey.Store` interface.
8. **PollerManager** — constructed, no goroutines yet. Starts one per journey on create / cold-start hydration from Postgres.
9. **HTTP server** — chi router with middleware + handlers, `:${PORT}`.
10. **Graceful shutdown** — SIGINT/SIGTERM. Sequence: stop accepting → wait in-flight (5 s) → stop pollers → close Valkey → close Postgres.

## Poller

Goroutine per journey, `time.Ticker(30s)`:

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

`tick()`:

1. **Lock** — `Store.Lock(journeyID)` (Valkey, TTL 25 s, just under tick).
2. **Fetch** — snapshot from Valkey (or Postgres on cold miss).
3. **HAFAS** — submit `tripUpdate` task per leg. Coalesced by trip ID — concurrent journeys sharing a train pay once.
4. **Apply** — merge realtime arrival/departure into legs.
5. **Summary** — `compute.Summary(legs)` derives ETA, status (`ON_TIME` / `DELAYED` / `CRITICAL` / `INFEASIBLE`), `nextStep`.
6. **BFS** — `routing.FindAlternatives(filters, legs, hafas)` → up to 5, scored by ETA delta + transfer buffer.
7. **Diff + persist** — anything changed → bump `etag_counter`, persist to Valkey + Postgres.
8. **Unlock.**

## Worker pool

```go
type WorkerPool struct {
    queue chan task     // depth = HAFAS_QUEUE_DEPTH (default 200)
    sem   chan struct{} // capacity = HAFAS_WORKER_POOL_SIZE (default 50)
}

func (p *WorkerPool) Submit(t task) (ok bool) {
    select {
    case p.queue <- t:
        return true
    default:
        return false   // backpressure: caller retries
    }
}
```

50 workers drain the queue, each holding one `sem` slot. Full queue → `Submit` fails immediately → handlers return `503` with `Retry-After`.

## Circuit breaker

```go
type Breaker struct {
    threshold int           // HAFAS_CB_THRESHOLD (default 5)
    state     atomic.Value  // closed | open | half-open
    failures  atomic.Int32
    probeAt   atomic.Int64
}
```

- **Closed:** flows normally. Success resets `failures`. Failure increments; `failures >= threshold` → `open`.
- **Open:** short-circuits with `ErrCircuitOpen`. After `HAFAS_CB_PROBE_INTERVAL` (default 30 s), one probe → `half-open`.
- **Half-open:** single probe decides — success → `closed`, failure → `open`, reset probe timer.

`/readyz` reports state. Alert when `state=open` >60 s.

## BFS routing

`routing.FindAlternatives` BFS over the HAFAS station graph, from the user's *current location* (next stop on their route) to destination.

- Node: `(station, eta)`.
- Edge: HAFAS leg starting at/after `eta + safety_buffer`.
- Depth bound: `filters.maxTransfers + 1`.
- Scored by `(target_eta, transfer_buffer, leg_count)` lex order.

Filtered by `dbOnly` (non-DB operators excluded) and `safetyLevel` (rejects routes with min transfer buffer below threshold). Top 5 returned.

## Database schema

Single table (001, optimised by 002):

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

Full schema + indexes + access tips: [Database](../database).

## Observability

- **Logs:** JSON via `slog`. Per-request: `request_id`, `method`, `path`, `status`, `duration_ms`, error keys.
- **Metrics:** Prometheus collectors at package init — see [Operations → Monitoring](../operations/monitoring).
- **Tracing:** not wired. `context.Context` everywhere + `request_id` propagation make OpenTelemetry additive.

## Graceful shutdown

```
SIGTERM
  ├─ http.Server.Shutdown (ctx 5 s) — stop new conns
  ├─ Cancel poller-manager ctx — per-journey goroutines exit
  ├─ Drain worker pool (close queue, wait in-flight HAFAS, max 5 s)
  ├─ Flush Valkey pipelines
  └─ Close Postgres pool
```

Budget: 10 s. Beyond → dropped.
