# Technical Architecture Design

**Date:** 2026-06-10
**Status:** Approved
**References:** `docs/specs/pre-defined-research/` — product, architecture, routing, data-sources, api-spec docs are source of truth for product decisions. This document adds the technical implementation layer on top.

---

## 1. Stack Decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Go | Concurrent goroutine-per-journey polling, fast REST service, low memory |
| Frontend | React + TypeScript | Ecosystem depth, PWA tooling, team familiarity |
| Build tool | Vite + vite-plugin-pwa | Fast HMR, PWA manifest + service worker generation |
| State management | Zustand | Lightweight, minimal boilerplate, fits app size |
| Persistence (hot) | Redis | Active journey cache, 2h TTL per journey |
| Persistence (durable) | Postgres | Journey history, future ML training data |
| Deployment | Docker Compose | Open source — contributors run with `docker compose up` |
| API versioning | URI prefix `/v1/` | Simplest for open source; no content negotiation complexity |
| Abuse shaping | API key + IP rate limiting | Key in React env var — public bundle means key is extractable. This is abuse-shaping only, not authentication. Stricter protection via IP + per-key rate limits. |
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
│  └──────────┘     │  Routing Engine + Poller │  │
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
- API key in `Authorization: Bearer <key>` header on all requests (not query param)

---

## 3. Go Backend Structure

```
backend/
├── cmd/server/main.go          # entry point
├── internal/
│   ├── api/
│   │   ├── handlers/           # one file per endpoint
│   │   ├── middleware/         # abuse-shaping, rate limiting, logging
│   │   └── router.go
│   ├── routing/
│   │   ├── engine.go           # RoutingEngine interface
│   │   ├── bfs.go              # MVP: earliest-arrival BFS
│   │   └── scorer.go           # ranking: ETA → buffer → risk
│   ├── journey/
│   │   ├── model.go            # Journey, Leg, Summary structs
│   │   ├── store.go            # Redis + Postgres persistence
│   │   └── poller.go           # goroutine per active journey
│   ├── hafas/
│   │   ├── client.go           # db.transport.rest HTTP client
│   │   ├── mapper.go           # HAFAS response → internal Journey model
│   │   └── filter.go           # DB-only operator filter
│   └── config/
│       └── config.go           # env vars, thresholds, API keys
├── openapi.yaml                # OpenAPI 3.1 spec (MVP deliverable)
├── Dockerfile
└── go.mod
```

### RoutingEngine Interface

```go
type RoutingEngine interface {
    FindAlternatives(ctx context.Context, req RoutingRequest) ([]Journey, error)
}
```

MVP implementation: `bfs.go` — earliest-arrival BFS over alternatives returned by db.transport.rest.

Migration path: when full timetable data is available, swap `bfs.go` for a RAPTOR implementation behind the same interface. No API or frontend changes required.

### Goroutine-per-journey Poller

Each active journey gets a goroutine started at journey creation, cancelled via `context.WithCancel` when:
- Journey TTL expires (2h)
- Client calls `DELETE /v1/journeys/{id}`
- Cleanup job removes journeys older than 6h from Postgres

The poller fetches fresh data from db.transport.rest every 45s, recalculates ETA / buffer / status, and writes deltas to Redis. The frontend's polling of `/v1/journeys/{id}/summary` always hits the Redis hot path.

---

## 4. React Frontend Structure

```
frontend/
├── public/
│   ├── manifest.json           # PWA manifest
│   └── sw.js                   # service worker (cache-first shell)
├── src/
│   ├── screens/
│   │   ├── StartScreen.tsx
│   │   ├── AlternativesScreen.tsx
│   │   └── CompanionScreen.tsx
│   ├── components/
│   │   ├── Timeline/           # Perlschnur stops + legs
│   │   ├── SummaryHeader/      # sticky ETA + nextStep card
│   │   ├── AlternativeCard/
│   │   └── RiskBadge/
│   ├── hooks/
│   │   ├── useJourney.ts       # polling loop + adaptive interval + ETag tracking
│   │   ├── useJourneySummary.ts
│   │   └── useOfflineState.ts  # IndexedDB cache + stale detection
│   ├── api/
│   │   └── client.ts           # typed fetch wrapper, Authorization header injection
│   ├── store/
│   │   └── journeyStore.ts     # Zustand — journey state, status flags
│   └── lib/
│       └── indexeddb.ts        # offline journey cache
├── Dockerfile                  # nginx + built assets
└── vite.config.ts
```

**Polling behaviour:**
- `useJourney.ts` polls `GET /v1/journeys/{id}/summary` every 30s (foreground), sending `If-None-Match` with stored ETag
- 304 Not Modified → skip re-render, reset interval
- 200 → update Zustand + IndexedDB + store new ETag
- Page Visibility API reduces interval to 90s when tab hidden
- On failed poll: render stale IndexedDB data, show `lastUpdatedAt` timestamp

---

## 5. API Contract

### Endpoint Surface

```
POST   /v1/journeys                       create journey, compute alternatives
GET    /v1/journeys/{id}                  full journey (summary + legs)
GET    /v1/journeys/{id}/summary          compact status (ETag-cached, fast poll path)
GET    /v1/journeys/{id}/details          leg/stop deltas (ETag-cached)
DELETE /v1/journeys/{id}                  terminate monitoring, cancel poller goroutine
POST   /v1/journeys/{id}/alternatives     re-compute alternatives for active journey
GET    /v1/trains/{number}                validate train number, return metadata
```

Note: `summary` and `details` are kept as separate sub-resources deliberately — different cache TTLs (summary: short, details: longer) and different polling frequencies on the client.

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

- `destination`: always a HAFAS station ID (e.g. `8000105` for Frankfurt Hbf), never a name string. Frontend resolves name → ID via autocomplete before submitting.
- `iAmOnThisTrain`: user assertion only. Backend does not reject on plausibility; it returns a `plausibility` object in the response.
- `filters.safetyLevel`: `"aggressive"` | `"normal"` | `"cautious"` — maps to min transfer buffer thresholds.
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
- `Location` response header: `/v1/journeys/jrn_01j2k3m4n5`

### GET /v1/trains/{number} — Train Validation

```
GET /v1/trains/ICE123?date=2026-06-10
```

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

### ETag Caching on Summary + Details

```
GET /v1/journeys/{id}/summary
→ 200 OK
   ETag: "v42"
   { eta: "19:24", status: "ok", ... }

GET /v1/journeys/{id}/summary
   If-None-Match: "v42"
→ 304 Not Modified   (no body, no re-render)

GET /v1/journeys/{id}/summary
   If-None-Match: "v42"
→ 200 OK
   ETag: "v43"
   { eta: "19:31", status: "critical", ... }
```

ETag is an opaque version counter incremented by the backend poller when state changes. Not a hash.

### Idempotency on Journey Creation

`POST /v1/journeys` accepts an optional `Idempotency-Key` header (UUID, client-generated). If the same key is received within 10 minutes, the backend returns the existing journey instead of creating a duplicate. Useful when the client retries on network failure.

```
POST /v1/journeys
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

### Error Format — RFC 7807

All 4xx/5xx responses use `Content-Type: application/problem+json`:

```json
{
  "type": "https://verspaetungsbegleiter.app/errors/train-not-found",
  "title": "Train Not Found",
  "status": 404,
  "detail": "Train ICE 123 does not operate on 2026-06-10.",
  "instance": "/v1/trains/ICE123"
}
```

Error type catalog:

| `type` slug | Status | Trigger |
|------------|--------|---------|
| `train-not-found` | 404 | Train number invalid or not running on date |
| `journey-not-found` | 404 | journeyId unknown or expired |
| `validation-error` | 422 | Missing/invalid request fields |
| `upstream-unavailable` | 503 | db.transport.rest unreachable |
| `rate-limit-exceeded` | 429 | Too many requests |

### Rate Limiting Headers

All responses include:

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

User submits train + destination + filters
  → POST /v1/journeys (Authorization: Bearer <key>, optional Idempotency-Key)
  → Go: check Idempotency-Key cache → if hit, return existing journey
  → Go: validate input fields → 422 if invalid
  → Go: call db.transport.rest
  → Go: map HAFAS response → internal Journey model
  → Go: apply DB-only operator filter
  → Go: BFS routing → rank alternatives by ETA → buffer → risk
  → Go: write Journey to Postgres + cache in Redis (TTL 2h)
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
  → React on 200: Zustand update → SummaryHeader re-renders + IndexedDB update

Background poller goroutine (Go, per journey):
  → every 45s: fetch fresh data from db.transport.rest
  → recalculate ETA, buffer, status, criticalTransfer, alternativeAvailable
  → if state changed: increment ETag, write delta to Redis, async flush to Postgres
  → next frontend poll with stale ETag gets 200 with new data
```

### Journey termination

```
User taps "Reise abschließen"
  → DELETE /v1/journeys/{id}
  → Go: cancel poller goroutine via context
  → Go: mark journey terminated in Postgres
  → Go: evict from Redis
  → 204 No Content
  → React: clear Zustand + navigate to StartScreen
```

### Offline degradation

```
Poll fails (network error or 503)
  → useOfflineState detects failure
  → render last known summary from IndexedDB
  → show "Zuletzt aktualisiert vor X Minuten" in SummaryHeader
  → journey stays visible, no crash, no blank screen
```

### Re-routing trigger

```
Poller detects criticalTransfer=true or status=critical
  → run BFS again with current realtime data
  → better alternative found → set alternativeAvailable=true + increment ETag in Redis
  → next frontend poll gets 200 → SummaryHeader shows warning card
  → user taps → POST /v1/journeys/{id}/alternatives → fresh alternatives list
```

---

## 7. Persistence Strategy

| Store | Contents | TTL / Lifecycle |
|-------|----------|-----------------|
| Redis | Active Journey state (summary, legs, status flags, ETag) | 2h TTL per journeyId |
| Postgres | All journeys (full model, history) | GC job removes terminated/expired entries > 6h old |
| IndexedDB | Last known summary + ETag per journeyId | Persists until user clears or new journey starts |

**Recovery path:** Redis evicts journey → next poll falls through to Postgres → reconstructs from stored model + fresh db.transport.rest call. No data loss.

---

## 8. MVP Scope

### V1 — must ship

- Start screen: train number + destination, iAmOnThisTrain toggle
- `GET /v1/trains/{number}` validation before journey creation
- `POST /v1/journeys` → ranked alternatives list (ETA, buffer, risk badges)
- Plausibility response + confirmation dialog when confidence not high
- Companion screen: sticky summary header + Perlschnur timeline
- Adaptive polling with ETag / If-None-Match (30s foreground / 90s background tab)
- DB-only operator filter (default ON, user-toggleable via `filters.dbOnly`)
- status: ok / critical / failed + criticalTransfer + alternativeAvailable flags
- `DELETE /v1/journeys/{id}` on "Reise abschließen"
- Offline: stale IndexedDB render + lastUpdatedAt indicator
- PWA manifest + service worker (installable)
- Docker Compose: `docker compose up` runs full stack
- API key abuse-shaping + IP-based rate limiting + RFC 7807 errors
- `openapi.yaml` published in repo, linted with `@redocly/cli`

### V2 — next iteration

- Von/Nach secondary start flow
- Filter sheet UI: max transfers, safety level (aggressive / normal / cautious)
- Re-routing suggestion card in companion header
- Journey history view
- `POST /v1/journeys/{id}/alternatives` triggered from UI

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

---

## 9. Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| db.transport.rest instability / undocumented rate limits | High | High | Cache in Redis, graceful stale fallback, expose `lastUpdatedAt` |
| HAFAS data quality (wrong delays, missing realtime) | High | Medium | Plausibility checks in `hafas/mapper.go`, mark data confidence in Journey model |
| Operator name string inconsistency (DB filter misses variants) | Medium | Medium | Normalize operator strings in `hafas/filter.go`, maintain allow-list with known variants |
| Goroutine leak (poller never cancelled) | Medium | High | Context cancellation on `DELETE` + TTL expiry + Postgres GC job |
| PWA polling on bad mobile network drains battery | Medium | Medium | Page Visibility API pause + 304 fast-path reduces payload cost |
| db.transport.rest changes API schema | Low | High | `hafas/mapper.go` isolation — internal Journey model unchanged |
| Open source abuse hammering upstream API | Medium | Medium | Per-key + IP rate limiting + global outbound rate limit to db.transport.rest |
| API key extracted from public bundle | High | Low | Accepted risk — key is abuse-shaping only, rate limiting does the real work |

**Highest risk:** db.transport.rest has no SLA. Design principle: degrade gracefully — stale data shown honestly beats error screens.

---

## 10. Open Questions (not blocking MVP)

- `GET /v1/journeys/{id}/details` delta structure: what minimal diff format does the Perlschnur need? Defer to frontend implementation phase.
- Exact operator allow-list: needs empirical testing against live db.transport.rest responses to catch all DB operator name variants.
- GC job implementation: cron goroutine in Go or Postgres scheduled job?
- Station autocomplete endpoint (`GET /v1/stations?q=...`): use db.transport.rest directly from frontend or proxy through backend? V1 can proxy; adds latency but keeps no direct HAFAS dependency in frontend.
