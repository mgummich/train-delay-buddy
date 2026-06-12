---
id: caching
title: Caching strategy
sidebar_position: 5
---

# Caching strategy

The system uses five distinct cache layers. Each has a different consistency requirement and a different invalidation strategy. Getting them wrong is a leading cause of "stale data" bugs.

## The five layers

| # | Layer | TTL | What is cached | Invalidation |
|---|-------|-----|----------------|--------------|
| 1 | **Browser memory** (TanStack Query) | 30 s for summary, 0 s for alternatives | API responses | `staleTime` expiry, manual `invalidateQueries` |
| 2 | **Browser disk** (Nginx `Cache-Control`) | 1 year for hashed assets, `no-cache` for `index.html` and API | Static assets | Hashed filename change |
| 3 | **Service worker** (Workbox runtime cache) | network-only for live data, cache-first for assets | Static assets + offline fallback | New SW activation |
| 4 | **Redis L1** | journey TTL (default 2 h), 5 min for station search | Full journey JSON, ETag counter | Poller writes, key expiry |
| 5 | **Postgres L2** | persistent until `terminated_at` is set | Canonical journey row | DELETE (manual or janitor GC) |

## Why ETags everywhere

The expensive part of polling is not the JSON serialization — it is sending the payload over the wire. By making the *client* present `If-None-Match` on every poll, we shift the freshness decision to the backend, which already has the up-to-date `etag_counter` in Redis.

The ETag is a stable, monotonic identifier:

```
ETag = base64(etag_epoch || etag_counter)
       ↑           ↑              ↑
       │           │              └─ bumped on every state change
       │           └─ bumped on cold restart (Redis was empty)
       └─ ensures cross-instance uniqueness
```

The frontend stores the last-seen ETag in its TanStack Query cache. When the response is 304, no state changes; when it is 200, the new ETag is captured for the next round.

## Redis key layout

| Key | Type | Value | TTL |
|-----|------|-------|-----|
| `journey:{id}` | string (JSON) | Full journey snapshot | `JOURNEY_TTL_HOURS` |
| `journey:{id}:etag` | string | "`epoch:counter`" | `JOURNEY_TTL_HOURS` |
| `journey:{id}:lock` | string | host:pid acquiring it | 25 s |
| `stations:{q}` | string (JSON) | Up to 10 station results | 5 min |
| `idem:{install-id}:{key}` | string (JSON) | Replayable response body | 10 min |
| `ratelimit:install:{id}` | sliding window counter (Lua script) | request count | 1 min sliding |
| `ratelimit:ip:{ip}` | sliding window counter | request count | 1 min sliding |

## Postgres ↔ Redis consistency

The system is **Redis-first** for reads of active journeys. Writes go to Redis and Postgres in this order:

```
poller.tick():
  ...
  if changed {
      WRITE to Redis  (SET journey:{id} new_state, EX ttl)
      WRITE to Postgres (UPDATE journeys SET ...)
  }
```

If the process crashes after the Redis write but before Postgres, the *Redis value is the truth* until its TTL expires. The next process to handle this journey will read Redis, find the latest state, and continue. The Postgres row eventually catches up on the next successful tick (or is reconciled by the janitor).

In the much rarer case of a Postgres write succeeding but Redis failing (because Redis was being restarted), the next read falls through to Postgres and refills Redis. The data is correct; the only cost is one Postgres read.

## Cache stampedes

Two protections:

- **Per-journey Redis lock** (25 s TTL). Only one poller can be ticking a given journey at a time. If a second instance picks up the same journey (e.g. during a rolling deploy), it sees the lock and skips this round.
- **HAFAS request coalescing**. A `coalescer` in `internal/hafas` deduplicates concurrent `tripUpdate(tripId)` calls — the first caller fetches; subsequent callers within the same request hash subscribe to the in-flight promise.

## Frontend cache invalidation rules

| Trigger | Action |
|---------|--------|
| `POST /v1/journeys` (success) | Set query data for the new journey directly (skip a redundant fetch) |
| `POST /v1/journeys/{id}/switch` | Invalidate `journey(id)` and `alternatives(id)`; trigger immediate refetch |
| `DELETE /v1/journeys/{id}` | Remove all queries with prefix `journey(id)`; clear Zustand `journeyId` |
| `summary.alternativeAvailable` flips to `true` | Invalidate `alternatives(id)` |
| `summary.status` becomes `CRITICAL` or `INFEASIBLE` | Show modal; do not invalidate (let the next poll pick it up) |
| Network reconnects | TanStack Query `onlineManager` triggers refetch of all `stale` queries |

## Nginx cache headers

See `nginx/nginx.conf`. The key rules:

```nginx
# index.html — never cached
location = /index.html { add_header Cache-Control "no-cache, no-store, must-revalidate" always; }

# Hashed assets — immutable
location ~* \.(js|css|woff2|png|svg|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable" always;
}

# API — never cached (proxied to backend)
location /v1/ { proxy_pass http://backend:8080; expires -1; }
```

This combination guarantees that a new deploy is picked up on the next page load (because `index.html` is always fresh) while still benefiting from year-long caching of hashed assets.
