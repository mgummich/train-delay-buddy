# Verspätungs-Begleiter

<div align="center">

![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791?logo=postgresql&logoColor=white)
![Valkey](https://img.shields.io/badge/Valkey-9.1-B5C2FF?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-22c55e)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa)

**Real-time alternative routing for Deutsche Bahn journeys.**  
Enter your current train and destination — the app monitors your connection live and surfaces faster alternatives as delays emerge.

> **Not affiliated with Deutsche Bahn.** Uses the public [`v6.db.transport.rest`](https://v6.db.transport.rest) HAFAS proxy.

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start — Docker Compose](#quick-start--docker-compose)
- [Local development — without Docker](#local-development--without-docker)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [Architecture overview](#architecture-overview)
- [Development workflow](#development-workflow)
- [Testing](#testing)
- [Database](#database)
- [API reference](#api-reference)
- [Metrics](#metrics)
- [PWA installation](#pwa-installation)
- [Production deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## What it does

1. You enter a train number (e.g. `ICE 123`) and your destination station.
2. The backend polls HAFAS every 30 seconds for realtime updates on every leg of your route.
3. A BFS routing engine reruns in the background and computes alternative routes that arrive earlier.
4. The frontend polls for state changes and shows you ranked alternatives — with time gain, minimum transfer buffer, and risk badges.
5. Tap an alternative to switch to it; the poller immediately follows the new route.
6. Install as a PWA for offline resilience and home-screen access (no app store required).

---

## Screenshots

<div align="center">

| Start | Alternatives | Companion timeline |
|:---:|:---:|:---:|
| ![Start screen](design_handoff_verspaetungsbegleiter/screenshots/1-start.png) | ![Alternatives](design_handoff_verspaetungsbegleiter/screenshots/2-alternativen.png) | ![Timeline](design_handoff_verspaetungsbegleiter/screenshots/3-reisebegleiter-timeline.png) |

| Filter sheet | Empty state | Dark mode |
|:---:|:---:|:---:|
| ![Filter](design_handoff_verspaetungsbegleiter/screenshots/5-filter-sheet.png) | ![Leer](design_handoff_verspaetungsbegleiter/screenshots/9-leer-zustand.png) | ![Dark](design_handoff_verspaetungsbegleiter/screenshots/10-darkmode-beispiel.png) |

</div>

Additional screens in [`design_handoff_verspaetungsbegleiter/screenshots/`](design_handoff_verspaetungsbegleiter/screenshots/).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Backend** | Go 1.25 — chi router, pgx/v5, go-redis, Prometheus metrics |
| **Frontend** | React 19, TypeScript, Vite 6, TanStack Query, Zustand, Tailwind CSS, shadcn/ui |
| **Database** | PostgreSQL 18 |
| **Cache** | Valkey 9.1 (BSD Redis fork, volatile-LRU, 256 MB cap) |
| **Reverse proxy** | Nginx (production) |
| **Containerisation** | Docker + Docker Compose |
| **External data** | `v6.db.transport.rest` — open HAFAS API for DB realtime data |
| **PWA** | vite-plugin-pwa + Workbox, installable on iOS and Android |

---

## Prerequisites

| Tool | Minimum version | Check command |
|------|----------------|---------------|
| Docker | 24 | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |
| Go | 1.25 | `go version` _(local dev only)_ |
| Node | 22 | `node --version` _(local dev only)_ |
| npm | 10 | `npm --version` _(local dev only)_ |

> [!NOTE]
> An internet connection is required — the backend calls `v6.db.transport.rest` for live train data. No API key is needed.

---

## Quick start — Docker Compose

The fastest path to a running stack. Every service is containerised; nothing needs to be installed beyond Docker.

```bash
# 1. Clone the repository
git clone git@github.com:mgummich/train-delay-buddy.git verspaetungs-begleiter
cd verspaetungs-begleiter

# 2. Create your env file (defaults work out of the box)
cp .env.example .env

# 3. Build and start all services
docker compose up -d

# 4. Follow logs until everything is healthy (takes ~20 s on first run)
docker compose logs -f
```

Once all health checks pass:

| URL | Service |
|-----|---------|
| `http://localhost:5173` | Frontend — Vite dev server with hot-reload |
| `http://localhost:8080` | Backend API |
| `http://localhost` | Full app via Nginx (mirrors production routing) |
| `http://localhost:8080/readyz` | Backend health — shows Valkey / Postgres / HAFAS status |

### Useful Compose commands

```bash
docker compose ps                  # check service and health status
docker compose logs -f backend     # stream backend logs
docker compose logs -f frontend    # stream frontend logs
docker compose restart backend     # restart one service without stopping others
docker compose down                # stop all services
docker compose down -v             # stop + delete the Postgres data volume (resets DB)
docker compose up -d --build       # rebuild images after Dockerfile or dependency change
```

---

## Local development — without Docker

Use this when you want IDE debugging, faster Go build cycles, or to run tests without containers.

### Step 1 — Start infrastructure only

```bash
docker compose up -d postgres valkey
```

This starts only Postgres (`:5432`) and Valkey (`:6379`), leaving the application services for local runs.

### Step 2 — Backend

```bash
cd backend
go mod download

export PORT=8080
export DATABASE_URL=postgres://vbb:${POSTGRES_PASSWORD}@localhost:5432/vbb
export VALKEY_URL=redis://localhost:6379
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export LOG_LEVEL=DEBUG

go run ./cmd/server
```

The server starts on `http://localhost:8080`. Database migrations apply automatically on every start — no manual migration step.

### Step 3 — Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173`. It proxies `/v1/*`, `/health`, and `/readyz` to `localhost:8080` via the Vite config, so there are no CORS issues during development.

---

## Environment variables

Backend variables are read from the process environment or, when using Docker Compose, from the `.env` file. When running locally without Compose, `export` the variables you need or use a tool like [`direnv`](https://direnv.net/).

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_URL` | `postgres://vbb:${POSTGRES_PASSWORD}@postgres:5432/vbb` | PostgreSQL connection string |
| `VALKEY_URL` | `redis://valkey:6379` | Valkey connection URL. The `redis://` scheme is reused for protocol compatibility with the `go-redis` client. |
| `REDIS_URL` | _(none)_ | Deprecated alias for `VALKEY_URL` — honoured when `VALKEY_URL` is unset, to ease migration from a Redis-only deployment. |
| `LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `HAFAS_BASE_URL` | `https://v6.db.transport.rest` | HAFAS API base URL — swap for a self-hosted proxy |
| `HAFAS_REQUEST_TIMEOUT` | `8s` | Per-request deadline to HAFAS |
| `HAFAS_WORKER_POOL_SIZE` | `50` | Max concurrent HAFAS goroutines |
| `HAFAS_QUEUE_DEPTH` | `200` | Backpressure queue depth; `Submit()` returns false when full |
| `HAFAS_CB_THRESHOLD` | `5` | Consecutive HAFAS failures before circuit breaker opens |
| `HAFAS_CB_PROBE_INTERVAL` | `30s` | How often an open circuit breaker probes HAFAS to recover |
| `MAX_ACTIVE_JOURNEYS` | `2000` | Capacity cap — `POST /v1/journeys` returns 503 when reached |
| `JOURNEY_TTL_HOURS` | `2` | Journeys inactive longer than this are garbage-collected |
| `RATE_LIMIT_PER_INSTALL` | `60` | Max requests/min per `X-Install-Id` UUID |
| `RATE_LIMIT_PER_IP` | `30` | Max requests/min per IP (fallback when header absent) |
| `DB_MAX_OPEN_CONNS` | `20` | pgx connection pool maximum size |
| `DB_MIN_CONNS` | `5` | pgx connection pool minimum idle connections |
| `DB_WRITE_TIMEOUT` | `5s` | Deadline on all Postgres write operations |
| `MIGRATIONS_DIR` | `./migrations` | Path to SQL migration files — auto-applied at startup |
| `CORS_ALLOWED_ORIGINS` | _(none)_ | Comma-separated allowed origins, e.g. `http://localhost:5173`. Required when frontend and backend are on different origins. |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | _(empty)_ | Backend base URL. Empty = relative URLs, which is correct for the Vite dev proxy and for same-origin production (Nginx). Set to `https://api.example.com` only when frontend and backend are on different domains. |

---

## Project structure

```
verspaetungs-begleiter/
│
├── backend/
│   ├── cmd/server/main.go          # Entry point — wires all deps, starts HTTP server
│   ├── internal/
│   │   ├── api/
│   │   │   ├── handlers/           # HTTP handlers (journeys, summary, legs, alternatives,
│   │   │   │                       #   trains, stations, health)
│   │   │   └── middleware/         # Rate limiting, request-id injection, CORS, logging
│   │   ├── config/                 # Env-var loading with defaults (config.go)
│   │   ├── hafas/                  # HAFAS REST client + response mapping to domain types
│   │   ├── journey/
│   │   │   ├── model.go            # All domain types: Journey, Leg, Summary, Filters, …
│   │   │   ├── compute.go          # Derives Summary (ETA, status, nextStep) from legs
│   │   │   ├── store.go            # Valkey L1 + Postgres L2 store (implements Store interface)
│   │   │   ├── poller.go           # Per-journey goroutine — ticks every 30 s, calls HAFAS
│   │   │   └── worker_pool.go      # Bounded concurrency pool for HAFAS fetch tasks
│   │   ├── metrics/                # Prometheus metric definitions (registered at import)
│   │   ├── migrate/                # SQL migration runner — runs on every server start
│   │   ├── problem/                # RFC 7807 application/problem+json response helpers
│   │   ├── reqid/                  # X-Request-Id middleware for log correlation
│   │   └── routing/                # BFS routing engine + ETA-based alternative scorer
│   ├── migrations/
│   │   └── 001_initial.sql         # Sole migration — journeys table + indexes
│   ├── openapi.yaml                # OpenAPI 3.1 specification (source of truth)
│   ├── Dockerfile                  # Multi-stage: dev → builder → production (Alpine)
│   └── go.mod
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts           # openapi-fetch client + X-Install-Id request middleware
│   │   │   ├── types.gen.ts        # Auto-generated TypeScript types (from openapi.yaml)
│   │   │   └── validation.ts       # Zod schemas for runtime API response validation
│   │   ├── components/             # UI components: AlternativeCard, FilterSheet,
│   │   │                           #   RiskBadge, AppBar, Skeleton, ErrorBanner, …
│   │   ├── hooks/                  # TanStack Query hooks: useJourneyFull,
│   │   │                           #   useJourneyAlternatives, useTrainValidation, …
│   │   ├── i18n/                   # German translations (de.json)
│   │   ├── lib/
│   │   │   ├── datetime.ts         # UTC ISO → Europe/Berlin local time formatting
│   │   │   ├── indexeddb.ts        # Offline journey persistence (IDB)
│   │   │   ├── installId.ts        # Persistent device ID: IDB → localStorage fallback
│   │   │   └── queryClient.ts      # TanStack Query client singleton + key factories
│   │   ├── mocks/                  # MSW service worker for API mocking in dev/tests
│   │   ├── router.tsx              # React Router 6.4 — loader-based TQ cache priming
│   │   ├── screens/                # Full-page components: StartScreen, AlternativesScreen,
│   │   │                           #   CompanionScreen, SettingsScreen, ErrorScreens
│   │   ├── store/                  # Zustand stores: journeyStore, installStore, uiStore
│   │   └── test/                   # Shared test helpers: MSW handlers, factories, render
│   ├── public/                     # Static assets + PWA manifest.json + icons
│   ├── Dockerfile                  # Multi-stage: dev → builder → prod (nginx)
│   ├── vite.config.ts              # Vite + React plugin + PWA (Workbox) + dev proxy
│   └── package.json
│
├── tests/
│   └── e2e/                        # Playwright end-to-end test suites
│       ├── golden-path.spec.ts     # Happy-path journey creation → alternatives → companion
│       ├── critical-status.spec.ts # Critical-transfer and failed-route scenarios
│       ├── deep-link.spec.ts       # Direct URL navigation and session restore
│       └── offline.spec.ts         # PWA offline behaviour
│
├── nginx/
│   └── nginx.conf                  # Reverse proxy, security headers, SPA fallback,
│                                   #   /metrics blocked from public access
│
├── docs/
│   └── specs/                      # Architecture and product specifications
│
├── design_handoff_verspaetungsbegleiter/
│   ├── screenshots/                # Reference screenshots of all screens
│   ├── design-system.md            # Design tokens, colour palette, typography
│   └── screens.jsx                 # Design canvas for UI reference
│
├── docker-compose.yml              # Production service definitions (no exposed DB ports)
├── docker-compose.override.yml     # Dev overrides: exposed ports, source volumes, hot-reload
└── .env.example                    # Environment variable template — copy to .env
```

---

## Architecture overview

```
Browser (React SPA / PWA)
  │
  │  dev:  http://localhost:5173  (Vite dev server + proxy)
  │  prod: http://localhost:80    (Nginx)
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  Backend  (Go / chi)                                    │
│                                                         │
│  Middleware: rate-limit · request-id · CORS · logging   │
│                                                         │
│  Handlers                                               │
│    POST /v1/journeys     ──► BFS Engine ──► Store       │
│    GET  /v1/journeys/:id/summary  (ETag / 304)          │
│    GET  /v1/journeys/:id/alternatives                   │
│    POST /v1/journeys/:id/alternatives  (202 async)      │
│                                                         │
│  PollerManager                                          │
│    └── goroutine per journey (30 s ticker)              │
│          ├── WorkerPool ──► HAFAS API (db.transport.rest)│
│          ├── ApplyTripUpdates  (realtime data → legs)   │
│          ├── ComputeSummary    (ETA · status · nextStep)│
│          ├── BFS routing       (fresh alternatives)     │
│          └── UpdateState ──► Valkey (L1) + Postgres (L2) │
└─────────────────────────────────────────────────────────┘
         │                         │
    Valkey 9.1               PostgreSQL 18
  (hot cache,              (persistent store,
  ETag counters)            migration on boot)
```

### Data flow — new journey

| Step | What happens |
|------|-------------|
| 1 | `POST /v1/journeys` — BFS routing against HAFAS, journey stored, poller starts |
| 2 | Frontend polls `GET /v1/journeys/{id}/summary` every 30 s with `If-None-Match` |
| 3 | Backend returns **304** (unchanged) or **200** + new ETag when state changes |
| 4 | When `summary.alternativeAvailable = true`, frontend fetches alternatives list |
| 5 | User taps an alternative → navigate to CompanionScreen → poller follows new route |
| 6 | User taps "Reise abschließen" → `DELETE /v1/journeys/{id}` → poller stopped |

### Caching strategy

| Layer | TTL | What is cached |
|-------|-----|----------------|
| Valkey | journey TTL (default 2 h) | Full journey JSON (fast ETag polling) |
| Valkey | 5 min | Station search results |
| Browser (TanStack Query) | 30 s | Full journey (`GET /journeys/{id}`) |
| Browser (TanStack Query) | 0 s (always refetch) | Alternatives list |
| Browser (Nginx) | 1 year | Hashed static assets (JS/CSS/fonts) |
| Browser (Nginx) | no-cache | `index.html`, API responses |

---

## Development workflow

### Frontend scripts

```bash
cd frontend

npm run dev            # Vite dev server on :5173 with HMR and API proxy
npm run build          # TypeScript compile + production Vite build → dist/
npm run preview        # Preview the production build locally
npm run typecheck      # tsc --noEmit — type errors only, no output files
npm run lint           # ESLint + Prettier check (fails on any warning)
npm run lint:fix       # Auto-fix all ESLint and Prettier violations
npm run test           # Vitest unit tests — single run
npm run test:watch     # Vitest in interactive watch mode
npm run test:coverage  # Vitest with coverage report → coverage/
npm run codegen        # Regenerate src/api/types.gen.ts from ../backend/openapi.yaml
npm run codegen:check  # Verify types.gen.ts matches openapi.yaml (use in CI)
npm run size-limit     # Check production bundle size against configured limits
```

### Backend commands

```bash
cd backend

go run ./cmd/server             # Start server (migrations apply automatically)
go test ./...                   # Run all tests
go test -v ./internal/journey/. # Verbose tests for one package
go test -run TestName ./...     # Run a specific test by name
go build -o /tmp/server ./cmd/server  # Compile a binary
go mod tidy                     # Sync go.sum, remove unused dependencies
go vet ./...                    # Static analysis
```

### Regenerating API types

Whenever `backend/openapi.yaml` changes, regenerate the TypeScript types:

```bash
cd frontend && npm run codegen
```

This overwrites `src/api/types.gen.ts`. Commit `openapi.yaml` and `types.gen.ts` together in the same commit.

> [!WARNING]
> Never edit `src/api/types.gen.ts` by hand — it is fully overwritten by `codegen`.

### Pre-commit hooks

Husky runs `lint-staged` on every `git commit`. Staged `.ts`/`.tsx` files are passed through ESLint and Prettier automatically. Only changed files are processed, so it runs in under a second.

```bash
# Skip hooks for a one-off (use sparingly)
git commit --no-verify
```

---

## Testing

### Backend unit tests

```bash
cd backend && go test ./...
```

No external services required. The store, routing engine, and HAFAS client are all mocked with in-memory fakes.

### Frontend unit tests

```bash
cd frontend && npm run test
```

Uses **Vitest** + **MSW** (Mock Service Worker). MSW intercepts all HTTP calls at the network layer — no backend needed. All 86 tests run in under 4 seconds.

### End-to-end tests

E2E tests live in `tests/e2e/` and use **Playwright**. They require the full stack running:

```bash
# Start the stack
docker compose up -d

# Run the E2E suite
cd tests/e2e && npx playwright test

# Or from the frontend directory (same suite, different entry)
cd frontend && npm run test:e2e
```

The suite covers: golden-path journey creation → alternatives → companion, critical-transfer scenarios, deep-link navigation, and PWA offline behaviour.

---

## Database

PostgreSQL 18 with a single migration file:

```
backend/migrations/001_initial.sql
```

Migrations run automatically on every server start via the embedded runner in `internal/migrate`. There is no separate migration step and no migration tool to install.

### Schema

```sql
CREATE TABLE journeys (
  id               TEXT PRIMARY KEY,    -- jrn_<ulid-style>, e.g. "jrn_01j2k3m4n5p6q7r8"
  install_id       TEXT NOT NULL,       -- device UUID for rate limiting and ownership
  train_number     TEXT NOT NULL,
  destination_id   TEXT NOT NULL,       -- HAFAS station ID, e.g. "8000105"
  destination_name TEXT NOT NULL,
  filters_json     JSONB NOT NULL,      -- routing constraints: dbOnly, safetyLevel, maxTransfers
  summary_json     JSONB NOT NULL,      -- latest summary: ETA, status, nextStep, dataConfidence
  legs_json        JSONB NOT NULL,      -- current route legs with realtime timestamps
  stops_json       JSONB NOT NULL,      -- all stops across all legs
  etag_epoch       BIGINT  NOT NULL,    -- increments when journey is loaded into Valkey
  etag_counter     INTEGER NOT NULL,    -- increments on every state change (ETag key)
  created_at       TIMESTAMPTZ NOT NULL,
  terminated_at    TIMESTAMPTZ,         -- NULL = active, set = terminated
  last_polled_at   TIMESTAMPTZ
);
```

Indexes: `journeys_active_idx` (partial — `WHERE terminated_at IS NULL`) and `journeys_install_id_idx`.

### Connecting directly

```bash
# Via Docker
docker compose exec postgres psql -U vbb vbb

# Via local psql (when override ports are exposed)
psql postgres://vbb:vbb@localhost:5432/vbb
```

### Adding a migration

Create a new numbered SQL file in `backend/migrations/`:

```bash
touch backend/migrations/002_add_column.sql
```

The runner applies all unapplied files in alphabetical order on the next server start.

---

## API reference

The full **OpenAPI 3.1** specification lives at [`backend/openapi.yaml`](backend/openapi.yaml).

To explore it interactively:

```bash
# Scalar (recommended — modern UI)
npx @scalar/cli serve backend/openapi.yaml

# Or open with Swagger UI / Redoc pointing at the file
```

### Endpoint summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/journeys` | Create journey, start poller, compute initial alternatives |
| `GET` | `/v1/journeys/{id}` | Full journey: summary + legs (initial load only — not for polling) |
| `DELETE` | `/v1/journeys/{id}` | Terminate monitoring, stop poller |
| `GET` | `/v1/journeys/{id}/summary` | Compact status — poll every 30 s with `If-None-Match` ETag |
| `GET` | `/v1/journeys/{id}/legs` | Leg and stop data for timeline rendering |
| `GET` | `/v1/journeys/{id}/alternatives` | Ranked alternative routes |
| `POST` | `/v1/journeys/{id}/alternatives` | Trigger fresh recomputation — returns 202 immediately |
| `GET` | `/v1/trains/{number}` | Validate train number, return origin/destination/status |
| `GET` | `/v1/stations?q=` | Station name autocomplete (Valkey-cached 5 min) |
| `GET` | `/health` | Liveness probe — 200 while process is alive |
| `GET` | `/readyz` | Readiness probe — 200/503 with Valkey/Postgres/HAFAS status |

### Conventions

- All timestamps are **UTC ISO 8601** — the frontend handles local timezone conversion.
- Errors use **RFC 7807** `application/problem+json` with stable `urn:verspbegl:error:<slug>` type URNs.
- **No authentication.** Abuse-shaped via `X-Install-Id` UUID header (generated on first app launch, stored in IndexedDB with localStorage backup) and IP rate limiting.
- The `Idempotency-Key` header on `POST /v1/journeys` provides a 10-minute replay window.

---

## Metrics

The backend exposes Prometheus metrics at `GET /metrics` (Prometheus text format).

```bash
curl http://localhost:8080/metrics
```

> [!NOTE]
> `/metrics` is **blocked by Nginx** in production (`deny all`). Access it directly on port 8080 or via an internal monitoring network.

Scrape configuration for Prometheus:

```yaml
scrape_configs:
  - job_name: verspaetungsbegleiter
    static_configs:
      - targets: ["backend:8080"]
```

---

## PWA installation

The app is a fully installable Progressive Web App. The service worker pre-caches all static assets for offline rendering of previously visited screens.

**Install on iOS (Safari):**
1. Open `http://localhost` (or your production URL) in Safari.
2. Tap the Share button → "Add to Home Screen".
3. Tap "Add".

**Install on Android (Chrome):**
1. Open the app in Chrome.
2. Tap the "Install app" prompt that appears in the address bar, or open the browser menu → "Add to Home Screen".

**Install on desktop (Chrome/Edge):**
1. Click the install icon in the address bar (right side).

**Service worker behaviour:**
- Static assets (JS/CSS/fonts/icons): pre-cached on install, served offline.
- `/v1/journeys/*/summary` and `/v1/stations`: network-only — never served from cache (realtime data must be fresh).
- The `OfflineStateLoader` component reads the last-known journey from IndexedDB and displays it when the network is unavailable.

---

## Production deployment

The production `docker-compose.yml` (without the override file) runs the hardened stack with no exposed database ports and resource limits applied:

```bash
# Production — no source mounts, no open DB ports
docker compose -f docker-compose.yml up -d
```

**What runs:**
| Service | Details |
|---------|---------|
| `nginx` | Port 80 — serves the built frontend SPA, proxies `/v1/*` to backend, blocks `/metrics` |
| `backend` | Statically compiled Go binary, 512 MB RAM / 1 CPU limit, migrations on start |
| `postgres` | Data in `postgres_data` named volume — survives container restarts |
| `valkey` | 256 MB volatile-LRU cap, data in memory only |

### Pre-deployment checklist

1. **Change Postgres credentials** — update `POSTGRES_PASSWORD` and `DATABASE_URL` in `docker-compose.yml`. Never use `vbb/vbb` in production.
2. **Set `CORS_ALLOWED_ORIGINS`** — or leave empty if frontend and backend are served from the same domain via Nginx.
3. **TLS** — the app does not handle TLS. Put Nginx behind a TLS-terminating load balancer or use Certbot.
4. **`LOG_LEVEL=WARN`** — reduces log volume in production.
5. **Monitor `/readyz`** — configure your load balancer to route traffic only to healthy instances.

### Health check endpoints

```
GET /health  → 200 {"status":"ok"}
GET /readyz  → 200 {"status":"ok","checks":{"valkey":"ok","postgres":"ok","hafas":"ok"}}
             → 503 when Valkey or Postgres is unreachable
```

---

## Troubleshooting

### `docker compose up` fails on port conflicts

Check for processes already using the required ports:

```bash
lsof -i :80 -i :5173 -i :8080 -i :5432 -i :6379
```

Edit `docker-compose.override.yml` to remap ports if needed.

### Backend exits with "connection refused" to Postgres or Valkey

The Compose health checks prevent the backend from starting until both dependencies are ready. If startup consistently times out, increase `start_period` in `docker-compose.yml` (backend service → `healthcheck`).

### Frontend shows a blank screen or API errors

1. Verify the backend is healthy: `curl http://localhost:8080/health`
2. Check CORS: `CORS_ALLOWED_ORIGINS` must include the frontend origin when running without Nginx.
3. In dev, the Vite proxy handles `/v1/*` — open `http://localhost:5173`, **not** `:8080` directly.
4. Open browser devtools → Network tab and look for failed requests to `/v1/`.

### HAFAS returns no trains or empty results

`v6.db.transport.rest` is a public community API — it can be slow, temporarily rate-limited, or unavailable. Test it directly:

```bash
curl "https://v6.db.transport.rest/trips?trainNumber=ICE123&nationalExpress=true" | head -c 500
```

The backend circuit breaker will automatically recover once HAFAS responds successfully. You can monitor its state via `/readyz`.

### TypeScript types are out of sync with `openapi.yaml`

```bash
cd frontend

# Check if types need regenerating
npm run codegen:check

# Regenerate and commit
npm run codegen
git add src/api/types.gen.ts backend/openapi.yaml
git commit -m "chore: sync generated API types"
```

### Tests fail on "Cannot find module" or import errors

```bash
# Backend
cd backend && go mod tidy

# Frontend
cd frontend && npm install
```

### Resetting all local data

```bash
# Stop services and delete the Postgres volume
docker compose down -v

# Restart fresh
docker compose up -d
```
