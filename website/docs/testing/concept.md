---
id: concept
title: Test Concept
sidebar_position: 1
---

# Test Concept — Verspätungsbegleiter

Tests validate observable behaviour from the outside in. Every layer is automated — tests not run automatically do not exist.

## Pyramid

```
          ┌─────────────┐
          │ Performance │   Manual (k6)
         ┌┴─────────────┴┐
         │  E2E (Playwright) │  CI blocking
        ┌┴───────────────────┴┐
        │   Unit + Integration  │  CI blocking
       └───────────────────────┘
```

| Layer | Count | Tooling | CI |
|-------|-------|---------|----|
| Frontend unit | ~23 files / ~1,270 lines | Vitest + RTL + MSW | Blocks |
| Backend unit | ~24 files / ~1,970 lines | Go `testing` | Blocks |
| E2E | 7 spec files | Playwright 1.49+ | Blocks |
| Performance | 1 k6 script | k6 | Manual |

## Frontend Unit

**Stack:** Vitest 4.x (jsdom), RTL 16, MSW 2, `@tanstack/react-query` (`retry: false`), `fake-indexeddb/auto`.

**Infrastructure (`frontend/src/test/`):**
```
setup.ts          — MSW lifecycle, jsdom patches (matchMedia, connection, ResizeObserver)
render.tsx        — RTL wrapper: QueryClientProvider + MemoryRouter
msw-handlers.ts   — Default mocks + MSW_ERRORS factory
factories.ts      — Test data builders
polyfills.ts      — Node polyfills
```

**Coverage thresholds** (enforced via `vitest.config.ts`):

| Metric | Threshold |
|--------|-----------|
| Lines / Functions | 80% |
| Branches | 75% |

Excluded: `src/api/types.gen.ts`, `src/test/**`, `src/main.tsx`, `src/router.tsx`.

**Patterns:**
- ✅ Test components via public props + rendered output; `waitFor` / `findBy*` for async; override MSW per test via `server.use(http.get(...))`; prefer `getByRole` / `getByText` over `getByTestId`; seed `QueryClient` cache (`qc.setQueryData`) to skip network round-trips.
- ❌ Test internal hook state, assert CSS class names, leave `screen.debug()` in commits.

**Scope:**

| Area | Files | Scenarios |
|------|-------|-----------|
| API validation | `api/validation.test.ts` | Schema parsing, malformed payloads |
| DateTime | `lib/datetime.test.ts` | `formatTime`, timezone conversion |
| IndexedDB | `lib/indexeddb.test.ts` | save/load, offline read |
| Hooks | `hooks/use*.test.tsx` | Happy/error/polling |
| Components | `components/*/*.test.tsx` | Render, interactions, edge states |
| Screens | `screens/*.test.tsx` | Navigation, error, empty states |
| Stores | `store/stores.test.ts` | State transitions |

**Gaps:** `SummaryHeader` stale indicator boundary tests at `minutesSince = 0.5` / `2.0`; `useJourney` 90 s polling throttle; `router.tsx` navigation guards (currently excluded from coverage).

## Backend Unit

**Stack:** Go `testing`, `net/http/httptest`, `-race` always on, table-driven.

CI does not yet enforce a coverage threshold. Add `-coverprofile=coverage.out`; target 70%.

**Scope:**

| Package | Scenarios |
|---------|-----------|
| `api/handlers` | Status codes, parsing, response shape |
| `api/middleware` | Auth, CORS, rate limit, ownership, request-ID |
| `hafas` | Client, coalescer, filter, mapper |
| `journey` | ID generation, poller lifecycle, worker pool |
| `routing` | BFS pathfinding, scorer |
| `config` | Env var parsing, defaults |
| `migrate` | Migration idempotency |

**Patterns:**
- ✅ Table-driven I/O; `httptest.NewRecorder` + `httptest.NewServer`; boundary inputs (empty, max, zero).
- ❌ Hit real HAFAS, share mutable state across subtests, disable `-race`.

**Gaps:** no CI coverage threshold; HAFAS retry/transient-error tests missing; rate-limit Redis sliding-window tests thin (28 lines).

## E2E

**Stack:** Playwright 1.49+. Backend not required — all API calls mocked via `page.route()`. Vite preview auto-started by `playwright.config.ts`. Projects: Desktop Chrome, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 13, local only).

**Infrastructure (`tests/e2e/`):**
```
playwright.config.ts     — timeout 50s, retries 2 on CI
fixtures/test.ts         — base fixture, POM instances
fixtures/mocks.ts        — MockServer
pages/{start,alternatives,companion}.page.ts
```

**MockServer API:**

| Method | Purpose |
|--------|---------|
| `install(opts)` | Register full route table with defaults |
| `overrideSummary(id, summary)` | Replace summary mid-test |
| `overrideJourneyCreatePlausibilityLow(id)` | Trigger low-confidence dialog |
| `setOffline(offline)` | Abort all API routes (pair with `context.setOffline`) |
| `abortAllJourneys()` | Force journey lookups to network failure |
| `setAllJourneysNotFound()` | Force all journey lookups to 404 |

**Why `mocks.setOffline` exists:** `context.setOffline(true)` emulates browser offline; route handlers run at protocol layer and bypass it. `mocks.setOffline` registers a high-priority abort handler so mocks also stop responding.

**Timeout:** global 50 s. Offline tests assert with 35 s (one 30 s poll cycle + buffer); global must exceed 35 s plus setup.

**Specs:**

| Spec | Coverage |
|------|---------|
| `golden-path.spec.ts` | Start → alternatives → companion, deep link, ETA timezone, plausibility dialog, terminate |
| `start.spec.ts` | Form validation: submit disabled, train not found, destination required |
| `alternatives.spec.ts` | Filter chips: DB-only toggle, count badge |
| `critical-status.spec.ts` | Critical/failed banners, aria-live region |
| `offline.spec.ts` | Stale indicator, auto-recovery, offline nav |
| `deep-link.spec.ts` | Direct URL to companion, resume journey |
| `accessibility.spec.ts` | Axe audit (zero critical/serious) on three main screens |

**Patterns:**
- ✅ Page Object Model (selectors in `pages/`); semantic selectors over `getByTestId`; `mocks.install()` per test/`beforeEach`; `context.setOffline()` + `mocks.setOffline()` paired.
- ❌ `waitForTimeout()` (use `waitFor`, `toBeVisible({ timeout })`, `waitForURL`); shared journey state across tests; testing implementation details.

E2E is a **hard merge gate** (`needs: [frontend]`).

**Gaps:**

| Gap | Priority |
|-----|----------|
| StartScreen station-search 503 | Medium |
| AlternativesScreen `maxTransfers` toggle | Medium |
| Companion DELETE failure path | Medium |
| Companion browser back → alternatives | Low |
| Mobile Safari in CI | Low |

## Performance

**Stack:** k6, `tests/performance/k6/journey-creation.js`, real backend.

**SLOs:**

| Metric | Threshold |
|--------|-----------|
| `POST /v1/journeys` p95 | < 10 s |
| `GET /v1/journeys/{id}/summary` p95 | < 200 ms |
| HTTP error rate | < 1% |
| ETag 304 hit rate | > 50% |

**Scenarios:** steady (10 VUs / 1 min); spike (ramp 0 → 50 → 50 → 0 over 90 s, starts t+90 s).

**Lifecycle:** validate train → station autocomplete → create → idempotency replay → poll summary 3× with ETag → verify 304 → delete → second delete 404.

**Trigger:** not in CI (needs real HAFAS). Manual against staging:

```sh
k6 run --env BASE_URL=http://staging.example.com tests/performance/k6/journey-creation.js
```

**Gaps:** no alternatives-endpoint test; no soak; no scheduled CI run.

## Security Testing

SAST on every push:

| Tool | Scope | Config |
|------|-------|--------|
| Gitleaks | Secrets in git history | `continue-on-error: false` |
| gosec | Go code, severity ≥ high, confidence ≥ medium | SARIF → GitHub Security |
| Semgrep | All langs, OWASP Top 10 + secrets | `--error` |

**Gaps:** no DAST, no rate-limit bypass test, no body fuzzing on `POST /v1/journeys`, dependency scans (`govulncheck`, `npm audit`) not yet in CI.

## CI/CD Integration

```
push / PR to master
│
├── backend  → go mod verify → vet → build → test -race (coverage ≥ 55%) → govulncheck
├── frontend → npm ci → codegen:check → lint → typecheck → npm audit → vitest run
├── e2e (needs: frontend) → build → install browsers → typecheck → playwright test (hard gate)
├── sast → gitleaks → gosec → semgrep
└── docker (needs: backend, frontend) → compose validate → build images
```

Missing: weekly k6 run against staging.

## Accessibility

`accessibility.spec.ts` runs `@axe-core/playwright` on Start, Alternatives, Companion — zero critical/serious violations. Color-contrast rules excluded (require visual review). `critical-status.spec.ts` verifies aria-live attachment; asserting announcements is a remaining gap.

## Test Data

**Frontend:** fabricated by factories.

| Factory | Location | Usage |
|---------|----------|-------|
| `makeSummary(overrides)` | `tests/e2e/fixtures/mocks.ts` | E2E |
| `makeAlternative(id)` | same | E2E |
| `makeJourneyCreateResponse(opts)` | same | E2E |
| `DEFAULT_SUMMARY`, `DEFAULT_JOURNEY_ID` | `frontend/src/test/msw-handlers.ts` | Unit |
| `makeSummary(overrides)` | `frontend/src/test/factories.ts` | Unit |

**Backend:** inline literals or table-driven; no shared fixtures.

**Production data is never used** — CI runs against synthetic data only.

## Flakiness Policy

1. A test failing >1 in 5 runs is flaky — fix, do not retry.
2. Quarantine with `test.skip` + tracking issue link.
3. Playwright `retries: 2` catches transient browser issues, not logic flaws.
4. Offline tests (35 s window) are load-sensitive — keep as smoke tests; for finer control use `vi.useFakeTimers` in unit tests.

## Debug Files

`debug-*.spec.ts` must not be committed — `.gitignore` or delete.
