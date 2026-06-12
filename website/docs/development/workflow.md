---
id: workflow
title: Development workflow
sidebar_position: 1
---

# Development workflow

How a feature flows from "idea in the issue" to "merged in master".

## 1. Branch from `master`

```bash
git switch master
git pull --ff-only
git switch -c feat/short-descriptive-name
```

Branch name conventions:

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

Vite on `:5173`, backend on `:8080`, Postgres + Redis on the docker network. Source-mounted, hot-reloaded.

For backend changes that don't fit the dev-stage image:

```bash
docker compose up -d postgres redis
cd backend && go run ./cmd/server
```

## 3. Edit code

### Backend changes

- Touching the public API? **Edit `backend/openapi.yaml` first.** Then regenerate frontend types (`cd frontend && npm run codegen`). The handler implementation comes last. This forces the spec, the types, and the code into agreement from the start.
- Adding configuration? **Add the env var to `internal/config/config.go`**, default it, and document it in [`configuration/environment-variables`](../configuration/environment-variables).
- Touching a hot path? **Write a benchmark in `*_bench_test.go`** before the change — see `internal/journey/poller_test.go` for the pattern.

### Frontend changes

- Touching API call sites? **Use the generated types from `src/api/types.gen.ts`.** Never hand-write request/response shapes.
- New screens? Add the route to `router.tsx` with a `loader` that prefetches via TanStack Query.
- New state? Decide *which* of the three layers it belongs in. Server state → TanStack Query. Persistent client state → Zustand + `persist`. UI ephemeral → local `useState`.

## 4. Commit small, commit often

```bash
git add -p                # stage hunks deliberately
git commit -m "feat(api): add Idempotency-Key support to POST /v1/journeys"
```

### Commit message convention

Conventional Commits. Format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `style`, `build`, `ci`.

Scopes: `api`, `frontend`, `backend`, `db`, `docker`, `nginx`, `ci`, `docs`.

The pre-commit hook (Husky + lint-staged) runs ESLint + Prettier on staged TS/TSX files. Skip with `--no-verify` only in emergencies.

## 5. Push and open a PR

```bash
git push -u origin feat/short-descriptive-name
gh pr create --fill
```

CI runs:

1. **backend** — `go vet`, `go build`, `go test -race`.
2. **frontend** — `npm ci`, `codegen:check`, `lint`, `typecheck`, `test`.
3. **docker** — `docker compose config`, build both images with GHA cache.

All three jobs must pass before merging.

## 6. Merge to `master`

Squash merge is the default. The PR title becomes the squash commit subject — make it a good Conventional Commits message.

## 7. CI on master

Pushing to `master` triggers the docs deploy workflow (`.github/workflows/docs.yml`), which builds the Docusaurus site and publishes to GitHub Pages.

## Code style

- **Go**: standard Go style. `gofmt -s`, `go vet`. Prefer narrow interfaces ("accept interfaces, return structs"). Avoid `context.Background()` in handlers — propagate from the request.
- **TypeScript**: ESLint + Prettier as configured in `frontend/.eslintrc.cjs`. No `any`. No `// @ts-ignore` — use `// @ts-expect-error <reason>` if absolutely necessary.
- **SQL**: lowercase keywords, snake_case columns, trailing commas in column lists for cleaner diffs.

## Reviewing PRs

Checklist for reviewers:

- [ ] Does the change touch `openapi.yaml`? If so, was `types.gen.ts` regenerated and committed in the same commit?
- [ ] New env var? Is it documented?
- [ ] Hot-path change? Is there a benchmark, or proof that it does not regress?
- [ ] New endpoint? Are there `*_test.go` tests for the handler?
- [ ] New screen / hook? Are there Vitest tests?
- [ ] Migration added? Does it apply cleanly to a fresh DB? (CI proves this.)
- [ ] Any security-relevant change? Did you re-run `docker compose config` and verify hardening is still in place?
