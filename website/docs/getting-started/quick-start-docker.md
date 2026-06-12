---
id: quick-start-docker
title: Quick start — Docker Compose
sidebar_position: 2
---

# Quick start — Docker Compose

The fastest path to a running stack. Everything is containerised; nothing needs to be installed beyond Docker.

## 1. Clone and prepare environment

```bash
git clone git@github.com:mgummich/train-delay-buddy.git verspaetungs-begleiter
cd verspaetungs-begleiter
cp .env.example .env
```

:::caution Set the Postgres password
The repo enforces `POSTGRES_PASSWORD` as a required env var (Docker Compose will refuse to start without it). Edit `.env`:

```bash
POSTGRES_PASSWORD=change-me-locally
```

For production deployments, generate a strong random password and never reuse `vbb/vbb`.
:::

## 2. Build and start the stack

```bash
docker compose up -d
```

On first run, Compose pulls base images and runs both Dockerfile builds. Expect ~2–3 minutes the first time, ~5 seconds on subsequent restarts thanks to BuildKit layer cache.

The override file (`docker-compose.override.yml`) is picked up automatically and:

- Mounts your source trees into the dev containers for hot-reload.
- Exposes `5432` (Postgres) and `5173` (Vite) on `127.0.0.1` for debugging.
- Swaps the backend image to its `dev` target (Go source-mounted, rebuilds on save).

## 3. Watch services come up

```bash
docker compose logs -f
```

Healthy state:

```
postgres   | LOG:  database system is ready to accept connections
redis      | Ready to accept connections tcp
backend    | level=info msg="server listening" addr=:8080
frontend   | VITE v6.x ready in 412 ms
nginx      | start worker processes
```

`docker compose ps` should show every service as `healthy`:

```bash
$ docker compose ps
NAME              STATUS                   PORTS
backend-1         Up 12s (healthy)
frontend-1        Up 12s                   127.0.0.1:5173->5173/tcp
nginx-1           Up 8s  (healthy)         127.0.0.1:80->80/tcp
postgres-1        Up 12s (healthy)         127.0.0.1:5432->5432/tcp
redis-1           Up 12s (healthy)
```

## 4. Open the app

| URL | Service |
|-----|---------|
| `http://localhost:5173` | Frontend — Vite dev server with HMR |
| `http://localhost:8080` | Backend API |
| `http://localhost` | Full app via Nginx (production-style routing) |
| `http://localhost:8080/readyz` | Readiness probe — Redis / Postgres / HAFAS status |
| `http://localhost:8080/metrics` | Prometheus metrics (blocked behind Nginx) |

## Useful Compose commands

```bash
docker compose ps                  # service and health status
docker compose logs -f backend     # stream backend logs
docker compose restart backend     # restart one service
docker compose down                # stop everything
docker compose down -v             # stop + delete the Postgres data volume (resets DB)
docker compose up -d --build       # rebuild after Dockerfile or dependency change
docker compose exec backend sh     # shell into the running backend container
docker compose exec postgres psql -U vbb vbb  # open psql in the postgres container
```

## What just happened

Two Compose files merged into one configuration:

1. **`docker-compose.yml`** — the production stack: hardened (non-root, `cap_drop: ALL`, `no-new-privileges`, read-only root filesystem on backend), no exposed DB ports, log rotation, resource limits, named volumes.
2. **`docker-compose.override.yml`** — the dev overlay: opens `5173`, `5432`, `8080` on `127.0.0.1`; mounts `./backend` and `./frontend` for live edits; switches build targets to the `dev` stages.

When you run `docker compose up -d` without `-f`, Compose automatically merges both. See [Configuration → Docker Compose](../configuration/docker-compose) for the full layering rules.

Next: continue with the [App walkthrough](../usage/app-walkthrough), or jump to [Local development without Docker](./local-development) if you want IDE debugging.
