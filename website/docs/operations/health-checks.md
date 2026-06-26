---
id: health-checks
title: Health checks
sidebar_position: 3
---

# Health checks

Two endpoints, two purposes:

| Endpoint | Purpose | Use for |
|----------|---------|---------|
| `GET /health` | Liveness — process is alive | Container restart trigger |
| `GET /readyz` | Readiness — can serve right now | LB routing |

## `/health`

`200 OK` whenever the process runs. Never depends on downstream — restarting because Valkey is briefly slow would be wrong.

```http
GET /health HTTP/1.1
```
```json
{ "status": "ok" }
```

Use as Docker `HEALTHCHECK`, k8s `livenessProbe`, Compose health check. Restart only when this stops responding (process wedged / crashed).

## `/readyz`

`200 OK` only when backend can serve. Probes:

- **Valkey** — `PING` < 200 ms
- **Postgres** — `SELECT 1` < 500 ms
- **HAFAS** — breaker closed (or half-open with last probe ok)

```json
{
  "status": "ok",
  "checks": { "valkey": "ok", "postgres": "ok", "hafas": "ok" }
}
```

Impaired → `503` + detail on the impaired key:

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

HAFAS down does **not** kill all requests — `GET /v1/journeys/{id}/summary` still serves cached state. LB policy is your call:

- **Strict:** drain any `degraded`. Best with many instances.
- **Permissive:** route to `ok` ∪ `degraded`; drain only on full down (Postgres/Valkey unreachable). Best for small deploys where degraded > none.

## Compose

```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s     # migrations + Valkey warm-up

postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U vbb"]
    interval: 5s

valkey:
  healthcheck:
    test: ["CMD", "valkey-cli", "ping"]
    interval: 5s

nginx:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost/health"]
```

Nginx proxies `/health` to backend — healthy Nginx implies healthy backend.

## Kubernetes

```yaml
livenessProbe:
  httpGet: { path: /health, port: 8080 }
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 3
  timeoutSeconds: 2

readinessProbe:
  httpGet: { path: /readyz, port: 8080 }
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
  timeoutSeconds: 2

startupProbe:
  httpGet: { path: /health, port: 8080 }
  failureThreshold: 30
  periodSeconds: 2
```

`startupProbe` gives slow migrations up to 60 s before liveness starts holding it accountable.

## Manual verification

```bash
curl -i http://localhost:8080/health         # liveness — always 200 if alive
curl -s http://localhost:8080/readyz | jq    # readiness — 200 or 503
curl -i http://localhost/health              # via nginx
```
