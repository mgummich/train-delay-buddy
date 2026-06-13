---
id: end-to-end
title: End-to-end tests
sidebar_position: 4
---

# End-to-end tests

Playwright drives a real browser. All API calls mocked via `page.route()` — **no backend required.** `playwright.config.ts` `webServer` auto-starts `vite preview :4173`.

```bash
cd frontend && npm run build              # build once (or after frontend changes)
cd tests/e2e && npx playwright test       # run suite
npx playwright test --ui                  # interactive
npx playwright test --headed              # watch browser
```

## Suites (`tests/e2e/`)

| Suite | Covers |
|-------|--------|
| `golden-path.spec.ts` | Create → alternatives → switch → terminate |
| `start.spec.ts` | Form validation: submit disabled, train not found, destination required |
| `alternatives.spec.ts` | Filter chips: DB-only toggle, count badge |
| `critical-status.spec.ts` | Critical transfer + failed-route scenarios |
| `deep-link.spec.ts` | Direct URL nav, `localStorage` session restore |
| `offline.spec.ts` | PWA offline: SW + IndexedDB fallback |
| `accessibility.spec.ts` | Axe — zero critical/serious on three main screens |

## Architecture

All API calls intercepted by `page.route()` via `MockServer` (`tests/e2e/fixtures/mocks.ts`). No backend/Valkey/Postgres needed — suite is:

- **Fast** — no HAFAS latency, no Docker startup.
- **Deterministic** — canned responses.
- **CI-friendly** — runs alongside frontend job.

Set `BASE_URL` to target an external instance against the real stack instead.

## Page Object Model

| Page object | File | Locators |
|-------------|------|----------|
| `StartPage` | `pages/start.page.ts` | Train input, destination autocomplete, submit |
| `AlternativesPage` | `pages/alternatives.page.ts` | Cards, choose-route, time-gain hint |
| `CompanionPage` | `pages/companion.page.ts` | Timeline, ETA, critical warning, stale indicator, terminate |

Wired as `test.extend` fixtures in `fixtures/test.ts` — tests receive them as parameters.

## MockServer

```ts
await mocks.install({ journeyId: "jrn_abc", summary: { status: "DELAYED" } });
await mocks.overrideSummary("jrn_abc", makeSummary({ status: "CRITICAL" }));
await mocks.setAllJourneysNotFound();
await mocks.abortAllJourneys();      // offline sim
```

Factories (`makeSummary`, `makeTrain`, `makeAlternative`) produce typed payloads with sensible defaults + partial overrides.

## Invocations

```bash
npx playwright test --ui                                  # interactive
npx playwright test --headed
npx playwright test tests/e2e/golden-path.spec.ts         # one spec
npx playwright test -g "switches to faster alternative"   # by title
npx playwright test --trace on                            # generate trace
npx playwright show-trace trace.zip                       # view trace
```

## Selectors

A11y-driven:

```ts
await page.getByRole("textbox", { name: /train number/i }).fill("ICE 123");
await page.getByRole("button", { name: /start/i }).click();
await expect(page.getByRole("heading", { name: /alternatives/i })).toBeVisible();
```

Stable across redesigns + double as a11y assertions. Avoid CSS selectors unless nothing semantic exists.

## CI

`e2e` job runs every push/PR. No backend needed — only Vite preview.

```yaml
e2e:
  needs: [frontend]            # waits on frontend unit
  timeout-minutes: 20
  steps:
    - build frontend
    - install e2e deps
    - typecheck e2e
    - npx playwright install --with-deps chromium
    - npx playwright test
    - upload playwright-report/ (artifact on failure, 7-day)
    - upload test-results/ (traces on failure)
```

**Hard merge gate.** CI drops Mobile Safari (heavy webkit deps), runs 2 workers / 2 retries.

## Debugging flakes

1. `await page.pause()` at suspect line — UI mode opens debugger.
2. `--trace on` → `npx playwright show-trace`.
3. Check network tab — slow HAFAS is a common culprit.
4. Timing-related: switch `expect(...).toBeVisible()` → `expect.poll(...)` with longer timeout.

## Browser matrix

- **Mobile Chrome** (Pixel 5) — primary, mobile-first.
- **Desktop Chrome** — always.
- **Mobile Safari** (iPhone 13) — **local only** (webkit too heavy for CI).

Browser-specific blocks → `test.skip(browserName === ..., "reason")`.
