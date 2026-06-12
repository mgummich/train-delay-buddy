---
id: docker-compose
title: Docker Compose layout
sidebar_position: 2
---

# Docker Compose layout

The repository ships two Compose files. Compose v2 merges them automatically when you run `docker compose up` from the repo root:

| File | Role |
|------|------|
| `docker-compose.yml` | The production stack: hardened, no exposed DB ports, log rotation, resource limits |
| `docker-compose.override.yml` | The dev overlay: opens ports, mounts source, switches build targets to `dev` |

Run with the override (dev):
```bash
docker compose up -d
```

Run *without* the override (production-style locally):
```bash
docker compose -f docker-compose.yml up -d
```

## Services

### nginx

The reverse proxy *and* SPA host. In production it builds the frontend `prod` stage (which bakes the static build into the `nginx:1.27-alpine` image) and mounts the project's `nginx.conf`.

- Listens on `127.0.0.1:80`.
- Proxies `/v1/*`, `/health`, `/readyz` to `backend:8080`.
- Blocks `/metrics` (returns 403 — metrics are scraped on an internal network).
- Serves `index.html` for any SPA route (`try_files $uri /index.html`).
- Sends strict security headers: HSTS-omitted (apply at TLS terminator), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP with `self`-only sources.
- Health check via `wget`.

### backend

The Go binary.

- Built from `./backend/Dockerfile`, prod target = `production` stage (Alpine 3.21 + ca-certificates + curl for healthcheck).
- Runs as non-root user `app` (UID 10001).
- `read_only: true`, with a `tmpfs` mount for `/tmp` (64 MB).
- `cap_drop: ALL`, `no-new-privileges: true`.
- Resource limits: 512 MB RAM, 1.0 CPU.
- Health check hits `/health`.

### postgres

The canonical store.

- `postgres:16.4-alpine` image.
- Named volume `postgres_data` mounted at `/var/lib/postgresql/data`.
- `POSTGRES_PASSWORD` required via env (Compose refuses to start without it).
- Health check via `pg_isready`.
- Resource limits: 256 MB RAM, 0.5 CPU.

### valkey

The hot cache.

- `valkey/valkey:8-alpine` image.
- `--maxmemory 256mb --maxmemory-policy volatile-lru` — auto-evicts least-recently-used keys with TTLs.
- Health check via `valkey-cli ping`.
- Resource limits: 300 MB RAM, 0.5 CPU.

## Dev overlay specifics

```yaml
# docker-compose.override.yml (excerpt)
services:
  backend:
    build:
      context: ./backend
      target: dev               # switches to the dev stage (go run, not static binary)
    read_only: false            # need writable filesystem for go build cache
    volumes:
      - ./backend:/app:cached   # source-mounted for live edits
    ports: ["127.0.0.1:8080:8080"]
    deploy:
      resources: {}             # disable prod limits during dev profiling

  postgres:
    ports: ["127.0.0.1:5432:5432"]   # exposed for local psql

  frontend:
    build:
      context: ./frontend
      target: dev
    volumes:
      - ./frontend:/app:cached
      - /app/node_modules
    ports: ["127.0.0.1:5173:5173"]
    command: npm run dev -- --host 0.0.0.0
```

Note: the dev overlay introduces a separate `frontend` service that runs Vite. In prod, the frontend is baked into the Nginx image; there is no standalone `frontend` service.

## Security posture (production stack)

| Control | Status |
|---------|--------|
| Non-root containers | ✅ Backend runs as UID 10001 |
| `cap_drop: ALL` | ✅ Backend, valkey; Nginx keeps `NET_BIND_SERVICE` only |
| `no-new-privileges: true` | ✅ All services |
| `read_only: true` root filesystem | ✅ Backend (with tmpfs `/tmp`) |
| Secrets via env | ✅ `POSTGRES_PASSWORD` (no hardcoded passwords) |
| Ports bound to `127.0.0.1` | ✅ All exposed ports |
| Log rotation | ✅ json-file driver, 10 MB × 3 files per service |
| Pinned image tags | ✅ `valkey/valkey:8-alpine`, `postgres:16.4-alpine`, `nginx:1.27-alpine` (digest pinning would be stronger) |
| Resource limits | ✅ memory + CPU set per service |
| `restart: unless-stopped` | ✅ All services |

## Common modifications

### Use an external Postgres (RDS / Cloud SQL)

Remove the `postgres` service and the `postgres_data` volume from `docker-compose.yml`. Set:

```env
DATABASE_URL=postgres://user:pass@your-rds-host:5432/vbb?sslmode=require
```

Drop `depends_on.postgres` from the backend.

### Use an external Valkey (or compatible — ElastiCache, Upstash)

Same idea. Remove `valkey` from `docker-compose.yml`, set `VALKEY_URL=rediss://your-host:6380/0`, drop `depends_on.valkey`.

### Add a TLS terminator (Caddy / Traefik)

Put Caddy or Traefik in front of `nginx`. The simplest path: replace `nginx` with `caddy` and configure auto-TLS via the `caddy:2-alpine` image and a `Caddyfile`.

### Override env per environment

Create `docker-compose.prod.yml` and `docker-compose.staging.yml`. Run with explicit file order:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d
```

The override file shipped here is just one convention; you can layer arbitrarily many.
