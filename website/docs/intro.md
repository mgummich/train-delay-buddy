---
id: intro
title: Introduction
slug: /
sidebar_position: 1
---

# Verspätungs-Begleiter

**Real-time alternative routing for Deutsche Bahn journeys.**

Enter current train + destination station. Backend monitors the connection by polling [HAFAS](https://v6.db.transport.rest) every 30 s. As delays emerge, a BFS routing engine surfaces ranked alternatives that arrive earlier — with transfer buffer, risk badges, confidence indicators.

:::info Not affiliated with Deutsche Bahn
Uses public, community-operated [`v6.db.transport.rest`](https://v6.db.transport.rest) HAFAS proxy. No API key.
:::

## What this site covers

Single source of truth for the project:

- **Getting started** — prerequisites, Docker quick-start, non-Docker dev.
- **Usage** — app walkthrough, PWA install on iOS/Android/desktop.
- **Architecture** — backend (Go, chi, poller, BFS), frontend (React 19, Vite, TanStack Query), data flow, multi-layer cache.
- **Configuration** — every env var, Compose layout, dev vs. prod.
- **API reference** — endpoints, conventions (RFC 7807, `Idempotency-Key`, `If-None-Match`), OpenAPI source.
- **Database** — schema, migrations, direct access.
- **Development** — scripts, codegen, pre-commit hooks.
- **Testing** — Go, Vitest + MSW, Playwright E2E.
- **Operations** — prod deploy, Prometheus, probes, CI/CD that built this site.
- **Troubleshooting** — every failure mode hit, with diagnosis + fix.

## Screenshots

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/1-start.png" alt="Start screen" /><figcaption>Start screen</figcaption></figure>
  <figure><img src="/img/screenshots/2-alternativen.png" alt="Alternatives list" /><figcaption>Alternatives</figcaption></figure>
  <figure><img src="/img/screenshots/3-reisebegleiter-timeline.png" alt="Companion timeline" /><figcaption>Companion timeline</figcaption></figure>
  <figure><img src="/img/screenshots/5-filter-sheet.png" alt="Filter sheet" /><figcaption>Filter sheet</figcaption></figure>
  <figure><img src="/img/screenshots/9-leer-zustand.png" alt="Empty state" /><figcaption>Empty state</figcaption></figure>
  <figure><img src="/img/screenshots/10-darkmode-beispiel.png" alt="Dark mode example" /><figcaption>Dark mode</figcaption></figure>
</div>

## Stack

| Layer | Tech |
|-------|------|
| Backend | Go 1.25 — chi, pgx/v5, go-redis, Prometheus |
| Frontend | React 19, TypeScript, Vite 8, TanStack Query, Zustand, Tailwind, shadcn/ui |
| Database | PostgreSQL 18 |
| Cache | Valkey 9.1 (BSD Redis fork, volatile-LRU, 256 MB cap) |
| Reverse proxy | Nginx (prod) |
| Containers | Docker + Compose |
| External data | `v6.db.transport.rest` — open HAFAS for DB realtime |
| PWA | vite-plugin-pwa + Workbox, installable iOS + Android |

## Five-minute mental model

1. Frontend creates a *journey* (`POST /v1/journeys`) with train + destination + filters.
2. Backend runs BFS, persists in Postgres, caches in Valkey, starts a 30 s poller goroutine.
3. Poller fetches HAFAS realtime, applies updates to legs, recomputes summary + alternatives.
4. Frontend polls `/summary` with `If-None-Match`. Backend → **304** unchanged, **200** + new ETag otherwise.
5. `summary.alternativeAvailable === true` → UI loads `/alternatives` and surfaces ranked list.
6. Tap alternative → poller switches. Tap "complete journey" → `DELETE /v1/journeys/{id}` stops poller.

Continue: [Quick start](./getting-started/quick-start-docker).
