# Verspätungs-Begleiter

Real-time alternative routing for Deutsche Bahn journeys. Enter your current train and destination — the app monitors your connection and surfaces faster alternatives as delays emerge.

**Not affiliated with Deutsche Bahn.** Uses the public [`db.transport.rest`](https://v6.db.transport.rest) HAFAS proxy.

---

## What it does

1. You enter a train number (e.g. `ICE 123`) and your destination station.
2. The backend polls HAFAS every 30 seconds for realtime updates on your legs.
3. A BFS routing engine runs in the background and computes alternative routes that arrive earlier.
4. The frontend polls for status changes and shows you ranked alternatives with time gain, transfer buffer, and risk badges.
5. You tap an alternative to switch to it and continue monitoring from there.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.25 — chi router, pgx/v5, go-redis, Prometheus metrics |
| Frontend | React 19, TypeScript, Vite 6, TanStack Query, Zustand, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL 16 |
| Cache / pub-sub | Redis 7 |
| Reverse proxy | Nginx (production) |
| Containerisation | Docker + Docker Compose |
| External data | `v6.db.transport.rest` — open HAFAS API for DB realtime data |

---

## Prerequisites

| Tool | Minimum version | Check |
|------|----------------|-------|
| Docker | 24 | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |
| Go | 1.25 | `go version` (local dev only) |
| Node | 22 | `node --version` (local dev only) |
| npm | 10 | `npm --version` (local dev only) |

A running internet connection is required — the backend calls `v6.db.transport.rest` for train data.

---

## Quick start — Docker Compose

The fastest path to a running stack. Everything is containerised.

```bash
# 1. Clone
git clone <repo-url> verspaetungs-begleiter
cd verspaetungs-begleiter

# 2. Create your env file
cp .env.example .env
# The defaults work out of the box for local dev — no edits required.

# 3. Start all services
docker compose up -d

# 4. Watch logs until everything is healthy
docker compose logs -f
```

Once all health checks pass (~20 s), open:

| URL | Service |
|-----|---------|
| `http://localhost:5173` | Frontend (Vite dev server, hot-reload) |
| `http://localhost:8080` | Backend API |
| `http://localhost` | Full app via Nginx (mirrors production) |
| `http://localhost:8080/readyz` | Backend health — shows Redis / Postgres / HAFAS status |

### Useful Compose commands

```bash
docker compose ps                  # check service health
docker compose logs -f backend     # tail backend logs
docker compose logs -f frontend    # tail frontend logs
docker compose restart backend     # restart one service
docker compose down                # stop everything
docker compose down -v             # stop + delete Postgres data volume
docker compose up -d --build       # rebuild images after Dockerfile change
```

---

## Local development — without Docker

Suitable when you want IDE debugging, faster Go rebuild cycles, or to run tests directly.

### 1. Start only the infrastructure services

```bash
docker compose up -d postgres redis
```

This starts Postgres (port 5432) and Redis (port 6379) without the application services.

### 2. Backend

```bash
cd backend
go mod download

# Set required environment variables
export PORT=8080
export DATABASE_URL=postgres://vbb:vbb@localhost:5432/vbb
export REDIS_URL=redis://localhost:6379
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export LOG_LEVEL=DEBUG
# All other vars have defaults — see Environment variables below

go run ./cmd/server
```

The server runs on `http://localhost:8080`. Database migrations apply automatically on startup.

### 3. Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173`. It proxies `/v1/*`, `/health`, and `/readyz` to `localhost:8080` automatically (configured in `vite.config.ts`), so no CORS issues during development.

---

## Environment variables

All backend variables are read from the environment or `.env` file. The `.env` file is only loaded by Docker Compose — when running locally, export them directly or use a tool like `direnv`.

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_URL` | `postgres://vbb:vbb@postgres:5432/vbb` | PostgreSQL DSN |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `HAFAS_BASE_URL` | `https://v6.db.transport.rest` | HAFAS API base URL — change for self-hosted proxy |
| `HAFAS_REQUEST_TIMEOUT` | `8s` | Per-request timeout to HAFAS |
| `HAFAS_WORKER_POOL_SIZE` | `50` | Concurrent HAFAS goroutines |
| `HAFAS_QUEUE_DEPTH` | `200` | Backpressure queue size; `Submit()` returns false when full |
| `HAFAS_CB_THRESHOLD` | `5` | Consecutive HAFAS errors before circuit breaker trips |
| `HAFAS_CB_PROBE_INTERVAL` | `30s` | How often the tripped circuit breaker probes HAFAS |
| `MAX_ACTIVE_JOURNEYS` | `2000` | Capacity cap — new POSTs return 503 when reached |
| `JOURNEY_TTL_HOURS` | `2` | Inactive journeys older than this are garbage-collected |
| `RATE_LIMIT_PER_INSTALL` | `60` | Max requests/min per `X-Install-Id` UUID |
| `RATE_LIMIT_PER_IP` | `30` | Max requests/min per IP (fallback when header absent) |
| `DB_MAX_OPEN_CONNS` | `20` | pgx connection pool max size |
| `DB_MIN_CONNS` | `5` | pgx connection pool min idle connections |
| `DB_WRITE_TIMEOUT` | `5s` | Deadline applied to all Postgres write operations |
| `MIGRATIONS_DIR` | `./migrations` | Path to SQL migration files (auto-applied on startup) |
| `CORS_ALLOWED_ORIGINS` | _(none)_ | Comma-separated allowed origins, e.g. `http://localhost:5173` — required for local frontend dev |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | _(empty)_ | Backend base URL. Empty string means relative URLs — correct for dev proxy and production (same origin). Set to `https://api.example.com` only when frontend and backend are on different domains. |

---

## Project structure

```
verspaetungs-begleiter/
│
├── backend/
│   ├── cmd/server/main.go          # Entry point — wires all deps, starts HTTP server
│   ├── internal/
│   │   ├── api/
│   │   │   ├── handlers/           # HTTP handlers (journeys, summary, legs, alternatives, trains, stations, health)
│   │   │   └── middleware/         # Rate limiting, request-id, CORS, logging
│   │   ├── config/                 # Env-var loading with defaults
│   │   ├── hafas/                  # HAFAS client + response mapping
│   │   ├── journey/
│   │   │   ├── model.go            # All domain types (Journey, Leg, Summary, etc.)
│   │   │   ├── compute.go          # Summary derivation from legs
│   │   │   ├── store.go            # Redis + Postgres store (implements Store interface)
│   │   │   ├── poller.go           # Per-journey goroutine polling HAFAS on a ticker
│   │   │   └── worker_pool.go      # Bounded HAFAS concurrency pool
│   │   ├── metrics/                # Prometheus metric registrations
│   │   ├── migrate/                # SQL migration runner
│   │   ├── problem/                # RFC 7807 problem+json helpers
│   │   ├── reqid/                  # Request ID middleware
│   │   └── routing/                # BFS routing engine + alternative scorer
│   ├── migrations/
│   │   └── 001_initial.sql         # Single migration — journeys table + indexes
│   ├── openapi.yaml                # REST API specification (OpenAPI 3.1)
│   ├── Dockerfile                  # Multi-stage: dev / builder / production
│   └── go.mod
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts           # openapi-fetch client + X-Install-Id middleware
│   │   │   ├── types.gen.ts        # Auto-generated TypeScript types from openapi.yaml
│   │   │   └── validation.ts       # Zod schemas for API responses
│   │   ├── components/             # Reusable UI components (AlternativeCard, FilterSheet, RiskBadge, …)
│   │   ├── hooks/                  # TanStack Query hooks (useJourneyFull, useJourneyAlternatives, …)
│   │   ├── i18n/                   # German translations (de.json)
│   │   ├── lib/
│   │   │   ├── datetime.ts         # UTC → Europe/Berlin formatting
│   │   │   ├── indexeddb.ts        # Offline journey persistence
│   │   │   ├── installId.ts        # Persistent device ID (IDB → localStorage fallback)
│   │   │   └── queryClient.ts      # TanStack Query client + key factories
│   │   ├── mocks/                  # MSW mock service worker (dev/test)
│   │   ├── router.tsx              # React Router 6.4 with loader-based cache priming
│   │   ├── screens/                # Full-page route components (StartScreen, AlternativesScreen, CompanionScreen, …)
│   │   ├── store/                  # Zustand stores (journeyStore, installStore, uiStore)
│   │   └── test/                   # Shared test utilities (MSW handlers, factories, render helpers)
│   ├── public/                     # Static assets + PWA manifest
│   ├── Dockerfile                  # Multi-stage: dev / builder / prod (nginx)
│   ├── vite.config.ts              # Vite + React + PWA plugin + dev proxy
│   └── package.json
│
├── nginx/
│   └── nginx.conf                  # Reverse proxy + security headers + SPA fallback
│
├── docker-compose.yml              # Production service definitions
├── docker-compose.override.yml     # Dev overrides: exposed ports, source volumes, hot-reload
├── .env.example                    # Environment variable template
└── .husky/                         # Git hooks
```

---

## Architecture overview

```
Browser
  │  HTTP (dev: :5173 via Vite proxy; prod: :80 via Nginx)
  ▼
Frontend (React SPA)
  │  REST /v1/*   ←  openapi-fetch (typed)   →  X-Install-Id header on every request
  ▼
Backend (Go)
  ├── chi router + middleware (rate limit, request-id, CORS)
  ├── Handlers → Store (Redis L1 cache → Postgres L2)
  └── PollerManager
        └── per-journey goroutine (polls HAFAS every 30 s via WorkerPool)
              ├── applies realtime trip updates to legs
              ├── derives new Summary (ComputeSummary)
              ├── re-runs BFS routing for alternatives
              └── writes updated state to Redis + Postgres via UpdateState
```

**Data flow for a new journey:**

1. `POST /v1/journeys` → BFS routing against HAFAS → journey stored → poller starts
2. Frontend polls `GET /v1/journeys/{id}/summary` every 30 s with `If-None-Match` (ETag)
3. Backend returns 304 when nothing changed, 200 + new ETag when state changes
4. When `summary.alternativeAvailable` is true, frontend fetches `GET /v1/journeys/{id}/alternatives`
5. User taps an alternative → `setJourney(altId)` + navigate to CompanionScreen → poller follows the new route

---

## Development workflow

### Frontend scripts

```bash
cd frontend

npm run dev            # Start Vite dev server on :5173 with HMR
npm run build          # TypeScript compile + Vite production build → dist/
npm run typecheck      # tsc --noEmit (no emit, type errors only)
npm run lint           # ESLint + Prettier check (fails on any warning)
npm run lint:fix       # Auto-fix ESLint and Prettier violations
npm run test           # Vitest unit tests (single run)
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # Coverage report to coverage/
npm run test:e2e       # Playwright end-to-end tests
npm run codegen        # Regenerate src/api/types.gen.ts from ../backend/openapi.yaml
npm run codegen:check  # Verify types.gen.ts is up to date (CI use)
npm run size-limit     # Check bundle size against limits
```

### Backend commands

```bash
cd backend

go run ./cmd/server            # Start server (applies migrations on boot)
go test ./...                  # Run all tests
go test ./internal/journey/... # Run tests in one package
go build -o /tmp/server ./cmd/server  # Compile binary
go mod tidy                    # Sync go.sum + remove unused deps
go vet ./...                   # Static analysis
```

### Running tests

**Backend:**
```bash
cd backend && go test ./...
```
Tests use in-memory mocks for the store and routing engine — no Postgres or Redis required.

**Frontend unit tests:**
```bash
cd frontend && npm run test
```
Uses Vitest + MSW for API mocking. All 86 tests run in under 4 seconds.

**Frontend E2E:**
```bash
# Requires the full stack running
docker compose up -d
cd frontend && npm run test:e2e
```

### Regenerating API types

Whenever `backend/openapi.yaml` changes, regenerate the TypeScript types:

```bash
cd frontend && npm run codegen
```

This runs `openapi-typescript` against `../backend/openapi.yaml` and overwrites `src/api/types.gen.ts`. Commit both files together.

### Git hooks

A pre-commit hook (Husky + lint-staged) runs automatically on `git commit`:

- Staged `.ts`/`.tsx` files → ESLint + Prettier
- Only changed files are linted, so it's fast

If you skip hooks for a one-off: `git commit --no-verify` (use sparingly).

---

## Database

PostgreSQL 16. A single migration file creates the `journeys` table:

```
backend/migrations/001_initial.sql
```

Migrations run automatically when the backend starts (via the embedded runner in `internal/migrate`). There is no separate migration step.

**Schema overview:**

```sql
journeys (
  id               TEXT PRIMARY KEY,      -- jrn_<ulid-style> identifier
  install_id       TEXT,                  -- device UUID for rate limiting / ownership
  train_number     TEXT,
  destination_id   TEXT,                  -- HAFAS station ID
  destination_name TEXT,
  filters_json     JSONB,                 -- routing constraints (dbOnly, safetyLevel, …)
  summary_json     JSONB,                 -- latest computed summary (ETA, status, nextStep)
  legs_json        JSONB,                 -- current route legs with realtime data
  stops_json       JSONB,                 -- all stops across all legs
  etag_epoch       BIGINT,                -- increments when journey is loaded into Redis
  etag_counter     INTEGER,               -- increments on every state change
  created_at       TIMESTAMPTZ,
  terminated_at    TIMESTAMPTZ,           -- NULL = still active
  last_polled_at   TIMESTAMPTZ
)
```

To connect to the database directly:

```bash
# Via Docker
docker compose exec postgres psql -U vbb vbb

# Via local psql (if ports exposed)
psql postgres://vbb:vbb@localhost:5432/vbb
```

---

## API reference

The full OpenAPI 3.1 specification lives at `backend/openapi.yaml`. Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/journeys` | Create journey, start monitoring, compute initial alternatives |
| `GET` | `/v1/journeys/{id}` | Full journey — summary + legs (initial load only, not for polling) |
| `DELETE` | `/v1/journeys/{id}` | Terminate monitoring |
| `GET` | `/v1/journeys/{id}/summary` | Compact status — poll every 30 s with `If-None-Match` ETag |
| `GET` | `/v1/journeys/{id}/legs` | Leg and stop data for timeline rendering |
| `GET` | `/v1/journeys/{id}/alternatives` | Ranked alternative routes |
| `POST` | `/v1/journeys/{id}/alternatives` | Trigger fresh alternatives recomputation (202 async) |
| `GET` | `/v1/trains/{number}` | Validate train number + return metadata |
| `GET` | `/v1/stations?q=` | Station name autocomplete (Redis-cached 5 min) |
| `GET` | `/health` | Liveness probe |
| `GET` | `/readyz` | Readiness probe — checks Redis, Postgres, HAFAS |

All timestamps are **UTC ISO 8601**. Errors use **RFC 7807** `application/problem+json` with `urn:verspbegl:error:<slug>` type URNs.

**Authentication:** None. Abuse-shaped via `X-Install-Id` UUID header (generated on first app launch, persisted in IndexedDB) and IP rate limiting.

To explore the API interactively, point [Scalar](https://github.com/scalar/scalar) or [Swagger UI](https://github.com/swagger-api/swagger-ui) at `backend/openapi.yaml`.

---

## Production deployment

The production `docker-compose.yml` (without the override file) runs a fully containerised stack:

```bash
# Production — no source volumes, no exposed database ports
docker compose -f docker-compose.yml up -d
```

**What runs:**
- `nginx` — serves the built frontend SPA on port 80, proxies `/v1/*` to backend, blocks `/metrics`
- `backend` — statically compiled Go binary, migrations applied on start, 512 MB RAM limit
- `postgres` — data persisted in named `postgres_data` volume
- `redis` — 256 MB volatile-LRU cache

**Before deploying to a real host:**

1. Change Postgres credentials in `docker-compose.yml` and `DATABASE_URL`.
2. Set `CORS_ALLOWED_ORIGINS` to your production frontend domain (or leave empty if same-origin via Nginx).
3. Put TLS termination in front of Nginx (your load balancer or Certbot). The app does not handle TLS itself.
4. Set `LOG_LEVEL=WARN` in production to reduce noise.

**Health check endpoints for orchestrators:**

```
GET /health  → 200 {"status":"ok"}             # liveness
GET /readyz  → 200/503 {"status":"ok|degraded"} # readiness
```

---

## Troubleshooting

### `docker compose up` fails immediately

Check that no other process uses ports 80, 5173, or 8080:

```bash
lsof -i :80 -i :5173 -i :8080
```

### Backend exits with "connection refused" to Postgres/Redis

The Compose health checks gate the backend start — if Postgres or Redis take longer than expected to initialise, increase `start_period` in `docker-compose.yml`.

### Frontend shows a blank screen / network errors

1. Check the backend is healthy: `curl http://localhost:8080/health`
2. Check CORS: `CORS_ALLOWED_ORIGINS` must include the frontend origin when running without Nginx.
3. In dev, the Vite proxy handles `/v1/*` — make sure you're opening `http://localhost:5173`, not port 8080 directly.

### HAFAS returns no trains

`v6.db.transport.rest` is a public community API — it can be slow or rate-limited. Check:

```bash
curl "https://v6.db.transport.rest/stops/8000105/departures?duration=30" | head -c 500
```

If it returns an error, wait and try again. The backend circuit breaker will automatically recover.

### TypeScript types are out of sync with the API

```bash
cd frontend && npm run codegen:check
# If it fails:
npm run codegen
git add src/api/types.gen.ts
```

### Running tests in CI without a database

Backend tests use mocked stores — no Postgres or Redis needed:

```bash
cd backend && go test ./...
```

Frontend tests use MSW to intercept all HTTP calls — no backend needed:

```bash
cd frontend && npm test
```
