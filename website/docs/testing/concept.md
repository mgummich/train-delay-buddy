---
id: concept
title: Test Concept
sidebar_position: 1
---

# Test Concept — Verspätungsbegleiter

**Status:** Active  
**Last updated:** 2026-06-13

---

## 1. Philosophy

Tests validate observable behaviour from the outside in. Implementation details are not tested. The testing pyramid governs investment: many fast unit tests, fewer integration tests, fewer still E2E tests, one performance suite.

Every layer is automated. Tests that are not run automatically do not exist in practice.

---

## 2. Test Pyramid

```
          ┌─────────────┐
          │ Performance │   Manual trigger (k6)
         ┌┴─────────────┴┐
         │  E2E (Playwright) │  Blocking on CI
        ┌┴───────────────────┴┐
        │   Unit + Integration  │  Blocking on CI
       └───────────────────────┘
```

| Layer | Count | Tooling | CI Blocking |
|-------|-------|---------|-------------|
| Frontend unit | ~23 files / ~1,270 lines | Vitest + RTL + MSW | Yes |
| Backend unit | ~24 files / ~1,970 lines | Go `testing` | Yes |
| E2E | 7 spec files | Playwright 1.49+ | Yes (see §7) |
| Performance | 1 k6 script | k6 | Manual |

---

## 3. Frontend Unit Tests

### Tooling
- **Runner:** Vitest 3.2 (jsdom environment)
- **Component rendering:** React Testing Library 16
- **API mocking:** MSW 2 (`setupServer` in Node mode)
- **Async state:** `@tanstack/react-query` with `retry: false`
- **IndexedDB:** `fake-indexeddb/auto`

### Test Infrastructure

```
frontend/src/test/
  setup.ts          — MSW server lifecycle, jsdom patches (matchMedia, connection, ResizeObserver)
  render.tsx        — RTL wrapper: QueryClientProvider + MemoryRouter
  msw-handlers.ts   — Default API mocks + MSW_ERRORS factory
  factories.ts      — Test data builders (makeSummary, makeJourney, …)
  polyfills.ts      — Node-side polyfills
```

### Coverage Thresholds

Enforced via `vitest.config.ts`; CI fails if any threshold is breached.

| Metric | Threshold |
|--------|-----------|
| Lines | 80% |
| Functions | 80% |
| Branches | 75% |

Excluded from coverage: `src/api/types.gen.ts` (generated), `src/test/**`, `src/main.tsx`, `src/router.tsx`.

### Patterns

**Do:**
- Test each component in isolation through its public props and rendered output
- Use `waitFor` or `findBy*` for async state
- Override MSW handlers per test with `server.use(http.get(...))` to test error paths
- Prefer `getByRole` / `getByText` over `getByTestId` — role-based selectors are resilient
- Seed `QueryClient` cache directly (`qc.setQueryData`) to avoid network round-trips in rendering tests

**Don't:**
- Test internal hook state — test the component that uses the hook
- Assert CSS class names — assert visible text, roles, attributes
- Use `screen.debug()` in committed tests

### What Is Tested

| Area | Files | Key Scenarios |
|------|-------|---------------|
| API validation | `api/validation.test.ts` | Schema parsing, malformed payloads |
| DateTime | `lib/datetime.test.ts` | `formatTime`, timezone conversion |
| IndexedDB | `lib/indexeddb.test.ts` | save/load journey, offline read |
| Hooks | `hooks/use*.test.tsx` | Happy path, error states, polling |
| Components | `components/*/*.test.tsx` | Render, interactions, edge states |
| Screens | `screens/*.test.tsx` | Navigation, error states, empty states |
| Stores | `store/stores.test.ts` | State transitions |

### Gaps (to be filled)

- `SummaryHeader` stale indicator: no unit test for time-boundary transitions at `minutesSince = 0.5` and `2.0`
- `useJourney`: no test for `saveData: true` polling throttle (90 s path)
- `router.tsx` excluded from coverage — navigation guards deserve dedicated tests

---

## 4. Backend Unit Tests

### Tooling
- **Runner:** Go `testing` standard library
- **HTTP handler testing:** `net/http/httptest`
- **Race detection:** `-race` flag on every CI run
- **Pattern:** Table-driven tests

### Coverage Reporting

CI currently does not enforce a backend coverage threshold. Add `-coverprofile=coverage.out` to the CI test command and enforce a minimum threshold once the baseline is established (target: 70%).

### What Is Tested

| Package | Key Scenarios |
|---------|---------------|
| `api/handlers` | HTTP status codes, request parsing, response shape |
| `api/middleware` | Auth, CORS, rate limiting, ownership check, request-ID injection |
| `hafas` | Client, coalescer, filter, mapper |
| `journey` | ID generation, poller lifecycle, worker pool |
| `routing` | BFS pathfinding, scorer |
| `config` | Env var parsing, defaults |
| `migrate` | Schema migration idempotency |

### Patterns

**Do:**
- Table-driven tests for input/output variation
- `httptest.NewRecorder` + `httptest.NewServer` for handler tests
- Test boundary conditions: empty lists, max values, zero values

**Don't:**
- Hit real HAFAS or external services — use test doubles
- Share mutable state between subtests in a `TestXxx` function
- Skip the race detector (`-race` is always on)

### Gaps (to be filled)

- No coverage threshold enforced in CI
- HAFAS client: no test for transient network errors / retry logic
- Rate limit Redis tests are very thin (28 lines) — more coverage needed for sliding window semantics

---

## 5. E2E Tests

### Tooling
- **Runner:** Playwright 1.49+
- **Backend:** Not required — all API calls mocked via `page.route()`
- **Frontend:** Vite preview auto-started by `playwright.config.ts`
- **Projects:** Desktop Chrome, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 13, local only)

### Infrastructure

```
tests/e2e/
  playwright.config.ts     — config (timeout: 50s, retries: 2 on CI)
  fixtures/
    test.ts                — base fixture extending Playwright test with POM instances
    mocks.ts               — MockServer: install(), overrideSummary(), setOffline(), abortAllJourneys()
  pages/
    start.page.ts          — StartPage POM
    alternatives.page.ts   — AlternativesPage POM
    companion.page.ts      — CompanionPage POM
```

### Mock Server Design

`MockServer` intercepts all API traffic via `page.route()`. Tests call `mocks.install(opts)` once per test to register the full route table. Override methods allow per-test variation without re-installing:

| Method | Purpose |
|--------|---------|
| `install(opts)` | Register full route table with defaults |
| `overrideSummary(id, summary)` | Replace summary response mid-test |
| `overrideJourneyCreatePlausibilityLow(id)` | Trigger low-confidence dialog |
| `setOffline(offline)` | Abort all API routes (pair with `context.setOffline`) |
| `abortAllJourneys()` | Force journey lookups to network failure |
| `setAllJourneysNotFound()` | Force all journey lookups to 404 |

**Why `setOffline` is necessary:** `context.setOffline(true)` emulates browser offline but Playwright route handlers run at the protocol layer and bypass it. `mocks.setOffline(true)` registers a high-priority abort handler so mock routes also stop responding, matching real-world offline behaviour.

### Test Timeout

Global test timeout is 50 s. Offline tests assert with `timeout: 35_000` (one 30 s poll cycle + buffer) — this requires the global timeout to exceed 35 s plus setup time.

### Test Specs

| Spec | Coverage |
|------|---------|
| `golden-path.spec.ts` | Start → alternatives → companion, deep link, ETA timezone, plausibility dialog, terminate |
| `start.spec.ts` | Form validation — submit disabled on load, train not found, destination required |
| `alternatives.spec.ts` | Filter chip interaction — DB-only toggle, filter count badge |
| `critical-status.spec.ts` | Critical/failed status banners, aria-live region |
| `offline.spec.ts` | Stale indicator, auto-recovery, offline navigation |
| `deep-link.spec.ts` | Direct URL navigation to companion, resume existing journey |
| `accessibility.spec.ts` | Axe a11y audit (zero critical/serious violations) on all three main screens |

### Patterns

**Do:**
- Use Page Object Model — selectors live in `pages/`, not in spec files
- Use `getByTestId` only when no semantic selector works
- Keep tests independent — `mocks.install()` in each test or `beforeEach`
- Use `context.setOffline()` + `mocks.setOffline()` together for offline simulation

**Don't:**
- Call `waitForTimeout()` — use `waitFor`, `toBeVisible({ timeout: N })`, or `waitForURL`
- Share journey state between tests — use separate journey IDs per describe block
- Test implementation details through the UI — test what the user sees

### CI Blocking

E2E runs after the frontend job with `needs: [frontend]`. The `continue-on-error: true` flag is a **temporary workaround** while offline tests are stabilised. Once `offline.spec.ts` is consistently green, remove `continue-on-error` to make E2E a hard gate.

### Gaps (to be filled)

| Gap | Priority |
|-----|----------|
| Remove `continue-on-error: true` once offline tests pass | High |
| StartScreen: station search error state (API 503) | Medium |
| AlternativesScreen: filter toggle for maxTransfers | Medium |
| Companion: "Reise abschließen" error case (DELETE fails) | Medium |
| Companion: browser back button returns to alternatives | Low |
| Mobile Safari: runs locally only — add to CI once webkit dep weight acceptable | Low |

---

## 6. Performance Tests

### Tooling
- **Runner:** k6
- **Location:** `tests/performance/k6/journey-creation.js`
- **Target:** real backend, not mocked

### SLOs

| Metric | Threshold |
|--------|-----------|
| `POST /v1/journeys` p95 | < 10 s |
| `GET /v1/journeys/{id}/summary` p95 | < 200 ms |
| HTTP error rate | < 1% |
| ETag 304 cache hit rate | > 50% |

### Scenarios

| Scenario | Configuration |
|----------|--------------|
| Steady load | 10 VUs, 1 minute |
| Spike | Ramp 0 → 50 → 50 → 0 VUs over 90 s, starting at t+90 s |

### Lifecycle Tested

1. Validate train number (`GET /v1/trains/{number}`)
2. Station autocomplete (`GET /v1/stations?q=…`)
3. Create journey (`POST /v1/journeys`)
4. Idempotency replay (same key → 200 with replay header)
5. Poll summary 3× with ETag conditional requests
6. Verify 304 on unchanged ETag
7. Delete journey, verify second delete → 404

### Trigger

Performance tests are **not in CI** — they require a real backend with HAFAS connectivity. Run manually against staging before significant backend changes:

```sh
k6 run --env BASE_URL=http://staging.example.com tests/performance/k6/journey-creation.js
```

### Gaps (to be filled)

- No performance test for alternatives endpoint (`GET /v1/journeys/{id}/alternatives`)
- No soak test (extended steady load to detect memory leaks)
- No CI integration — add a weekly scheduled run against staging

---

## 7. Security Testing

### Static Analysis (SAST) — runs on every CI push

| Tool | Scope | Configuration |
|------|-------|---------------|
| **Gitleaks** | Secrets in git history | `continue-on-error: false` |
| **gosec** | Go code, severity ≥ high, confidence ≥ medium | SARIF uploaded to GitHub Security |
| **Semgrep** | All languages, OWASP Top 10 + secrets | `--error` on findings |

### Gaps (to be filled)

| Gap | Priority |
|-----|----------|
| No DAST (dynamic API security testing) | Medium |
| No rate-limit bypass test (brute-force X-Install-Id rotation) | Medium |
| No input fuzzing on `POST /v1/journeys` body | Low |
| Dependency vulnerability scanning (`govulncheck`, `npm audit`) not in CI | Medium |

---

## 8. CI/CD Integration

```
push / PR to master
│
├── backend (Go)
│   └── go mod verify → go vet → go build → go test -race -count=1 -timeout=5m ./...
│
├── frontend (Node)
│   └── npm ci → codegen:check → lint → typecheck → vitest run
│
├── e2e (Playwright)          needs: [frontend]
│   └── build → install browsers → typecheck → playwright test
│   └── ⚠️ continue-on-error: true — remove once offline tests are stable
│
├── sast
│   └── gitleaks → gosec → semgrep
│
└── docker
    needs: [backend, frontend]
    └── build backend + frontend images
```

### Missing CI Steps

| Step | Priority | Notes |
|------|----------|-------|
| Backend coverage report | High | Add `-coverprofile`, fail below 70% |
| `govulncheck ./...` | High | Go CVE scanner |
| `npm audit --audit-level=high` | High | Frontend CVE scanner |
| E2E made blocking | High | Remove `continue-on-error` |
| Weekly k6 run against staging | Low | Scheduled workflow |

---

## 9. Accessibility Testing

`accessibility.spec.ts` runs `@axe-core/playwright` against all three main screens (Start, Alternatives, Companion) and asserts zero critical or serious violations. Color-contrast rules are excluded — they require visual review and produce false positives in headless environments.

`critical-status.spec.ts` already verifies the `aria-live` region is attached. Extending it to assert announcements is a remaining gap.

---

## 10. Test Data Strategy

### Frontend (unit + E2E)

All test data is fabricated by factory functions:

| Factory | Location | Usage |
|---------|----------|-------|
| `makeSummary(overrides)` | `tests/e2e/fixtures/mocks.ts` | E2E |
| `makeAlternative(id)` | same | E2E |
| `makeJourneyCreateResponse(opts)` | same | E2E |
| `DEFAULT_SUMMARY`, `DEFAULT_JOURNEY_ID` | `frontend/src/test/msw-handlers.ts` | Unit |
| `makeSummary(overrides)` | `frontend/src/test/factories.ts` | Unit |

Factory functions accept `overrides` for partial customisation, keeping test intent visible.

### Backend

Tests use inline literals or table-driven fixtures. No shared fixtures file — each test file owns its data.

### No Production Data

Production data must never be used in any test. CI runs against synthetic data only.

---

## 11. Flakiness Policy

1. A test that fails more than once in 5 runs is **flaky** and must be fixed, not re-run.
2. Quarantine flaky tests with `test.skip` + a link to the tracking issue — do not silently retry.
3. On CI, `retries: 2` (Playwright) catches legitimate transient browser issues, not test logic flaws.
4. Offline tests (35 s assertion window) are sensitive to machine load — if they fail on CI regularly, increase `timeout` in the test or decouple staleness from wall-clock time (e.g. use `vi.useFakeTimers` in unit tests and keep E2E offline tests as smoke tests only).

---

## 12. Debug Files Policy

Temporary debug spec files (`debug-*.spec.ts`) must not be committed. Add them to `.gitignore` or delete after investigation.
