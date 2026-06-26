---
id: reference
title: API reference
sidebar_position: 1
---

# API reference

`backend/openapi.yaml` (OpenAPI 3.1) is the source of truth. Frontend TypeScript types are generated from it; CI fails on drift.

## Browse interactively

```bash
# Scalar (recommended)
npx @scalar/cli serve backend/openapi.yaml

# Swagger UI
docker run --rm -p 8000:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v "$PWD/backend/openapi.yaml:/spec/openapi.yaml" \
  swaggerapi/swagger-ui

# Redoc
npx redocly preview-docs backend/openapi.yaml
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/journeys` | Create journey, start poller, compute initial alternatives |
| `GET` | `/v1/journeys/{id}` | Full journey (summary + legs + stops). Initial load, not polling |
| `DELETE` | `/v1/journeys/{id}` | Terminate, stop poller |
| `GET` | `/v1/journeys/{id}/summary` | Compact status — poll every 30 s with `If-None-Match` |
| `GET` | `/v1/journeys/{id}/legs` | Leg + stop data for timeline |
| `GET` | `/v1/journeys/{id}/alternatives` | Ranked alternatives |
| `POST` | `/v1/journeys/{id}/alternatives` | Force recomputation — `202 Accepted` |
| `GET` | `/v1/trains/{number}` | Validate train, return origin/destination/status |
| `GET` | `/v1/stations?q=` | Station autocomplete (Valkey 5 min cache) |
| `GET` | `/health` | Liveness — `200` while alive |
| `GET` | `/readyz` | Readiness — `200`/`503` with Valkey/Postgres/HAFAS status |
| `GET` | `/metrics` | Prometheus (blocked by Nginx in prod) |

## `POST /v1/journeys`

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

| Code | Meaning |
|------|---------|
| `201` | Created |
| `400` | Invalid body (`urn:verspbegl:error:validation`) |
| `404` | No route (`urn:verspbegl:error:no-route`) |
| `429` | Rate limit (`Retry-After`) |
| `502` | HAFAS upstream |
| `503` | At capacity (`MAX_ACTIVE_JOURNEYS`), `Retry-After` |

## `GET /v1/journeys/{id}/summary`

Polling endpoint. Always send `If-None-Match` for 304 fast-path.

```http
GET /v1/journeys/jrn_01j2k3m4n5p6q7r8/summary HTTP/1.1
If-None-Match: "MTA6Mw"
```

```http
HTTP/1.1 304 Not Modified
ETag: "MTA6Mw"
Cache-Control: no-store
```

On change:

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

Order: `(etaUtc ASC, transferBufferMinutes DESC, legCount ASC)`. Max 5.

## `GET /readyz`

```json
{
  "status": "ok",
  "checks": { "valkey": "ok", "postgres": "ok", "hafas": "ok" }
}
```

Impaired subsystem → `503` + problem detail:

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

LB: `/readyz` for routing, `/health` for liveness only.
