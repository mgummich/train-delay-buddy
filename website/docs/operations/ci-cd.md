---
id: ci-cd
title: CI/CD pipelines
sidebar_position: 4
---

# CI/CD pipelines

Two workflows in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to `master` | Build, test, image build |
| `docs.yml` | push to `master` (`website/**`, `README.md`) | Build Docusaurus, deploy to Pages |

Both run on `ubuntu-latest`.

## `ci.yml`

Jobs: `backend` + `frontend` + `sast` run in parallel; `docker` and `e2e` wait on them.

### `backend`

```yaml
- checkout@v6
- setup-go@v6 (cache, go.mod-based)
- go mod verify
- go vet ./...
- go build ./...
- go test -race -count=1 -timeout=5m -coverprofile=coverage.out ./...
- coverage check: fail if < 55%
- govulncheck ./...
```

`-race` adds ~30% runtime but catches concurrency bugs. `-count=1` defeats test cache. `CGO_ENABLED=1` required for the race detector. `govulncheck` scans against the Go vuln DB.

### `frontend`

```yaml
- checkout@v6
- setup-node@v6 (node 22, npm cache)
- npm ci
- npm run codegen:check     # fails if types.gen.ts is stale
- npm run lint
- npm run typecheck
- npm audit --audit-level=high
- npm run test -- --reporter=default
```

### `e2e` (`needs: [frontend]`, `timeout-minutes: 20`)

```yaml
- checkout@v6
- setup-node@v6 (node 22, npm cache for frontend + tests/e2e)
- npm ci && npm run build (frontend)
- npm install --no-audit --no-fund (tests/e2e)
- npm run typecheck (tests/e2e)
- npx playwright install --with-deps chromium
- npx playwright test
- upload-artifact@v7 (playwright-report + traces, on failure, 7-day retention)
```

**Hard gate** — failures block merges. HTML report + traces uploaded for offline inspection.

### `sast` (parallel)

```yaml
permissions:
  contents: read
  security-events: write
- gitleaks/gitleaks-action@v3        # secrets, full history
- securego/gosec@master              # Go SAST, HIGH severity, SARIF
- github/codeql-action/upload-sarif@v4
- pip install semgrep
  semgrep scan \
    --config p/default --config p/security-audit \
    --config p/owasp-top-ten --config p/dockerfile --config p/secrets \
    --error
```

Direct semgrep CLI (not the deprecated `returntocorp/semgrep-action`) avoids version lock. gosec SARIF surfaces in the Security tab.

### `docker` (`needs: [backend, frontend]`)

```yaml
- cp .env.example .env       # compose validation needs it
- docker compose config --quiet
- docker/setup-buildx-action@v4
- docker/build-push-action@v7 (backend, target=production)
- docker/build-push-action@v7 (frontend, target=prod)
```

`cache-from` / `cache-to: type=gha,mode=max` reuse layers. Warm ~30 s, cold ~3 min. Images built, **not pushed** — see "Publishing images" below.

### Concurrency

```yaml
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

`contents: read` is the minimum. `cancel-in-progress` kills superseded runs.

## `docs.yml`

Builds `website/` and publishes to `gh-pages` / GitHub Pages.

```yaml
on:
  push:
    branches: [master]
    paths:
      - "website/**"
      - "README.md"
      - "design_handoff_verspaetungsbegleiter/screenshots/**"
      - ".github/workflows/docs.yml"
  workflow_dispatch:
```

```yaml
- checkout@v6
- setup-node@v6 (node 22, npm cache scoped to website/package-lock.json)
- npm ci (website/)
- npm run build
- upload-pages-artifact@v5 (path: website/build)
- deploy-pages@v5
```

```yaml
permissions:
  contents: read
  pages: write
  id-token: write   # required by deploy-pages@v5
```

**One-time setup:** Settings → Pages → source: **GitHub Actions**. Site lands at `https://mgummich.github.io/train-delay-buddy/`. `baseUrl` in `website/docusaurus.config.ts` matches.

## Local CI simulation

```bash
# Backend
(cd backend && go mod verify && go vet ./... && CGO_ENABLED=1 go test -race -count=1 ./...)

# Frontend
(cd frontend && npm ci && npm run codegen:check && npm run lint && npm run typecheck && npm run test)

# E2E
(cd frontend && npm run build)
(cd tests/e2e && npm install && npx playwright install chromium && npx playwright test)

# Security
pip install semgrep && semgrep scan --config p/default --config p/security-audit --config p/owasp-top-ten --config p/dockerfile --config p/secrets --error

# Docker
cp .env.example .env && docker compose config --quiet && docker compose -f docker-compose.yml build

# Docs
(cd website && npm ci && npm run build)
```

## Publishing images (optional)

Add to the `docker` job, plus `packages: write` permission:

```yaml
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}

- uses: docker/build-push-action@v7
  with:
    context: ./backend
    target: production
    push: true
    tags: |
      ghcr.io/mgummich/verspaetungs-begleiter-backend:latest
      ghcr.io/mgummich/verspaetungs-begleiter-backend:${{ github.sha }}
    cache-from: type=gha,scope=backend
    cache-to: type=gha,scope=backend,mode=max
```

## Vulnerability scanning

Go: `govulncheck` (in `backend`). Frontend: `npm audit --audit-level=high` (in `frontend`).

Trivy for built images:

```yaml
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: verspaetungs-begleiter-backend:ci
    severity: HIGH,CRITICAL
    exit-code: 1
    ignore-unfixed: true
```

Place after each `docker build`. Fails on unfixed `HIGH` / `CRITICAL` CVEs.
