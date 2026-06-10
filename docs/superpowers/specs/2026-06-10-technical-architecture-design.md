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
| Auth | API key | Key in React env var, validated by Go middleware |
| Rate limiting | IP + API key | `golang.org/x/time/rate` in Go middleware |
| Real-time updates | Adaptive polling | 30s foreground / 90s background tab; simpler than SSE on flaky mobile networks |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                 Docker Compose                  │
│                                                 │
│  ┌──────────┐     ┌──────────────────────────┐  │
│  │  React   │────▶│      Go Backend          │  │
│  │  (nginx) │◀────│  REST API + Routing      │  │
│  └──────────┘     │  Engine + Poller         │  │
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
- API key injected into all React requests via typed fetch wrapper

---

## 3. Go Backend Structure

```
backend/
├── cmd/server/main.go          # entry point
├── internal/
│   ├── api/
│   │   ├── handlers/           # one file per endpoint
│   │   ├── middleware/         # auth, rate limiting, logging
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
- User calls journey termination
- Cleanup job removes journeys older than 6h from Postgres

The poller fetches fresh data from db.transport.rest every 45s, recalculates ETA / buffer / status, and writes deltas to Redis. The frontend's polling of `/summary` always hits the Redis hot path.

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
│   │   ├── useJourney.ts       # polling loop + adaptive interval
│   │   ├── useJourneySummary.ts
│   │   └── useOfflineState.ts  # IndexedDB cache + stale detection
│   ├── api/
│   │   └── client.ts           # typed fetch wrapper, API key injection
│   ├── store/
│   │   └── journeyStore.ts     # Zustand — journey state, status flags
│   └── lib/
│       └── indexeddb.ts        # offline journey cache
├── Dockerfile                  # nginx + built assets
└── vite.config.ts
```

**Polling behaviour:**
- `useJourney.ts` polls `GET /journeys/{id}/summary` every 30s (foreground)
- Page Visibility API reduces to 90s when tab is hidden
- On failed poll: render stale IndexedDB data, show `lastUpdatedAt` timestamp

---

## 5. Data Flow

### Journey creation

```
User submits train number + destination
  → POST /reroute (API key header)
  → Go: validate input → call db.transport.rest
  → Go: map HAFAS response → internal Journey model
  → Go: apply DB-only operator filter
  → Go: BFS routing → rank alternatives by ETA → buffer → risk
  → Go: write Journey to Postgres + cache in Redis (TTL 2h)
  → Go: start poller goroutine for journeyId
  → Response: journeyId + ranked alternatives list
  → React: navigate to AlternativesScreen
```

### Active journey monitoring

```
User selects alternative → React stores journeyId in Zustand
  → useJourney.ts polls GET /journeys/{id}/summary every 30s
  → Go: Redis hit → return summary (fast path)
  → React: Zustand update → SummaryHeader re-renders

Background poller goroutine (Go, per journey):
  → every 45s: fetch fresh data from db.transport.rest
  → recalculate ETA, buffer, status, criticalTransfer, alternativeAvailable
  → write delta to Redis → async flush to Postgres
  → next frontend poll sees updated summary
```

### Offline degradation

```
Poll fails
  → useOfflineState detects network loss
  → render last known summary from IndexedDB
  → show "Zuletzt aktualisiert vor X Minuten" in SummaryHeader
  → journey stays visible, no crash, no blank screen
```

### Re-routing trigger

```
Poller detects criticalTransfer=true or status=critical
  → run BFS again with current realtime data
  → better alternative found → set alternativeAvailable=true in Redis
  → next frontend poll → SummaryHeader shows warning card
  → user taps → AlternativesScreen with updated alternatives
```

---

## 6. Persistence Strategy

| Store | Contents | TTL / Lifecycle |
|-------|----------|-----------------|
| Redis | Active Journey state (summary, legs, status flags) | 2h TTL per journeyId |
| Postgres | All journeys (full model, history) | Kept indefinitely; GC job removes entries > 6h old |
| IndexedDB | Last known summary per journeyId | Persists until user clears or new journey starts |

**Recovery path:** Redis evicts journey → next poll falls through to Postgres → reconstructs from stored model + fresh db.transport.rest call. No data loss.

---

## 7. MVP Scope

### V1 — must ship

- Start screen: train number + destination, iAmOnThisTrain toggle
- Train number validation via db.transport.rest
- POST /reroute → ranked alternatives list (ETA, buffer, risk badges)
- Companion screen: sticky summary header + Perlschnur timeline
- Adaptive polling (30s foreground / 90s background tab)
- DB-only operator filter (default ON, user-toggleable)
- status: ok / critical / failed + criticalTransfer + alternativeAvailable flags
- Offline: stale IndexedDB render + lastUpdatedAt indicator
- PWA manifest + service worker (installable)
- Docker Compose: `docker compose up` runs full stack
- API key auth + IP-based rate limiting

### V2 — next iteration

- Von/Nach secondary start flow
- Filter sheet: max transfers, safety level (aggressive / normal / cautious)
- Re-routing suggestion card in companion header
- Journey history view
- Plausibility dialog ("Wir konnten nicht sicher feststellen, dass du in diesem Zug bist")

### V3+ — later

- Historical delay models + risk scoring
- RAPTOR routing engine (swap behind RoutingEngine interface)
- RIS integration
- Learned user preferences
- Push notifications for critical status changes
- Automatic route switching

### Exit criteria for MVP

1. User can go from train number → alternatives → active companion in < 30s
2. Companion updates live without manual refresh
3. App renders usably offline with stale data
4. `docker compose up` starts clean stack with no manual steps

---

## 8. Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| db.transport.rest instability / undocumented rate limits | High | High | Cache in Redis, graceful stale fallback, expose `lastUpdatedAt` |
| HAFAS data quality (wrong delays, missing realtime) | High | Medium | Plausibility checks in `hafas/mapper.go`, mark data confidence in Journey model |
| Operator name string inconsistency (DB filter misses variants) | Medium | Medium | Normalize operator strings in `hafas/filter.go`, maintain allow-list with known variants |
| Goroutine leak (poller never cancelled) | Medium | High | Context cancellation on TTL expiry + Postgres GC job for journeys > 6h |
| PWA polling on bad mobile network drains battery | Medium | Medium | Page Visibility API pause + adaptive interval backoff |
| db.transport.rest changes API schema | Low | High | `hafas/mapper.go` isolation — internal Journey model unchanged |
| Open source abuse hammering upstream API | Medium | Medium | Per-key + IP rate limiting + global outbound rate limit to db.transport.rest |

**Highest risk:** db.transport.rest has no SLA. Design principle: degrade gracefully — stale data shown honestly beats error screens.

---

## 9. Open Questions (not blocking MVP)

- `GET /journeys/{id}/details` delta structure: what minimal diff format does the Perlschnur need? Defer to frontend implementation phase.
- Exact operator allow-list: needs empirical testing against live db.transport.rest responses to catch all DB operator name variants.
- GC job implementation: cron goroutine in Go or Postgres scheduled job?
