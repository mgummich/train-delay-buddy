---
id: scripts
title: Scripts reference
sidebar_position: 2
---

# Scripts reference

Every npm + Go command, by goal.

## Frontend (`cd frontend`)

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite `:5173` + HMR + API proxy |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve prod build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier, **fails on warning** (`--max-warnings 0`) |
| `npm run lint:fix` | Auto-fix |
| `npm run test` | Vitest single run |
| `npm run test:watch` | Vitest watch |
| `npm run test:coverage` | Vitest + coverage → `coverage/` |
| `npm run test:e2e` | Playwright (needs `docker compose up`) |
| `npm run codegen` | Regenerate `src/api/types.gen.ts` from `../backend/openapi.yaml` |
| `npm run codegen:check` | Verify generated types vs. spec (CI uses) |
| `npm run size-limit` | Check bundle vs. configured limits |

## Backend (`cd backend`)

| Command | Purpose |
|---------|---------|
| `go run ./cmd/server` | Start backend (migrations apply on start) |
| `go test ./...` | All tests |
| `go test -race -count=1 ./...` | CI flags |
| `go test -v ./internal/journey/...` | Verbose one package |
| `go test -run TestPollerTick ./...` | One test by name |
| `go test -bench=. ./internal/routing/` | Benchmarks |
| `go test -cover ./...` | Coverage summary |
| `go build -o /tmp/server ./cmd/server` | Compile binary |
| `go vet ./...` | Static analysis |
| `go mod tidy` | Sync `go.sum`, drop unused deps |
| `go mod verify` | Verify module sums |

## Whole-stack (repo root)

| Command | Purpose |
|---------|---------|
| `docker compose up -d` | Dev stack with override |
| `docker compose -f docker-compose.yml up -d` | Prod stack (no override) |
| `docker compose down` | Stop |
| `docker compose down -v` | Stop + drop volumes (resets DB!) |
| `docker compose ps` | Service + health |
| `docker compose logs -f backend` | Stream backend logs |
| `docker compose exec backend sh` | Shell into backend |
| `docker compose exec postgres psql -U vbb vbb` | psql |
| `docker compose config --quiet` | Validate merged config |

## Docs (`cd website`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run start` | Local server + hot reload |
| `npm run build` | Static → `website/build/` |
| `npm run serve` | Serve static locally |
| `npm run typecheck` | Type-check config + components |
| `npm run prepare-assets` | Copy screenshots to `static/img/screenshots/` |

## One-liners

```bash
# count active journeys
docker compose exec postgres psql -U vbb vbb -tAc \
  "SELECT count(*) FROM journeys WHERE terminated_at IS NULL"

# tail backend warns + errors
docker compose logs -f backend | grep -E '"level":"ERROR|level":"WARN'

# rebuild one service from scratch
docker compose up -d --build --force-recreate backend

# nuke node_modules + Vite cache
rm -rf frontend/node_modules frontend/.vite

# diff OpenAPI vs. main
git diff origin/master -- backend/openapi.yaml | bat -l diff
```
