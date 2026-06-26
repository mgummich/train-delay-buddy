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

No external services. Postgres, Valkey, HAFAS replaced with in-memory fakes implementing the same Go interfaces.

## Coverage

~50 `*_test.go` files covering:

- HAFAS client + mapper + coalescer + filter.
- Journey poller, worker pool, ID generation.
- Routing — BFS + ETA scorer.
- Migration runner.
- All HTTP handlers — happy + every problem response.
- All middleware — rate-limit, request-ID, CORS, logging.
- Config loader — required, defaults, validation.

## Conventions

### Layout

Tests next to code:

```
internal/journey/poller.go
internal/journey/poller_test.go      ← same package, can touch internals
```

Black-box (preferred for handlers): `_test` suffix:

```
internal/api/handlers/journeys_test.go    ← package handlers_test
```

### Table-driven

Preferred for any function with >2 distinct inputs:

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

No mocking libraries. Each non-trivial collaborator has a dedicated fake in `internal/<pkg>/fake.go`:

- `internal/hafas/fake.go` — in-memory `Client`, canned responses keyed by trip ID.
- `internal/journey/storefake.go` — in-memory `Store`.
- `internal/journey/clockfake.go` — controllable `Clock`.

Fakes are real Go code, fully type-checked. No string-typed mock expectations to drift.

### Time

Time-sensitive tests inject `journey.Clock` (`Now()` + `NewTicker(d)`). Fake clock advances deterministically:

```go
clk := journey.NewFakeClock(time.Date(2026, 6, 12, 8, 0, 0, 0, time.UTC))
poller := journey.NewPoller(..., journey.WithClock(clk))
go poller.Run(ctx)

clk.Advance(30 * time.Second)   // forces one tick
```

**No `time.Sleep` in tests. Ever.**

## Invocations

```bash
go test ./...                                  # all
go test -v ./...                               # verbose + timing
go test -v ./internal/journey/...              # one package
go test -run TestPollerTick ./internal/journey/...   # one test
go test -race -count=1 ./...                   # CI default
go test -bench=. -benchmem ./internal/routing/ # benchmarks
go test -cover ./...                           # coverage summary
go test -coverprofile=cover.out ./... && go tool cover -html=cover.out
```

## CI

`backend` job:

```yaml
- name: Test
  env:
    CGO_ENABLED: "1"   # required for -race (gcc on ubuntu-latest)
  run: go test -race -count=1 -timeout=5m -coverprofile=coverage.out ./...
- name: Coverage check
  run: |
    go tool cover -func=coverage.out | tail -1
    # fails if < 55%
```

`-count=1` defeats cache. `-race` mandatory — concurrency bugs at PR time are cheap; in prod, expensive. 55% floor will rise as suite matures.
