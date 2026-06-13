---
id: frontend-unit
title: Frontend unit tests
sidebar_position: 3
---

# Frontend unit tests

```bash
cd frontend
npm run test
```

**Vitest** + **MSW** (Mock Service Worker). MSW intercepts all `fetch` calls at the network layer, so tests run against a fake backend that lives in the same process. No real HTTP server is involved. The full suite runs in under 5 seconds.

## Coverage areas

- **Hooks** (`src/hooks/*.test.tsx`) — every TanStack Query hook is tested in isolation: cache key shape, refetch policy, error mapping, optimistic updates.
- **Screens** (`src/screens/*.test.tsx`) — full mount via the shared `render()` helper, asserts user-visible output.
- **Lib utilities** (`src/lib/*.test.ts`) — pure functions: datetime formatting, install ID generation, IndexedDB helpers, query client setup.
- **Validation schemas** (`src/api/validation.test.ts`) — Zod schemas tested against both compliant and adversarial inputs.

## Conventions

### MSW handlers

`src/mocks/handlers.ts` defines the default set of responses. Tests can override specific endpoints using `server.use(...)`:

```ts
test("renders error banner when journey 404s", async () => {
  server.use(
    http.get("/v1/journeys/jrn_missing", () =>
      HttpResponse.json(
        { type: "urn:verspbegl:error:not-found", title: "Not found", status: 404 },
        { status: 404 }
      )
    ),
  );

  render(<CompanionScreen />, { route: "/journey/jrn_missing" });
  expect(await screen.findByText(/journey not found/i)).toBeInTheDocument();
});
```

### `render()` helper

`src/test/render.tsx` wraps RTL's `render` with the providers every screen expects:

- `QueryClientProvider` with a fresh `QueryClient` per test (no inter-test leakage).
- `MemoryRouter` configured to a given initial route.
- `I18nextProvider` with the German bundle.

Use it for every screen-level test:

```ts
render(<StartScreen />, { route: "/" });
```

### Factories

`src/test/factories.ts` exports small builder functions for the common domain types:

```ts
import { makeJourney, makeAlternative } from "../test/factories";

const j = makeJourney({ summary: { status: "DELAYED" } });
const alt = makeAlternative({ timeGainMinutes: 12 });
```

Factories use sensible defaults; overrides are deep-merged.

### TanStack Query specifics

For hooks that poll, freeze time with Vitest fake timers and advance manually:

```ts
vi.useFakeTimers();

const { result } = renderHook(() => useJourneyFull("jrn_123"), { wrapper });

await waitFor(() => expect(result.current.data).toBeDefined());

vi.advanceTimersByTime(30_000);   // triggers next poll
await waitFor(() => expect(result.current.dataUpdatedAt).toBeGreaterThan(0));

vi.useRealTimers();
```

## Useful invocations

```bash
# Whole suite, single run
npm run test

# Watch mode (re-runs on save)
npm run test:watch

# Coverage report → coverage/
npm run test:coverage

# Run a single file
npm run test -- src/hooks/useJourneyFull.test.tsx

# Run by test name
npm run test -- -t "renders error banner"

# Update snapshots (if any are used)
npm run test -- -u
```

## Continuous integration

`.github/workflows/ci.yml` job `frontend`:

```yaml
- run: npm ci
- run: npm run codegen:check
- run: npm run lint
- run: npm run typecheck
- run: npm run test -- --reporter=default
```

A red test, a lint failure, or any `tsc` error fails the PR.

## Anti-patterns

- **Do not mock TanStack Query directly.** Mock at the network layer with MSW. This keeps the test focused on user-visible behaviour and avoids depending on Query internals.
- **Do not test implementation details.** Assert on what the user sees (`screen.getByText`, `getByRole`), not on which props were passed to which child component.
- **Do not rely on `data-testid` for everything.** Prefer semantic queries (`getByRole("button", { name: "Start" })`). Reach for `data-testid` only when no role or text is appropriate.
- **Do not share state between tests.** Every test gets a fresh `QueryClient`. Every test resets MSW. Every test runs in isolation.
