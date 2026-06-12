---
id: deployment
title: Production deployment
sidebar_position: 1
---

# Production deployment

The hardened `docker-compose.yml` (without the dev override) ships a production-ready stack:

```bash
docker compose -f docker-compose.yml up -d
```

## What runs in production

| Service | Details |
|---------|---------|
| `nginx` | Port 80 — serves the built frontend, proxies `/v1/*` and `/health` to backend, blocks `/metrics` |
| `backend` | Statically compiled Go binary, 512 MB / 1 CPU limit, migrations apply on start |
| `postgres` | Named volume `postgres_data`, survives container restarts |
| `valkey` | 256 MB volatile-LRU, data in memory only |

## Pre-deployment checklist

- [ ] **`POSTGRES_PASSWORD`** is set in `.env` and strong (e.g. `openssl rand -base64 32`). Never `vbb/vbb`.
- [ ] **`CORS_ALLOWED_ORIGINS`** is set to your production frontend origin — or left empty if same-origin via Nginx.
- [ ] **`LOG_LEVEL=WARN`** to reduce log volume in steady state.
- [ ] **TLS** terminator in front of Nginx (Caddy, Traefik, Cloud LB, etc.). The app does not handle TLS itself.
- [ ] **Persistent volume** for `postgres_data` is on durable storage (not ephemeral container disk).
- [ ] **Backups** for Postgres are scheduled and tested (see [Database → Backups](../database#backups-and-restore)).
- [ ] **Monitoring** scrapes `/metrics` on the internal network and alerts on the key SLOs (see [Monitoring](./monitoring)).
- [ ] **Readiness probe** on the load balancer points at `/readyz`, not `/health`.

## TLS via Caddy

A minimal Caddy in front of Nginx:

```docker-compose
services:
  caddy:
    image: caddy:2.8-alpine
    ports: ["443:443", "80:80"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [nginx]
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
```

```Caddyfile
app.example.com {
    reverse_proxy nginx:80
}
```

Caddy will request and renew Let's Encrypt certs automatically. The internal Nginx no longer needs to listen on the host's port 80 — drop the public `ports` mapping.

## Capacity planning

Defaults are tuned for a single-instance deployment serving up to ~2000 concurrent active journeys. Each active journey:

- Consumes one goroutine (≈ 8 KB stack, GC-free 30 s loop).
- Generates ~2 HAFAS round-trips per minute (one tick × ~2 leg-updates per tick).
- Owns one Valkey key (full journey JSON, typically 5–20 KB) and one Postgres row.

At 2000 active journeys:

- Steady-state Valkey memory: 30–60 MB (well below the 256 MB cap).
- Steady-state HAFAS QPS: ~70/s on average, smoothed by the worker pool (default cap 50).
- Steady-state Postgres write QPS: ≤ 70/s (most ticks produce no diff).

To scale beyond a single instance, see "Horizontal scaling" below.

## Horizontal scaling

A single backend instance is the simplest deployment. To run multiple instances behind a load balancer:

1. **Stickiness is not required** — handlers are stateless. All journey state lives in Valkey.
2. **Poller ownership** must be coordinated. Without coordination, two instances would tick the same journey. The simplest scheme: each instance computes `instance_id % N == journey_hash % N` and only owns a journey if the modulus matches. On rolling deploys, brief overlap is harmless thanks to the per-journey Valkey lock.
3. **Postgres connection pooling**: `DB_MAX_OPEN_CONNS × instance_count` must fit within Postgres's `max_connections`. Tune `DB_MAX_OPEN_CONNS` down per-instance as you scale out.
4. **HAFAS rate limit**: the public proxy is shared across instances. If you scale to many instances, host your own HAFAS proxy.

## Deploy strategies

### Rolling deploy (blue/green via the orchestrator)

```bash
docker compose pull backend
docker compose up -d --no-deps --build backend
```

`depends_on.condition: service_healthy` ensures dependent services wait for the new backend to pass its health check before traffic flows. Old container drains in-flight requests during the 10-second graceful shutdown window before being killed.

### Stop-and-restart

```bash
docker compose down
docker compose up -d --build
```

Cheaper, ~5 seconds of unavailability. Fine for low-traffic deployments.

## Rollback

If a deploy goes bad:

```bash
# Pin to the previous image tag
docker compose pull backend
docker compose up -d backend
```

For schema migrations: forward-only is the convention. If a migration is bad, write a new migration that undoes it; never roll back applied migrations.

## Secret rotation

`POSTGRES_PASSWORD` rotation:

```bash
# 1. Set the new password in Postgres
docker compose exec postgres psql -U vbb postgres -c \
  "ALTER USER vbb WITH PASSWORD 'new-strong-password'"

# 2. Update .env on the host
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=new-strong-password/' .env

# 3. Restart backend (Postgres can stay up)
docker compose up -d --no-deps backend
```

No downtime if you do this fast — the backend's pool reconnects on the next query.
