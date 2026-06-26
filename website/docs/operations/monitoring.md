---
id: monitoring
title: Monitoring and metrics
sidebar_position: 2
---

# Monitoring and metrics

Backend exposes Prometheus metrics at `GET /metrics` (standard text format).

```bash
curl http://localhost:8080/metrics | head -40
```

:::info `/metrics` is private
Production Nginx blocks `/metrics` (`deny all`). Scrape on an internal network — directly against backend `:8080`.
:::

## Scrape config

```yaml
scrape_configs:
  - job_name: verspaetungsbegleiter
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["backend:8080"]
```

Kubernetes: `PodMonitor` / `ServiceMonitor` on port `8080`.

## Key metrics

### Request

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `http_requests_total` | counter | `method`, `path`, `status` | Per completed request |
| `http_request_duration_seconds` | histogram | `method`, `path` | Latency per route |

### Journey lifecycle

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `journeys_created_total` | counter | — | Per `POST /v1/journeys` success |
| `journeys_terminated_total` | counter | `reason` (`user`/`ttl`/`error`) | Per termination |
| `journeys_active` | gauge | — | Current poller count |
| `journeys_capacity_rejections_total` | counter | — | Per 503-at-capacity |

### Poller

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `poller_ticks_total` | counter | `journey_id_bucket` (low-cardinality) | Per tick |
| `poller_tick_duration_seconds` | histogram | — | Per-tick wall time |
| `poller_errors_total` | counter | `phase` (`fetch`/`apply`/`persist`) | Failed ticks |
| `poller_diff_writes_total` | counter | — | Ticks producing ETag bump |

### HAFAS

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `hafas_requests_total` | counter | `endpoint`, `status` | Per request |
| `hafas_request_duration_seconds` | histogram | `endpoint` | Latency |
| `hafas_breaker_state` | gauge | — | 0=closed, 1=half-open, 2=open |
| `hafas_worker_queue_depth` | gauge | — | Queue depth |
| `hafas_worker_pool_inflight` | gauge | — | Busy workers |
| `hafas_worker_pool_rejections_total` | counter | — | `Submit()` failed |

### Cache

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `cache_hits_total` | counter | `cache` (`valkey`/`idempotency`/`stations`) | Hits |
| `cache_misses_total` | counter | `cache` | Misses |
| `valkey_command_duration_seconds` | histogram | `command` | Client latency |

### Database

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `db_query_duration_seconds` | histogram | `operation` | pgx latency |
| `db_pool_open_conns` | gauge | — | Open conns |
| `db_pool_idle_conns` | gauge | — | Idle conns |

## SLOs

| SLO | Target | PromQL |
|-----|--------|--------|
| Summary p99 latency | < 50 ms | `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{path="/v1/journeys/{id}/summary"}[5m]))` |
| Poller success rate | > 99% | `1 - (rate(poller_errors_total[5m]) / rate(poller_ticks_total[5m]))` |
| HAFAS error budget | < 1% | `rate(hafas_requests_total{status="error"}[5m]) / rate(hafas_requests_total[5m])` |
| Breaker open time | < 5%/day | `avg_over_time(hafas_breaker_state[24h]) > 1.9` |

## Alerts

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
      description: "Backend short-circuiting HAFAS. Check /readyz + proxy."

  - alert: PollerErrorRateHigh
    expr: rate(poller_errors_total[5m]) / rate(poller_ticks_total[5m]) > 0.05
    for: 5m
    labels: { severity: warning }
    annotations: { summary: "Poller error rate above 5%" }

  - alert: AtCapacity
    expr: increase(journeys_capacity_rejections_total[5m]) > 0
    labels: { severity: warning }
    annotations:
      summary: "POST /v1/journeys returning 503"
      description: "MAX_ACTIVE_JOURNEYS reached. Scale out or raise the cap."

  - alert: BackendDown
    expr: up{job="verspaetungsbegleiter"} == 0
    for: 1m
    labels: { severity: critical }
```

## Dashboards

Minimal Grafana coverage:

1. **Request rate + latency** (RED method).
2. **Active journeys** + capacity util.
3. **HAFAS** — rate, errors, breaker.
4. **Poller** — tick, error, diff-write rate.
5. **DB pool** — open / idle / waiting.
6. **Valkey** — latency, key count, evictions.

Export dashboard JSON to `docs/grafana-dashboard.json` for reproducibility.

## Logs

JSON via `slog`:

| Field | Meaning |
|-------|---------|
| `time` | RFC 3339 |
| `level` | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `msg` | Message |
| `request_id` | UUID, via `X-Request-Id` |
| `journey_id` | On poller + journey-handler logs |
| `err` | On errors |

Search with `jq`:

```bash
docker compose logs backend \
  | jq -r 'select(.level=="ERROR") | "\(.time) \(.request_id // "-") \(.msg) \(.err // "")"'
```

In prod ship logs to your backend via the `logging` driver. Compose uses `json-file` with rotation (`max-size: 10m, max-file: 3`) — safe local default, not for scale.
