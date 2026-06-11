# Technical Architecture Design

**Date:** 2026-06-10
**Status:** Approved (rev 2)
**References:** `docs/specs/pre-defined-research/` — product, architecture, routing, data-sources, api-spec docs are source of truth for product decisions. This document adds the technical implementation layer on top.

---

## 1. Stack Decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Go | Concurrent worker pool for polling, fast REST service, low memory |
| Frontend | React 19 + TypeScript (strict) | Ecosystem depth, PWA tooling, team familiarity |
| Routing | React Router 6.4+ | URL-as-source-of-truth; loaders prime TanStack Query cache |
| Server state | TanStack Query 5 | Polling with adaptive interval, cache, dedup, AbortController |
| API codegen | openapi-typescript + openapi-fetch | Types from openapi.yaml; typed client, CI drift check |
| Runtime validation | Zod | Schema check at API boundary; catches server-client drift |
| Forms | react-hook-form + Zod | Field validation, 422 `errors[]` field mapping |
| Component primitives | shadcn/ui (Radix UI) | Full a11y; ARIA, keyboard, focus trap; copy-paste pattern |
| Styling | Tailwind CSS | Design tokens as CSS vars + utility classes |
| Animations | View Transitions API | Native screen transitions; auto-respects prefers-reduced-motion |
| E2E testing | Playwright | PWA install flow, mobile viewport, offline degradation |
| API mocking | MSW | Handlers generated from openapi.yaml; Vitest + Playwright |
| Build tool | Vite + vite-plugin-pwa | Fast HMR, PWA manifest + service worker generation |
| State management | Zustand | Lightweight, minimal boilerplate, fits app size |
| Persistence (hot) | Redis | Active journey cache, 2h TTL per journey |
| Persistence (durable) | Postgres | Journey history, future ML training data |
| Deployment | Docker Compose | Open source — contributors run with `docker compose up` |
| API versioning | URI prefix `/v1/` | Simplest for open source; no content negotiation complexity |
| Abuse shaping | Per-install ID + IP rate limiting | `X-Install-Id` (random UUID v4, generated at first launch, stored in IndexedDB) sent on every request. IP is fallback for clients missing the header. Per-install limits prevent a single user from hammering upstream. Carrier NAT makes IP-only limits unsafe — one IPv4 can represent thousands of mobile users on the same LTE tower. Global outbound rate limit to db.transport.rest. This is abuse-shaping only, not authentication. |
| Real-time updates | Adaptive polling | 30s foreground / 90s background tab; more robust than SSE on flaky mobile networks |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                 Docker Compose                  │
│                                                 │
│  ┌──────────┐     ┌──────────────────────────┐  │
│  │  React   │────▶│      Go Backend          │  │
│  │  (nginx) │◀────│  REST API /v1/           │  │
│  └──────────┘     │  Worker Pool + Coalescer │  │
│                   └────────┬─────────┬───────┘  │
│                            │         │           │
│                   ┌────────▼─┐  ┌────▼──────┐   │
│                   │  Redis   │  │ Postgres  │   │
│                   │ (hot TTL)│  │ (durable) │   │
│                   └──────────┘  └───────────┘   │
│                                                 │
│  External: db.transport.rest (HAFAS)            │
└─────────────────────────────────────────────────┘
```

**Key boundaries:**
- React only talks to Go backend — never directly to db.transport.rest
- Go backend owns all routing, polling, and caching logic
- Redis = L1 for active journeys (2h TTL), Postgres = L2 durable store
- `X-Install-Id: <uuid>` header on all requests (abuse shaping, not authentication — do NOT use `Authorization: Bearer`)
- Nginx serves frontend and proxies `/v1/` to Go — single origin, no CORS required for production Docker Compose setup

---

## 3. Go Backend Structure

```
backend/
├── cmd/server/main.go          # entry point, boot recovery
├── internal/
│   ├── api/
│   │   ├── handlers/           # one file per endpoint
│   │   ├── middleware/         # abuse-shaping, rate limiting, logging
│   │   └── router.go
│   ├── routing/
│   │   ├── engine.go           # RoutingEngine interface
│   │   ├── bfs.go              # MVP: earliest-arrival BFS
│   │   └── scorer.go           # ranking: ETA → buffer → risk; safetyLevel thresholds
│   ├── journey/
│   │   ├── model.go            # Journey, Leg, Summary structs
│   │   ├── store.go            # Redis + Postgres persistence, write-through semantics
│   │   └── poller.go           # worker pool, per-journey goroutines, fan-out
│   ├── hafas/
│   │   ├── client.go           # db.transport.rest HTTP client
│   │   ├── coalescer.go        # singleflight dedup on (trainNumber, date); fan-out to subscriber list
│   │   ├── mapper.go           # HAFAS response → internal Journey model; sets DataConfidence (high/low/unavailable)
│   │   └── filter.go           # DB-only operator filter
│   └── config/
│       └── config.go           # env vars, thresholds, safetyLevel buffers, pool sizes
├── migrations/                 # SQL migration files, auto-run at boot (idempotent)
├── openapi.yaml                # OpenAPI 3.1 spec (MVP deliverable)
├── Dockerfile
└── go.mod
```

### HAFAS Data Confidence

HAFAS responses can return HTTP 200 with incomplete realtime data. `hafas/mapper.go` evaluates each response and sets a `dataConfidence` field on the Journey:

| Value | Condition |
|-------|-----------|
| `high` | Full realtime data present for all active legs |
| `low` | Realtime data partially missing or older than 5 minutes |
| `unavailable` | No realtime data in HAFAS response |

Frontend shows a data-freshness indicator when `dataConfidence != "high"`. This is distinct from `dataFetchedAt` (backend fetch time) — `dataConfidence` reflects HAFAS data quality, not polling recency.

### RoutingEngine Interface

```go
type RoutingEngine interface {
    FindAlternatives(ctx context.Context, req RoutingRequest) ([]Journey, error)
}
```

MVP implementation: `bfs.go` — earliest-arrival BFS over alternatives returned by db.transport.rest.

Migration path: when full timetable data is available, swap `bfs.go` for a RAPTOR implementation behind the same interface. No API or frontend changes required.

### Worker Pool + Singleflight Coalescing

Rather than one goroutine per active journey with unbounded upstream calls:

1. **Journey poller goroutines** — one per active journey (context-cancelled), responsible for scheduling work.
2. **Bounded HAFAS worker pool** — configurable `HAFAS_WORKER_POOL_SIZE` (default: 50). Poller goroutines submit fetch tasks via a buffered channel of size `HAFAS_QUEUE_DEPTH` (default: 200, i.e. `HAFAS_WORKER_POOL_SIZE × 4`). When the channel is full, the poller skips the cycle rather than blocking — the journey retains last-known state for that poll tick.
3. **Singleflight coalescer** (`hafas/coalescer.go`) — deduplicates concurrent HAFAS fetches keyed on `(trainNumber, date)`. Multiple journeys on the same train share one upstream call; each subscriber receives the result via fan-out. When HAFAS returns a `tripId`, prefer keying on `(tripId)` for precise deduplication — same train number can run as distinct trips intraday (rare but possible).

Cap: `MAX_ACTIVE_JOURNEYS` env var (default: 2000). Journey creation returns 503 when at capacity.

Each HAFAS HTTP call runs with a per-request context deadline of `HAFAS_REQUEST_TIMEOUT` (default: 8s). A timed-out call returns an error; the journey retains last-known state and the `hafas_timeout_total` counter increments. Without a timeout, one hung upstream call occupies a worker pool slot indefinitely.

`hafas/client.go` propagates the triggering request's `X-Request-Id` as an outbound header on all HAFAS calls (header name: `X-Request-Id`). This allows correlating a backend error log entry with the specific upstream HAFAS call that caused it. For poller-initiated fetches (no inbound HTTP request), a new UUID v4 is generated per HAFAS call and logged as `hafasRequestId`.

Each poller goroutine is cancelled via `context.WithCancel` when:
- Journey TTL expires (2h)
- Client calls `DELETE /v1/journeys/{id}`
- GC job removes journeys older than 6h from Postgres

### Polling Cadence and Staleness Budget

- HAFAS worker fetches every **30s** per journey (aligned with frontend foreground poll interval)
- Frontend polls `/summary` every **30s** foreground, **90s** background tab
- Worst-case staleness: 30s (one missed cycle)
- `summary.dataFetchedAt` = timestamp of last successful HAFAS fetch (written by poller, not Redis write time)
- `summary.lastUpdatedAt` = timestamp of last ETag change (state change)

**Cache-Control:** All `/summary` and `/legs` responses include `Cache-Control: private, no-cache, must-revalidate`. Prevents silent caching by corporate proxies or CDNs.

### Boot Recovery

On startup, before accepting requests:
1. Run pending SQL migrations (`migrations/`) — idempotent, safe to re-run
2. Query Postgres: `SELECT id FROM journeys WHERE terminated_at IS NULL AND created_at > now() - interval '2h'`
3. Rehydrate Redis for each active journey (ETag epoch = current unix timestamp)
4. Restart poller goroutines with **staggered start** — spread launch over 10s (e.g. `time.Sleep(10s / len(journeys))` between each) to avoid HAFAS burst on restart
5. Begin accepting requests

Note: boot changes all active ETag epochs — stale client ETags miss and receive full 200 on next poll. Expected and correct behavior; clients handle gracefully.

### Graceful Shutdown

On SIGTERM / SIGINT:
1. `http.Server.Shutdown(ctx)` with 15s drain — stop accepting new requests, allow in-flight to complete
2. Cancel all poller goroutine contexts — stops HAFAS task submissions
3. Wait for HAFAS worker pool to drain (bounded by `HAFAS_REQUEST_TIMEOUT`)
4. Complete any in-flight synchronous Postgres writes
5. Close database connection pool
6. Exit 0

Prevents in-flight Postgres commits from being cut mid-transaction on `docker stop`.

### HAFAS Circuit Breaker

`hafas/client.go` implements a simple circuit breaker:
- After `HAFAS_CB_THRESHOLD` (default: 5) consecutive failures, circuit opens
- Open state: all HAFAS calls fail fast with `upstream-unavailable`; journeys serve cached state
- Circuit probes every `HAFAS_CB_PROBE_INTERVAL` (default: 30s) with a single test call
- On probe success, circuit closes and normal polling resumes

Prevents thundering-herd retries from amplifying a partial HAFAS outage.

---

## 4. React Frontend Structure

```
frontend/
├── public/
│   └── manifest.json           # PWA manifest
├── src/
│   ├── router.tsx              # React Router 6 — routes, loaders, URL params
│   ├── main.tsx                # QueryClientProvider + RouterProvider + ZustandProvider
│   ├── screens/
│   │   ├── StartScreen.tsx
│   │   ├── AlternativesScreen.tsx
│   │   └── CompanionScreen.tsx
│   ├── components/
│   │   ├── Timeline/           # Perlschnur stops + legs (virtualized > 15 stops via @tanstack/react-virtual)
│   │   ├── SummaryHeader/      # sticky ETA + nextStep card; aria-live="polite" on status changes
│   │   ├── AlternativeCard/
│   │   ├── RiskBadge/
│   │   ├── ErrorBanner/        # network / upstream error state, per-error-type UX
│   │   └── Skeleton/           # loading placeholders for timeline + card list
│   ├── hooks/
│   │   ├── useJourney.ts           # CompanionScreen — TanStack Query polling, adaptive interval, ETag
│   │   ├── useJourneySummary.ts    # AlternativesScreen — TanStack Query one-shot GET /v1/journeys/{id}
│   │   └── useOfflineState.ts      # IndexedDB cache + stale detection + Zustand hydration
│   ├── api/
│   │   ├── client.ts           # openapi-fetch typed client, X-Install-Id injection, Zod validation
│   │   ├── types.gen.ts        # auto-generated from backend/openapi.yaml (do not edit manually)
│   │   └── validation.ts       # Zod schemas mirroring API response shapes; fail-fast on drift
│   ├── store/
│   │   ├── journeyStore.ts     # Zustand slice — active journeyId, ETag, status, nextStep
│   │   ├── installStore.ts     # Zustand slice — installId, user filter preferences
│   │   └── uiStore.ts          # Zustand slice — dialog/sheet open states, toast queue
│   └── lib/
│       ├── indexeddb.ts        # offline journey cache (schemaVersion: 1, drop on mismatch)
│       ├── installId.ts        # generate + persist X-Install-Id in IndexedDB + localStorage backup
│       ├── datetime.ts         # Europe/Berlin formatter — Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' })
│       └── queryClient.ts      # TanStack Query client — retry config, staleTime, gcTime
├── Dockerfile                  # nginx + built assets
└── vite.config.ts              # vite-plugin-pwa: workbox precache + runtime caching rules
```

**Install ID:**
On first launch, `installId.ts` generates a random UUID v4, stored in both IndexedDB (`install_id`) and `localStorage` (`vbb_install_id`) as backup. On read, IndexedDB is preferred; falls back to `localStorage` if IndexedDB is empty (e.g. Safari iOS storage pressure eviction). If both empty, new ID generated. All requests include `X-Install-Id: <uuid>`. Rate limit bucket resets on hard clear — accepted trade-off for abuse-shaping-only use case.

**IndexedDB schema versioning:**
All cached objects include `{ schemaVersion: 1, ...data }`. On read, if `schemaVersion` doesn't match current constant, cache is dropped and re-fetched. Prevents silent decode failures across app updates.

**Service worker:**
`vite-plugin-pwa` with `registerType: 'autoUpdate'` and `skipWaiting: true`. On deploy, users receive updated bundle automatically — no stale shell. **Risk:** `skipWaiting: true` forces immediate activation mid-session. Mitigation: `useOfflineState` writes active `journeyId` + ETag to IndexedDB before every state update — CompanionScreen rehydrates from IndexedDB on reload without data loss.

**Service Worker Workbox Cache Strategy (vite.config.ts workbox block):**

| Asset type | Strategy | Details |
|------------|----------|---------|
| App shell (HTML/JS/CSS) | precache | Versioned at build time |
| Fonts (Geist woff2) | CacheFirst + immutable | `Cache-Control: max-age=31536000` |
| `/v1/journeys/{id}/summary` | NetworkFirst | Falls back to IndexedDB (not SW cache) |
| `/v1/stations?q=...` | NetworkOnly | Autocomplete must be fresh |
| Static icons / images | CacheFirst | Long TTL |

`/summary` and `/legs` are NOT in SW cache — IndexedDB handles offline fallback for these (schema-versioned, query-managed). SW cache is for app shell and static assets only.

**PWA Install UX:**
- Android: capture `beforeinstallprompt`, show "App installieren" banner on StartScreen (dismissable, stored in localStorage)
- iOS: `display-mode: standalone` not triggerable — show persistent "Zum Home-Bildschirm hinzufügen" tooltip on first visit (7-day snooze)
- Both: banner disappears once `window.matchMedia('(display-mode: standalone)').matches` is true

**Data Fetching — TanStack Query:**
`useJourney.ts` and `useJourneySummary.ts` use **TanStack Query** (`@tanstack/react-query`) for all server state. Manual fetch loops are error-prone (race conditions on unmount, AbortController leaks, duplicate requests). TanStack Query provides:
- `refetchInterval` for polling — 30s foreground, paused when `document.visibilityState === 'hidden'`
- `refetchIntervalInBackground: false` — uses Page Visibility API automatically
- AbortController cleanup on unmount — no memory leaks
- `retry` + exponential backoff config — handles 429 `Retry-After` via `retryDelay`
- Request deduplication — multiple components mounting won't fire duplicate fetches
- ETag tracked in query metadata; `If-None-Match` injected in `queryFn` via `client.ts`

**Adaptive polling rules (implemented in `queryClient.ts`):**
- Default: 30s (`refetchInterval: 30_000`)
- Background tab: paused (TanStack Query default with `refetchIntervalInBackground: false`)
- `status === 'critical'` OR `minTransferBufferMinutes < 5`: boost to 10s
- Idle > 5 min (no interaction): fall back to 90s
- `navigator.connection?.saveData === true`: cap at 90s regardless of status
- On 429: honour `Retry-After` header; plug into `retryDelay` as `Retry-After × 2^n` ms

**API codegen pipeline:**
`api/types.gen.ts` is generated from `backend/openapi.yaml` via `openapi-typescript`:
```
npx openapi-typescript backend/openapi.yaml -o frontend/src/api/types.gen.ts
```
`api/client.ts` uses `openapi-fetch` (4KB, zero-dep) for fully-typed requests driven by generated types.
`api/validation.ts` wraps each response in a Zod schema check — catches schema drift between server and client at runtime, logs errors, never silently corrupts state.
CI step `openapi-typescript --check` fails build if generated types are out of sync with openapi.yaml.

**Content Security Policy:**
Nginx serves all responses with:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'
```
Prevents injected scripts from exfiltrating travel data. `'unsafe-inline'` for styles is acceptable for Vite-generated CSS; evaluate hash-based CSP post-MVP.

**Bundle target:** Initial JS bundle ≤ 150KB gzipped. Perlschnur timeline renders 20–30 stops per journey; virtualize with `@tanstack/react-virtual` if stop count exceeds 15.

**Zustand / IndexedDB hydration contract:**
- App cold start: `useOfflineState` reads IndexedDB → hydrates Zustand before first render
- Successful poll 200: write to Zustand first, then async write to IndexedDB
- IndexedDB is fallback-of-last-resort, not primary store — Zustand is authoritative while online

**URL Routing (React Router 6):**

`journeyId` lives in the URL — not Zustand-only. URL is the source of truth for screen.

| Route | Screen | Behavior |
|-------|--------|----------|
| `/` | StartScreen | Default entry |
| `/journey/:journeyId/alternatives` | AlternativesScreen | journeyId from URL param |
| `/journey/:journeyId/companion` | CompanionScreen | journeyId from URL param |

On CompanionScreen mount: `useParams()` extracts `journeyId` → React Router loader fetches `GET /v1/journeys/:id` → TanStack Query cache primed. Browser refresh restores full state without depending on Zustand persistence.

Browser back from CompanionScreen → AlternativesScreen → confirmation: "Möchtest du die Route-Überwachung beenden?" (journey still monitored until explicit DELETE or TTL).

Deep-link handling: direct URL to `/journey/jrn_xxx/companion` with no prior session → loader fetches journey → if 404 redirect to `/`.

**Zustand Store Slices:**
```typescript
// journeyStore: active journey runtime state
type JourneyState = {
  journeyId: string | null
  etag: string | null
  status: 'ok' | 'critical' | 'failed' | null
  alternativeAvailable: boolean
}

// installStore: device identity + preferences
type InstallState = {
  installId: string
  filters: JourneyFilters  // persisted to localStorage
}

// uiStore: ephemeral UI state
type UIState = {
  confirmDialogOpen: boolean
  toasts: Toast[]
}
```

**iOS Safe Area:**
Sticky SummaryHeader and bottom CTAs require safe-area inset CSS:
```css
.summary-header { padding-top: max(env(safe-area-inset-top), 16px); }
.bottom-cta     { padding-bottom: max(env(safe-area-inset-bottom), 16px); }
```
Without this, content sits behind the Dynamic Island / notch on iPhone 12+.

**Pull-to-refresh:**
Disable browser pull-to-refresh in both browser and PWA modes:
```css
body { overscroll-behavior-y: contain; }
```
Prevents accidental reload mid-journey. Manual refresh available via ETA header tap (triggers `POST /alternatives`).

**TanStack Query Cache Config (`lib/queryClient.ts`):**

| Query key | staleTime | gcTime | Notes |
|-----------|-----------|--------|-------|
| `journey.full(id)` | 30s | 5min | One-shot on AlternativesScreen mount |
| `journey.summary(id)` | 0 | 5min | Always network-first; polling |
| `journey.legs(id)` | 30s | 5min | Fetched on CompanionScreen mount |
| `journey.alternatives(id)` | 0 | 2min | ETag-cached; `If-None-Match` injected same as summary |
| `stations(q)` | 5min | 10min | Matches Redis cache TTL |
| `train(number, date)` | 30s | 5min | Validated before journey creation |

`staleTime: 0` on summary = always triggers a network fetch, but ETag 304 makes it zero-bandwidth when state is unchanged.

**Error Boundaries per Route:**

React Router 6 `errorElement` per route — CompanionScreen must never white-screen:

| Route | errorElement | Behavior |
|-------|-------------|----------|
| `/` | `<FullPageError />` | Generic reload prompt |
| `/journey/:id/alternatives` | `<ScreenError message="Verbindungen konnten nicht geladen werden" />` | Back button |
| `/journey/:id/companion` | `<CompanionError />` | Reads IndexedDB, shows stale data + "Verbindung unterbrochen" banner |

`<CompanionError />` checks IndexedDB for last-known summary before displaying any error UI.

**Frontend Hydration Order (cold start):**

Race condition exists if Router loader fires before IndexedDB is read. Safe order:

1. `main.tsx` renders `<App>` — `useOfflineState` hook runs, **awaits** IndexedDB read (async, via Suspense boundary wrapping `<RouterProvider>`)
2. If journey found in IndexedDB: hydrate Zustand `journeyStore` with `journeyId` + ETag before any route loader fires
3. React Router renders, loader fires `queryClient.ensureQueryData(journeyQuery(id))`
4. TQ checks cache (already primed from loader), starts `refetchInterval`
5. If loader returns 404 and IndexedDB is empty → redirect to `/`

Implement `useOfflineState` as an async hook wrapped in a Suspense boundary around `<RouterProvider>`. IndexedDB is inherently async — never assume synchronous reads. Suspense handles the loading state until the read resolves.

---

## 5. API Contract

### Endpoint Surface

```
POST   /v1/journeys                       create journey, compute alternatives
GET    /v1/journeys/{id}                  full journey (initial screen load only — summary + legs combined)
GET    /v1/journeys/{id}/summary          compact status (ETag-cached, fast poll path)
GET    /v1/journeys/{id}/legs             leg/stop deltas (ETag-cached)
DELETE /v1/journeys/{id}                  terminate monitoring → 204; unknown ID → 404 (intentionally non-idempotent; annotate x-non-idempotent: true in openapi.yaml)
GET    /v1/journeys/{id}/alternatives     current alternatives list (cached, limit=5 default)
POST   /v1/journeys/{id}/alternatives     trigger fresh re-computation → 202 Accepted
GET    /v1/trains/{number}                validate train number, return metadata
GET    /v1/stations?q=...                 station name autocomplete, proxied from db.transport.rest
```

**Endpoint usage guide:**
- `GET /v1/journeys/{id}` — called once on AlternativesScreen initial load (avoids two parallel requests for summary + legs separately)
- `GET /v1/journeys/{id}/summary` — polling target in CompanionScreen (fast, ETag-cached, short TTL)
- `GET /v1/journeys/{id}/legs` — called once on CompanionScreen mount, then when `alternativeAvailable` flag changes
- `GET /v1/journeys/{id}/alternatives` — called when user opens alternatives view; returns cached list. ETag-cached (`If-None-Match` / 304) — ETag counter incremented when `POST /alternatives` computation completes.
- `POST /v1/journeys/{id}/alternatives` — called when user explicitly triggers re-route; 202 Accepted, then poll GET

### Abuse Shaping Header

All requests should include:
```
X-Install-Id: 550e8400-e29b-41d4-a716-446655440000
```

Missing `X-Install-Id` → IP-based rate limit applied. No authentication — open API.

### POST /v1/journeys — Request Body

```json
{
  "trainNumber": "ICE 123",
  "destination": "8000105",
  "iAmOnThisTrain": true,
  "filters": {
    "dbOnly": true,
    "maxTransfers": null,
    "safetyLevel": "normal"
  }
}
```

- `destination`: always a HAFAS station ID (e.g. `8000105` for Frankfurt Hbf), never a name string. Frontend resolves name → ID via `GET /v1/stations?q=...` before submitting.
- `trainNumber`: normalized to uppercase with single space before number on input (`"ICE 123"`, `"RE 42"`). Backend also normalizes on receipt — `ICE123` and `ICE 123` are treated as identical.
- `iAmOnThisTrain`: user assertion only. Backend does not reject on plausibility; returns a `plausibility` object in response.
- `filters.safetyLevel`: `"aggressive"` | `"normal"` | `"cautious"` — maps to min transfer buffer thresholds (see Section 11).
- `filters.maxTransfers`: integer or `null` (no limit).

### POST /v1/journeys — Response (201 Created)

```json
{
  "journeyId": "jrn_01j2k3m4n5",
  "plausibility": {
    "onTrainConfidence": "high",
    "reason": null
  },
  "summary": { ... },
  "alternatives": [ ... ]
}
```

- `plausibility.onTrainConfidence`: `"high"` | `"low"` | `"unknown"`. Frontend shows confirmation dialog when not `"high"`.
- Confidence computation: `"high"` when train is running and submitted `destination` is a valid future stop. `"low"` when train has passed destination or has no realtime data. `"unknown"` when train data unavailable from HAFAS.
- `Location` response header: `/v1/journeys/jrn_01j2k3m4n5`

### GET /v1/trains/{number} — Train Validation

```
GET /v1/trains/ICE123?date=2026-06-10
```

`trainNumber` in URL: space-stripped for URL safety. Backend normalizes — `ICE123` and `ICE 123` resolve to the same train.

Response 200:
```json
{
  "trainNumber": "ICE 123",
  "date": "2026-06-10",
  "origin": { "id": "8000261", "name": "München Hbf" },
  "destination": { "id": "8011160", "name": "Berlin Hbf" },
  "stops": [ ... ],
  "status": "running"
}
```

Response 404 when train not found for date. Used by StartScreen before submitting journey creation — avoids wasting a `POST /v1/journeys` on an invalid train.

### GET /v1/stations — Autocomplete

```
GET /v1/stations?q=Frank
```

Response 200:
```json
{
  "stations": [
    { "id": "8000105", "name": "Frankfurt (Main) Hbf" },
    { "id": "8000104", "name": "Frankfurt (Main) Süd" }
  ]
}
```

Proxied from db.transport.rest. Backend adds Redis cache (TTL 5min) keyed on normalized query string. Frontend never calls db.transport.rest directly.

### ETag Caching on Summary + Details

```
GET /v1/journeys/{id}/summary
→ 200 OK
   ETag: "jrn_01j2k3m4n5:1749600000:42"
   X-RateLimit-Limit: 60
   X-RateLimit-Remaining: 47
   X-RateLimit-Reset: 1749600420
   {
     "eta": "2026-06-10T17:24:00Z",
     "status": "ok",
     "timeGainVsOriginalMinutes": 18,
     "timeGainVsCurrentRouteMinutes": null,
     "minTransferBufferMinutes": 9,
     "criticalTransfer": false,
     "alternativeAvailable": false,
     "dataConfidence": "high",
     "nextStep": {
       "type": "transfer",
       "stationName": "Kassel Hbf",
       "stationId": "8000294",
       "trainNumber": "RE 4321",
       "platform": "5",
       "departureTime": "2026-06-10T16:57:00Z",
       "bufferMinutes": 9
     },
     "dataFetchedAt": "2026-06-10T19:23:45Z",
     "lastUpdatedAt": "2026-06-10T19:00:12Z"
   }

GET /v1/journeys/{id}/summary
   If-None-Match: "jrn_01j2k3m4n5:1749600000:42"
→ 304 Not Modified   (no body, no re-render)
   X-RateLimit-Limit: 60
   X-RateLimit-Remaining: 46
   X-RateLimit-Reset: 1749600420

GET /v1/journeys/{id}/summary
   If-None-Match: "jrn_01j2k3m4n5:1749600000:42"
→ 200 OK
   ETag: "jrn_01j2k3m4n5:1749600000:43"
   { "eta": "2026-06-10T17:31:00Z", "status": "critical", ... }
```

**ETag format:** `<journeyId>:<redisLoadEpoch>:<counter>`. The `redisLoadEpoch` is set when a Redis entry is created or rehydrated from Postgres. Counter starts at 1 and increments on each state change. After Redis eviction + rehydration, the epoch changes — stale client ETags correctly miss and receive fresh data. Prevents stale-304 from epoch-zero counter collision.

### nextStep Schema

`nextStep` is the next concrete action for the traveler. Null when journey is complete.

| Field | Type | Present when | Description |
|-------|------|-------------|-------------|
| `type` | `"ride" \| "transfer" \| "disembark"` | always | Type of next action |
| `stationName` | string | always | Station name for the action |
| `stationId` | string | always | HAFAS station ID |
| `trainNumber` | string \| null | `"transfer"`, `"ride"` | Train to board |
| `platform` | string \| null | when known | Departure platform |
| `departureTime` | UTC ISO 8601 \| null | `"transfer"` | Departure of connecting train |
| `bufferMinutes` | integer \| null | `"transfer"` | Minutes between arrival and departure |

`type` semantics: `"ride"` = stay on current train; `"transfer"` = upcoming transfer with details; `"disembark"` = final destination.

### Timestamp and Timezone Strategy

All timestamps in API responses use **UTC ISO 8601** (`2026-06-10T17:24:00Z`). No local time strings transmitted — frontend formats to user's local timezone for display.

| Field | Format |
|-------|--------|
| `eta` | UTC ISO 8601 |
| `dataFetchedAt` | UTC ISO 8601 |
| `lastUpdatedAt` | UTC ISO 8601 |
| `departureTime` / `arrivalTime` in legs | UTC ISO 8601 (planned + actual) |
| `nextStep.departureTime` | UTC ISO 8601 |
| `X-RateLimit-Reset` | Unix timestamp (integer) — standard convention |

Rate limit headers present on **all** responses, including 304.

### Idempotency on Journey Creation

`POST /v1/journeys` accepts an optional `Idempotency-Key` header (UUID, client-generated). Stored in Redis with 10min TTL alongside a hash of the **canonical** request body (JSON with alphabetically sorted keys, no extra whitespace). The frontend's `client.ts` always serializes with sorted keys to prevent false 409s from different key orderings.

```
POST /v1/journeys
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

- Same key + same body within 10min → 200 with existing journey (not 201)
- Same key + different body → 409 Conflict

### Error Format — RFC 7807

All 4xx/5xx responses use `Content-Type: application/problem+json`:

```json
{
  "type": "urn:verspbegl:error:train-not-found",
  "title": "Train Not Found",
  "status": 404,
  "detail": "Train ICE 123 does not operate on 2026-06-10.",
  "instance": "/v1/trains/ICE123"
}
```

Error type catalog:

| `type` slug | Status | Trigger |
|------------|--------|---------|
| `urn:verspbegl:error:malformed-request` | 400 | Invalid JSON or missing Content-Type header |
| `urn:verspbegl:error:train-not-found` | 404 | Train number invalid or not running on date |
| `urn:verspbegl:error:journey-not-found` | 404 | journeyId unknown or expired |
| `urn:verspbegl:error:validation-error` | 422 | Missing/invalid request fields |
| `urn:verspbegl:error:upstream-unavailable` | 503 | db.transport.rest unreachable |
| `urn:verspbegl:error:rate-limit-exceeded` | 429 | Too many requests |
| `urn:verspbegl:error:capacity-exceeded` | 503 | MAX_ACTIVE_JOURNEYS reached |
| `urn:verspbegl:error:idempotency-conflict` | 409 | Same Idempotency-Key, different request body |
| `urn:verspbegl:error:internal-error` | 500 | Unexpected server error |

### Rate Limiting Headers

All responses include (including 304):

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1749600420
```

429 response adds:

```
Retry-After: 30
```

### Versioning + Deprecation

- Current version: `/v1/`
- Breaking changes (new required fields, removed fields, changed semantics) → new major `/v2/`
- `/v1/` kept alive for minimum 6 months after `/v2/` ships
- Deprecated endpoints return `Deprecation: true` + `Sunset: <date>` headers

---

## 6. Data Flow

### Journey creation

```
User validates train number
  → GET /v1/trains/{number}?date=today → 200 or 404

User searches station
  → GET /v1/stations?q=... → autocomplete list → user selects → frontend stores HAFAS station ID

User submits train + destination + filters
  → POST /v1/journeys (X-Install-Id: <uuid>, optional Idempotency-Key)
  → Go: check Idempotency-Key cache
      → hit + same body  → return existing journey (200)
      → hit + diff body  → 409 Conflict
  → Go: validate input fields → 422 if invalid
  → Go: call db.transport.rest via coalescer (singleflight on (trainNumber, date))
  → Go: map HAFAS response → internal Journey model
  → Go: apply DB-only operator filter
  → Go: BFS routing → rank alternatives by ETA → buffer → risk
  → Go: write Journey to Postgres (write-through, synchronous)
  → Go: write summary + legs to Redis (TTL 2h, ETag = "<id>:<epoch>:1")
  → Go: start poller goroutine for journeyId
  → 201 Created, Location header, journeyId + plausibility + alternatives
  → React: if plausibility.onTrainConfidence != "high" → show dialog
  → React: navigate to AlternativesScreen
```

### Active journey monitoring

```
User selects alternative → React stores journeyId + ETag in Zustand
  → useJourney.ts polls GET /v1/journeys/{id}/summary every 30s
     with If-None-Match: "<etag>"
  → Go: Redis hit → compare ETag → 304 or 200 + new ETag
  → React on 200: update Zustand → SummaryHeader re-renders + async write IndexedDB

Background poller goroutine (Go, per journey):
  → every 30s: submit fetch task to HAFAS worker pool
  → coalescer deduplicates (trainNumber, date) across concurrent journeys
  → recalculate ETA, buffer, status, criticalTransfer, alternativeAvailable
  → set dataFetchedAt = now()
  → if state changed: increment ETag counter, write delta to Postgres (synchronous, DB_WRITE_TIMEOUT=5s), write to Redis
  → next frontend poll with stale ETag gets 200 with new data
```

### Journey termination

```
User taps "Reise abschließen"
  → DELETE /v1/journeys/{id}
  → Go: cancel poller goroutine via context
  → Go: set terminated_at in Postgres (synchronous write-through)
  → Go: evict from Redis
  → 204 No Content
  → React: clear Zustand + navigate to StartScreen
```

### Offline degradation

```
Poll fails (network error or 503)
  → useOfflineState detects failure
  → render last known summary from IndexedDB
  → show "Zuletzt aktualisiert vor X Minuten" in SummaryHeader (from summary.lastUpdatedAt)
  → journey stays visible, no crash, no blank screen
```

**Staleness thresholds** (implemented in `useOfflineState` / SummaryHeader):

| `dataFetchedAt` age | UI behaviour |
|---------------------|-------------|
| < 3 minutes | Normal display |
| ≥ 3 minutes | "Möglicherweise veraltet" badge on SummaryHeader |
| ≥ 10 minutes | Explicit warning banner: "Daten veraltet – kein Netz?" |

`dataFetchedAt` is the backend's last successful HAFAS fetch timestamp (from summary JSON), not the time of the last frontend poll. This correctly reflects data quality, not polling recency.

### Re-routing trigger

```
Poller detects criticalTransfer=true or status=critical
  → run BFS again with current realtime data
  → better alternative found → set alternativeAvailable=true + increment ETag counter
  → write-through to Postgres
  → next frontend poll gets 200 → SummaryHeader shows warning card
  → user taps → POST /v1/journeys/{id}/alternatives → 202 → GET /v1/journeys/{id}/alternatives → fresh alternatives list
```

### Boot recovery

```
Server starts
  → run SQL migrations (idempotent)
  → query Postgres: SELECT id FROM journeys WHERE terminated_at IS NULL
      AND created_at > now() - interval '2h'
  → for each active journey: rehydrate Redis (epoch = now()), restart poller goroutine
  → begin accepting requests
```

---

## 7. Persistence Strategy

### Storage table

| Store | Contents | TTL / Lifecycle |
|-------|----------|-----------------|
| Redis | Active Journey state (summary, legs, status flags, ETag) | 2h TTL per journeyId; `volatile-lru` eviction policy — only evicts keys with TTL set, protecting active session keys from arbitrary eviction under memory pressure |
| Postgres | All journeys (full model, history) | GC job removes terminated/expired entries > 6h old |
| IndexedDB | Last known summary + ETag per journeyId (`schemaVersion: 1`) | Persists until user clears or new journey starts |

### Postgres Schema (core tables)

```sql
CREATE TABLE journeys (
    id              TEXT PRIMARY KEY,           -- "jrn_01j2k3m4n5"
    install_id      TEXT NOT NULL,              -- X-Install-Id from creator
    train_number    TEXT NOT NULL,              -- normalized "ICE 123"
    destination_id  TEXT NOT NULL,              -- HAFAS station ID
    filters_json    JSONB NOT NULL,
    summary_json    JSONB NOT NULL,
    legs_json       JSONB NOT NULL,
    etag_counter    INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    terminated_at   TIMESTAMPTZ,
    last_polled_at  TIMESTAMPTZ
);

CREATE INDEX journeys_active_idx ON journeys (created_at)
    WHERE terminated_at IS NULL;

CREATE INDEX journeys_install_id_idx ON journeys (install_id);
-- GDPR deletion: fast lookup of all journeys by device ID
```

### Schema Write Optimization

On state-change polls, only `summary_json`, `etag_counter`, and `last_polled_at` are updated in the common case. Reduces per-poll Postgres write payload by ~80%.

**Exception — `legs_json` must also be updated when:**
- `platformActual` changes on any stop (Gleisänderung) — platform changes are part of legs and are displayed in the Perlschnur
- A leg's `status` transitions to `cancelled`

`legs_json` is not written on pure delay updates (delay is captured in `summary_json` via ETA / buffer). Implementors in `journey/store.go` must check for platform or cancellation changes before skipping the `legs_json` write.

GC job (cron goroutine in Go, runs every 30min):
```sql
DELETE FROM journeys
WHERE terminated_at IS NOT NULL
   OR created_at < now() - interval '6h';
```

GC uses `FOR UPDATE SKIP LOCKED`: rows with an active write lock (mid-poll) are skipped, not blocked on. Journey inserts and updates use `ON CONFLICT (id) DO UPDATE` semantics to handle any residual race.

### Write Strategy

**Write-through:**
- Journey creation: write Postgres synchronously → then write Redis
- State change (ETag bump): write Postgres synchronously (`DB_WRITE_TIMEOUT=5s`) → then write Redis. Eliminates the async race where Redis eviction between an async write and a pending Postgres flush could cause state regression on recovery.
- Termination: write Postgres synchronously → then evict Redis

**Recovery path:** Redis evicts journey → next poll falls through to Postgres → reconstructs from stored model + fresh db.transport.rest call → rehydrates Redis with new epoch. No data loss.

---

## 8. Observability

MVP ships with minimal but usable observability.

### Prometheus endpoint

`GET /metrics` (unauthenticated, accessible only within Docker network):

| Metric | Type | Description |
|--------|------|-------------|
| `hafas_fetch_total{status}` | Counter | HAFAS outbound calls by status (success/error) |
| `hafas_fetch_duration_seconds` | Histogram | HAFAS request latency |
| `active_journeys_total` | Gauge | Currently active poller goroutines |
| `poll_etag_304_total` | Counter | Frontend polls returning 304 (cache efficiency) |
| `poll_etag_200_total` | Counter | Frontend polls returning 200 |
| `redis_miss_total` | Counter | Redis miss → Postgres fallback |
| `coalescer_dedup_total` | Counter | HAFAS requests saved by singleflight |
| `hafas_timeout_total` | Counter | HAFAS calls that exceeded HAFAS_REQUEST_TIMEOUT |
| `hafas_circuit_state` | Gauge | Circuit breaker state: 0=closed, 1=half-open, 2=open |
| `http_request_duration_seconds{path,status}` | Histogram | Request latency by endpoint and status code |

### Structured logging

JSON logs to stdout via `slog` (Go 1.21+):
```json
{"level":"INFO","msg":"poll_state_change","journeyId":"jrn_01j2k3m4n5","requestId":"550e8400-e29b-41d4-a716-446655440001","etag":"jrn_01j2k3m4n5:1749600000:43","status":"critical","dataFetchedAt":"2026-06-10T19:23:45Z"}
```

Log levels: `INFO` for state changes, `WARN` for HAFAS errors, `ERROR` for internal failures.

All HTTP responses include `X-Request-Id: <uuid>` (server-generated). Value is echoed in the `instance` field of error responses for log correlation.

---

## 9. MVP Scope

### V1 — must ship

- Start screen: train number + destination, iAmOnThisTrain toggle
- `GET /v1/stations?q=...` autocomplete (proxied from db.transport.rest, Redis-cached 5min)
- `GET /v1/trains/{number}` validation before journey creation
- `POST /v1/journeys` → ranked alternatives list (ETA, buffer, risk badges)
- Plausibility response + confirmation dialog when confidence not high
- Companion screen: sticky summary header + Perlschnur timeline
- Adaptive polling with ETag / If-None-Match (30s foreground / 90s background tab)
- DB-only operator filter (default ON, user-toggleable via `filters.dbOnly`)
- status: ok / critical / failed + criticalTransfer + alternativeAvailable flags
- `DELETE /v1/journeys/{id}` on "Reise abschließen"
- Offline: stale IndexedDB render + lastUpdatedAt indicator
- PWA manifest + service worker (installable, `registerType: 'autoUpdate'` + skipWaiting)
- Docker Compose: `docker compose up` runs full stack — `.env.example` included, auto-migrate on boot
- Per-install ID + IP rate limiting + RFC 7807 errors (urn: type format)
- Prometheus `/metrics` endpoint + structured JSON logging
- `openapi.yaml` published in repo, linted with `@redocly/cli`
- Boot recovery: rehydrate Redis + restart pollers from Postgres on startup
- `GET /health` (liveness) + `GET /readyz` (readiness — checks Redis, Postgres, HAFAS) endpoints
- `X-Request-Id` response header on all endpoints; echoed in error `instance` field

### V2 — next iteration

- Von/Nach secondary start flow
- Filter sheet UI: max transfers, safety level (aggressive / normal / cautious)
- Re-routing suggestion card in companion header
- Journey history view

### V3+ — later

- Historical delay models + risk scoring
- RAPTOR routing engine (swap behind RoutingEngine interface)
- RIS integration
- Learned user preferences
- Push notifications for critical status changes
- Automatic route switching
- Proper authentication (replace abuse-shaping with real auth)

### Exit criteria for MVP

1. User can go from train number → alternatives → active companion in < 30s
2. Companion updates live without manual refresh
3. App renders usably offline with stale data
4. `docker compose up` starts clean stack with no manual steps
5. `openapi.yaml` lints clean with no errors
6. `POST /v1/journeys` p95 latency < 10s (HAFAS call budget: 8s via HAFAS_REQUEST_TIMEOUT, processing + DB budget: 2s)

---

## 10. Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| db.transport.rest instability / undocumented rate limits | High | High | Singleflight coalescer reduces outbound volume; Redis stale fallback; `dataFetchedAt` exposed to frontend |
| HAFAS data quality (wrong delays, missing realtime) | High | Medium | Plausibility checks in `hafas/mapper.go`, mark data confidence in Journey model |
| Operator name string inconsistency (DB filter misses variants) | Medium | Medium | Normalize operator strings in `hafas/filter.go`, maintain allow-list with known variants |
| Goroutine leak (poller never cancelled) | Medium | High | Context cancellation on DELETE + TTL expiry + Postgres GC job + MAX_ACTIVE_JOURNEYS cap |
| HAFAS overload from N concurrent journeys × 30s | Medium | High | Bounded HAFAS worker pool (50) + singleflight coalescer — N journeys on same train = 1 upstream call |
| PWA polling on bad mobile network drains battery | Medium | Medium | Page Visibility API pause + 304 fast-path reduces payload cost |
| db.transport.rest changes API schema | Low | High | `hafas/mapper.go` isolation — internal Journey model unchanged |
| Open source abuse hammering upstream API | Medium | Medium | Per-install ID + IP rate limiting + global outbound rate limit + MAX_ACTIVE_JOURNEYS cap |
| Install ID extracted or spoofed | High | Low | Accepted risk — install ID is abuse-shaping only; rate limiting does the real work |
| Redis restart loses active journey state | Low | Medium | Boot recovery from Postgres rehydrates all active journeys before accepting traffic |

**Highest risk:** db.transport.rest has no SLA. Design principle: degrade gracefully — stale data shown honestly beats error screens.

---

## 11. Configuration Reference

Environment variables (`.env.example` committed to repo):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `DATABASE_URL` | `postgres://vbb:vbb@postgres:5432/vbb` | Postgres DSN |
| `HAFAS_BASE_URL` | `https://v6.db.transport.rest` | HAFAS API base |
| `HAFAS_WORKER_POOL_SIZE` | `50` | Max concurrent HAFAS workers |
| `MAX_ACTIVE_JOURNEYS` | `2000` | Hard cap on concurrent journeys |
| `JOURNEY_TTL_HOURS` | `2` | Redis TTL and poller lifetime |
| `RATE_LIMIT_PER_INSTALL` | `60` | Requests/min per X-Install-Id |
| `RATE_LIMIT_PER_IP` | `30` | Requests/min per IP (fallback when X-Install-Id missing) |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` |
| `HAFAS_REQUEST_TIMEOUT` | `8s` | Per-call HTTP timeout for HAFAS requests. Prevents goroutine blocking on hung upstream. |
| `HAFAS_QUEUE_DEPTH` | `200` | Buffer size of HAFAS worker task channel (HAFAS_WORKER_POOL_SIZE × 4). Tasks dropped when full. |
| `HAFAS_CB_THRESHOLD` | `5` | Consecutive HAFAS errors before circuit breaker opens. |
| `HAFAS_CB_PROBE_INTERVAL` | `30s` | Interval for circuit breaker probe calls when open. |
| `DB_MAX_OPEN_CONNS` | `20` | pgx pool max open connections. Sized for concurrent state-change writes. |
| `DB_MAX_IDLE_CONNS` | `5` | pgx pool idle connections kept alive between polls. |
| `DB_WRITE_TIMEOUT` | `5s` | Timeout for synchronous Postgres state-change writes. |

### safetyLevel Transfer Buffer Thresholds

| safetyLevel | Min transfer buffer |
|-------------|---------------------|
| `aggressive` | 3 minutes |
| `normal` | 8 minutes |
| `cautious` | 15 minutes |

Applied in `routing/scorer.go` — alternatives with buffer below threshold are ranked lower or excluded.

---

## 12. Open Questions (not blocking MVP)

- `GET /v1/journeys/{id}/legs` delta structure: what minimal diff format does the Perlschnur need? Defer to frontend implementation phase.
- Exact operator allow-list: needs empirical testing against live db.transport.rest responses to catch all DB operator name variants.
- GC job: cron goroutine in Go (preferred — keeps stack minimal, no external scheduler) vs. Postgres scheduled job.

---

## 13. Privacy and Data Retention

### Personal Data Inventory

No user accounts, no authentication, no payment data. Data qualifying as personal under GDPR:

| Data | Stored in | Retention | Basis |
|------|-----------|-----------|-------|
| `X-Install-Id` (pseudonymous device ID) | Postgres `journeys.install_id` | GC after 6h | Legitimate interest (abuse prevention) |
| Travel pattern (train + destination per journey) | Postgres | GC after 6h | Legitimate interest (core function) |
| IP addresses (rate limiting) | Redis | TTL per rate-limit window | Legitimate interest |

### Obligations Before Public Launch

- **Privacy Policy:** Document data categories, retention periods, contact — required before public availability.
- **No third-party tracking:** App must not include analytics SDKs that transmit user data externally.
- **db.transport.rest:** Outbound requests include journey parameters. Verify db.transport.rest data processing terms before production.
- **Log retention:** JSON logs include `trainNumber` + `journeyId`. Log aggregation must apply ≤7 day retention.

---

## 14. Architecture Decision Records

### ADR-001: In-Process Pollers vs Separate Worker Service

**Status:** Accepted

**Context:** Journey monitoring requires background polling goroutines that run independently of HTTP request handling. These could live in the same process as the API server or in a separate worker service.

**Decision:** In-process goroutines within the Go backend.

**Alternatives Considered:**
- Separate worker service (e.g. second Docker Compose service) — independent scaling, fault isolation, but adds IPC layer and operational complexity for open-source contributors.
- External job queue (Redis queues, RabbitMQ) — decoupled, but adds a third messaging dependency.

**Consequences:**
- Positive: Contributors run one `docker compose up`, zero IPC complexity, shared in-process state (no serialization overhead).
- Negative: Poller panic brings down API server (mitigated: recover() in goroutine startup); no independent scaling.

**Trade-off:** Operational simplicity over isolation. Revisit if active journeys approach 10k+.

---

### ADR-002: Polling vs Server-Sent Events (SSE)

**Status:** Accepted

**Context:** The CompanionScreen needs live journey updates. Two primary options: client-driven polling or server-push via SSE.

**Decision:** Adaptive polling (30s foreground / 90s background tab).

**Alternatives Considered:**
- SSE (`text/event-stream`) — server pushes changes immediately; lower latency; auto-reconnects on drop.
- WebSocket — bidirectional, overkill for unidirectional server→client updates.

**Consequences:**
- Positive: Works on every HTTP/1.1 intermediary; no persistent connection to maintain per-client; predictable server load; ETag 304 makes most polls zero-cost.
- Negative: Up to 30s latency on critical state change (e.g. missed transfer warning arrives 30s late).

**Trade-off:** Reliability and simplicity over latency. For safety-critical timing (e.g. <3 min transfer buffer), consider accelerating poll to 10s when `minTransferBufferMinutes < 5`. SSE reserved for V2 at `/v1/journeys/{id}/events`.

---

### ADR-003: BFS Facade vs Full Routing Engine (RAPTOR)

**Status:** Accepted

**Context:** The spec describes a "time-dependent graph" routing algorithm. Two implementation paths: (a) delegate routing to HAFAS and filter/rank the returned results, (b) implement a graph-based router (RAPTOR/CSA) using raw timetable data.

**Decision:** BFS facade — use HAFAS as the routing oracle; apply filter and ranking logic on top of HAFAS-returned alternatives.

**Alternatives Considered:**
- RAPTOR on full timetable — optimal routing, no HAFAS dependency for routing logic; but requires full timetable import pipeline (GTFS/HAFAS NeTEx), significant engineering.
- CSA (Connection Scan Algorithm) — similar to RAPTOR, same prerequisite.

**Consequences:**
- Positive: HAFAS already handles graph traversal, realtime integration, and transfer minimums; MVP ships without a timetable pipeline.
- Negative: Routing quality is bounded by HAFAS response quality; cannot explore paths HAFAS doesn't return; HAFAS rate limits constrain re-routing frequency.

**Trade-off:** Integration speed over algorithmic control. `RoutingEngine` interface allows swap to RAPTOR without API or frontend changes.

---

### ADR-004: Mutable JSONB Columns vs Event Sourcing for Journey State

**Status:** Accepted

**Context:** Journey state changes frequently (every 30s poll may produce a new ETag). State could be stored as mutable columns (current snapshot) or as an append-only event log.

**Decision:** Mutable JSONB columns (`summary_json`, `etag_counter`, `last_polled_at`).

**Alternatives Considered:**
- Event sourcing (append-only `journey_events` table) — full audit trail, replay capability, ML training data.
- Hybrid: snapshot + event log for deltas.

**Consequences:**
- Positive: GDPR 6h retention is simple to implement (DELETE row); no event replay complexity; Postgres storage bounded.
- Negative: No history of how a journey evolved; no replay for debugging.

**Trade-off:** GDPR simplicity and operational clarity over audit trail. V3+ ML training data would require an opt-in event log with explicit consent.

---

### ADR-005: React Router Loaders + TanStack Query Integration

**Status:** Accepted

**Context:** React Router 6 loaders and TanStack Query both fetch data on screen entry. Without a clear integration pattern, implementors double-fetch or bypass TQ cache on navigation.

**Decision:** Router loaders prime TanStack Query cache; TQ owns all subsequent fetches.

```typescript
// routes/companion.tsx
export const companionLoader = (queryClient: QueryClient) =>
  async ({ params }: LoaderFunctionArgs) => {
    await queryClient.ensureQueryData(journeyQuery(params.journeyId!))
    return null  // data served from TQ cache, not loader return value
  }
```

**Pattern:**
1. Loader: `queryClient.ensureQueryData(...)` — primes cache, shows React Router suspense
2. Component: `useSuspenseQuery(journeyQuery(id))` — reads from cache, starts polling
3. No double-fetch. Browser back = cache hit, instant render.

**Alternatives Considered:**
- Loader only (no TQ) — no polling, no cache invalidation, no adaptive interval.
- TQ only (no loader) — no suspense-based loading states via Router; data loads after component mounts.
- `initialData` from loader — couples loader return shape to TQ; brittle on schema changes.

**Consequences:**
- Positive: Clean separation — Router handles navigation/loading state, TQ handles data lifecycle.
- Negative: Loader and TQ query keys must stay in sync; shared `queryClient` instance passed to route definitions.

**Trade-off:** Slight coupling (shared `queryClient`) for a major DX win: type-safe, suspense-ready, no duplicate fetches.

---

## 15. Sequence Diagrams

### Journey Creation and Monitoring

```mermaid
sequenceDiagram
    participant FE as React (Frontend)
    participant BE as Go Backend
    participant RL as Redis (Rate Limit)
    participant RC as Redis (Journey Cache)
    participant PG as Postgres
    participant HF as db.transport.rest

    FE->>BE: GET /v1/trains/ICE123?date=today
    BE->>HF: fetch train metadata
    HF-->>BE: train stops + status
    BE-->>FE: 200 train metadata

    FE->>BE: POST /v1/journeys (X-Install-Id)
    BE->>RL: check rate limit
    RL-->>BE: ok
    BE->>HF: fetch journeys (via coalescer)
    HF-->>BE: HAFAS alternatives
    BE->>BE: map + filter (DB-only) + BFS rank
    BE->>PG: INSERT journey (sync)
    PG-->>BE: ok
    BE->>RC: SET journey summary+legs (TTL 2h)
    BE->>BE: start poller goroutine
    BE-->>FE: 201 + journeyId + plausibility + alternatives

    FE->>FE: user selects alternative → navigate CompanionScreen

    loop every 30s (foreground) / 90s (background tab)
        FE->>BE: GET /summary If-None-Match: ETag
        BE->>RC: GET summary
        RC-->>BE: hit
        alt state unchanged
            BE-->>FE: 304 Not Modified (no re-render)
        else state changed
            BE-->>FE: 200 + new ETag + updated summary
            FE->>FE: update Zustand + async write IndexedDB
        end
    end

    Note over BE: Background poller (every 30s)
    BE->>HF: fetch realtime (coalescer dedup)
    HF-->>BE: updated delays / status
    BE->>BE: recalculate ETA, buffer, status
    alt state changed
        BE->>PG: UPDATE summary_json + etag_counter (sync)
        BE->>RC: SET updated summary (new ETag)
    end

    FE->>BE: DELETE /v1/journeys/{id}
    BE->>BE: cancel poller context
    BE->>PG: SET terminated_at (sync)
    BE->>RC: DEL journey
    BE-->>FE: 204 No Content
```

---

## 16. Frontend Tooling Stack

| Concern | Tool | Version / Notes |
|---------|------|-----------------|
| Framework | React + TypeScript | 19+ / strict mode |
| Build | Vite | 6+ |
| PWA | vite-plugin-pwa | workbox-based |
| Routing | React Router | 6.4+ (loaders/actions) |
| Server state | TanStack Query | 5+ |
| Client state | Zustand | 5+ |
| API types | openapi-typescript | codegen from backend/openapi.yaml |
| API client | openapi-fetch | typed fetch, zero runtime deps |
| Runtime validation | Zod | schema validation at API boundary |
| Forms | react-hook-form + Zod resolver | field-level validation, 422 error mapping |
| Components | shadcn/ui (Radix UI + Tailwind) | copy-paste, full a11y primitives |
| Styling | Tailwind CSS | design tokens mapped to CSS vars |
| Animations | View Transitions API (CSS fallback) | honors prefers-reduced-motion natively |
| Virtualization | @tanstack/react-virtual | Perlschnur timeline > 15 stops |
| Date/time | Intl.DateTimeFormat | Europe/Berlin TZ, no library import |
| Linting | ESLint + @typescript-eslint + react-hooks + jsx-a11y | |
| Formatting | Prettier | |
| Pre-commit | lint-staged + husky | typecheck + lint + format |
| Unit testing | Vitest + React Testing Library | |
| E2E testing | Playwright | PWA install flow, mobile viewport |
| API mocking | MSW | generate handlers from openapi.yaml |
| Bundle analysis | vite-bundle-visualizer + size-limit | ≤150KB JS gzipped |

### shadcn/ui + Tailwind Integration

Design tokens from `design-system.md` map to CSS variables and Tailwind config:

```typescript
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      'bg-app': 'var(--bg-app)',       // #F6F4F2 light / #111827 dark
      'bg-card': 'var(--bg-card)',     // #FFFFFF / #1F2933
      'accent': 'var(--accent)',        // #0F766E / #34D399
      'warn': 'var(--warn)',            // #DC6B33 / #F97316
    }
  }
}
```

shadcn/ui primitives used: Dialog (plausibility confirm), Sheet (filter panel), Switch (DB-only toggle), Toast (error notifications), Popover (transfer details).

### i18n Contract

All user-facing strings are extracted via `react-i18next` with `de.json` as source of truth. V1 ships DE-only; extraction scaffold in place so V2 adds locales without refactor.

```typescript
// All UI strings via t(), never hardcoded
const { t } = useTranslation()
t('companion.nextStep.transfer', { station: 'Kassel Hbf', buffer: 9 })
```

---

## 17. Frontend CI Pipeline

Steps run on every PR:

```yaml
- npm run typecheck          # tsc --noEmit
- npm run lint               # ESLint + Prettier check
- npm run test               # Vitest (unit + integration)
- npm run build              # Vite production build
- npm run size-limit         # fail if JS bundle > 150KB gzipped
- npm run codegen:check      # openapi-typescript --check (fail if types out of sync)
- npm run test:e2e           # Playwright (critical paths: train→alternatives→companion)
```

E2E critical paths (Playwright):
1. Train number → alternatives → select route → companion screen renders with ETA
2. Offline mode: disconnect network → companion shows stale data + timestamp banner
3. PWA: `display-mode: standalone` → install banner not shown

---

## 18. Nginx Configuration

### proxy + security headers (`nginx/nginx.conf`)

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    # Security headers
    # HSTS has no effect on HTTP — only activates when TLS is terminated upstream (load balancer / reverse proxy in production).
    # Keep the header so it is present when nginx sits behind TLS termination; harmless on plain HTTP.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'" always;

    # Gzip
    gzip on;
    gzip_types application/json text/plain application/javascript text/css;
    gzip_min_length 1024;

    # API proxy
    location /v1/ {
        proxy_pass http://backend:8080;
        proxy_read_timeout 15s;   # > HAFAS_REQUEST_TIMEOUT (8s) + processing margin
        proxy_connect_timeout 5s;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;      # don't buffer SSE-style streaming (future V2)
    }

    location /health { proxy_pass http://backend:8080; }
    location /readyz { proxy_pass http://backend:8080; }
    location /metrics { deny all; }   # metrics internal only — not exposed via nginx

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
        expires -1;               # no cache for index.html (SW handles it)
    }

    # Immutable static assets (Vite content-hashed)
    location ~* \.(js|css|woff2|png|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Rate Limiting Coordination:**
- Nginx: DDoS-level flood protection — `limit_req_zone $binary_remote_addr rate=200r/s burst=50`
- Go middleware: per-install-ID quota enforcement (60 req/min) + per-IP fallback (30 req/min)
- No conflict: nginx drops flood traffic before it hits Go; Go enforces app-level quotas on what nginx passes through.

---

## 19. Docker Compose Specification

### `docker-compose.yml`

```yaml
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - frontend_build:/usr/share/nginx/html:ro
    depends_on:
      backend: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  backend:
    build: ./backend
    environment:
      - PORT=8080
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgres://vbb:vbb@postgres:5432/vbb
    env_file: .env
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s   # allow boot recovery to complete
    deploy:
      resources:
        limits: { memory: 512m, cpus: "1.0" }

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy volatile-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits: { memory: 300m }

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vbb
      POSTGRES_USER: vbb
      POSTGRES_PASSWORD: vbb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vbb"]
      interval: 5s
      timeout: 3s
      retries: 10
    deploy:
      resources:
        limits: { memory: 256m }

volumes:
  postgres_data:
  frontend_build:
```

### `docker-compose.override.yml` (development)

```yaml
# Overrides for local development — not committed if it contains secrets
services:
  backend:
    build:
      context: ./backend
      target: dev          # multi-stage: dev target includes air for hot-reload
    volumes:
      - ./backend:/app:cached
    ports: ["8080:8080"]   # expose for frontend dev server
    deploy:
      resources: {}         # no resource limits in dev

  frontend:
    build:
      context: ./frontend
      target: dev
    volumes:
      - ./frontend:/app:cached
      - /app/node_modules
    ports: ["5173:5173"]
    environment:
      - VITE_API_BASE_URL=http://localhost:8080
    command: npm run dev

  postgres:
    ports: ["5432:5432"]   # expose for DB tools
```

**Frontend Vite env var:**
`VITE_API_BASE_URL` — empty string in production (relative URL via nginx proxy). Set to `http://localhost:8080` in `docker-compose.override.yml` for dev. `client.ts` reads `import.meta.env.VITE_API_BASE_URL ?? ''`.

---

## 20. Go Module and TypeScript Config

### Go Module Path

```
# backend/go.mod
module github.com/verspaetungsbegleiter/backend
go 1.22
```

For open-source contributors: `go get github.com/verspaetungsbegleiter/backend@main`. Module path must be set before any `go mod init` or `go build`.

### TypeScript Config (`frontend/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

`noUncheckedIndexedAccess` prevents silent `undefined` from array access — critical when iterating Zod-validated API arrays.
`exactOptionalPropertyTypes` ensures optional fields from `types.gen.ts` are handled correctly.
