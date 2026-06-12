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

Three jobs run in parallel where possible:

### Job: `backend`

```yaml
- actions/checkout@v4
- actions/setup-go@v5 (with cache, go.mod-based)
- go mod verify
- go vet ./...
- go build ./...
- go test -race -count=1 -timeout=5m ./...
```

The `-race` detector adds ~30 % runtime but catches concurrency bugs that would otherwise reach production. `-count=1` defeats Go's test result cache on every CI run.

### Job: `frontend`

```yaml
- actions/checkout@v4
- actions/setup-node@v4 (node 22, npm cache)
- npm ci
- npm run codegen:check    # fails if types.gen.ts is out of date
- npm run lint
- npm run typecheck
- npm run test -- --reporter=default
```

The `codegen:check` step is critical — it guarantees the committed TypeScript types match the OpenAPI spec.

### Job: `docker`

```yaml
needs: [backend, frontend]   # only runs after both pass
- docker compose config --quiet
- docker/setup-buildx-action@v3
- docker/build-push-action@v6 (backend, target=production)
- docker/build-push-action@v6 (frontend, target=prod)
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
- actions/checkout@v4
- actions/setup-node@v4 (with npm cache scoped to website/package-lock.json)
- npm ci (in website/)
- npm run build (which auto-copies screenshots via the prepare-assets script)
- actions/upload-pages-artifact@v3 (path: website/build)
- actions/deploy-pages@v4
```

### Permissions

```yaml
permissions:
  contents: read
  pages: write
  id-token: write   # required by deploy-pages@v4
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

# Docker
docker compose config --quiet
docker compose -f docker-compose.yml build

# Docs
(cd website && npm ci && npm run build)
```

If all four blocks pass, your CI run will pass.

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
  uses: docker/build-push-action@v6
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
