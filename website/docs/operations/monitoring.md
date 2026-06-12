---
id: monitoring
title: Monitoring and metrics
sidebar_position: 2
---

# Monitoring and metrics

The backend exposes Prometheus metrics at `GET /metrics` in the standard text format.

```bash
curl http://localhost:8080/metrics | head -40
```

:::info `/metrics` is private
In production the Nginx config blocks `/metrics` (`deny all`). Scrape it on an internal network — directly against the backend container on port 8080.
:::

## Scrape configuration

```yaml
scrape_configs:
  - job_name: verspaetungsbegleiter
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["backend:8080"]
```

For Kubernetes, use a `PodMonitor` or `ServiceMonitor` pointing at the backend pod's `8080` port.

## Key metrics

### Request-level

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `http_requests_total` | counter | `method`, `path`, `status` | One per completed HTTP request |
| `http_request_duration_seconds` | histogram | `method`, `path` | Latency distribution per route |

### Journey lifecycle

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `journeys_created_total` | counter | — | One per `POST /v1/journeys` success |
| `journeys_terminated_total` | counter | `reason` (`user`, `ttl`, `error`) | One per termination |
| `journeys_active` | gauge | — | Current count of pollers |
| `journeys_capacity_rejections_total` | counter | — | One per 503-at-capacity |

### Poller

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `poller_ticks_total` | counter | `journey_id_bucket` (low-cardinality) | One per tick |
| `poller_tick_duration_seconds` | histogram | — | Per-tick wall time |
| `poller_errors_total` | counter | `phase` (`fetch`, `apply`, `persist`) | Failed ticks |
| `poller_diff_writes_total` | counter | — | Ticks that produced an ETag bump |

### HAFAS

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `hafas_requests_total` | counter | `endpoint`, `status` | One per HAFAS request |
| `hafas_request_duration_seconds` | histogram | `endpoint` | HAFAS latency |
| `hafas_breaker_state` | gauge | — | 0 = closed, 1 = half-open, 2 = open |
| `hafas_worker_queue_depth` | gauge | — | Current queue depth |
| `hafas_worker_pool_inflight` | gauge | — | Workers currently busy |
| `hafas_worker_pool_rejections_total` | counter | — | `Submit()` returned false |

### Cache

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `cache_hits_total` | counter | `cache` (`redis`, `idempotency`, `stations`) | Cache hits |
| `cache_misses_total` | counter | `cache` | Cache misses |
| `redis_command_duration_seconds` | histogram | `command` | Redis client latency |

### Database

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `db_query_duration_seconds` | histogram | `operation` | pgx query latency |
| `db_pool_open_conns` | gauge | — | Open connections in the pool |
| `db_pool_idle_conns` | gauge | — | Idle connections |

## SLOs

Recommended starting SLOs:

| SLO | Target | PromQL |
|-----|--------|--------|
| 99th-percentile summary latency | < 50 ms | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{path="/v1/journeys/{id}/summary"}[5m]))` |
| Successful poller tick rate | > 99 % | `1 - (rate(poller_errors_total[5m]) / rate(poller_ticks_total[5m]))` |
| HAFAS error budget | < 1 % | `rate(hafas_requests_total{status="error"}[5m]) / rate(hafas_requests_total[5m])` |
| Circuit breaker open time | < 5 % per day | `avg_over_time(hafas_breaker_state[24h]) > 1.9` |

## Alert rules

```yaml
groups:
- name: verspaetungsbegleiter
  rules:
  - alert: HAFASCircuitOpen
    expr: hafas_breaker_state == 2
    for: 60s
    labels: { severity: warning }
    annotations:
      summary: "HAFAS circuit breaker is open"
      description: "Backend is short-circuiting all HAFAS calls. Check /readyz and HAFAS proxy health."

  - alert: PollerErrorRateHigh
    expr: rate(poller_errors_total[5m]) / rate(poller_ticks_total[5m]) > 0.05
    for: 5m
    labels: { severity: warning }
    annotations:
      summary: "Poller error rate above 5%"

  - alert: AtCapacity
    expr: increase(journeys_capacity_rejections_total[5m]) > 0
    labels: { severity: warning }
    annotations:
      summary: "POST /v1/journeys is returning 503"
      description: "MAX_ACTIVE_JOURNEYS reached. Scale out or raise the cap."

  - alert: BackendDown
    expr: up{job="verspaetungsbegleiter"} == 0
    for: 1m
    labels: { severity: critical }
```

## Dashboards

A minimal Grafana dashboard should cover:

1. **Request rate and latency** — RED method.
2. **Active journeys** + capacity utilization.
3. **HAFAS health** — request rate, error rate, breaker state.
4. **Poller** — tick rate, error rate, diff-write rate.
5. **DB pool** — open vs. idle vs. waiting.
6. **Redis** — command latency, key count, evictions.

Export your dashboard JSON to `docs/grafana-dashboard.json` so reviewers can reproduce it.

## Logs

Structured JSON via `slog`. Each line includes:

| Field | Meaning |
|-------|---------|
| `time` | RFC 3339 timestamp |
| `level` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `msg` | Human-readable message |
| `request_id` | UUID, propagated via `X-Request-Id` |
| `journey_id` | Present on poller and journey-handler logs |
| `err` | Present on errors |

Search example with `jq`:

```bash
docker compose logs backend \
  | jq -r 'select(.level=="ERROR") | "\(.time) \(.request_id // "-") \(.msg) \(.err // "")"'
```

For production, ship logs to your log backend via the `logging` driver. The Compose file uses `json-file` with rotation (`max-size: 10m, max-file: 3`) — a safe local default but not what you want at scale.
