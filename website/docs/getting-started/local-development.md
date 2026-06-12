---
id: local-development
title: Local development (no Docker)
sidebar_position: 3
---

# Local development — without Docker

Use this path when you want native IDE debugging (breakpoints, profiling, live race detection) or the fastest possible Go build cycles. Postgres and Redis still run in Docker because the cost of installing them natively is not worth the marginal gain.

## Step 1 — Start infrastructure only

```bash
docker compose up -d postgres redis
```

This starts only the two stateful services and leaves the application services for you to run on the host:

- Postgres on `127.0.0.1:5432` (dev override exposes the port).
- Redis on `127.0.0.1:6379` (only inside Docker network by default; expose with `--service-ports` if needed).

## Step 2 — Run the backend on the host

```bash
cd backend
go mod download

export PORT=8080
export DATABASE_URL=postgres://vbb:${POSTGRES_PASSWORD}@localhost:5432/vbb
export REDIS_URL=redis://localhost:6379
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export LOG_LEVEL=DEBUG
export MIGRATIONS_DIR=./migrations

go run ./cmd/server
```

The server starts on `http://localhost:8080`. Migrations apply automatically on every start — there is no separate `migrate up` step.

:::tip Use `air` for hot reload
Install [`air`](https://github.com/cosmtrek/air) and create a `.air.toml` in `backend/`. `air` watches for `.go` changes and rebuilds the binary on save.
:::

### IDE debugging

- **GoLand** — create a Run Configuration of type *Go Build*; entry point `./cmd/server`; environment variables from above.
- **VS Code** — `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug backend",
      "type": "go",
      "request": "launch",
      "mode": "auto",
      "program": "${workspaceFolder}/backend/cmd/server",
      "env": {
        "PORT": "8080",
        "DATABASE_URL": "postgres://vbb:vbb@localhost:5432/vbb",
        "REDIS_URL": "redis://localhost:6379",
        "CORS_ALLOWED_ORIGINS": "http://localhost:5173",
        "LOG_LEVEL": "DEBUG"
      }
    }
  ]
}
```

## Step 3 — Run the frontend on the host

```bash
cd frontend
npm install
npm run dev
```

Vite serves on `http://localhost:5173` and proxies `/v1/*`, `/health`, and `/readyz` to `http://localhost:8080`. The proxy is configured in `vite.config.ts`, so the frontend code only ever sees same-origin URLs and CORS is not required during development.

## Verifying the full chain

```bash
# 1. Backend liveness
curl http://localhost:8080/health
# {"status":"ok"}

# 2. Backend readiness (checks Redis + Postgres + HAFAS)
curl http://localhost:8080/readyz | jq
# {"status":"ok","checks":{"redis":"ok","postgres":"ok","hafas":"ok"}}

# 3. End-to-end via the proxy
curl -i http://localhost:5173/health
# HTTP/1.1 200 OK
```

If `/readyz` reports any subsystem as `degraded` or `down`, jump to [Troubleshooting](../troubleshooting).

## Common pitfalls

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `dial tcp 127.0.0.1:5432: connect: connection refused` | Postgres container is not up yet | Wait for `docker compose ps` to report `healthy`, then re-run |
| `redis: connection refused` | Redis port not exposed | `docker compose up -d redis` and ensure your `REDIS_URL` uses `localhost`, not `redis` |
| `CORS policy: No 'Access-Control-Allow-Origin'` | You opened `:8080` directly in the browser | Open `:5173` instead — the Vite proxy makes requests same-origin |
| `migrations table does not exist` | Wrong `MIGRATIONS_DIR` | Set `MIGRATIONS_DIR=./migrations` from inside `backend/` |
