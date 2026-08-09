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

**Vitest** + **MSW.** MSW intercepts all `fetch` at the network layer — fake backend in the same process. Full suite < 5 s.

## Coverage

- **Hooks** (`src/hooks/*.test.tsx`) — each TanStack Query hook in isolation: cache key, refetch policy, error mapping, optimistic updates.
- **Screens** (`src/screens/*.test.tsx`) — full mount via shared `render()`, asserts user-visible output.
- **Lib** (`src/lib/*.test.ts`) — pure functions: datetime, install ID, IndexedDB, query client. `queryClient.test.ts` pulls `retry` / `retryDelay` straight off `getDefaultOptions()` and asserts the policy per branch (4xx skip, 429 retry, `Retry-After` curve, 30s vs 300s caps) — no network needed.
- **API client** (`src/api/client.test.ts`) — `apiError` status/`Retry-After` stamping, including the HTTP-date form that must not become `NaN`.
- **Validation** (`src/api/validation.test.ts`) — Zod against compliant + adversarial inputs; asserts `safeParse` never throws.

## Conventions

### MSW

Defaults in `src/mocks/handlers.ts`. Override per test:

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

`src/test/render.tsx` wraps RTL with providers:

- `QueryClientProvider` — fresh client per test (no leakage).
- `MemoryRouter` — initial route.
- `I18nextProvider` — German bundle.

```ts
render(<StartScreen />, { route: "/" });
```

### Factories

`src/test/factories.ts`:

```ts
import { makeJourney, makeAlternative } from "../test/factories";

const j = makeJourney({ summary: { status: "DELAYED" } });
const alt = makeAlternative({ timeGainMinutes: 12 });
```

Defaults + deep-merged overrides.

### Polling hooks

Vitest fake timers, advance manually:

```ts
vi.useFakeTimers();
const { result } = renderHook(() => useJourneyFull("jrn_123"), { wrapper });
await waitFor(() => expect(result.current.data).toBeDefined());
vi.advanceTimersByTime(30_000);
await waitFor(() => expect(result.current.dataUpdatedAt).toBeGreaterThan(0));
vi.useRealTimers();
```

## Invocations

```bash
npm run test                                       # single run
npm run test:watch                                 # watch
npm run test:coverage                              # coverage → coverage/
npm run test -- src/hooks/useJourneyFull.test.tsx  # one file
npm run test -- -t "renders error banner"          # by name
npm run test -- -u                                 # update snapshots
```

## CI

`frontend` job:

```yaml
- run: npm ci
- run: npm run codegen:check
- run: npm run lint
- run: npm run typecheck
- run: npm run test -- --reporter=default
```

Red test, lint failure, or `tsc` error fails the PR.

## Anti-patterns

- ❌ **Don't mock TanStack Query.** Mock at network with MSW.
- ❌ **Don't test implementation details.** Assert what the user sees (`screen.getByText`, `getByRole`), not which props were passed.
- ❌ **Don't lean on `data-testid`.** Prefer semantic queries. Reach for testid only when no role/text fits.
- ❌ **Don't share state across tests.** Fresh `QueryClient`, MSW reset, full isolation.
