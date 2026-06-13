---
id: app-walkthrough
title: App walkthrough
sidebar_position: 1
---

# App walkthrough

Tour of every screen in the order a user encounters them.

## 1. Start

Entry point. Enter train number (`ICE 123`) + autocomplete destination.

![Start screen](/img/screenshots/1-start.png)

- Train number validated against `GET /v1/trains/{number}` (debounced 300 ms).
- Autocomplete → `GET /v1/stations?q=` (≤10 matches, 5 min Valkey cache).
- Filter sheet (slider icon) constrains routing: `dbOnly`, `safetyLevel`, `maxTransfers`.

## 2. Filter sheet

![Filter sheet](/img/screenshots/5-filter-sheet.png)

Persisted to `localStorage` → survives reloads → becomes `filters` of `POST /v1/journeys`.

| Filter | Meaning |
|--------|---------|
| DB only | Excludes regional carriers (BRB, ODEG, MetronomeRail, …) from BFS |
| Safety level | Min transfer buffer: `low` (3 min), `medium` (5 min, default), `high` (8 min) |
| Max transfers | Hard cap on leg-to-leg transfers |

## 3. Alternatives

After "Start" → ranked feed of routes arriving earlier than current train, given live delays.

![Alternatives list](/img/screenshots/2-alternativen.png)

Each card:

- **Time gain** vs. current route ("−12 min", green).
- **Transfer buffer** — min minutes between connections. `RiskBadge` when below threshold.
- **Confidence** — `high` (realtime), `medium` (partial), `low` (timetable).

Frontend polls `/summary` every 30 s. When `alternativeAvailable` flips true, list is invalidated + refetched.

## 4. Companion (timeline)

Tap an alternative or current train → *Reisebegleiter* view: full multi-leg timeline, realtime times, platforms, deltas.

![Companion timeline](/img/screenshots/3-reisebegleiter-timeline.png)

Pulls from `GET /v1/journeys/{id}/legs`. Stops rendered as vertical milestones:

- 🟢 on-time / arrived.
- 🟡 minor delay (< 5 min).
- 🔴 significant (≥ 5 min) or canceled.

Map view (alternative tab) shows geometry on tile layer:

![Map view](/img/screenshots/4-reisebegleiter-karte.png)

## 5. Transfer detail + language

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/7-detail-puffer.png" alt="Transfer buffer detail" /><figcaption>Transfer buffer detail</figcaption></figure>
  <figure><img src="/img/screenshots/8-detail-sprache.png" alt="Language detail" /><figcaption>Language settings</figcaption></figure>
</div>

## 6. Settings

Theme, language (DE/EN), notifications:

![Settings](/img/screenshots/6-einstellungen.png)

## 7. Empty + dark

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/9-leer-zustand.png" alt="Empty state" /><figcaption>Empty state</figcaption></figure>
  <figure><img src="/img/screenshots/10-darkmode-beispiel.png" alt="Dark mode" /><figcaption>Dark mode (system-driven)</figcaption></figure>
</div>

Theme follows system (`next-themes`); user override in settings.

## State persistence

Active journey survives reloads:

- `journeyId` → `localStorage` via `journeyStore` (Zustand + `persist`).
- Full snapshot also written to IndexedDB on every refresh — *Offline state loader* renders last-known when offline.
- `X-Install-Id` UUID (IDB primary + localStorage fallback) survives sessions and identifies device for rate-limit + ownership.
