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

**Typography:** Two font families loaded from Google Fonts (avoids generic Inter/Roboto look):
- Display: **Space Grotesk** — headlines, time gains, big numbers
- Body: **IBM Plex Sans** — UI text, labels, body copy

CSS fallback: `system-ui, -apple-system, sans-serif`. `html { font-size: 100%; }` — never override with fixed px.

| Role | Family | Size | Weight | Notes |
|------|--------|------|--------|-------|
| H1 (start title) | Display | 26px | 700 | line-height 1.18, letter-spacing -0.01em, max ~15ch |
| H2 (screen title) | Display | 20–21px | 600 | |
| H3 (card/stop name) | Display | 17px | 600 | |
| Body | Body | 16px | 400 | line-height ~1.5 |
| Label/field label | Body | 13px | 600 | muted color |
| Badge/chip | Body | 12–14px | 600 | |
| Group header | Body | 12.5px | 600 | uppercase, letter-spacing .04em, faint |

All time/number values: `font-variant-numeric: tabular-nums; white-space: nowrap` — apply via `.tnum` utility class.

**Full token set (`src/styles/tokens.css` — separate file, imported in `main.tsx`):**
```css
:root {
  /* Fonts */
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;

  /* Backgrounds */
  --bg-app: #F6F4F2;
  --bg-card: #FFFFFF;
  --bg-subtle: #F0ECE8;

  /* Text */
  --text-primary: #1F2329;
  --text-muted: #6B7280;
  --text-faint: #9CA3AF;

  /* Accent */
  --accent: #0F766E;
  --accent-hover: #0D615B;
  --accent-active: #0B4B47;
  --accent-soft: #E2EFEC;   /* icon chips, transfer blocks, node bg */
  --accent-ink: #FFFFFF;    /* text/icon on accent surfaces */

  /* Warn */
  --warn: #DC6B33;
  --warn-soft: #FBEADF;     /* critical transfer block bg */
  --warn-strong: #B91C1C;

  /* Borders */
  --border-subtle: #E5E7EB;
  --border-strong: #D1D5DB;

  /* Radius */
  --radius-input: 10px;
  --radius-card: 14px;
  --radius-sheet: 22px;
  --radius-btn: 12px;

  /* Shadows */
  --shadow-card: 0 1px 2px rgba(31,35,41,.04), 0 4px 16px rgba(31,35,41,.06);
  --shadow-lift: 0 2px 4px rgba(31,35,41,.06), 0 12px 28px rgba(31,35,41,.10);
  --shadow-sheet: 0 -8px 40px rgba(0,0,0,.18);

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
    --bg-subtle: #19212E;
    --text-primary: #E5E7EB;
    --text-muted: #9CA3AF;
    --text-faint: #6B7280;
    --accent: #34D399;
    --accent-hover: #2BBE85;
    --accent-active: #25A874;
    --accent-soft: #15302B;
    --accent-ink: #06241C;
    --warn: #F97316;
    --warn-soft: #3A2415;
    --warn-strong: #F87171;
    --border-subtle: #2B3543;
    --border-strong: #3A4658;
    --shadow-card: 0 1px 2px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.32);
    --shadow-lift: 0 2px 4px rgba(0,0,0,.34), 0 12px 28px rgba(0,0,0,.36);
  }
}

/* Animations */
@keyframes vb-pulse {
  0%, 100% { box-shadow: 0 0 0 4px var(--bg-card), 0 0 0 6px var(--accent-soft); }
  50% { box-shadow: 0 0 0 4px var(--bg-card), 0 0 0 10px transparent; }
}
@keyframes vb-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.vb-pulse { animation: vb-pulse 2.4s ease-in-out infinite; }
.vb-blink { animation: vb-blink 1.6s ease-in-out infinite; }
.tnum { font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .vb-pulse, .vb-blink { animation: none; }
}
```

**`tailwind.config.ts` full token mapping:**
```typescript
theme: {
  extend: {
    fontFamily: {
      display: 'var(--font-display)',
      body: 'var(--font-body)',
    },
    colors: {
      'bg-app': 'var(--bg-app)',
      'bg-card': 'var(--bg-card)',
      'bg-subtle': 'var(--bg-subtle)',
      'text-primary': 'var(--text-primary)',
      'text-muted': 'var(--text-muted)',
      'text-faint': 'var(--text-faint)',
      'accent': 'var(--accent)',
      'accent-hover': 'var(--accent-hover)',
      'accent-active': 'var(--accent-active)',
      'accent-soft': 'var(--accent-soft)',
      'accent-ink': 'var(--accent-ink)',
      'warn': 'var(--warn)',
      'warn-soft': 'var(--warn-soft)',
      'warn-strong': 'var(--warn-strong)',
      'border-subtle': 'var(--border-subtle)',
      'border-strong': 'var(--border-strong)',
    },
    borderRadius: {
      'input': 'var(--radius-input)',
      'card': 'var(--radius-card)',
      'sheet': 'var(--radius-sheet)',
      'btn': 'var(--radius-btn)',
    },
    boxShadow: {
      'card': 'var(--shadow-card)',
      'lift': 'var(--shadow-lift)',
      'sheet': 'var(--shadow-sheet)',
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
  outline: 2px solid var(--accent);
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
| `/settings` | SettingsScreen stub (V2 full impl) | `<FullPageError />` |

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

**StartScreen layout (from design handoff):**
- AppBar: brand mark (26×26 accent rounded-square radius 8 + wordmark "VerspätungsBegleiter" Display 15/600) + settings icon button 38×38 radius 10 → navigates to `/settings`
- Eyebrow badge: `accent-soft` pill, bolt icon + "Live-Umleitung", 12.5/600
- H1: "Schneller ans Ziel — ab deinem jetzigen Zug." (Display 26/700, max 15ch)
- Subtitle: muted 15/1.5 — "Wir überwachen deine Verbindung..."
- Info line (faint 12.5): info-circle icon + "Fokus: schnellere Ankunft — kein Ticketverkauf, keine offizielle DB-App."
- Form card: white, `radius-card` (14px), 1px `border-subtle`, padding 16, gap 16
- Primary button: full-width, 50px height, `radius-btn` (12px), accent bg + accent-ink text
- Secondary link: accent-colored text link, no border

**Input component spec:**
- Height: 48px, width: 100%, `radius-input` (10px), 1.5px `border-strong`
- Default: bg `bg-card`
- Focus: border `accent`, box-shadow `0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)`
- Error: border `warn`, error text faint 12.5 below field
- Leading icon 18px (train icon for Zugnummer, pin icon for Zielbahnhof)

**Form behavior:**
- `react-hook-form` + Zod resolver
- Train number: validate on `blur` via `GET /v1/trains/{number}` — inline error below field on 404
- Destination: autocomplete via `useStationSearch`; selection stores HAFAS station ID; validate on submit only
- `POST /v1/journeys` 422 `errors[]`: map backend field names → `setError()` on form fields
- Submit button disabled while train validation or POST inflight
- `Idempotency-Key` (UUID v4) generated per submit attempt; injected in `client.ts`

**Toggle "Ich sitze in diesem Zug" (design wording):**
- Default ON; subtext "Wir nehmen deine aktuelle Position als Startpunkt."
- When OFF: show "Startbahnhof" field (same autocomplete as destination)
- Radix `Switch` primitive — `role="switch"`, `aria-checked`, Space-key support

**Plausibility dialog (shadcn Dialog):**
- Trigger: `plausibility.onTrainConfidence !== 'high'` in POST response
- Buttons: "Ja, Route planen" (proceed) / "Nein, ich sitze nicht in diesem Zug" (set toggle OFF)

**PWA install UX:**
- Android: capture `beforeinstallprompt` → "App installieren" banner on StartScreen; dismissable; 7-day snooze in localStorage; hide when `display-mode: standalone`
- iOS: persistent "Zum Home-Bildschirm hinzufügen" hint on first visit; 7-day snooze; hide in standalone mode
- Both: dismiss when `window.matchMedia('(display-mode: standalone)').matches`

**Settings screen stub (`/settings`):**
- Add route `/settings` → `<SettingsScreen />` shell (Plan 2 delivers only the shell — AppBar gear must navigate somewhere)
- Full settings implementation is V2

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

**AlternativeCard spec (from design):**
- `radius-card` (14px), padding 16, gap 12, `shadow-card`
- Recommended card: `border-color: var(--accent)`, `shadow-lift`
- Time gain: Display 26/700, `accent` color, `tnum`, letter-spacing -0.02em
- Sub-line: clock icon + "Ankunft **{eta}**" · "{transfers} Umstiege" · "min. Puffer {n} Min" — muted 14.5 `tnum`
- Badges: pill 24px, 12.5/600, optional leading icon
  - "Schnellste": accent bg/ink, bolt icon
  - "Riskant": warn bg, alert icon
  - "Am stabilsten": accent-soft bg, accent text, shield icon
  - "Nur DB": neutral bg, muted text

**Filter row:**
- "Filter" chip: filter icon + count badge (accent pill, 11.5/700, min-width 18px) showing count of active filters
- Active filter chips: `accent-soft` bg, `accent` border + text, removable with `×` — clicking × removes that filter
- Chip height: 36px, `radius-badge` (999px), 1.5px border

**Filter sheet (shadcn Sheet — bottom sheet, `shadow-sheet`, top corners `radius-sheet`):**
- Grab handle: 38×4 bar, `border-strong`, radius 999
- Header: "Filter" (H2 20px) + "Zurücksetzen" link
- 4 blocks separated by dividers, gap 22:

  **Block 1 — Nur frühere Ankünfte** (toggle ON by default, always-on product rule — display-only for V1):
  - Toggle + label + subtext "Zeigt nur Wege, die vor deinem aktuellen Zug ankommen."
  - Radix Switch, `aria-checked="true"`, non-interactive in V1

  **Block 2 — Verkehrsmittel** (V1: display-only; fully wired in V2):
  - MultiChips: `Fernverkehr` (active), `Regional` (active), `S-Bahn` (inactive)
  - "Nur DB-Züge" inline toggle — **V1, fully functional** — wired to `installStore.filters.dbOnly`

  **Block 3 — Maximale Umstiege** (V2 stub):
  - Full-width segmented: `0 · 1 · 2 · 3 · egal`
  - Disabled in V1 with `opacity-50 cursor-not-allowed`

  **Block 4 — Puffer beim Umstieg** (V2 stub):
  - Full-width segmented: `Aggressiv · Normal · Vorsichtig`
  - Dynamic `bg-subtle` help block updates with selection (shield icon + contextual text)
  - Disabled in V1

- Apply button: full-width, 50px, accent — label: `{n} Verbindungen anzeigen` or `Keine Treffer — Suche anpassen` (when max-Umstiege `0`)
- Scrim: `rgba(15,20,28,.42)` behind sheet

**Header:**
- No active route: "Dein aktueller Zug bringt dich voraussichtlich um {time} ans Ziel." — in `bg-subtle` card strip, clock icon, no shadow
- Active route: "Deine derzeit überwachte Route → Ankunft {time}."

**Neu berechnen:**
- `POST /v1/journeys/{id}/alternatives` → 202 Accepted
- Then poll `GET /v1/journeys/{id}/alternatives` until fresh data
- Spinner in button; previous card list stays visible (not cleared) until response

**Nullfall (no better alternative):**
- Info text per product spec
- "Route überwachen" CTA → navigate to companion

**ErrorBanner** already built in Plan 2 — wire all variants here.

**Empty state (Leer — no faster alternative found):**
- Reference strip same as normal header (bg-subtle, clock icon, "19:42")
- Centered block (padding 24px 12px 8px):
  - 64×64 `accent-soft` rounded tile (radius 18), `accent` shield icon 30px
  - H2 "Aktuell keine schnellere Verbindung" (21px, max 18ch)
  - Muted body 14.5/1.55, max 32ch
  - Badge (28px, 12px px): blinking dot (`.vb-blink`) + "Live-Überwachung aktiv"
- Action card (`bg-card`, padding 16, gap 13):
  - Toggle row: "Benachrichtigen, wenn schneller möglich" (15/600) + muted sub + Radix Switch
  - Divider
  - Ghost button: `btn-ghost` — border `border-strong`, muted text, filter icon + "Filter lockern" → opens filter sheet

**`btn-ghost` button variant:** transparent bg, 1.5px `border-strong`, `text-primary`, same height/radius as primary button.

**Tests (Vitest):**
- Skeleton → card list transition on data load
- Nullfall/Leer state renders correctly (shield icon, blinking badge)
- Filter badges appear when filters active, removable × works
- Filter count badge on Filter chip increments correctly
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

**CompanionScreen layout (from design handoff):**
- SubAppBar: back arrow + centered "Reisebegleiter" eyebrow + settings gear
- Sticky header block (`position: sticky; top: 0; background: linear-gradient(var(--bg-app) 78%, transparent)`):
  - KPI card: Display 30/700 `+18 Min` accent `tnum` + "schneller"; muted 13.5 "als dein ursprünglicher Zug · Ankunft **19:24**"; divider; warn clock + "+10 Min Verspätung"
  - Next-step card: 38×38 `accent-soft` icon tile (radius 10) + 14.5/600 action text + muted sub (train, platform, buffer)
  - Tab bar: `bg-subtle` track (radius 12, padding 4); Timeline tab (list-glyph icon) + Karte tab (pin icon); active = white card + `shadow-card` + primary text; inactive = muted

**Timeline (Perlschnur) node specs (from companion.jsx):**
- Rail: 44px left column, continuous vertical line
- Rail segments: traveled = `accent` 3px solid; upcoming = `border-strong` 2.5px solid
- Active leg rail: animated dashed `accent` (repeating-linear-gradient 7px on / 6px off, 3px wide)
- Active leg train marker: 24px circle `accent` bg + `accent-ink` train icon, `boxShadow: 0 0 0 4px var(--bg-app)`, absolutely centered on rail — animate with `.vb-train` scrolling motion

Node variants (exact pixel sizes):
| State | Size | Style |
|-------|------|-------|
| `past` | 13px | filled `accent`, `boxShadow: 0 0 0 4px var(--bg-app)` |
| `current` | 22px | filled `accent`, inner 7px `accent-ink` dot, `.vb-pulse` animation, `boxShadow: 0 0 0 4px var(--bg-app), 0 0 0 6px var(--accent-soft)` |
| `future` | 14px | hollow, 2.5px `border-strong`, bg `bg-card`, `boxShadow: 0 0 0 4px var(--bg-app)` |
| `dest` | 16px | hollow, 2.5px `border-strong`, inner 5px `faint` dot, `boxShadow: 0 0 0 4px var(--bg-app)` |

Per-stop content (right column):
- H3 stop name (current stop: `accent` color)
- TimeLine row: real time (15/600 `tnum` bold) + delay (`+N` in `warn` or "pünktl." in `accent`, 13/600) + plan time struck-through `faint tnum 13` + platform badge ("Gl N") right-aligned neutral
- Leg block: line name 14.5/600 + direction faint 13.5 + duration muted 13 + (if current:) blinking `.vb-blink` dot badge "Jetzt unterwegs · +10 Min"
- Transfer block: `accent-soft` (ok) or `warn-soft` (critical), radius 12, padding 11/12; check or alert icon + "Umstieg · Puffer {N} Min" + "Weiter mit **{train}** ab Gleis {N}"; if critical: "Umstieg kritisch — Alternative ansehen →" warn-colored link → navigate to AlternativesScreen

**Critical state UX:**
- `status === 'critical'` OR `criticalTransfer === true`: warn badge on affected stop
- Transfer block shows "Umstieg kritisch" link in warn color

**Map view (Karte tab):**
- Same sticky header + Tab bar as Timeline (Karte tab active)
- Schematic map card (height 340, radius 16, `bg-subtle` bg with faint 36px grid lines via `background-image: linear-gradient`)
- SVG `viewBox="0 0 100 100"` inside:
  - Traveled portion: solid `accent` 3px polyline
  - Remaining: dashed `border-strong` 2px, dash 4/3, `vectorEffect="non-scaling-stroke"`
- Absolute-positioned station pins (% coordinates) with white label pills (12/700 + 10.5 `tnum` sub)
- "Du bist hier" pin: `.vb-pulse` accent circle + train icon
- Destination pin: hollow `accent` ring + pin icon
- Legend row: "Aktuelle Position" dot + "Restliche Route" dashed line, muted 12.5
- Info card (`bg-subtle`, no shadow): pin icon + "Schematische Übersicht..." note with **Timeline** bolded

**Timeline stop states:**
- Past: 13px filled accent, no keyboard focus needed (tabindex="-1", aria-hidden)
- Current: 22px pulsing, `aria-current="step"`, tabindex="0"
- Future: 14px hollow, tabindex="0"
- Critical transfer block: `warn-soft` bg, warn-colored text and icon

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
