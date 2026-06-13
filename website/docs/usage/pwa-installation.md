---
id: pwa-installation
title: PWA installation
sidebar_position: 2
---

# PWA installation

Frontend is a fully installable PWA. Service worker pre-caches static assets so previously visited screens render offline.

## iOS (Safari)

1. Open URL in **Safari** — iOS does *not* support PWA install from third-party browsers.
2. Tap **Share** → **Add to Home Screen** → **Add**.

Launches stand-alone (no Safari chrome), own switcher card.

## Android (Chrome)

1. Open in Chrome.
2. Tap **Install app** in address bar, or menu → **Add to Home Screen** → **Install**.

Behaves native, own launcher icon.

## Desktop (Chrome / Edge / Brave)

1. Open in browser.
2. Click **install** icon (download-style) in address bar → confirm.

Opens in its own window, no browser chrome.

## Service worker

| Asset class | Strategy | Reason |
|-------------|----------|--------|
| `index.html` | Stale-while-revalidate | Fast first paint, eventual consistency on releases |
| `*.js`, `*.css`, `*.woff2`, `*.png`, `*.svg`, `*.ico` (Vite-hashed) | Cache-first, 1 yr | Hashed names = immutable |
| `GET /v1/journeys/*/summary` | Network-only | Realtime must be fresh |
| `GET /v1/stations` | Network-only | Cached server-side in Valkey |
| `GET /v1/trains/{number}` | Network-only | Same |
| Everything else | Network-first, 5 s timeout | Safe default — cache fallback |

## Offline state loader

When offline, `OfflineStateLoader` reads last-known snapshot from IndexedDB + renders with clear "offline" banner. Polling stops; retry button forces fresh fetch.

Offline cache invalidates on:

- Journey termination (`DELETE /v1/journeys/{id}`).
- TTL expiry (default 2 h).
- New journey created.

## Updates

SW checks for updates each launch. New bundle → non-blocking toast:

> A new version is available. Reload to update.

Tap reloads with fresh assets. Slow-network users can dismiss + continue; applied on next launch.

## Verify in DevTools

Chrome DevTools → **Application** → **Manifest** + **Service Workers**. Manifest should match `frontend/public/manifest.json`:

- `name: "Verspätungs-Begleiter"`
- `short_name: "VB"`
- `start_url: "/"`
- `display: "standalone"`
- `theme_color`, `background_color`, full icon set incl. 192×192 and 512×512.

Run **Lighthouse → PWA audit** to verify all criteria.
