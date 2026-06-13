---
id: quick-start-docker
title: Quick start — Docker Compose
sidebar_position: 2
---

# Quick start — Docker Compose

Fastest path. Everything containerised.

## 1. Clone + env

```bash
git clone git@github.com:mgummich/train-delay-buddy.git verspaetungs-begleiter
cd verspaetungs-begleiter
cp .env.example .env
```

:::caution Set Postgres password
`POSTGRES_PASSWORD` is required (Compose refuses to start without it). Edit `.env`:

```bash
POSTGRES_PASSWORD=change-me-locally
```

Production: strong random. Never reuse `vbb/vbb`.
:::

## 2. Build + start

```bash
docker compose up -d
```

First run: ~2–3 min (pulls base images, runs both builds). Subsequent restarts: ~5 s via BuildKit cache.

Override (`docker-compose.override.yml`) is auto-picked-up:

- Source-mounts dev containers (hot-reload).
- Exposes `5432` (Postgres) + `5173` (Vite) on `127.0.0.1`.
- Swaps backend to `dev` target.

## 3. Watch

```bash
docker compose logs -f
```

Healthy:

```
postgres   | LOG:  database system is ready to accept connections
valkey     | Ready to accept connections tcp
backend    | level=info msg="server listening" addr=:8080
frontend   | VITE v6.x ready in 412 ms
nginx      | start worker processes
```

```bash
$ docker compose ps
NAME              STATUS                   PORTS
backend-1         Up 12s (healthy)
frontend-1        Up 12s                   127.0.0.1:5173->5173/tcp
nginx-1           Up 8s  (healthy)         127.0.0.1:80->80/tcp
postgres-1        Up 12s (healthy)         127.0.0.1:5432->5432/tcp
valkey-1          Up 12s (healthy)
```

## 4. Open

| URL | Service |
|-----|---------|
| `http://localhost:5173` | Frontend — Vite dev + HMR |
| `http://localhost:8080` | Backend API |
| `http://localhost` | Full app via Nginx (prod routing) |
| `http://localhost:8080/readyz` | Readiness — Valkey / Postgres / HAFAS |
| `http://localhost:8080/metrics` | Prometheus (blocked by Nginx) |

## Compose commands

```bash
docker compose ps                                # service + health
docker compose logs -f backend                   # stream logs
docker compose restart backend                   # restart one
docker compose down                              # stop
docker compose down -v                           # stop + drop volumes (resets DB)
docker compose up -d --build                     # rebuild after Dockerfile/dep change
docker compose exec backend sh                   # shell
docker compose exec postgres psql -U vbb vbb     # psql
```

## What just happened

Two Compose files merged:

1. **`docker-compose.yml`** — prod: hardened (non-root, `cap_drop: ALL`, `no-new-privileges`, read-only root fs on backend), no exposed DB ports, log rotation, resource limits, named volumes.
2. **`docker-compose.override.yml`** — dev overlay: opens `5173`/`5432`/`8080` on `127.0.0.1`; mounts `./backend` + `./frontend`; switches build targets to `dev`.

`docker compose up -d` without `-f` auto-merges. See [Configuration → Docker Compose](../configuration/docker-compose) for layering rules.

Next: [App walkthrough](../usage/app-walkthrough), or [Local development without Docker](./local-development) for IDE debugging.
