---
id: conventions
title: API conventions
sidebar_position: 2
---

# API conventions

## Authentication and identity

The API has **no user authentication**. Abuse-shaping is achieved via:

- The `X-Install-Id` UUID header, generated on first frontend launch and persisted to IndexedDB (with `localStorage` fallback).
- Rate limiting per `X-Install-Id` and (as fallback) per IP. See `RATE_LIMIT_PER_INSTALL` and `RATE_LIMIT_PER_IP`.
- Capacity-based admission control via `MAX_ACTIVE_JOURNEYS`.

Hosting this publicly means anyone who can reach the API can create journeys. The throttles keep abuse cost-bounded, but if you expose this to the open internet, sit it behind a CDN with bot mitigation.

## Journey ownership

Every per-journey route (`GET/DELETE /v1/journeys/{id}`, summary, legs, alternatives) enforces ownership: the `X-Install-Id` header on the request must match the `install_id` recorded when the journey was created.

On a mismatch — or when the header is absent — the backend returns **404 Not Found** (never 403) to avoid leaking the existence of journeys owned by other installs.

The `JourneyOwnership` middleware (`internal/api/middleware/ownership.go`) performs this check before any handler runs, and attaches the verified journey to the request context so handlers can reuse it without a second store read.

:::info Why 404 instead of 403?
Returning 403 would confirm that a journey with that ID *exists*. Using 404 unconditionally prevents IDOR enumeration — an attacker learns nothing useful from the response.
:::

## Idempotency

`POST /v1/journeys` accepts an `Idempotency-Key` header (any opaque string up to 128 chars). The backend namespaces the cache key as `installID:rawKey` — so two different installs using the same `Idempotency-Key` string never collide, and a replay response from install A can never be delivered to install B.

The first request creates the journey and caches the response in Valkey for 10 minutes. Subsequent requests with the same `(X-Install-Id, Idempotency-Key)` pair return the cached response — even if the underlying request body is different. If the same key is reused with a *different* body hash, the server returns `409 Conflict` with `urn:verspbegl:error:idempotency-conflict`.

Use this to safely retry network-failed POSTs from the frontend without duplicating journeys.

## ETag and `If-None-Match`

`GET /v1/journeys/{id}/summary` is the only ETag-aware endpoint. The frontend's polling loop captures the ETag on every successful 200 and sends it back as `If-None-Match` on the next poll. The backend short-circuits with `304 Not Modified` when nothing has changed.

The ETag is opaque and stable. Do not parse it client-side. Internally it encodes `(epoch, counter)` where:

- `epoch` is a monotonic value set when the journey is first loaded into Valkey (new process, cold cache → new epoch).
- `counter` is bumped on every state mutation.

## Errors — RFC 7807

All error responses use `application/problem+json` ([RFC 7807](https://www.rfc-editor.org/rfc/rfc7807)):

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "urn:verspbegl:error:no-route",
  "title": "No route found",
  "status": 404,
  "detail": "No route from the current location to destination 8000105 satisfies the filters.",
  "instance": "/v1/journeys"
}
```

Type URNs are stable — clients can pattern-match on the `type` field to decide UI behaviour:

| URN | HTTP status | When |
|-----|-------------|------|
| `urn:verspbegl:error:validation` | 400 | Body validation failure (Zod-style) |
| `urn:verspbegl:error:not-found` | 404 | Journey ID does not exist |
| `urn:verspbegl:error:no-route` | 404 | BFS could not find an applicable route |
| `urn:verspbegl:error:alternative-expired` | 409 | The chosen alternative is no longer in the current set |
| `urn:verspbegl:error:rate-limit` | 429 | Per-install or per-IP throttle exceeded |
| `urn:verspbegl:error:at-capacity` | 503 | `MAX_ACTIVE_JOURNEYS` reached |
| `urn:verspbegl:error:hafas-unavailable` | 502/503 | HAFAS upstream failure or circuit-breaker open |
| `urn:verspbegl:error:internal` | 500 | Unexpected — see `X-Request-Id` for log correlation |

## Time and timezones

All timestamps in API payloads are **UTC ISO 8601** with the `Z` suffix:

```json
{ "etaUtc": "2026-06-12T10:42:00Z" }
```

Local-time conversion is the frontend's responsibility. `frontend/src/lib/datetime.ts` formats every timestamp into `Europe/Berlin` using `Intl.DateTimeFormat`.

## Identifiers

| Type | Format | Example |
|------|--------|---------|
| Journey ID | `jrn_<ulid>` | `jrn_01j2k3m4n5p6q7r8` |
| Alternative ID | `alt_<ulid>` | `alt_01j2k3m4...` |
| Leg ID | `leg_<ulid>` | `leg_01j2...` |
| HAFAS station ID | numeric string | `8000105` (Frankfurt Hbf) |
| Train number | as displayed | `ICE 123`, `RE 5`, `S 8` |
| Install ID | UUIDv7 | `0193b88e-3a1a-7e64-9f4a-2b1c0d3e4f5a` |

ULIDs are sortable, monotonic, and 26 characters — they make great primary keys and great log identifiers.

## Pagination

Not currently used. The longest list response is `alternatives` (max 5 items). Station autocomplete returns up to 10 results, sorted by relevance. If you add a list endpoint in the future, follow cursor-based pagination (`?cursor=<opaque>&limit=N`).

## Versioning

The API is versioned with a URL prefix: `/v1/`. Breaking changes will land in `/v2/`. The Go handlers expose only one version per binary — the frontend's typed client also targets one version at a time.

## Request and trace correlation

Every request gets an `X-Request-Id` header (generated server-side if not present; passed through if the client supplied one). It appears in:

- The response headers.
- Every log line touched by the request (via `slog` context).
- The journey row's `last_request_id` column (when a request mutates a journey).

Use it as the first thing you grep for in logs when investigating a user-reported issue.
