---
id: intro
title: Introduction
slug: /
sidebar_position: 1
---

# Verspätungs-Begleiter

**Real-time alternative routing for Deutsche Bahn journeys.**

Enter your current train and your destination station. The backend monitors your connection live by polling [HAFAS](https://v6.db.transport.rest) every 30 seconds. As delays emerge, a Breadth-First-Search (BFS) routing engine surfaces ranked alternative routes that get you to your destination earlier — with transfer buffer, risk badges, and confidence indicators.

:::info Not affiliated with Deutsche Bahn
The app uses the public, community-operated [`v6.db.transport.rest`](https://v6.db.transport.rest) HAFAS proxy. No API key is required.
:::

## What this documentation covers

This site is the **single source of truth** for everything about the project:

- **Getting started** — prerequisites, Docker Compose quick-start, local non-Dockerised dev.
- **Usage** — end-to-end walkthrough of the app, PWA installation on iOS, Android, and desktop.
- **Architecture** — backend internals (Go, chi, poller, BFS), frontend internals (React 19, Vite, TanStack Query), data flow, multi-layer cache strategy.
- **Configuration** — every environment variable, Docker Compose layout, dev vs. prod profiles.
- **API reference** — every endpoint, conventions (RFC 7807 errors, `Idempotency-Key`, `If-None-Match`), and OpenAPI source.
- **Database** — schema, migration strategy, direct connection.
- **Development** — scripts, codegen, pre-commit hooks.
- **Testing** — backend `go test`, Vitest + MSW, Playwright E2E.
- **Operations** — production deployment, Prometheus metrics, liveness/readiness probes, the CI/CD pipeline that builds and publishes this site.
- **Troubleshooting** — every failure mode we have hit, with diagnosis and fix.

## Screenshots

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/1-start.png" alt="Start screen" /><figcaption>Start screen</figcaption></figure>
  <figure><img src="/img/screenshots/2-alternativen.png" alt="Alternatives list" /><figcaption>Alternatives</figcaption></figure>
  <figure><img src="/img/screenshots/3-reisebegleiter-timeline.png" alt="Companion timeline" /><figcaption>Companion timeline</figcaption></figure>
  <figure><img src="/img/screenshots/5-filter-sheet.png" alt="Filter sheet" /><figcaption>Filter sheet</figcaption></figure>
  <figure><img src="/img/screenshots/9-leer-zustand.png" alt="Empty state" /><figcaption>Empty state</figcaption></figure>
  <figure><img src="/img/screenshots/10-darkmode-beispiel.png" alt="Dark mode example" /><figcaption>Dark mode</figcaption></figure>
</div>

## Tech stack at a glance

| Layer | Technology |
|-------|------------|
| **Backend** | Go 1.25 — chi router, pgx/v5, go-redis, Prometheus metrics |
| **Frontend** | React 19, TypeScript, Vite 6, TanStack Query, Zustand, Tailwind CSS, shadcn/ui |
| **Database** | PostgreSQL 16 |
| **Cache** | Valkey 8 (BSD Redis fork, volatile-LRU, 256 MB cap) |
| **Reverse proxy** | Nginx (production) |
| **Containerisation** | Docker + Docker Compose |
| **External data** | `v6.db.transport.rest` — open HAFAS API for DB realtime data |
| **PWA** | vite-plugin-pwa + Workbox, installable on iOS and Android |

## Five-minute mental model

1. Frontend creates a *journey* (`POST /v1/journeys`) with train number + destination + filters.
2. Backend runs BFS, persists the resulting route in Postgres, caches in Valkey, starts a 30-second poller goroutine.
3. Poller fetches realtime data from HAFAS, applies trip updates to the legs, recomputes the summary, and re-runs BFS to find alternatives.
4. Frontend polls `GET /v1/journeys/{id}/summary` with `If-None-Match`. Backend returns **304** when nothing changed, **200** + a new ETag otherwise.
5. When `summary.alternativeAvailable === true`, the UI loads `GET /v1/journeys/{id}/alternatives` and surfaces a ranked list to the user.
6. User taps an alternative → the poller switches to that route. User taps "complete journey" → `DELETE /v1/journeys/{id}` stops the poller.

Continue with the [Quick start](./getting-started/quick-start-docker).
