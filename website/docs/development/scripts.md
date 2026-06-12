---
id: scripts
title: Scripts reference
sidebar_position: 2
---

# Scripts reference

Every npm and Go command you will use, organised by goal.

## Frontend (`cd frontend`)

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server on `:5173` with HMR + API proxy |
| `npm run build` | `tsc -b && vite build` — typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally to verify before deploy |
| `npm run typecheck` | `tsc --noEmit` — type errors only, no files written |
| `npm run lint` | ESLint + Prettier check, **fails on any warning** (`--max-warnings 0`) |
| `npm run lint:fix` | Auto-fix all ESLint and Prettier violations |
| `npm run test` | Vitest unit tests, single run |
| `npm run test:watch` | Vitest in interactive watch mode |
| `npm run test:coverage` | Vitest with coverage → `coverage/` |
| `npm run test:e2e` | Playwright E2E (requires `docker compose up`) |
| `npm run codegen` | Regenerate `src/api/types.gen.ts` from `../backend/openapi.yaml` |
| `npm run codegen:check` | Verify generated types match `openapi.yaml` (CI uses this) |
| `npm run size-limit` | Check the production bundle against configured size limits |

## Backend (`cd backend`)

| Command | Purpose |
|---------|---------|
| `go run ./cmd/server` | Start the backend (migrations apply on start) |
| `go test ./...` | Run all backend tests |
| `go test -race -count=1 ./...` | Production CI flags |
| `go test -v ./internal/journey/...` | Verbose run for one package |
| `go test -run TestPollerTick ./...` | Run a single test by name |
| `go test -bench=. ./internal/routing/` | Run benchmarks |
| `go test -cover ./...` | Coverage summary |
| `go build -o /tmp/server ./cmd/server` | Compile a binary |
| `go vet ./...` | Static analysis |
| `go mod tidy` | Sync `go.sum`, remove unused dependencies |
| `go mod verify` | Verify module sums match downloaded archives |

## Whole-stack (`cd .` — repo root)

| Command | Purpose |
|---------|---------|
| `docker compose up -d` | Start the dev stack with the override |
| `docker compose -f docker-compose.yml up -d` | Start the production stack (no override) |
| `docker compose down` | Stop everything |
| `docker compose down -v` | Stop + delete volumes (resets DB!) |
| `docker compose ps` | Service + health status |
| `docker compose logs -f backend` | Stream backend logs |
| `docker compose exec backend sh` | Shell into the backend container |
| `docker compose exec postgres psql -U vbb vbb` | Open psql |
| `docker compose config --quiet` | Validate merged Compose configuration |

## Docs (`cd website`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install Docusaurus deps |
| `npm run start` | Local docs server with hot reload |
| `npm run build` | Static build to `website/build/` |
| `npm run serve` | Serve the static build locally to verify |
| `npm run typecheck` | Type-check the Docusaurus config + components |
| `npm run prepare-assets` | Copy screenshots into `static/img/screenshots/` |

## One-liners that earn their keep

```bash
# count active journeys right now
docker compose exec postgres psql -U vbb vbb -tAc \
  "SELECT count(*) FROM journeys WHERE terminated_at IS NULL"

# tail backend errors only
docker compose logs -f backend | grep -E '"level":"ERROR|level":"WARN'

# fully rebuild a single service
docker compose up -d --build --force-recreate backend

# nuke node_modules + Vite cache
rm -rf frontend/node_modules frontend/.vite

# check what changed in the OpenAPI spec vs. main
git diff origin/master -- backend/openapi.yaml | bat -l diff
```
