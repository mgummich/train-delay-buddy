---
id: health-checks
title: Health checks
sidebar_position: 3
---

# Health checks

Two endpoints, two purposes:

| Endpoint | Purpose | What to use it for |
|----------|---------|--------------------|
| `GET /health` | **Liveness** — "the process is alive" | Container restart trigger |
| `GET /readyz` | **Readiness** — "the process can serve traffic right now" | Load-balancer routing decision |

## `/health`

Returns `200 OK` whenever the process is running. It never depends on downstream subsystems — it would be wrong to restart the container because Redis is briefly slow.

```http
GET /health HTTP/1.1
```

```json
{ "status": "ok" }
```

Use it as the Docker `HEALTHCHECK`, the Kubernetes `livenessProbe`, and the Compose health check. The container should be restarted only when this endpoint stops responding (which means the process is wedged or has crashed).

## `/readyz`

Returns `200 OK` only when the backend can actually serve user requests. It probes:

- **Redis** — does `PING` return within 200 ms?
- **Postgres** — does `SELECT 1` return within 500 ms?
- **HAFAS** — is the circuit breaker closed (or half-open with the last probe succeeded)?

```http
GET /readyz HTTP/1.1
```

```json
{
  "status": "ok",
  "checks": {
    "redis": "ok",
    "postgres": "ok",
    "hafas": "ok"
  }
}
```

When something is impaired, the response is `503 Service Unavailable` and the impaired key carries detail:

```json
{
  "status": "degraded",
  "checks": {
    "redis": "ok",
    "postgres": "ok",
    "hafas": { "state": "circuit-open", "since": "2026-06-12T08:14:22Z" }
  }
}
```

Note that `hafas` being down does **not** make the backend unable to serve all requests — `GET /v1/journeys/{id}/summary` still works from cached state. The load balancer's behaviour is a policy choice:

- **Strict**: route away from any instance reporting `degraded`. Best when you have many instances and one being slow doesn't matter.
- **Permissive**: route to any instance with status ∈ {`ok`, `degraded`}, and only drain on full `down` (Postgres or Redis unreachable). Best for small deployments where degraded availability is better than no availability.

## Compose health checks

Each service in the production Compose file defines a health check:

```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 15s
```

The `start_period` gives the backend 15 seconds to apply migrations and warm up Redis before the orchestrator counts failures.

Postgres:

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U vbb"]
    interval: 5s
```

Redis:

```yaml
redis:
  healthcheck:
    test: ["CMD", "valkey-cli", "ping"]
    interval: 5s
```

Nginx:

```yaml
nginx:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost/health"]
```

Nginx's health check proxies to the backend, so a healthy Nginx implies a healthy backend.

## Kubernetes probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 3
  timeoutSeconds: 2

readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
  timeoutSeconds: 2

startupProbe:
  httpGet:
    path: /health
    port: 8080
  failureThreshold: 30
  periodSeconds: 2
```

The `startupProbe` gives slow Postgres migrations up to 60 seconds before the liveness probe starts holding the container accountable.

## Manual verification

```bash
# Liveness — always 200 if the process is alive
curl -i http://localhost:8080/health

# Readiness — 200 or 503 with subsystem detail
curl -s http://localhost:8080/readyz | jq

# Force-check via nginx (which proxies /health)
curl -i http://localhost/health
```
