---
id: local-development
title: Local development (no Docker)
sidebar_position: 3
---

# Local development — without Docker

Use for native IDE debugging (breakpoints, profiling, live race detection) or fastest Go build cycles. Postgres + Valkey still in Docker — not worth installing natively.

## 1. Infra only

```bash
docker compose up -d postgres valkey
```

- Postgres on `127.0.0.1:5432` (dev override exposes).
- Valkey on `127.0.0.1:6379` (in-docker by default; expose with `--service-ports` if needed).

## 2. Backend on host

```bash
cd backend
go mod download

export PORT=8080
export DATABASE_URL=postgres://vbb:${POSTGRES_PASSWORD}@localhost:5432/vbb
export VALKEY_URL=redis://localhost:6379
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export LOG_LEVEL=DEBUG
export MIGRATIONS_DIR=./migrations

go run ./cmd/server
```

Migrations apply on every start. No separate `migrate up`.

:::tip Hot reload with `air`
Install [`air`](https://github.com/cosmtrek/air), drop `.air.toml` in `backend/`. Watches `.go`, rebuilds on save.
:::

### IDE debugging

- **GoLand:** Run Configuration *Go Build* → entry `./cmd/server` → env vars above.
- **VS Code** `.vscode/launch.json`:

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
        "VALKEY_URL": "redis://localhost:6379",
        "CORS_ALLOWED_ORIGINS": "http://localhost:5173",
        "LOG_LEVEL": "DEBUG"
      }
    }
  ]
}
```

## 3. Frontend on host

```bash
cd frontend
npm install
npm run dev
```

Vite on `http://localhost:5173`, proxies `/v1/*`, `/health`, `/readyz` → `http://localhost:8080`. Same-origin via Vite — no CORS needed in dev.

## Verify

```bash
curl http://localhost:8080/health
# {"status":"ok"}

curl http://localhost:8080/readyz | jq
# {"status":"ok","checks":{"valkey":"ok","postgres":"ok","hafas":"ok"}}

curl -i http://localhost:5173/health
# HTTP/1.1 200 OK
```

`/readyz` `degraded`/`down` → [Troubleshooting](../troubleshooting).

## Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `dial tcp 127.0.0.1:5432: connect: connection refused` | Postgres not up | Wait for `docker compose ps` `healthy`, retry |
| `valkey: connection refused` | Port not exposed | `docker compose up -d valkey`; use `VALKEY_URL=redis://localhost:6379` (not `redis://valkey:6379`) |
| `CORS policy: No 'Access-Control-Allow-Origin'` | Opened `:8080` directly | Use `:5173` — Vite proxy makes requests same-origin |
| `migrations table does not exist` | Wrong `MIGRATIONS_DIR` | Set `MIGRATIONS_DIR=./migrations` from inside `backend/` |
