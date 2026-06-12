---
id: app-walkthrough
title: App walkthrough
sidebar_position: 1
---

# App walkthrough

A guided tour of every screen, in the order a real user encounters them.

## 1. Start screen

The entry point. User enters a train number (e.g. `ICE 123`) and selects a destination station from an autocomplete dropdown.

![Start screen](/img/screenshots/1-start.png)

**Behind the scenes:**

- Train number is validated against `GET /v1/trains/{number}` as the user types (debounced 300 ms).
- The station autocomplete calls `GET /v1/stations?q=<text>` — the backend returns up to 10 station matches and caches the result in Valkey for 5 minutes.
- A filter sheet (accessed via the slider icon) lets the user constrain routing: `dbOnly`, `safetyLevel`, `maxTransfers`.

## 2. Filter sheet

![Filter sheet](/img/screenshots/5-filter-sheet.png)

Filters are persisted to `localStorage` so they survive page reloads. They become the `filters` field of `POST /v1/journeys`.

| Filter | Meaning |
|--------|---------|
| **DB only** | Exclude regional carriers (BRB, ODEG, MetronomeRail, etc.) from the BFS search space |
| **Safety level** | Minimum transfer buffer threshold: `low` (3 min), `medium` (5 min, default), `high` (8 min) |
| **Max transfers** | Hard cap on the number of leg-to-leg transfers in an alternative route |

## 3. Alternatives list

After tapping "Start", the user lands on the alternatives list — a ranked feed of routes that arrive earlier than the current train, given live delay data.

![Alternatives list](/img/screenshots/2-alternativen.png)

Each card shows:

- **Time gain** vs. the current route (e.g. "−12 min" highlighted in green).
- **Transfer buffer** — the minimum minutes between connecting trains. A `RiskBadge` is rendered when the buffer is below the safety threshold.
- **Confidence indicator** — `high` (full realtime), `medium` (partial), `low` (predicted from timetable).

The frontend polls `GET /v1/journeys/{id}/summary` every 30 s. When the summary's `alternativeAvailable` flag flips to `true`, the alternatives list is invalidated and refetched.

## 4. Companion (timeline) screen

Tapping an alternative — or the user's current train — opens the *Reisebegleiter* (companion) view, which renders the full multi-leg timeline with realtime arrival/departure times, platform numbers, and delay deltas.

![Companion timeline](/img/screenshots/3-reisebegleiter-timeline.png)

The timeline pulls leg + stop data from `GET /v1/journeys/{id}/legs` and renders each stop as a vertical milestone:

- **Green dot** — on time or arrived.
- **Amber dot** — minor delay (< 5 min).
- **Red dot** — significant delay (≥ 5 min) or canceled.

There is also a map view (alternative tab in the same screen) that shows the route geometry on a map tile layer.

![Map view](/img/screenshots/4-reisebegleiter-karte.png)

## 5. Transfer-detail and language screens

Two secondary screens accessible from the main navigation:

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/7-detail-puffer.png" alt="Transfer buffer detail" /><figcaption>Transfer buffer detail</figcaption></figure>
  <figure><img src="/img/screenshots/8-detail-sprache.png" alt="Language detail" /><figcaption>Language settings</figcaption></figure>
</div>

## 6. Settings

User-facing controls for theme, language (currently DE / EN), and notifications:

![Settings](/img/screenshots/6-einstellungen.png)

## 7. Empty and dark states

When the user has no active journey, the start screen renders an empty state with a call-to-action.

<div className="screenshot-grid">
  <figure><img src="/img/screenshots/9-leer-zustand.png" alt="Empty state" /><figcaption>Empty state</figcaption></figure>
  <figure><img src="/img/screenshots/10-darkmode-beispiel.png" alt="Dark mode" /><figcaption>Dark mode (system-driven)</figcaption></figure>
</div>

Theme follows the system preference by default (`next-themes`); users can override it manually in settings.

## State persistence

The active journey survives page reloads:

- The `journeyId` is stored in `localStorage` by `journeyStore` (Zustand + `persist` middleware).
- The full journey snapshot is also written to IndexedDB on every successful refresh, so the *Offline state loader* can render last-known data when the network is down.
- The persistent `X-Install-Id` UUID (generated on first launch, IndexedDB-primary with `localStorage` fallback) survives across browser sessions and identifies the device for rate-limit and ownership purposes.
