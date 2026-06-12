---
id: frontend
title: Frontend internals
sidebar_position: 3
---

# Frontend internals

The frontend is a React 19 + TypeScript SPA built with Vite 6, packaged as an installable PWA via `vite-plugin-pwa` (Workbox). Production builds are served as static files by Nginx; the API is reverse-proxied to the Go backend on the same origin.

## Folder map

```
frontend/src/
├── api/
│   ├── client.ts          # openapi-fetch client with X-Install-Id middleware
│   ├── types.gen.ts       # generated from backend/openapi.yaml (DO NOT EDIT)
│   └── validation.ts      # Zod runtime guards over response payloads
├── components/            # UI primitives: AlternativeCard, FilterSheet, RiskBadge,
│                          # AppBar, Skeleton, ErrorBanner, ...
├── hooks/                 # TanStack Query hooks per resource:
│                          # useJourneyFull, useJourneyAlternatives,
│                          # useTrainValidation, useStationSearch, useOfflineState
├── i18n/                  # i18next configuration + de.json translations
├── lib/
│   ├── datetime.ts        # UTC ISO -> Europe/Berlin formatting
│   ├── indexeddb.ts       # offline persistence (idb wrapper)
│   ├── installId.ts       # persistent device UUID (IDB primary, localStorage fallback)
│   └── queryClient.ts     # TanStack Query client + key factories
├── mocks/                 # MSW handlers — used in tests AND dev (?mock=1 query param)
├── router.tsx             # React Router 6.4 — loader-based TanStack Query priming
├── screens/               # full-page components (one per route)
├── store/                 # Zustand stores: journeyStore, installStore, uiStore
└── test/                  # shared test setup, MSW handlers, factories, render()
```

## State management

Three orthogonal layers, each with a clear responsibility:

| Layer | Tool | Owns |
|-------|------|------|
| **Server state** | TanStack Query 5 | Everything fetched from the backend. Caching, deduplication, background refetch, retries, polling. |
| **Persistent client state** | Zustand + `persist` middleware | `journeyId` of the current journey, filters, theme. Survives reloads via `localStorage`. |
| **UI ephemeral state** | `useState` / `useReducer` | Sheet open/closed, focused field, in-progress form input. Lost on reload (correct behaviour). |

Crucially, **journey data is never written to Zustand**. The journey itself is server state — only the *pointer* to it lives in the persistent store.

## Polling and ETag

The active-journey screens use a TanStack Query hook with `refetchInterval: 30_000`. The `openapi-fetch` client automatically attaches the previously seen `ETag` value as `If-None-Match` on every subsequent request.

When the backend replies `304 Not Modified`, openapi-fetch surfaces the cached body, TanStack Query's `data` reference does not change, and React skips re-rendering. The polling cost is dominated by the round-trip — payload-wise, a 304 is ~150 bytes.

When the backend replies `200 OK` with a new ETag, the client cache and `query.data` update; React re-renders the affected components. The poll interval continues uninterrupted.

## React Router 6.4 loaders

Each screen has a `loader` that primes the TanStack Query cache *before* the route renders. This eliminates the "loading spinner immediately after navigation" flash:

```ts
const journeyRoute = {
  path: "/journey/:id",
  loader: async ({ params, request }) => {
    await queryClient.prefetchQuery({
      queryKey: journeyKeys.full(params.id!),
      queryFn: ({ signal }) => api.getJourney(params.id!, signal),
    });
    return null;
  },
  element: <CompanionScreen />,
};
```

By the time `<CompanionScreen>` mounts, the data is already in the cache and renders synchronously.

## Type safety end-to-end

```
backend/openapi.yaml   <—— source of truth (committed alongside any handler change)
   │
   │  npm run codegen  (openapi-typescript)
   ▼
frontend/src/api/types.gen.ts   <—— auto-generated, do not edit
   │
   ▼
api/client.ts   <—— openapi-fetch typed client; every path + method is statically checked
   │
   ▼
hooks/useJourneyFull.ts   <—— TanStack Query hook; data is fully typed
   │
   ▼
screens/CompanionScreen.tsx   <—— consumes typed data
```

The CI pipeline runs `npm run codegen:check` which regenerates `types.gen.ts` and fails if it diverges from the committed version. There is no way to ship a frontend whose types do not match the OpenAPI spec.

## Validation at the boundary

OpenAPI's static types describe the *shape* of the response, not its runtime correctness. `src/api/validation.ts` defines Zod schemas for every endpoint that flow into UI logic. The hook calls `schema.parse(data)` before returning, which:

- Catches a backend regression that shipped without an OpenAPI update.
- Catches a Service Worker serving a corrupted cached payload.
- Provides a single, easily debuggable failure mode (`ZodError`) rather than a cryptic `undefined.map` deep in a render.

## Install ID

The `X-Install-Id` header identifies the device for rate-limit and ownership purposes. `lib/installId.ts`:

1. Reads from IndexedDB store `install`.
2. If missing, reads from `localStorage` (legacy or Safari Private Browsing fallback).
3. If still missing, generates a `crypto.randomUUID()`, writes it to both IDB and localStorage.

This survives Safari's "clear website data" *most* of the time and is good enough for abuse-shaping; it is not a security identity.

## i18next

Currently bundled languages: `de` (default) and `en` (fallback). `src/i18n/de.json` is the working copy. Strings are keyed by feature path (`screens.start.title`, `components.alternativeCard.transferBuffer`). Translations are loaded synchronously at boot — no Suspense fallback needed.

## PWA layer

`vite.config.ts` registers `VitePWA` with:

- `registerType: "autoUpdate"` — Workbox updates the service worker as soon as a new build is detected.
- Pre-cache list: `index.html`, all hashed JS / CSS / fonts, every icon.
- Runtime cache rules: see [PWA installation](../usage/pwa-installation) for the full table.

## Build pipeline

```
npm run build
  ├─ tsc -b           (full project references, strict mode, no emit)
  └─ vite build       (esbuild, Rollup, Workbox plugin emits sw.js + workbox-*.js)
       └─ output: dist/
            ├─ index.html
            ├─ assets/*.[hash].js
            ├─ assets/*.[hash].css
            ├─ icons/...
            ├─ manifest.json
            └─ sw.js
```

`dist/` is then copied into the Nginx image at `/usr/share/nginx/html`.

## Testing surface

- **Unit**: Vitest, runs in jsdom. MSW intercepts every `fetch` so no backend is needed. See [Testing → Frontend unit](../testing/frontend-unit).
- **E2E**: Playwright drives a real browser against the full Docker Compose stack. See [Testing → End-to-end](../testing/end-to-end).
