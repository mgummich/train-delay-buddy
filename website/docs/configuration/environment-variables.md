---
id: environment-variables
title: Environment variables
sidebar_position: 1
---

# Environment variables

Backend reads from process env or, with Compose, `.env` at repo root. Without Compose: `export` or use [`direnv`](https://direnv.net/). `.env.example` is the template — `cp .env.example .env`.

## Backend

### Required

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Postgres password. Required by Compose (`POSTGRES_PASSWORD:?required`) + backend via `DATABASE_URL`. |

### HTTP / CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Listen port |
| `CORS_ALLOWED_ORIGINS` | _(empty)_ | Comma-separated. Required when frontend is on a different origin. Empty when same-origin via Nginx. |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://vbb:${POSTGRES_PASSWORD}@postgres:5432/vbb` | Conn string |
| `DB_MAX_OPEN_CONNS` | `20` | pgxpool max |
| `DB_MIN_CONNS` | `5` | pgxpool min idle |
| `DB_WRITE_TIMEOUT` | `5s` | Per-write deadline |
| `MIGRATIONS_DIR` | `./migrations` (dev) / `/app/migrations` (prod) | SQL migrations path. Auto-applied at startup. |

### Valkey

| Variable | Default | Description |
|----------|---------|-------------|
| `VALKEY_URL` | `redis://valkey:6379` | Valkey URL. `redis://` scheme reused for `go-redis` compat. |
| `REDIS_URL` | _(none)_ | Deprecated alias — only read when `VALKEY_URL` unset. |

### HAFAS

| Variable | Default | Description |
|----------|---------|-------------|
| `HAFAS_BASE_URL` | `https://v6.db.transport.rest` | REST base. Swap for self-hosted to dodge rate limits. |
| `HAFAS_REQUEST_TIMEOUT` | `8s` | Per-request deadline |
| `HAFAS_WORKER_POOL_SIZE` | `50` | Max concurrent goroutines |
| `HAFAS_QUEUE_DEPTH` | `200` | Backpressure queue; `Submit()` returns `false` when full |
| `HAFAS_CB_THRESHOLD` | `5` | Consecutive failures → breaker opens |
| `HAFAS_CB_PROBE_INTERVAL` | `30s` | Probe cadence for open breaker |

### Capacity / TTL

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ACTIVE_JOURNEYS` | `2000` | Cap. `POST /v1/journeys` → 503 once hit. |
| `JOURNEY_TTL_HOURS` | `2` | Inactive longer → GCed by janitor |

### Rate limit

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_PER_INSTALL` | `60` | req/min per `X-Install-Id` |
| `RATE_LIMIT_PER_IP` | `30` | req/min per IP. Fallback when install header absent. |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |

## Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | _(empty)_ | Empty = relative URLs (Vite proxy + same-origin Nginx). Set only when frontend + backend are on different domains. |

`VITE_*` are inlined at build. Changes require rebuild.

## Tuning

### High-volume

```env
HAFAS_WORKER_POOL_SIZE=100
HAFAS_QUEUE_DEPTH=400
MAX_ACTIVE_JOURNEYS=5000
DB_MAX_OPEN_CONNS=40
DB_MIN_CONNS=10
RATE_LIMIT_PER_INSTALL=120
JOURNEY_TTL_HOURS=4
LOG_LEVEL=WARN
```

### Low-resource (Raspberry Pi, free-tier VM)

```env
HAFAS_WORKER_POOL_SIZE=10
HAFAS_QUEUE_DEPTH=40
MAX_ACTIVE_JOURNEYS=200
DB_MAX_OPEN_CONNS=5
DB_MIN_CONNS=2
```

### Local dev

```env
LOG_LEVEL=DEBUG
HAFAS_REQUEST_TIMEOUT=15s   # public proxy slow on cold cache
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

## Startup validation

`internal/config.Load()` validates all values. Invalid → fail fast:

- `DB_MAX_OPEN_CONNS < DB_MIN_CONNS` → refuse.
- `HAFAS_QUEUE_DEPTH < HAFAS_WORKER_POOL_SIZE` → warning (not fatal).
- Empty `POSTGRES_PASSWORD` → refuse.
- Invalid `LOG_LEVEL` → refuse + list valid values.
