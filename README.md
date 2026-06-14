# Verspätungs-Begleiter

<div align="center">

![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791?logo=postgresql&logoColor=white)
![Valkey](https://img.shields.io/badge/Valkey-9.1-B5C2FF?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-22c55e)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa)

**Real-time alternative routing for Deutsche Bahn journeys.**
Enter train + destination — app monitors the connection live and surfaces faster alternatives as delays emerge.

> **Not affiliated with Deutsche Bahn.** Uses a self-hosted [`db-vendo-client`](https://github.com/public-transport/db-vendo-client) HAFAS sidecar for realtime data.

📖 **Full documentation:** [https://mgummich.github.io/train-delay-buddy/](https://mgummich.github.io/train-delay-buddy/)

</div>

---

## What it does

1. Enter a train (e.g. `ICE 123`) + destination.
2. Backend polls HAFAS every 30 s for realtime updates on every leg.
3. BFS routing engine reruns in background, computes earlier-arriving alternatives.
4. Frontend shows ranked alternatives with time gain, transfer buffer, risk badges.
5. Tap an alternative → poller follows the new route.
6. Install as PWA for offline + home-screen access.

## Screenshots

<div align="center">

| Start | Alternatives | Companion timeline |
|:---:|:---:|:---:|
| ![Start screen](design_handoff_verspaetungsbegleiter/screenshots/1-start.png) | ![Alternatives](design_handoff_verspaetungsbegleiter/screenshots/2-alternativen.png) | ![Timeline](design_handoff_verspaetungsbegleiter/screenshots/3-reisebegleiter-timeline.png) |

| Filter sheet | Empty state | Dark mode |
|:---:|:---:|:---:|
| ![Filter](design_handoff_verspaetungsbegleiter/screenshots/5-filter-sheet.png) | ![Leer](design_handoff_verspaetungsbegleiter/screenshots/9-leer-zustand.png) | ![Dark](design_handoff_verspaetungsbegleiter/screenshots/10-darkmode-beispiel.png) |

</div>

More screens: [`design_handoff_verspaetungsbegleiter/screenshots/`](design_handoff_verspaetungsbegleiter/screenshots/).

## Stack

| Layer | Tech |
|-------|------|
| Backend | Go 1.25 — chi, pgx/v5, go-redis, Prometheus |
| Frontend | React 19, TypeScript, Vite 8, TanStack Query, Zustand, Tailwind, shadcn/ui |
| Database | PostgreSQL 18 |
| Cache | Valkey 9.1 (BSD Redis fork, volatile-LRU, 256 MB cap) |
| Reverse proxy | Nginx (prod) |
| Containers | Docker + Compose |
| External data | `db-vendo-client` sidecar — self-hosted HAFAS for DB realtime |
| PWA | vite-plugin-pwa + Workbox, installable iOS + Android |

## Quick start

```bash
git clone git@github.com:mgummich/train-delay-buddy.git verspaetungs-begleiter
cd verspaetungs-begleiter
cp .env.example .env          # set POSTGRES_PASSWORD
docker compose up -d
docker compose logs -f        # wait until healthy (~20 s first run)
```

| URL | Service |
|-----|---------|
| `http://localhost:5173` | Frontend (Vite + HMR) |
| `http://localhost:8080` | Backend API |
| `http://localhost` | Full app via Nginx |
| `http://localhost:8080/readyz` | Health — Valkey / Postgres / HAFAS |

Full setup, env vars, local-without-Docker, IDE debug → [Getting started](https://mgummich.github.io/train-delay-buddy/getting-started/quick-start-docker).

## Project structure

```
verspaetungs-begleiter/
├── backend/         # Go binary (cmd/server + internal/{api,journey,hafas,routing,…})
├── frontend/        # React 19 + Vite SPA / PWA
├── tests/e2e/       # Playwright suites
├── nginx/           # Reverse proxy + security headers + SPA fallback
├── website/         # Docusaurus documentation site
├── docs/            # Specs
└── docker-compose.{yml,override.yml}
```

Detail in [Architecture overview](https://mgummich.github.io/train-delay-buddy/architecture/overview).

## Documentation

The Docusaurus site at [mgummich.github.io/train-delay-buddy](https://mgummich.github.io/train-delay-buddy/) is the single source of truth for:

- [Getting started](https://mgummich.github.io/train-delay-buddy/getting-started/quick-start-docker) — Docker quick-start, local dev, prerequisites
- [Architecture](https://mgummich.github.io/train-delay-buddy/architecture/overview) — backend, frontend, data flow, caching
- [Configuration](https://mgummich.github.io/train-delay-buddy/configuration/environment-variables) — every env var, Compose layout
- [API reference](https://mgummich.github.io/train-delay-buddy/api/reference) — endpoints, conventions, OpenAPI
- [Database](https://mgummich.github.io/train-delay-buddy/database) — schema, migrations, queries
- [Testing](https://mgummich.github.io/train-delay-buddy/testing/concept) — unit, E2E, performance
- [Operations](https://mgummich.github.io/train-delay-buddy/operations/deployment) — prod deploy, monitoring, CI/CD
- [Troubleshooting](https://mgummich.github.io/train-delay-buddy/troubleshooting) — every failure mode hit
- [Contributing](https://mgummich.github.io/train-delay-buddy/contributing)

Build the docs locally:

```bash
cd website && npm ci && npm run start
```

## License

MIT.
