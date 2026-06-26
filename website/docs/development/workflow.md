---
id: workflow
title: Development workflow
sidebar_position: 1
---

# Development workflow

Issue → merged in master.

## 1. Branch

```bash
git switch master
git pull --ff-only
git switch -c feat/short-descriptive-name
```

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-visible functionality |
| `fix/` | Bug fix |
| `refactor/` | Internal cleanup, no behaviour change |
| `chore/` | Tooling, deps, CI |
| `docs/` | Documentation only |

## 2. Run the stack

```bash
docker compose up -d
```

Vite `:5173`, backend `:8080`, Postgres + Valkey on docker network. Source-mounted, hot-reloaded.

For backend changes outside the dev image:

```bash
docker compose up -d postgres valkey
cd backend && go run ./cmd/server
```

## 3. Edit

### Backend

- Touching public API? **Edit `backend/openapi.yaml` first**, then `cd frontend && npm run codegen`, then handler. Forces spec/types/code agreement upfront.
- Adding config? **Add env var to `internal/config/config.go`**, default + document in [environment-variables](../configuration/environment-variables).
- Touching hot path? **Write benchmark in `*_bench_test.go` first** — see `internal/journey/poller_test.go`.

### Frontend

- API call sites? **Use generated types from `src/api/types.gen.ts`**. Never hand-write shapes.
- New screens? Add route to `router.tsx` with a `loader` that prefetches via TanStack Query.
- New state? Pick the layer: server → TanStack Query; persistent client → Zustand + `persist`; UI ephemeral → local `useState`.

## 4. Commit small, often

```bash
git add -p
git commit -m "feat(api): add Idempotency-Key support to POST /v1/journeys"
```

### Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `build`, `ci`.
Scopes: `api`, `frontend`, `backend`, `db`, `docker`, `nginx`, `ci`, `docs`.

Pre-commit hook (Husky + lint-staged) runs ESLint + Prettier on staged TS/TSX. `--no-verify` only in emergencies.

## 5. Push + PR

```bash
git push -u origin feat/short-descriptive-name
gh pr create --fill
```

CI: backend → frontend → docker. All must pass before merge.

## 6. Merge

Squash. PR title becomes squash subject — make it a good Conventional Commits message.

## 7. Master CI

Push to `master` → docs deploy (`.github/workflows/docs.yml`) → Docusaurus build + Pages publish.

## Code style

- **Go:** `gofmt -s`, `go vet`. Narrow interfaces ("accept interfaces, return structs"). No `context.Background()` in handlers — propagate from request.
- **TypeScript:** ESLint + Prettier per `frontend/.eslintrc.cjs`. No `any`. No `// @ts-ignore` — use `// @ts-expect-error <reason>` if absolutely necessary.
- **SQL:** lowercase keywords, snake_case columns, trailing commas in column lists.

## Review checklist

- [ ] Touches `openapi.yaml`? Was `types.gen.ts` regenerated + committed in the same commit?
- [ ] New env var? Documented?
- [ ] Hot-path change? Benchmark present, or proof of no regression?
- [ ] New endpoint? `*_test.go` for the handler?
- [ ] New screen/hook? Vitest tests?
- [ ] Migration? Applies cleanly to fresh DB? (CI proves.)
- [ ] Security-relevant? Re-ran `docker compose config` to verify hardening intact?
