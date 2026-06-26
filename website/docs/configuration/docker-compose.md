---
id: docker-compose
title: Docker Compose layout
sidebar_position: 2
---

# Docker Compose layout

Two Compose files; Compose v2 merges them automatically from the repo root:

| File | Role |
|------|------|
| `docker-compose.yml` | Production stack: hardened, no exposed DB ports, log rotation, resource limits |
| `docker-compose.override.yml` | Dev overlay: opens ports, mounts source, switches build targets to `dev` |

**Prereq:** `cp .env.example .env` and set `POSTGRES_PASSWORD` (Compose refuses to start without it).

```bash
docker compose up -d                          # dev (with override)
docker compose -f docker-compose.yml up -d    # production-style locally
```

## YAML anchors

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-security: &default-security
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
```

Services use `logging: *default-logging` and `<<: *default-security`. Nginx overrides `cap_drop`/`cap_add` inline (needs extra capabilities).

## Startup ordering

```mermaid
flowchart LR
  postgres([postgres]) -->|healthy| backend([backend])
  valkey([valkey])     -->|healthy| backend
  backend              -->|healthy| nginx([nginx])
```

`depends_on.condition: service_healthy` waits for `healthcheck` to pass. `start_period` gives processes boot time before failures count against `retries`.

## Services

### nginx — reverse proxy + SPA host

- Builds frontend `prod` stage (static build baked into `nginx:1.27-alpine`), mounts `nginx.conf`.
- Listens on `127.0.0.1:80`.
- Proxies `/v1/*`, `/health`, `/readyz` → `backend:8080`. Blocks `/metrics` (403; scraped on internal network).
- SPA fallback: `try_files $uri /index.html`.
- Strict headers: `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `self`-only. HSTS at TLS terminator.
- Healthcheck via `wget`.

### backend — Go binary

- `./backend/Dockerfile` prod target = `production` (Alpine 3.24 + ca-certificates + curl).
- Non-root user `app` (UID 10001).
- `read_only: true` + `tmpfs /tmp` (64 MB).
- `cap_drop: ALL`, `no-new-privileges`.
- Limits: 512 MB / 1.0 CPU. Healthcheck: `/health`.

### postgres

- `postgres:18.4-alpine3.23`. Named volume `postgres_data` at `/var/lib/postgresql`.
- `POSTGRES_PASSWORD` required.
- Healthcheck: `pg_isready`. Limits: 256 MB / 0.5 CPU.

### valkey — hot cache

- `valkey/valkey:9.1.0-alpine3.23` (BSD Redis fork; `redis://` scheme, `go-redis` compatible).
- `--maxmemory 256mb --maxmemory-policy volatile-lru` (auto-evicts LRU keys with TTLs).
- Runs as `999:1000`. Healthcheck: `valkey-cli ping`. Limits: 300 MB / 0.5 CPU.

## Dev overlay

```yaml
services:
  backend:
    build: { context: ./backend, target: dev }   # go run, not static binary
    read_only: false                              # need writable build cache
    volumes: [ "./backend:/app:cached" ]
    ports: ["127.0.0.1:8080:8080"]
    environment:
      - LOG_LEVEL=DEBUG
      - CORS_ALLOWED_ORIGINS=http://localhost:5173
    deploy: { resources: {} }                     # drop prod limits

  postgres:
    ports: ["127.0.0.1:5432:5432"]                # exposed for local psql

  frontend:                                        # only exists in dev
    build: { context: ./frontend, target: dev }
    volumes:
      - ./frontend:/app:cached
      - /app/node_modules                          # anon volume prevents host shadow
    ports: ["127.0.0.1:5173:5173"]
    environment:
      - VITE_API_BASE_URL=                         # empty = relative, proxied by Vite
    command: npm run dev -- --host 0.0.0.0
    restart: unless-stopped
```

In prod the frontend is baked into the Nginx image — no standalone service.

## Security posture (production)

| Control | Status |
|---------|--------|
| Non-root containers | ✅ Backend UID 10001 |
| `cap_drop: ALL` | ✅ Backend, valkey; Nginx re-adds `CHOWN, SETGID, SETUID, NET_BIND_SERVICE, DAC_OVERRIDE` |
| `no-new-privileges: true` | ✅ All |
| `read_only` root fs | ✅ Backend (tmpfs `/tmp` 64 MB) |
| Secrets via env | ✅ `POSTGRES_PASSWORD` only |
| Ports on `127.0.0.1` | ✅ Only `nginx:80`; postgres/valkey have no host port |
| Log rotation | ✅ json-file, 10 MB × 3 |
| Pinned images | ✅ `valkey:9.1.0-alpine3.23`, `postgres:18.4-alpine3.23` (digest would be stronger) |
| Resource limits | ✅ per service |
| `restart: unless-stopped` | ✅ All |

## Common modifications

### External Postgres (RDS / Cloud SQL)

Remove `postgres` service + `postgres_data` volume. Set:

```env
DATABASE_URL=postgres://user:pass@your-rds-host:5432/vbb?sslmode=require
```

Drop `depends_on.postgres` from backend.

### External Valkey (ElastiCache, Upstash)

Remove `valkey` service. `VALKEY_URL=rediss://your-host:6380/0`. Drop `depends_on.valkey`.

### TLS terminator (Caddy / Traefik)

Prod stack only listens on `127.0.0.1:80` — TLS must terminate externally.

- **Option A (recommended VPS):** add a `caddy` sidecar that auto-obtains Let's Encrypt and proxies to `nginx:80` on the internal network. Nginx unchanged.
- **Option B:** replace nginx with `caddy:2-alpine` mounting a `Caddyfile`. Caddy serves SPA + proxies `/v1/*`. More moving parts — prefer A.

### Per-env overrides

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d
```

Layer arbitrarily many files.
