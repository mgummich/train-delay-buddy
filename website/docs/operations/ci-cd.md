---
id: ci-cd
title: CI/CD pipelines
sidebar_position: 4
---

# CI/CD pipelines

Two GitHub Actions workflows live under `.github/workflows/`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push to `master`, PRs to `master` | Verify code builds, tests pass, images build |
| `docs.yml` | push to `master` (paths: `website/**`, `README.md`) | Build this Docusaurus site and deploy to GitHub Pages |

Both run on `ubuntu-latest` only — no matrix.

## `ci.yml` — Code verification

Four jobs run; `backend` and `frontend` run in parallel, `docker` and `e2e` wait on them:

### Job: `backend`

```yaml
- actions/checkout@v6
- actions/setup-go@v6 (with cache, go.mod-based)
- go mod verify
- go vet ./...
- go build ./...
- go test -race -count=1 -timeout=5m ./...
```

The `-race` detector adds ~30 % runtime but catches concurrency bugs that would otherwise reach production. `-count=1` defeats Go's test result cache on every CI run.

### Job: `frontend`

```yaml
- actions/checkout@v6
- actions/setup-node@v6 (node 22, npm cache)
- npm ci
- npm run codegen:check    # fails if types.gen.ts is out of date
- npm run lint
- npm run typecheck
- npm run test -- --reporter=default
```

The `codegen:check` step is critical — it guarantees the committed TypeScript types match the OpenAPI spec.

### Job: `e2e`

```yaml
needs: [frontend]
continue-on-error: true    # non-blocking — failures reported but don't block merges
timeout-minutes: 20
- actions/checkout@v6
- actions/setup-node@v6 (node 22, npm cache for both frontend and tests/e2e)
- npm ci (frontend)
- npm run build (frontend)
- npm install --no-audit --no-fund (tests/e2e)
- npm run typecheck (tests/e2e)
- npx playwright install --with-deps chromium
- npx playwright test
- actions/upload-artifact@v7 (playwright-report, 7-day retention, on failure)
- actions/upload-artifact@v7 (traces, on failure)
```

`continue-on-error: true` means E2E failures are visible in the summary but do not block PRs from merging. Remove that flag once all screens are fully implemented.

### Job: `sast`

Runs in parallel with `backend` and `frontend`:

```yaml
permissions:
  contents: read
  security-events: write
- gitleaks/gitleaks-action@v3      # secret scanning across full history
- securego/gosec@master            # Go SAST, HIGH severity, SARIF output
- github/codeql-action/upload-sarif@v4  # uploads gosec.sarif
- pip install semgrep              # multi-language SAST via semgrep CLI
  semgrep scan \
    --config p/default \
    --config p/security-audit \
    --config p/owasp-top-ten \
    --config p/dockerfile \
    --config p/secrets \
    --error
```

Semgrep runs as a direct CLI call (not the deprecated `returntocorp/semgrep-action`) to avoid version-lock issues. gosec results appear as code-scanning alerts in the Security tab via the uploaded SARIF.

### Job: `docker`

```yaml
needs: [backend, frontend]   # only runs after both pass
- cp .env.example .env       # required for compose validation
- docker compose config --quiet
- docker/setup-buildx-action@v4
- docker/build-push-action@v7 (backend, target=production)
- docker/build-push-action@v7 (frontend, target=prod)
```

`cache-from` and `cache-to: type=gha,mode=max` reuse layer cache across runs. A warm build takes ~30 seconds; a cold build takes ~3 minutes.

Images are built but **not pushed**. To enable image publication, add `push: true` and configure registry credentials (see "Publishing images" below).

### Concurrency and permissions

```yaml
permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

`contents: read` is the minimum needed. `concurrency.cancel-in-progress` saves CI minutes by killing superseded runs when you push twice in a row.

## `docs.yml` — Docs deployment

Builds the Docusaurus site under `website/` and publishes the static output to the `gh-pages` branch (and thus to GitHub Pages).

### Trigger paths

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

`workflow_dispatch` lets you trigger a deploy manually from the GitHub UI.

### Pipeline shape

```yaml
- actions/checkout@v6
- actions/setup-node@v6 (node 22, npm cache scoped to website/package-lock.json)
- npm ci (in website/)
- npm run build
- actions/upload-pages-artifact@v5 (path: website/build)
- actions/deploy-pages@v5
```

### Permissions

```yaml
permissions:
  contents: read
  pages: write
  id-token: write   # required by deploy-pages@v5
```

These match GitHub's standard Pages-deploy template. No other secrets are needed; the OIDC token signed by `id-token: write` authorises the deploy.

### One-time setup in the repo

1. In the repo's **Settings → Pages**, set the source to **GitHub Actions** (not "Deploy from branch").
2. After the first successful deploy, the docs will be available at `https://<owner>.github.io/<repo>/`. For this repo: `https://mgummich.github.io/train-delay-buddy/`.

The `baseUrl` in `website/docusaurus.config.ts` is set to `/train-delay-buddy/` to match.

## Local CI simulation

Before pushing, you can run the same checks locally:

```bash
# Backend
(cd backend && go mod verify && go vet ./... && go test -race -count=1 ./...)

# Frontend
(cd frontend && npm ci && npm run codegen:check && npm run lint && npm run typecheck && npm run test)

# E2E (build frontend first)
(cd frontend && npm run build)
(cd tests/e2e && npm install && npx playwright install chromium && npx playwright test)

# Security (requires Python for semgrep)
pip install semgrep && semgrep scan --config p/default --config p/security-audit --config p/owasp-top-ten --config p/dockerfile --config p/secrets --error

# Docker
cp .env.example .env
docker compose config --quiet
docker compose -f docker-compose.yml build

# Docs
(cd website && npm ci && npm run build)
```

If all blocks pass, your CI run will pass.

## Publishing images (optional)

To publish images to GitHub Container Registry on `master`:

```yaml
- name: Login to GHCR
  uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}

- name: Build and push backend
  uses: docker/build-push-action@v7
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

Add `packages: write` to the workflow `permissions:`.

## Vulnerability scanning (optional)

To add Trivy scanning of the built images:

```yaml
- uses: aquasecurity/trivy-action@master
  with:
    image-ref: verspaetungs-begleiter-backend:ci
    severity: HIGH,CRITICAL
    exit-code: 1
    ignore-unfixed: true
```

Place this after each `docker build` step. The workflow will fail on any unfixed `HIGH` or `CRITICAL` CVE.
