---
id: environment-variables
title: Environment variables
sidebar_position: 1
---

# Environment variables

Backend variables are read from the process environment or, when using Docker Compose, from the `.env` file at the repo root. When running locally without Compose, `export` what you need or use [`direnv`](https://direnv.net/).

`.env.example` is the canonical template. Copy it: `cp .env.example .env`.

## Backend

### Required

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Postgres user password. Required by Docker Compose (`POSTGRES_PASSWORD:?required`). Required by the backend via `DATABASE_URL`. |

### HTTP and CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port. |
| `CORS_ALLOWED_ORIGINS` | _(empty)_ | Comma-separated allowed origins, e.g. `https://app.example.com,https://staging.example.com`. Required when the frontend is on a different origin than the backend. Leave empty when serving from one origin via Nginx. |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://vbb:${POSTGRES_PASSWORD}@postgres:5432/vbb` | Postgres connection string. |
| `DB_MAX_OPEN_CONNS` | `20` | pgxpool maximum connections. |
| `DB_MIN_CONNS` | `5` | pgxpool minimum idle connections. |
| `DB_WRITE_TIMEOUT` | `5s` | Deadline applied to every Postgres write call. |
| `MIGRATIONS_DIR` | `./migrations` (dev) / `/app/migrations` (prod) | Path to SQL migration files. Auto-applied at startup. |

### Valkey

| Variable | Default | Description |
|----------|---------|-------------|
| `VALKEY_URL` | `redis://valkey:6379` | Valkey connection URL (Valkey is a BSD-licensed, wire-compatible Redis fork). The `redis://` scheme is reused for protocol compatibility with the `go-redis` client. |
| `REDIS_URL` | _(none)_ | Deprecated alias for `VALKEY_URL` — read only when `VALKEY_URL` is unset, to ease migration from a Redis-only deployment. |

### HAFAS

| Variable | Default | Description |
|----------|---------|-------------|
| `HAFAS_BASE_URL` | `https://v6.db.transport.rest` | HAFAS REST base URL. Swap for a self-hosted proxy to reduce rate-limit exposure. |
| `HAFAS_REQUEST_TIMEOUT` | `8s` | Per-request deadline. |
| `HAFAS_WORKER_POOL_SIZE` | `50` | Maximum concurrent HAFAS goroutines. |
| `HAFAS_QUEUE_DEPTH` | `200` | Backpressure queue depth. `Submit()` returns `false` when full. |
| `HAFAS_CB_THRESHOLD` | `5` | Consecutive HAFAS failures before the circuit breaker opens. |
| `HAFAS_CB_PROBE_INTERVAL` | `30s` | How often an open breaker probes HAFAS to recover. |

### Capacity and TTLs

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ACTIVE_JOURNEYS` | `2000` | Capacity cap. `POST /v1/journeys` returns 503 once exceeded. |
| `JOURNEY_TTL_HOURS` | `2` | Journeys inactive longer than this are GCed by the janitor. |

### Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_PER_INSTALL` | `60` | Max requests per minute per `X-Install-Id` UUID. |
| `RATE_LIMIT_PER_IP` | `30` | Max requests per minute per remote IP. Falls back when the install header is absent. |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARN`, `ERROR`. |

## Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | _(empty)_ | Backend base URL. Empty = relative URLs, correct for the Vite dev proxy and same-origin production (Nginx). Set to `https://api.example.com` only when frontend and backend are on different domains. |

`VITE_*` variables are inlined at build time by Vite. Changes require a rebuild — they are not read at runtime.

## Tuning guide

### High-volume production

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

### Low-resource environment (Raspberry Pi, free-tier VM)

```env
HAFAS_WORKER_POOL_SIZE=10
HAFAS_QUEUE_DEPTH=40
MAX_ACTIVE_JOURNEYS=200
DB_MAX_OPEN_CONNS=5
DB_MIN_CONNS=2
```

### Local development

```env
LOG_LEVEL=DEBUG
HAFAS_REQUEST_TIMEOUT=15s   # public HAFAS proxy is slow on cold cache
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

## Validation at startup

`internal/config.Load()` validates all parsed values. Invalid combinations fail fast:

- `DB_MAX_OPEN_CONNS < DB_MIN_CONNS` — refuse to start.
- `HAFAS_QUEUE_DEPTH < HAFAS_WORKER_POOL_SIZE` — warning logged (not fatal).
- Empty `POSTGRES_PASSWORD` (via empty `DATABASE_URL`) — refuse to start.
- Invalid `LOG_LEVEL` — refuse to start with the list of valid values.
