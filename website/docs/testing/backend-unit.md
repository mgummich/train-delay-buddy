---
id: backend-unit
title: Backend unit tests
sidebar_position: 2
---

# Backend unit tests

```bash
cd backend
go test ./...
```

No external services are required. Postgres, Valkey, and HAFAS are all replaced with in-memory fakes that implement the same Go interfaces as the real clients.

## What is covered

The backend ships with ~50 `*_test.go` files covering:

- HAFAS client + mapper + coalescer + filter.
- Journey poller, worker pool, ID generation.
- Routing — BFS and ETA scorer.
- Migration runner.
- All HTTP handlers — happy path + every problem response.
- All middleware — rate-limit, request-ID, CORS, logging.
- Config loader — required fields, defaults, validation.

## Conventions

### Package layout

Tests live next to the code they cover:

```
internal/journey/poller.go
internal/journey/poller_test.go    ← same package, can touch internals
```

For black-box tests (preferred for handlers), use the `_test` package suffix:

```
internal/api/handlers/journeys_test.go    ← package handlers_test
```

### Table-driven tests

The codebase prefers table-driven tests for any function with > 2 distinct inputs:

```go
func TestComputeETA(t *testing.T) {
    tests := []struct {
        name string
        legs []Leg
        want time.Time
    }{
        {"single leg", []Leg{leg1}, leg1.Arrival},
        {"multi leg", []Leg{leg1, leg2}, leg2.Arrival},
        {"no legs", nil, time.Time{}},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := ComputeETA(tt.legs)
            if !got.Equal(tt.want) { t.Errorf("got %v, want %v", got, tt.want) }
        })
    }
}
```

### Fakes, not mocks

Mocking libraries are not used. Each non-trivial collaborator has a dedicated fake under `internal/<pkg>/fake.go`:

- `internal/hafas/fake.go` — an in-memory `Client` that returns canned responses keyed by trip ID.
- `internal/journey/storefake.go` — an in-memory `Store`.
- `internal/journey/clockfake.go` — a controllable `Clock` for time-based tests.

The advantage: a fake is real Go code, fully type-checked by the compiler. There are no string-typed mock expectations to drift out of date.

### Time

Time-sensitive tests always inject `journey.Clock` (an interface with `Now()` and `NewTicker(d)`). The fake clock lets you advance time deterministically:

```go
clk := journey.NewFakeClock(time.Date(2026, 6, 12, 8, 0, 0, 0, time.UTC))
poller := journey.NewPoller(..., journey.WithClock(clk))
go poller.Run(ctx)

clk.Advance(30 * time.Second)   // forces one tick
// assert observable side effects
```

No `time.Sleep` in tests. Ever.

## Useful invocations

```bash
# All tests
go test ./...

# Verbose, with package timing
go test -v ./...

# One package
go test -v ./internal/journey/...

# One test
go test -run TestPollerTick ./internal/journey/...

# Race detector (default for CI)
go test -race -count=1 ./...

# Benchmarks
go test -bench=. -benchmem ./internal/routing/

# Coverage summary
go test -cover ./...

# Coverage profile + HTML report
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out
```

## Continuous integration

`.github/workflows/ci.yml` job `backend`:

```yaml
- name: Test
  env:
    CGO_ENABLED: "0"
  run: go test -race -count=1 -timeout=5m ./...
```

`-count=1` prevents test-cache reuse on a fresh CI run (Go caches by source + flags). `-race` is mandatory — concurrency bugs found at PR time are cheap; the same bug in production is expensive.
