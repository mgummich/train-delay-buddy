---
id: frontend
title: Frontend internals
sidebar_position: 3
---

# Frontend internals

React 19 + TypeScript SPA, Vite 8, installable PWA via `vite-plugin-pwa` (Workbox). Prod served as static files by Nginx; API reverse-proxied same-origin.

## Folder map

```
frontend/src/
├── api/
│   ├── client.ts          # openapi-fetch + X-Install-Id middleware
│   ├── types.gen.ts       # generated from backend/openapi.yaml (DO NOT EDIT)
│   └── validation.ts      # Zod runtime guards
├── components/            # UI primitives
├── hooks/                 # TanStack Query hooks per resource
├── i18n/                  # i18next + de.json
├── lib/
│   ├── datetime.ts        # UTC ISO → Europe/Berlin
│   ├── indexeddb.ts       # offline persistence (idb wrapper)
│   ├── installId.ts       # device UUID (IDB primary, localStorage fallback)
│   └── queryClient.ts     # TanStack Query client + key factories
├── mocks/                 # MSW handlers — tests AND dev (?mock=1)
├── router.tsx             # React Router 6.4 + loader-based priming
├── screens/               # full-page components (one per route)
├── store/                 # Zustand stores
└── test/                  # shared test setup
```

## State management

Three orthogonal layers:

| Layer | Tool | Owns |
|-------|------|------|
| Server state | TanStack Query 5 | Backend data — cache, dedup, refetch, retry, poll |
| Persistent client state | Zustand + `persist` | `journeyId`, filters, theme. Survives via `localStorage` |
| UI ephemeral | `useState` / `useReducer` | Sheets, focus, in-progress input. Lost on reload (correct) |

**Journey data is never written to Zustand** — it is server state. Only the *pointer* is persisted.

## Polling + ETag

Active-journey screens use `refetchInterval: 30_000`. `openapi-fetch` auto-attaches the last seen `ETag` as `If-None-Match`.

- `304`: cached body surfaced, `data` ref unchanged, React skips re-render. Wire cost ~150 bytes per poll.
- `200`: cache + `query.data` update, components re-render. Interval continues.

## React Router 6.4 loaders

Each screen `loader` primes the TanStack Query cache *before* render — eliminates post-navigation spinner flash:

```ts
const journeyRoute = {
  path: "/journey/:id",
  loader: async ({ params }) => {
    await queryClient.prefetchQuery({
      queryKey: journeyKeys.full(params.id!),
      queryFn: ({ signal }) => api.getJourney(params.id!, signal),
    });
    return null;
  },
  element: <CompanionScreen />,
};
```

When `<CompanionScreen>` mounts, data is cached and renders synchronously.

## End-to-end type safety

```
backend/openapi.yaml   ← source of truth
   │  npm run codegen  (openapi-typescript)
   ▼
frontend/src/api/types.gen.ts   ← auto-generated, do not edit
   │
   ▼
api/client.ts   ← openapi-fetch typed client; all paths statically checked
   │
   ▼
hooks/useJourneyFull.ts   ← TanStack Query, fully typed
   │
   ▼
screens/CompanionScreen.tsx
```

CI `npm run codegen:check` fails on drift. Cannot ship a frontend whose types diverge from the spec.

## Boundary validation

OpenAPI types describe shape, not runtime correctness. `src/api/validation.ts` has Zod schemas per endpoint that flow into UI logic. Hooks call `safeParse(schema, data)` at the fetch boundary to catch:

- Backend regressions shipped without OpenAPI update.
- Service Worker serving corrupted cache.

`safeParse` **never throws.** On a schema mismatch it logs `[API schema drift]` with the Zod issues and returns the raw data unchanged. Crashing a live journey mid-trip is worse than rendering a slightly wrong field, so drift degrades instead of failing.

The consequence is that the `JourneySummary` return type is a deliberate lie on the failure path — a field the type promises may be absent at runtime. **Render paths must therefore tolerate garbage rather than trust the type.** `lib/datetime.ts` is where that is absorbed:

| Function | Malformed input | Why |
|----------|-----------------|-----|
| `formatTime`, `formatDateTime` | renders `–` | A bad timestamp must not throw mid-render |
| `minutesSince` | returns `Infinity` | Unknown freshness must *surface* the stale-data warning, not hide it |

Validate at each boundary a value actually crosses — which is not the same as validating once per shape. `CompanionScreen` re-`safeParse`s `journey.summary` even though the polled summary was already validated, because that field arrives from `GET /journeys/{id}`, a different endpoint. Its generated type is also looser: several fields the Zod schema requires are `?:` optional in the OpenAPI spec, so the call is a real narrowing, not a duplicate.

## Error handling + retry

Every hook throws through `apiError(response, error)` in `src/api/client.ts`, which stamps two fields onto the throwable:

- `status` — from the `Response`, not the body. A non-JSON upstream failure (nginx 502/504 HTML) leaves openapi-fetch's `error` undefined, so hooks gate on `!response.ok`, never on `if (error)`. Gating on `error` would resolve the query with `undefined` data instead of failing.
- `retryAfter` — parsed from the `Retry-After` header, which is unreachable once the body has been read off the `Response`. Only the HTTP-delay-seconds form is supported; the HTTP-date form yields `undefined` rather than `NaN`.

`lib/queryClient.ts` reads both back:

| Error | Retry? | Delay |
|-------|--------|-------|
| 4xx except 429 | No | — |
| 429 with `Retry-After` | Yes, ≤ 3× | `min(Retry-After × 2ⁿ, 300s)` — per [`openapi.yaml`](../api/reference) |
| 5xx, network, unknown | Yes, ≤ 3× | `min(1s × 2ⁿ, 30s)` |

The backend rate limiter sends `Retry-After: 30`, so a throttled client backs off 30s / 60s / 120s. Honouring the header is a contract, not an optimisation: ignoring it means three retries inside 7 seconds against a limiter that asked for 30.

## Install ID

`X-Install-Id` identifies the device for rate-limit + ownership. `lib/installId.ts`:

1. Read IDB store `install`.
2. Fall back to `localStorage` (legacy or Safari Private Browsing).
3. Else generate `crypto.randomUUID()`, write both.

Survives Safari's "clear website data" most of the time — abuse-shaping, not security identity.

## i18next

Bundled: `de` (default), `en` (fallback). `src/i18n/de.json` working copy. Keys by feature path (`screens.start.title`). Synchronous load — no Suspense needed.

## PWA layer

`vite.config.ts` registers `VitePWA`:

- `registerType: "autoUpdate"` — Workbox updates SW on new build.
- Pre-cache: `index.html`, hashed JS/CSS/fonts, all icons.
- Runtime cache: see [PWA installation](../usage/pwa-installation).

## Build

```
npm run build
  ├─ tsc -b           (project references, strict, no emit)
  └─ vite build       (esbuild, Rollup, Workbox → sw.js + workbox-*.js)
       └─ dist/
            ├─ index.html
            ├─ assets/*.[hash].{js,css}
            ├─ icons/...
            ├─ manifest.json
            └─ sw.js
```

`dist/` copied into Nginx image at `/usr/share/nginx/html`.

## Testing surface

- **Unit:** Vitest + jsdom + MSW. See [Testing → Frontend unit](../testing/frontend-unit).
- **E2E:** Playwright against full stack. See [Testing → End-to-end](../testing/end-to-end).
