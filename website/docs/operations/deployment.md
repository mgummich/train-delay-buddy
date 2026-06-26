---
id: deployment
title: Production deployment
sidebar_position: 1
---

# Production deployment

Hardened `docker-compose.yml` (no dev override):

```bash
docker compose -f docker-compose.yml up -d
```

## What runs

| Service | Details |
|---------|---------|
| `nginx` | Port 80 — serves frontend, proxies `/v1/*` + `/health`, blocks `/metrics` |
| `backend` | Static Go binary, 512 MB / 1 CPU, migrations on start |
| `postgres` | Named volume `postgres_data` |
| `valkey` | 256 MB volatile-LRU, in-memory only |

## Pre-deploy checklist

- [ ] **`POSTGRES_PASSWORD`** strong (`openssl rand -base64 32`). Never `vbb/vbb`.
- [ ] **`CORS_ALLOWED_ORIGINS`** = prod frontend origin, or empty for same-origin via Nginx.
- [ ] **`LOG_LEVEL=WARN`** in steady state.
- [ ] **TLS terminator** in front of Nginx (Caddy/Traefik/Cloud LB). App does not do TLS.
- [ ] **Persistent volume** for `postgres_data` on durable storage.
- [ ] **Backups** scheduled + tested ([Database → Backups](../database#backups)).
- [ ] **Monitoring** scrapes `/metrics` on internal network + alerts on SLOs ([Monitoring](./monitoring)).
- [ ] **LB readiness probe** → `/readyz`, not `/health`.

## TLS via Caddy

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

Caddy auto-renews Let's Encrypt. Drop nginx's public port 80 mapping.

## Capacity

Defaults tuned for single-instance ~2000 concurrent active journeys. Each journey:

- ~8 KB goroutine stack, 30 s loop.
- ~2 HAFAS round-trips/min.
- 1 Valkey key (5–20 KB JSON), 1 Postgres row.

At 2000 active:
- Valkey: 30–60 MB (under 256 MB cap).
- HAFAS QPS: ~70/s avg, smoothed by worker pool (cap 50).
- Postgres writes: ≤70/s (most ticks no diff).

## Horizontal scaling

1. **No stickiness** — handlers stateless. State in Valkey.
2. **Poller ownership** must coordinate. Simple: `instance_id % N == journey_hash % N`. Brief overlap on rolling deploys is harmless (per-journey Valkey lock).
3. **Postgres pool**: `DB_MAX_OPEN_CONNS × instances` must fit `max_connections`. Tune down per instance as you scale.
4. **HAFAS rate limit**: public proxy is shared. Many instances → host your own.

## Deploy

### Rolling

```bash
docker compose pull backend
docker compose up -d --no-deps --build backend
```

`depends_on.condition: service_healthy` waits for new backend to pass health before traffic. Old container drains in-flight in the 10 s shutdown window.

### Stop-and-restart

```bash
docker compose down
docker compose up -d --build
```

Cheaper, ~5 s unavailability. Fine for low traffic.

## Rollback

```bash
docker compose pull backend     # pin previous tag
docker compose up -d backend
```

**Migrations are forward-only.** If a migration is bad, write a new one undoing it — never roll back applied migrations.

## Secret rotation

```bash
# 1. Update Postgres
docker compose exec postgres psql -U vbb postgres -c \
  "ALTER USER vbb WITH PASSWORD 'new-strong-password'"

# 2. Update .env
sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=new-strong-password/' .env

# 3. Restart backend only
docker compose up -d --no-deps backend
```

No downtime — backend's pool reconnects on next query.
