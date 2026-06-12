---
id: end-to-end
title: End-to-end tests
sidebar_position: 3
---

# End-to-end tests

Playwright drives a real browser against the full Docker Compose stack.

```bash
# Boot the stack
docker compose up -d

# Run the suite
cd frontend && npm run test:e2e

# Or directly
cd tests/e2e && npx playwright test
```

The test suites live in `tests/e2e/`:

| Suite | What it covers |
|-------|----------------|
| `golden-path.spec.ts` | Happy path — create journey, view alternatives, switch, terminate |
| `critical-status.spec.ts` | Critical transfer and failed-route scenarios |
| `deep-link.spec.ts` | Direct URL navigation, session restore from `localStorage` |
| `offline.spec.ts` | PWA offline behaviour — service worker, IndexedDB fallback |

## How they interact with the backend

By default the E2E suite talks to a *real* backend with a *real* HAFAS upstream. This makes the tests slow (HAFAS latency) and flaky (HAFAS availability). Two mitigations:

- **Network conditioning** — `playwright.config.ts` sets `timeout: 60s` and `retries: 1` on CI.
- **Selective stubbing** — HAFAS responses for the deterministic test journeys are recorded and replayed via Playwright's `route.fulfill`. Production-shaped journeys go to the real upstream only when explicitly tagged.

For complete isolation, set `HAFAS_BASE_URL` to point at a local mock server before running:

```bash
HAFAS_BASE_URL=http://localhost:9999 docker compose up -d backend
node tests/mock-hafas-server.mjs &
cd frontend && npm run test:e2e
```

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

The current `.github/workflows/ci.yml` does **not** run Playwright in CI — the public HAFAS API makes the suite too flaky for a hard gate. Run E2E locally before merging anything that touches user-facing flows.

If you want CI E2E, add a `e2e` job that:

1. `docker compose up -d` (with `HAFAS_BASE_URL` pointed at a mock or recorded fixtures).
2. Waits for `/readyz` to return 200.
3. Runs `npx playwright test --reporter=github`.
4. Uploads `playwright-report/` as an artifact on failure.

## Debugging a flake

1. Add `await page.pause()` at the suspect line — UI mode opens a debugger.
2. Run with `--trace on` and inspect the trace zip with `npx playwright show-trace`.
3. Check the network tab in the trace — common culprit is a slow HAFAS response.
4. If the failure is timing-related, switch from `expect(...).toBeVisible()` to `expect.poll(...)` with a longer timeout.

## Browser matrix

`playwright.config.ts` runs each test across:

- **Chromium** (Desktop Chrome) — default.
- **Mobile Safari** (iPhone 14 emulation) — covers the PWA install path.
- **Firefox** — sanity check, no full-feature coverage required.

Tests should be browser-agnostic. If you need a browser-specific block, gate it with `test.skip(browserName === ..., "reason")`.
