---
id: reference
title: API reference
sidebar_position: 1
---

# API reference

The OpenAPI 3.1 spec at `backend/openapi.yaml` is the source of truth. The frontend's TypeScript types are generated from it; CI fails if they diverge.

## Browsing the spec interactively

```bash
# Scalar (recommended — modern UI)
npx @scalar/cli serve backend/openapi.yaml

# Or Swagger UI
docker run --rm -p 8000:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v "$PWD/backend/openapi.yaml:/spec/openapi.yaml" \
  swaggerapi/swagger-ui

# Or Redoc
npx redocly preview-docs backend/openapi.yaml
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/journeys` | Create a journey, start the poller, compute initial alternatives |
| `GET` | `/v1/journeys/{id}` | Full journey: summary + legs + stops. Use for the initial load, not for polling |
| `DELETE` | `/v1/journeys/{id}` | Terminate monitoring, stop the poller |
| `GET` | `/v1/journeys/{id}/summary` | Compact status — poll every 30 s with `If-None-Match` |
| `GET` | `/v1/journeys/{id}/legs` | Leg + stop data for the timeline view |
| `GET` | `/v1/journeys/{id}/alternatives` | Ranked alternative routes |
| `POST` | `/v1/journeys/{id}/alternatives` | Trigger fresh recomputation — returns `202 Accepted` immediately |
| `POST` | `/v1/journeys/{id}/switch` | Switch the active journey to a chosen alternative |
| `GET` | `/v1/trains/{number}` | Validate a train number, return origin/destination/status |
| `GET` | `/v1/stations?q=` | Station-name autocomplete (Valkey-cached 5 min) |
| `GET` | `/health` | Liveness probe — `200` while the process is alive |
| `GET` | `/readyz` | Readiness probe — `200`/`503` with Valkey/Postgres/HAFAS status |
| `GET` | `/metrics` | Prometheus metrics (blocked behind Nginx in production) |

## `POST /v1/journeys`

Create a new journey.

```http
POST /v1/journeys HTTP/1.1
Host: localhost:8080
Content-Type: application/json
X-Install-Id: 0193b88e-3a1a-7e64-9f4a-2b1c0d3e4f5a
Idempotency-Key: 9f4a-create-2026-06-12T08:00:00Z

{
  "trainNumber": "ICE 123",
  "destinationId": "8000105",
  "filters": {
    "dbOnly": true,
    "safetyLevel": "medium",
    "maxTransfers": 3
  }
}
```

```http
HTTP/1.1 201 Created
Location: /v1/journeys/jrn_01j2k3m4n5p6q7r8
ETag: "MTA6Mw"
Content-Type: application/json

{
  "id": "jrn_01j2k3m4n5p6q7r8",
  "summary": {
    "status": "ON_TIME",
    "etaUtc": "2026-06-12T10:42:00Z",
    "alternativeAvailable": false,
    "dataConfidence": "high",
    "nextStep": { "type": "DEPARTURE", "stationName": "Frankfurt(M) Hbf", "platform": "8" }
  },
  "legs": [ /* ... */ ]
}
```

### Status codes

| Code | Meaning |
|------|---------|
| `201` | Journey created |
| `400` | Invalid body — see `urn:verspbegl:error:validation` problem |
| `404` | No route possible — `urn:verspbegl:error:no-route` |
| `429` | Rate limit exceeded — `Retry-After` header set |
| `502` | HAFAS upstream error |
| `503` | At capacity (`MAX_ACTIVE_JOURNEYS` reached) — `Retry-After` set |

## `GET /v1/journeys/{id}/summary`

The polling endpoint. Always call with `If-None-Match` to leverage the 304 fast-path.

```http
GET /v1/journeys/jrn_01j2k3m4n5p6q7r8/summary HTTP/1.1
If-None-Match: "MTA6Mw"
```

```http
HTTP/1.1 304 Not Modified
ETag: "MTA6Mw"
Cache-Control: no-store
```

When state changes:

```http
HTTP/1.1 200 OK
ETag: "MTA6NA"
Content-Type: application/json

{
  "status": "DELAYED",
  "etaUtc": "2026-06-12T10:48:00Z",
  "etaDeltaMinutes": 6,
  "alternativeAvailable": true,
  "dataConfidence": "high",
  "nextStep": { "type": "TRANSFER", "stationName": "Mannheim Hbf", "platform": "3" }
}
```

## `GET /v1/journeys/{id}/alternatives`

```http
GET /v1/journeys/jrn_01j2k3m4n5p6q7r8/alternatives HTTP/1.1
```

```json
[
  {
    "id": "alt_01j2k3m4...",
    "etaUtc": "2026-06-12T10:39:00Z",
    "timeGainMinutes": 9,
    "transferBufferMinutes": 8,
    "risk": "low",
    "legs": [ /* ... */ ]
  }
]
```

Ordering is by `(etaUtc ASC, transferBufferMinutes DESC, legCount ASC)`. Maximum 5 results.

## `POST /v1/journeys/{id}/switch`

```http
POST /v1/journeys/jrn_.../switch HTTP/1.1
Content-Type: application/json

{ "alternativeId": "alt_01j2k3m4..." }
```

Returns the new summary + legs on success. Fails with `409 alternative-expired` if the chosen ID is not in the current alternatives set (the user took too long to decide and the list has been replaced).

## `GET /readyz`

```json
{
  "status": "ok",
  "checks": {
    "valkey": "ok",
    "postgres": "ok",
    "hafas": "ok"
  }
}
```

When any subsystem is impaired, the response code is `503` and the corresponding key reports a problem detail:

```json
{
  "status": "degraded",
  "checks": {
    "valkey": "ok",
    "postgres": "ok",
    "hafas": { "state": "circuit-open", "since": "2026-06-12T08:14:22Z" }
  }
}
```

Configure your load balancer to use `/readyz` for routing decisions and `/health` for liveness only.
