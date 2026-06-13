---
id: end-to-end
title: End-to-end tests
sidebar_position: 4
---

# End-to-end tests

Playwright drives a real browser. All API calls are mocked via `page.route()` — **no running backend is required.** The `playwright.config.ts` `webServer` block auto-starts `vite preview` on `:4173` before the suite begins.

```bash
# Build the frontend first (only needed once, or after frontend changes)
cd frontend && npm run build

# Run the suite (starts Vite preview automatically)
cd tests/e2e && npx playwright test

# UI mode — pick tests interactively, time-travel through traces
npx playwright test --ui

# Headed mode — watch the browser
npx playwright test --headed
```

The test suites live in `tests/e2e/`:

| Suite | What it covers |
|-------|----------------|
| `golden-path.spec.ts` | Happy path — create journey, view alternatives, switch, terminate |
| `start.spec.ts` | Start screen form validation — submit disabled, train not found, destination required |
| `alternatives.spec.ts` | Filter chip interaction — DB-only toggle, filter count badge |
| `critical-status.spec.ts` | Critical transfer and failed-route scenarios |
| `deep-link.spec.ts` | Direct URL navigation, session restore from `localStorage` |
| `offline.spec.ts` | PWA offline behaviour — service worker, IndexedDB fallback |
| `accessibility.spec.ts` | Axe a11y audit — zero critical/serious violations on all three main screens |

## Architecture — fully mocked, no backend needed

All API calls are intercepted by `page.route()` via the shared `MockServer` class (`tests/e2e/fixtures/mocks.ts`). No backend or Valkey or Postgres is required. This makes the suite:

- **Fast** — no HAFAS latency, no Docker startup.
- **Deterministic** — canned responses, no flakiness from network conditions.
- **CI-friendly** — runs in the same job that builds the frontend.

`playwright.config.ts` uses the `webServer` block to auto-start `vite preview` on port 4173. Set `BASE_URL` to target an external instance if you want to test against the real stack instead.

## Page Object Model

The suite uses POM to keep specs readable and selectors centralised:

| Page object | File | Locators |
|-------------|------|----------|
| `StartPage` | `pages/start.page.ts` | Train number input, destination autocomplete, submit button |
| `AlternativesPage` | `pages/alternatives.page.ts` | Alternative cards, choose-route button, time-gain hint |
| `CompanionPage` | `pages/companion.page.ts` | Timeline, ETA, critical-warning, stale indicator, terminate button |

All three are wired as `test.extend` fixtures in `fixtures/test.ts` — each test receives them as function parameters.

## MockServer

`MockServer` (`fixtures/mocks.ts`) centralises all `page.route()` calls:

```ts
// Install the full default mock table
await mocks.install({ journeyId: "jrn_abc", summary: { status: "DELAYED" } });

// Override one endpoint for a specific scenario
await mocks.overrideSummary("jrn_abc", makeSummary({ status: "CRITICAL" }));

// Simulate 404 for all journey routes
await mocks.setAllJourneysNotFound();

// Abort all network traffic (offline simulation)
await mocks.abortAllJourneys();
```

Factory helpers (`makeSummary`, `makeTrain`, `makeAlternative`, …) generate typed payloads with sensible defaults, accepting partial overrides.

## Useful invocations

```bash
# UI mode — pick tests interactively, time-travel through traces
npx playwright test --ui

# Headed mode — watch the browser
npx playwright test --headed

# One spec
npx playwright test tests/e2e/golden-path.spec.ts

# One test by title
npx playwright test -g "switches to faster alternative"

# Generate a trace for a failing test
npx playwright test --trace on

# Show the trace viewer
npx playwright show-trace trace.zip
```

## Selectors and accessibility

Playwright tests favour accessibility-driven selectors:

```ts
await page.getByRole("textbox", { name: /train number/i }).fill("ICE 123");
await page.getByRole("button", { name: /start/i }).click();
await expect(page.getByRole("heading", { name: /alternatives/i })).toBeVisible();
```

These are stable across visual redesigns and double as accessibility assertions. Avoid CSS selectors except when nothing semantic exists.

## CI

`.github/workflows/ci.yml` has an `e2e` job that runs on every push and PR. Because all API calls are mocked, no backend or Valkey/Postgres is needed — the job only spins up a Vite preview server.

```yaml
e2e:
  needs: [frontend]            # waits for frontend unit tests first
  continue-on-error: true      # non-blocking: failures reported but don't block merges
  timeout-minutes: 20
  steps:
    - build frontend            # npm run build
    - install e2e deps          # npm install --no-audit --no-fund
    - typecheck e2e             # npm run typecheck
    - install Playwright        # npx playwright install --with-deps chromium (Chromium only on CI)
    - run suite                 # npx playwright test
    - upload playwright-report/ # artifact on failure, 7-day retention
    - upload test-results/      # traces on failure
```

`continue-on-error: true` means failures surface in the summary but don't block merges. On CI, `playwright.config.ts` drops Mobile Safari (heavy webkit deps) and runs 2 workers with 2 retries. Failures upload the HTML report and trace zips as GitHub Actions artifacts.

## Debugging a flake

1. Add `await page.pause()` at the suspect line — UI mode opens a debugger.
2. Run with `--trace on` and inspect the trace zip with `npx playwright show-trace`.
3. Check the network tab in the trace — common culprit is a slow HAFAS response.
4. If the failure is timing-related, switch from `expect(...).toBeVisible()` to `expect.poll(...)` with a longer timeout.

## Browser matrix

`playwright.config.ts` runs each test across:

- **Mobile Chrome** (Pixel 5 emulation) — primary target; matches the mobile-first PWA design.
- **Desktop Chrome** — always runs.
- **Mobile Safari** (iPhone 13 emulation) — **local only**; webkit deps are too heavy for CI.

Tests should be browser-agnostic. If you need a browser-specific block, gate it with `test.skip(browserName === ..., "reason")`.
