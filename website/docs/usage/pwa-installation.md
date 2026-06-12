---
id: pwa-installation
title: PWA installation
sidebar_position: 2
---

# PWA installation

The frontend is a fully installable Progressive Web App. The service worker pre-caches all static assets so previously visited screens render offline.

## Install on iOS (Safari)

1. Open the app URL (e.g. `http://localhost` in dev, or your production URL) in **Safari** — iOS does *not* support PWA install from third-party browsers.
2. Tap the **Share** button.
3. Tap **"Add to Home Screen"**.
4. Tap **"Add"**.

The app now launches in stand-alone mode (no Safari chrome) and obtains its own switcher card.

## Install on Android (Chrome)

1. Open the app in Chrome.
2. Either tap the **"Install app"** prompt that appears in the address bar, or open the browser menu → **"Add to Home Screen"** → **"Install"**.

The app behaves like a native app with its own launcher icon.

## Install on desktop (Chrome / Edge / Brave)

1. Open the app in the browser.
2. Click the **install** icon in the right-hand side of the address bar (a download-style icon).
3. Confirm.

The app opens in its own window without browser chrome.

## Service worker behaviour

| Asset class | Strategy | Reason |
|-------------|----------|--------|
| `index.html` | **Stale-while-revalidate** | Fast first paint, eventual consistency on new releases |
| `*.js`, `*.css`, `*.woff2`, `*.png`, `*.svg`, `*.ico` (Vite-hashed) | **Cache-first, 1-year** | Hashed filenames make them immutable |
| `GET /v1/journeys/*/summary` | **Network-only** | Realtime data must be fresh — staleness breaks the use case |
| `GET /v1/stations` | **Network-only** | Autocomplete already cached server-side in Redis |
| `GET /v1/trains/{number}` | **Network-only** | Same reason |
| Everything else | **Network-first with 5 s timeout** | Safe default — falls back to cache for resilience |

## Offline state loader

When the network is unavailable, the `OfflineStateLoader` component reads the last-known journey snapshot from IndexedDB and renders it with a clear "offline" banner. Polling stops; a "retry" button forces a fresh fetch.

The offline cache is invalidated whenever:

- The user terminates the journey (`DELETE /v1/journeys/{id}`).
- The journey TTL expires (default 2 h).
- A new journey is created.

## Updating an installed PWA

The service worker checks for updates every time the app is launched. When a new bundle is detected, a non-blocking toast appears at the bottom:

> A new version is available. Reload to update.

Tapping reloads with the fresh assets. Users on slow networks can dismiss and continue using the old version; the update will be applied on the next launch.

## Verifying the PWA in DevTools

Open Chrome DevTools → **Application** → **Manifest** and **Service Workers**. The manifest should match `frontend/public/manifest.json`:

- `name: "Verspätungs-Begleiter"`
- `short_name: "VB"`
- `start_url: "/"`
- `display: "standalone"`
- `theme_color`, `background_color`, full icon set down to 192×192 and 512×512.

Run **Lighthouse → PWA audit** to verify all PWA criteria pass.
