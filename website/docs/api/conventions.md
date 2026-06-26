---
id: conventions
title: API conventions
sidebar_position: 2
---

# API conventions

## Auth + identity

**No user accounts.** Abuse shaping via:

- `X-Install-Id` UUID header — generated on first launch, persisted to IndexedDB (localStorage fallback).
- Rate limit per install + IP fallback. See `RATE_LIMIT_PER_INSTALL` / `RATE_LIMIT_PER_IP`.
- Capacity admission via `MAX_ACTIVE_JOURNEYS`.

Public hosting means anyone reachable can create journeys. Throttles cost-bound abuse. For open-internet exposure, put a CDN with bot mitigation in front.

## Journey ownership

Per-journey routes (`GET/DELETE /v1/journeys/{id}`, summary, legs, alternatives) enforce ownership: request `X-Install-Id` must match journey's `install_id`.

Mismatch or missing header → **404 Not Found** (never 403) — avoids leaking journey existence.

`JourneyOwnership` middleware (`internal/api/middleware/ownership.go`) runs before any handler + attaches verified journey to context so handlers skip a second store read.

:::info Why 404 not 403?
403 would confirm the ID exists. Unconditional 404 prevents IDOR enumeration.
:::

## Idempotency

`POST /v1/journeys` accepts `Idempotency-Key` (opaque ≤128 chars). Backend namespaces cache key as `installID:rawKey` — two installs with the same key never collide; install A's replay never reaches install B.

First request creates + caches the response in Valkey for 10 min. Subsequent matching `(X-Install-Id, Idempotency-Key)` return cached response even on different body. Same key + different body hash → `409 Conflict` (`urn:verspbegl:error:idempotency-conflict`).

Use for safe retry of network-failed POSTs without duplicating journeys.

## ETag / `If-None-Match`

`GET /v1/journeys/{id}/summary` is the only ETag-aware endpoint. Frontend captures ETag on each 200, sends as `If-None-Match` next poll. Backend short-circuits with `304 Not Modified` when nothing changed.

ETag is opaque + stable — do not parse client-side. Internally encodes `(epoch, counter)`:

- `epoch` — monotonic, set when journey first loaded into Valkey (new process / cold cache → new epoch).
- `counter` — bumped per mutation.

## Errors — RFC 7807

All errors use `application/problem+json` ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)):

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "urn:verspbegl:error:no-route",
  "title": "No route found",
  "status": 404,
  "detail": "No route from current location to destination 8000105 satisfies the filters.",
  "instance": "/v1/journeys"
}
```

Type URNs are stable — pattern-match for UI behaviour:

| URN | HTTP | When |
|-----|------|------|
| `urn:verspbegl:error:validation` | 400 | Body validation |
| `urn:verspbegl:error:not-found` | 404 | Journey ID doesn't exist |
| `urn:verspbegl:error:no-route` | 404 | BFS found no applicable route |
| `urn:verspbegl:error:alternative-expired` | 409 | Chosen alternative no longer in current set |
| `urn:verspbegl:error:rate-limit` | 429 | Throttle exceeded |
| `urn:verspbegl:error:at-capacity` | 503 | `MAX_ACTIVE_JOURNEYS` reached |
| `urn:verspbegl:error:hafas-unavailable` | 502/503 | HAFAS down / breaker open |
| `urn:verspbegl:error:internal` | 500 | Unexpected — grep `X-Request-Id` |

## Time

All API timestamps are **UTC ISO 8601** with `Z`:

```json
{ "etaUtc": "2026-06-12T10:42:00Z" }
```

Local conversion is frontend responsibility — `frontend/src/lib/datetime.ts` formats to `Europe/Berlin` via `Intl.DateTimeFormat`.

## Identifiers

| Type | Format | Example |
|------|--------|---------|
| Journey ID | `jrn_<ulid>` | `jrn_01j2k3m4n5p6q7r8` |
| Alternative ID | `alt_<ulid>` | `alt_01j2k3m4...` |
| Leg ID | `leg_<ulid>` | `leg_01j2...` |
| HAFAS station ID | numeric string | `8000105` (Frankfurt Hbf) |
| Train number | as displayed | `ICE 123`, `RE 5`, `S 8` |
| Install ID | UUIDv7 | `0193b88e-3a1a-7e64-9f4a-2b1c0d3e4f5a` |

ULIDs are sortable, monotonic, 26 chars — good PKs + log identifiers.

## Pagination

Not used. Longest list is `alternatives` (max 5). Station autocomplete returns ≤10 by relevance. Future list endpoints → cursor-based (`?cursor=<opaque>&limit=N`).

## Versioning

URL prefix: `/v1/`. Breaking changes → `/v2/`. One version per binary; typed client targets one at a time.

## Request + trace correlation

Every request gets `X-Request-Id` (server-generated if absent, else passed through). Appears in:

- Response headers.
- Every log line via `slog` context.
- `last_request_id` column when a request mutates a journey.

First thing to grep when investigating a user issue.
