# Frontend Design — Verspaetungsbegleiter

**Date:** 2026-06-11
**Status:** Approved
**References:** `docs/superpowers/specs/2026-06-10-technical-architecture-design.md`, `docs/specs/pre-defined-research/product-spec.md`, `docs/specs/pre-defined-research/design-system.md`

---

## Overview

React 19 + TypeScript PWA split into 4 sequential implementation plans. Each plan ends with a runnable, demo-able deliverable. Plans build strictly on each other — no parallel dependencies.

---

## Plan Structure

### Plan 1 — Foundation

**Goal:** `docker compose up` starts full stack. Frontend dev server runs. Routes exist as shells. API client types generated. MSW ready to mock all endpoints.

**Deliverable:** Navigate to `/` in browser, see StartScreen shell. No real data — MSW returns canned responses. TypeScript strict, lint, CI green.

**Files created:**

| Path | Purpose |
|------|---------|
| `frontend/vite.config.ts` | Vite 6 + vite-plugin-pwa, workbox precache rules, `VITE_API_BASE_URL` env var |
| `frontend/public/manifest.json` | PWA manifest (name, icons, display: standalone, theme_color) |
| `frontend/tsconfig.json` | Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, paths `@/*` |
| `frontend/src/api/types.gen.ts` | Generated from `backend/openapi.yaml` via `openapi-typescript` — do not edit manually |
| `frontend/src/api/client.ts` | `openapi-fetch` typed client; X-Install-Id injection on every request; Zod boundary validation |
| `frontend/src/api/validation.ts` | Zod schemas mirroring all API response shapes; fail-fast on schema drift |
| `frontend/src/lib/installId.ts` | UUID v4 generation; IndexedDB primary + localStorage backup; read prefers IndexedDB |
| `frontend/src/lib/indexeddb.ts` | Typed IndexedDB wrapper; `schemaVersion: 1`; drop-on-version-mismatch |
| `frontend/src/lib/datetime.ts` | `Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' })` + `Intl.RelativeTimeFormat` |
| `frontend/src/lib/queryClient.ts` | TanStack Query client; staleTime/gcTime per query key; retry + `Retry-After` header support |
| `frontend/src/store/journeyStore.ts` | Zustand slice: `journeyId`, `etag`, `status`, `alternativeAvailable` |
| `frontend/src/store/installStore.ts` | Zustand slice: `installId`, `filters` (persisted to localStorage) |
| `frontend/src/store/uiStore.ts` | Zustand slice: `confirmDialogOpen`, `toasts` |
| `frontend/src/hooks/useOfflineState.ts` | Async IndexedDB read → Zustand hydration; must resolve before RouterProvider renders |
| `frontend/src/router.tsx` | React Router 6.4 routes; 3 routes wired with stub components; error boundaries per route |
| `frontend/src/main.tsx` | QueryClientProvider + RouterProvider; `useOfflineState` Suspense boundary wraps RouterProvider |
| `frontend/src/screens/StartScreen.tsx` | Shell only — returns placeholder div |
| `frontend/src/screens/AlternativesScreen.tsx` | Shell only |
| `frontend/src/screens/CompanionScreen.tsx` | Shell only |
| `frontend/src/mocks/handlers.ts` | MSW handlers for all 8 endpoints; generated from `backend/openapi.yaml` |
| `frontend/src/mocks/browser.ts` | MSW service worker setup |
| `frontend/tailwind.config.ts` | Design tokens → CSS vars → Tailwind extend; colors: `bg-app`, `bg-card`, `accent`, `warn` |
| `frontend/src/index.css` | CSS var declarations for light/dark; safe-area inset vars; `overscroll-behavior-y: contain` |
| `frontend/Dockerfile` | Multi-stage: dev (Vite HMR) + prod (nginx + built assets) |
| `frontend/.eslintrc.cjs` | ESLint + `@typescript-eslint` + `react-hooks` + `jsx-a11y` |
| `.husky/pre-commit` | lint-staged: typecheck + lint + format |
| `frontend/src/i18n/de.json` | i18n strings scaffold — all keys present, values empty or placeholder |
| `frontend/src/i18n/index.ts` | `react-i18next` init; `de` as sole namespace; `lng: 'de'` |

**CI steps added (`frontend/package.json` scripts):**
```
typecheck   → tsc --noEmit
lint        → eslint + prettier --check
test        → vitest run
build       → vite build
size-limit  → fail if JS bundle > 150KB gzipped
codegen:check → openapi-typescript --check (fail if types out of sync with openapi.yaml)
test:e2e    → playwright test (stub — no tests yet)
```

**shadcn/ui init:** Run `npx shadcn-ui@latest init` targeting Radix + Tailwind. Add: Dialog, Sheet, Switch, Toast, Popover, Badge, Button, Skeleton.

**Typography:** Geist Variable Font (self-hosted woff2 — one HTTP request for all weights). CSS fallback: `system-ui, -apple-system, sans-serif`. Font sizes:
- H1 (Start title): 1.5–1.75rem, Bold
- H2 (screen title): 1.25–1.375rem, Semibold
- H3 (card title, stop name): 1–1.125rem, Semibold
- Body: 1rem, Regular
- Label/Badge: 0.75–0.875rem, Medium

`html { font-size: 100%; }` — never override with fixed px.

**Full token set (`src/styles/tokens.css` — separate file, imported in `main.tsx`):**
```css
:root {
  /* Backgrounds */
  --bg-app: #F6F4F2;
  --bg-card: #FFFFFF;
  --bg-subtle: #F0ECE8;
  /* Text */
  --text-primary: #1F2329;
  --text-muted: #6B7280;
  --text-faint: #9CA3AF;
  /* Accent */
  --accent-primary: #0F766E;
  --accent-hover: #0D615B;
  --accent-active: #0B4B47;
  /* Warn */
  --warn: #DC6B33;
  --warn-strong: #B91C1C;
  /* Borders */
  --border-subtle: #E5E7EB;
  --border-strong: #D1D5DB;
  /* Motion */
  --motion-fast: 150ms;
  --motion-medium: 220ms;
  --motion-slow: 300ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-app: #111827;
    --bg-card: #1F2933;
    --bg-subtle: #111827;
    --text-primary: #E5E7EB;
    --text-muted: #9CA3AF;
    --accent-primary: #34D399;
    --warn: #F97316;
  }
}
```

**`tailwind.config.ts` full token mapping:**
```typescript
theme: {
  extend: {
    colors: {
      'bg-app': 'var(--bg-app)',
      'bg-card': 'var(--bg-card)',
      'bg-subtle': 'var(--bg-subtle)',
      'text-primary': 'var(--text-primary)',
      'text-muted': 'var(--text-muted)',
      'text-faint': 'var(--text-faint)',
      'accent': 'var(--accent-primary)',
      'accent-hover': 'var(--accent-hover)',
      'accent-active': 'var(--accent-active)',
      'warn': 'var(--warn)',
      'warn-strong': 'var(--warn-strong)',
      'border-subtle': 'var(--border-subtle)',
      'border-strong': 'var(--border-strong)',
    },
    transitionDuration: {
      'fast': 'var(--motion-fast)',
      'medium': 'var(--motion-medium)',
      'slow': 'var(--motion-slow)',
    },
    transitionTimingFunction: {
      'expo-out': 'var(--ease-out-expo)',
    },
  }
}
```

**Focus-visible (already in arch spec — implement in `src/styles/tokens.css`):**
```css
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: inherit;
}
```

**Micro-interactions:** Button/card tap: `active:scale-[0.97] transition-transform duration-fast ease-expo-out`. Applied via Tailwind utility on all interactive elements.

**View Transitions (in `router.tsx`):**
```typescript
// Wrap all programmatic navigations
document.startViewTransition?.(() => flushSync(() => navigate(path)))
```
```css
/* src/styles/tokens.css */
::view-transition-old(root) { animation: slide-out var(--motion-medium) var(--ease-out-expo); }
::view-transition-new(root) { animation: slide-in var(--motion-medium) var(--ease-out-expo); }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
}
```
Browsers without View Transitions API fall through to normal navigation — no error.

**`api/client.ts` — DELETE 404 handling:** `DELETE /v1/journeys/{id}` intentionally returns 404 on second call (non-idempotent by design). Client error handler must treat 404 on DELETE as a no-op (journey already gone), not a user-visible error.

**`api/validation.ts` — journeyId Zod schema:** `z.string().regex(/^jrn_[0-9a-z]{12,26}$/)` — use wherever journeyId is received from API.

**URL routes:**

| Route | Screen | Error boundary |
|-------|--------|---------------|
| `/` | StartScreen | `<FullPageError />` |
| `/journey/:journeyId/alternatives` | AlternativesScreen | `<ScreenError message="Verbindungen konnten nicht geladen werden" />` |
| `/journey/:journeyId/companion` | CompanionScreen | `<CompanionError />` (reads IndexedDB, shows stale data) |

**Hydration order (cold start):**
1. `main.tsx` renders App — `useOfflineState` awaits IndexedDB read via Suspense
2. If journey found: hydrate Zustand `journeyStore` with `journeyId` + ETag
3. React Router renders; loaders fire `queryClient.ensureQueryData(...)`
4. TanStack Query reads primed cache, starts polling
5. If loader 404 + IndexedDB empty → redirect to `/`

---

### Plan 2 — StartScreen

**Goal:** User can enter train number + destination, validate, and submit. Form fully functional against MSW. Plausibility dialog works.

**Deliverable:** Full StartScreen UX — train validation on blur, station autocomplete with debounce + AbortController, plausibility dialog, 422 field error mapping, submit disabled during inflight.

**Files created/modified:**

| Path | Purpose |
|------|---------|
| `frontend/src/screens/StartScreen.tsx` | Full implementation (replaces Plan 1 shell) |
| `frontend/src/hooks/useTrainValidation.ts` | `GET /v1/trains/{number}?date=today`; validates on blur; inline error |
| `frontend/src/hooks/useStationSearch.ts` | `GET /v1/stations?q=...`; 200ms debounce; AbortController on keystroke; min 2 chars |
| `frontend/src/components/Skeleton/index.tsx` | Base skeleton variants (card, text, inline) |
| `frontend/src/components/ErrorBanner/index.tsx` | Per-error-type banner variants (offline, 503, 500, 429, rate-limit) |
| `frontend/src/i18n/de.json` | Fill StartScreen string keys |

**Form behavior:**
- `react-hook-form` + Zod resolver
- Train number: validate on `blur` via `GET /v1/trains/{number}` — inline error below field on 404
- Destination: autocomplete via `useStationSearch`; selection stores HAFAS station ID; validate on submit only
- `POST /v1/journeys` 422 `errors[]`: map backend field names → `setError()` on form fields
- Submit button disabled while train validation or POST inflight
- `Idempotency-Key` (UUID v4) generated per submit attempt; injected in `client.ts`

**Toggle "Ich befinde mich in diesem Zug":**
- Default ON; subtext visible
- When OFF: show "Startbahnhof" field (same autocomplete as destination)

**Plausibility dialog (shadcn Dialog):**
- Trigger: `plausibility.onTrainConfidence !== 'high'` in POST response
- Buttons: "Ja, Route planen" (proceed) / "Nein, ich sitze nicht in diesem Zug" (set toggle OFF)

**PWA install UX:**
- Android: capture `beforeinstallprompt` → "App installieren" banner on StartScreen; dismissable; 7-day snooze in localStorage; hide when `display-mode: standalone`
- iOS: persistent "Zum Home-Bildschirm hinzufügen" hint on first visit; 7-day snooze; hide in standalone mode
- Both: dismiss when `window.matchMedia('(display-mode: standalone)').matches`

**Tests (Vitest):**
- Form validation rules (required fields, min length)
- Train validation error displayed on blur
- Plausibility dialog shown on `onTrainConfidence: 'low'`
- 422 errors mapped to correct form fields
- Submit disabled during inflight

---

### Plan 3 — AlternativesScreen

**Goal:** After StartScreen submit, user lands on AlternativesScreen with ranked alternatives. Can open detail sheet, apply filters, trigger re-route, select a route.

**Deliverable:** Full journey creation flow. POST /v1/journeys → alternatives list → filter sheet → route selection → navigate to CompanionScreen shell.

**Files created/modified:**

| Path | Purpose |
|------|---------|
| `frontend/src/screens/AlternativesScreen.tsx` | Full implementation |
| `frontend/src/hooks/useJourneySummary.ts` | One-shot `GET /v1/journeys/{id}` on screen mount; primed by router loader |
| `frontend/src/components/AlternativeCard/index.tsx` | Time gain title, arrival subline, transfer count, min buffer, badges; tap → detail Sheet |
| `frontend/src/components/RiskBadge/index.tsx` | Variants: Riskant, Schnellste, Am stabilsten, Nur DB, custom |
| `frontend/src/i18n/de.json` | Fill AlternativesScreen string keys |

**Router loader (AlternativesScreen):**
```typescript
export const alternativesLoader = (queryClient: QueryClient) =>
  async ({ params }: LoaderFunctionArgs) => {
    await queryClient.ensureQueryData(journeyQuery(params.journeyId!))
    return null
  }
```

**Alternatives list:**
- Skeleton cards (3 placeholders) on initial load; max 8s → error banner if no response
- Each card: tap → detail Sheet (mini Perlschnur, comparison vs original, "Diese Route wählen" button)
- "Diese Route wählen": store `journeyId` in Zustand + URL; navigate to `/journey/:id/companion`

**Filter sheet (shadcn Sheet):**
- "Nur DB-Züge" toggle (wired to `installStore.filters.dbOnly`) — V1, fully functional
- "Maximale Umstiege" + "Sicherheitslevel" — rendered as disabled stubs with "Demnächst verfügbar" label; wired in V2
- Active filter badge shown in filter row when DB-only is ON

**Header:**
- No active route: "Dein aktueller Zug bringt dich voraussichtlich um {time} ans Ziel."
- Active route: "Deine derzeit überwachte Route → Ankunft {time}."

**Neu berechnen:**
- `POST /v1/journeys/{id}/alternatives` → 202 Accepted
- Then poll `GET /v1/journeys/{id}/alternatives` until fresh data
- Spinner in button; previous card list stays visible (not cleared) until response

**Nullfall (no better alternative):**
- Info text per product spec
- "Route überwachen" CTA → navigate to companion

**ErrorBanner** already built in Plan 2 — wire all variants here.

**Tests (Vitest):**
- Skeleton → card list transition on data load
- Nullfall state renders correctly
- Filter badges appear when filters active
- 422 errors surfaced correctly
- "Neu berechnen" spinner + list retention

---

### Plan 4 — CompanionScreen + Offline + PWA

**Goal:** Active journey monitoring with live Perlschnur. Offline degrades gracefully. PWA installable and Playwright-tested.

**Deliverable:** Full companion screen with ETag polling. Staleness badges appear at correct thresholds. `status=critical` triggers warn UI. Playwright E2E covers happy path + offline + PWA.

**Files created/modified:**

| Path | Purpose |
|------|---------|
| `frontend/src/screens/CompanionScreen.tsx` | Full implementation |
| `frontend/src/hooks/useJourney.ts` | TanStack Query polling; adaptive interval; ETag via `If-None-Match`; `refetchIntervalInBackground: false` |
| `frontend/src/components/SummaryHeader/index.tsx` | Sticky KPI row + next-step card; `aria-live="polite"`; staleness badges; data-confidence indicator |
| `frontend/src/components/Timeline/index.tsx` | Perlschnur: stop nodes (past/current/future), leg blocks, platform + delay, transfer puffer badges; `@tanstack/react-virtual` at >15 stops |
| `frontend/src/i18n/de.json` | Fill CompanionScreen + error string keys |
| `frontend/e2e/journey.spec.ts` | Playwright: happy path, offline, PWA |

**Router loader (CompanionScreen):**
```typescript
export const companionLoader = (queryClient: QueryClient) =>
  async ({ params }: LoaderFunctionArgs) => {
    await queryClient.ensureQueryData(journeyQuery(params.journeyId!))
    return null
  }
// Deep link: if 404 → redirect to /
```

**Polling (useJourney.ts):**

| Condition | Interval |
|-----------|---------|
| Default foreground | 30s |
| Background tab | paused (`refetchIntervalInBackground: false`) |
| `status === 'critical'` OR `minTransferBufferMinutes < 5` | 10s |
| Idle > 5min (no interaction) | 90s |
| `navigator.connection?.saveData === true` | cap 90s |
| 429 response | honour `Retry-After` header × 2^n ms |

ETag flow: `If-None-Match` on every poll → 304 = no re-render; 200 = update Zustand → async write IndexedDB.

**SummaryHeader staleness thresholds (`dataFetchedAt` age):**

| Age | UI |
|-----|----|
| < 3 min | Normal |
| ≥ 3 min | "Möglicherweise veraltet" badge |
| ≥ 10 min | "Daten veraltet – kein Netz?" warning banner |

**Timeline stop states:**
- Past: filled neutral node
- Current: larger accent node
- Future: outline node
- Critical transfer: puffer badge in warn colour

**Critical state UX:**
- `status === 'critical'` OR `criticalTransfer === true`: warn badge on affected stop
- Action card: "Umstieg kritisch – Alternative +X Minuten schneller ansehen" → opens alternatives Sheet

**"Zu 'Jetzt' springen" floating button:** scrolls timeline to current leg.

**Monitoring modes:**
- Monitored (default): no header hint; polling active
- Unmonitored: header hint "Diese Route wird nicht überwacht. Tippe hier, um sie als aktive Reise zu überwachen."

**Journey end:**
- "Reise abschließen": `DELETE /v1/journeys/{id}` → 204 → clear Zustand → navigate `/`
- Browser back from Companion: confirmation dialog "Möchtest du die Route-Überwachung beenden?" (journey stays monitored until DELETE or TTL)

**Journey expiry:**
- Poll returns 404 `journey-not-found` → "Deine Reise ist abgelaufen" → CTA "Neue Verbindung suchen" → StartScreen

**ARIA requirements (from design-system.md):**
- SummaryHeader ETA/status updates: `aria-live="polite" aria-atomic="true"`
- `status === 'critical'` warn card: `role="alert" aria-live="assertive"` — announces immediately
- Timeline: `<ol role="list" aria-label="Reisestationen">`
  - Current stop: `aria-current="step"`, `tabindex="0"`
  - Future stops: `tabindex="0"`
  - Past stops: `tabindex="-1" aria-hidden="true"` (keyboard skip)
- "Zu 'Jetzt' springen" button: `aria-label="Zum aktuellen Halt springen"`; focus-manage to current stop after click
- RiskBadge "Riskant": `aria-label="Umstieg riskant — Puffer unter 5 Minuten"`
- Zeitgewinn "+18 Min": `aria-label="18 Minuten früher als ursprünglicher Zug"` (dynamic via `t()`)
- ETA display: `aria-label="Voraussichtliche Ankunft {time} Uhr"`
- Loading indicators: `role="status" aria-label="Verbindungen werden geladen"`

**`<CompanionError />` error boundary:**
- Reads IndexedDB for last-known summary before any error UI
- Shows stale data + "Verbindung unterbrochen" banner

**Offline degradation (useOfflineState fully wired):**
- Network fail → TanStack Query error → `useOfflineState` serves IndexedDB → SummaryHeader shows staleness
- Journey stays visible; no crash; no blank screen

**iOS safe-area insets (already in index.css from Plan 1 — verify applied):**
```css
.summary-header { padding-top: max(env(safe-area-inset-top), 16px); }
.bottom-cta     { padding-bottom: max(env(safe-area-inset-bottom), 16px); }
```

**SW `skipWaiting` guard:** `useOfflineState` writes `journeyId` + ETag to IndexedDB before every Zustand state update — CompanionScreen rehydrates from IndexedDB on forced reload without data loss.

**Playwright E2E (`e2e/journey.spec.ts`):**
1. Train number → alternatives → select route → companion renders with ETA
2. Offline mode: disconnect network → companion shows stale data + staleness banner
3. PWA: `display-mode: standalone` → install banner not shown

**Final `size-limit` gate:** CI fails if JS bundle > 150KB gzipped.

---

## Inter-Plan Dependencies

```
Plan 1 (Foundation)
  └── Plan 2 (StartScreen) — requires API client, MSW, Zustand, i18n from Plan 1
        └── Plan 3 (AlternativesScreen) — requires StartScreen form + POST flow from Plan 2
              └── Plan 4 (CompanionScreen) — requires journeyId in URL + Zustand from Plan 3
```

Each plan is strictly sequential. No plan should be started before the previous is merged and green on CI.

---

## What Is Not in These Plans (V2+)

- Von/Nach secondary start flow
- Filter sheet: max transfers + safety level UI (Plan 3 wires DB-only only; full filter UI is V2)
- Re-routing suggestion card in companion header
- Journey history view
- Push notifications
- Background Sync / Periodic Sync
