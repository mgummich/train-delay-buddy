# Backend Plan 4 — Poller, Monitoring Endpoints, Metrics, Boot Recovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live journey monitoring — background HAFAS polling, ETag-based summary/legs/alternatives endpoints, Prometheus metrics, boot recovery, graceful shutdown, and GC job. After this plan the backend is feature-complete for MVP.

**Architecture:** One poller goroutine per active journey feeds tasks to a bounded HAFAS worker pool. Singleflight coalescer deduplicates concurrent fetches on the same trip. On state change: write-through to Postgres then Redis; ETag counter incremented. Boot recovery rehydrates Redis + restarts pollers with staggered launch. Graceful shutdown drains the worker pool within `HAFAS_REQUEST_TIMEOUT`.

**Builds on:** Plans 1–3. Requires store interface, BFS engine, HAFAS client, config.

---

## File Map

| Action | Path |
|--------|------|
| Modify | `backend/go.mod` |
| Create | `backend/internal/metrics/metrics.go` |
| Create | `backend/internal/journey/worker_pool.go` |
| Create | `backend/internal/journey/worker_pool_test.go` |
| Create | `backend/internal/journey/poller.go` |
| Create | `backend/internal/journey/poller_test.go` |
| Create | `backend/internal/api/handlers/summary.go` |
| Create | `backend/internal/api/handlers/summary_test.go` |
| Create | `backend/internal/api/handlers/legs.go` |
| Create | `backend/internal/api/handlers/legs_test.go` |
| Create | `backend/internal/api/handlers/alternatives.go` |
| Create | `backend/internal/api/handlers/alternatives_test.go` |
| Modify | `backend/internal/api/handlers/journeys.go` |
| Modify | `backend/internal/api/router.go` |
| Modify | `backend/cmd/server/main.go` |

---

### Task 1: Update go.mod — add Prometheus

**Files:**
- Modify: `backend/go.mod`

- [ ] **Step 1: Add dependency**

```
module github.com/verspaetungsbegleiter/backend

go 1.22

require (
    github.com/go-chi/chi/v5 v5.2.1
    github.com/jackc/pgx/v5 v5.7.2
    github.com/prometheus/client_golang v1.21.1
    github.com/redis/go-redis/v9 v9.7.3
    golang.org/x/sync v0.10.0
    golang.org/x/time v0.9.0
)
```

- [ ] **Step 2: Tidy**

```bash
cd backend && go mod tidy
```

Expected: `go.sum` updated, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "feat(backend): add prometheus/client_golang dependency"
```

---

### Task 2: Prometheus metrics package

**Files:**
- Create: `backend/internal/metrics/metrics.go`

All Prometheus counters, gauges, and histograms defined here. Registering metrics at package init via `promauto` means any import triggers registration — no setup call needed.

- [ ] **Step 1: Write metrics.go**

```go
// backend/internal/metrics/metrics.go
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HAFASFetchTotal counts outbound HAFAS calls by status (success | error | timeout).
	HAFASFetchTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "hafas_fetch_total",
			Help: "Outbound HAFAS calls by status.",
		},
		[]string{"status"},
	)

	// HAFASFetchDuration measures HAFAS request latency.
	HAFASFetchDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "hafas_fetch_duration_seconds",
			Help:    "HAFAS request latency.",
			Buckets: prometheus.DefBuckets,
		},
	)

	// ActiveJourneys is the current number of running poller goroutines.
	ActiveJourneys = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_journeys_total",
			Help: "Currently active poller goroutines.",
		},
	)

	// PollETag304Total counts frontend polls returning 304 (ETag hit).
	PollETag304Total = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "poll_etag_304_total",
			Help: "Frontend summary polls returning 304 Not Modified.",
		},
	)

	// PollETag200Total counts frontend polls returning 200 (state changed).
	PollETag200Total = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "poll_etag_200_total",
			Help: "Frontend summary polls returning 200 OK.",
		},
	)

	// RedisMissTotal counts cache misses falling through to Postgres.
	RedisMissTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "redis_miss_total",
			Help: "Redis miss → Postgres fallback.",
		},
	)

	// CoalescerDedupTotal counts HAFAS requests saved by singleflight.
	CoalescerDedupTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "coalescer_dedup_total",
			Help: "HAFAS requests deduplicated by singleflight.",
		},
	)

	// HAFASTimeoutTotal counts HAFAS calls that exceeded HAFAS_REQUEST_TIMEOUT.
	HAFASTimeoutTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "hafas_timeout_total",
			Help: "HAFAS calls that exceeded the configured request timeout.",
		},
	)

	// HAFASCircuitState tracks the circuit breaker state: 0=closed, 1=half-open, 2=open.
	HAFASCircuitState = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "hafas_circuit_state",
			Help: "HAFAS circuit breaker state: 0=closed, 1=half-open, 2=open.",
		},
	)

	// HTTPRequestDuration measures HTTP handler latency by path and status code.
	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by path and status code.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path", "status"},
	)
)
```

- [ ] **Step 2: Verify compiles**

```bash
cd backend && go build ./internal/metrics/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/metrics/
git commit -m "feat(backend): Prometheus metrics definitions"
```

---

### Task 3: Worker pool

**Files:**
- Create: `backend/internal/journey/worker_pool.go`
- Create: `backend/internal/journey/worker_pool_test.go`

A bounded goroutine pool. When the task channel is full, `Submit` drops the task (non-blocking) — the poller goroutine retains last-known journey state for that tick.

- [ ] **Step 1: Write failing test**

```go
// backend/internal/journey/worker_pool_test.go
package journey_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func TestWorkerPool_ExecutesTasks(t *testing.T) {
	var count atomic.Int64
	pool := journey.NewWorkerPool(4, 20)

	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		pool.Submit(func() {
			defer wg.Done()
			count.Add(1)
		})
	}
	wg.Wait()
	pool.Shutdown()

	if count.Load() != 10 {
		t.Errorf("expected 10 tasks executed, got %d", count.Load())
	}
}

func TestWorkerPool_DropWhenFull(t *testing.T) {
	var executed atomic.Int64
	// depth=1, size=1: the single worker is busy; second Submit should drop
	pool := journey.NewWorkerPool(1, 1)

	// Block the single worker
	started := make(chan struct{})
	unblock := make(chan struct{})
	pool.Submit(func() {
		close(started)
		<-unblock
	})
	<-started

	// Channel depth=1 is occupied by the blocking task.
	// Submitting two more: first may queue, second must drop.
	dropped := false
	for range 5 {
		if !pool.Submit(func() { executed.Add(1) }) {
			dropped = true
			break
		}
	}
	close(unblock)
	pool.Shutdown()

	if !dropped {
		t.Error("expected at least one task to be dropped when pool is full")
	}
}

func TestWorkerPool_Shutdown_WaitsForDrain(t *testing.T) {
	var count atomic.Int64
	pool := journey.NewWorkerPool(2, 10)
	for range 5 {
		pool.Submit(func() {
			time.Sleep(5 * time.Millisecond)
			count.Add(1)
		})
	}
	pool.Shutdown()
	if count.Load() < 5 {
		t.Errorf("shutdown returned before tasks completed: executed %d/5", count.Load())
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/journey/... -run TestWorkerPool -v
```

Expected: `FAIL`

- [ ] **Step 3: Write worker_pool.go**

```go
// backend/internal/journey/worker_pool.go
package journey

import "sync"

// WorkerPool is a bounded goroutine pool for HAFAS fetch tasks.
// When the task channel is full, Submit returns false and drops the task —
// the poller goroutine retains last-known state for that tick.
type WorkerPool struct {
	tasks chan func()
	wg    sync.WaitGroup
}

// NewWorkerPool creates a pool with size worker goroutines and a task channel of depth.
func NewWorkerPool(size, depth int) *WorkerPool {
	p := &WorkerPool{tasks: make(chan func(), depth)}
	for range size {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for task := range p.tasks {
				task()
			}
		}()
	}
	return p
}

// Submit enqueues task without blocking. Returns false if the channel is full (task dropped).
func (p *WorkerPool) Submit(task func()) bool {
	select {
	case p.tasks <- task:
		return true
	default:
		return false
	}
}

// Shutdown closes the task channel and waits for all in-flight tasks to complete.
// Must be called exactly once after all Submit calls are done.
func (p *WorkerPool) Shutdown() {
	close(p.tasks)
	p.wg.Wait()
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/journey/... -run TestWorkerPool -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/journey/worker_pool.go backend/internal/journey/worker_pool_test.go
git commit -m "feat(backend): bounded HAFAS worker pool with non-blocking submit"
```

---

### Task 4: Journey poller

**Files:**
- Create: `backend/internal/journey/poller.go`
- Create: `backend/internal/journey/poller_test.go`

One goroutine per active journey. Submits HAFAS fetch tasks to the worker pool every 30s. Coalesces concurrent requests on the same trip ID. Detects state changes and writes through to the store.

- [ ] **Step 1: Write failing test**

```go
// backend/internal/journey/poller_test.go
package journey_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func TestApplyTripUpdates_UpdatesDelay(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	actualArr, _ := time.Parse(time.RFC3339, "2026-06-10T17:12:00Z") // +12 min delay

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			Stops: []journey.Stop{
				{StationID: "8000261", StationName: "München Hbf", ArrivalTimePlanned: dep},
				{StationID: "8000105", StationName: "Frankfurt (Main) Hbf", ArrivalTimePlanned: arr},
			},
			Status: journey.LegStatusRunning,
		},
	}

	arrivalDelaySecs := 720 // 12 minutes in seconds
	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", ActualArrival: &actualArr, ArrivalDelaySecs: &arrivalDelaySecs},
			},
		},
	}

	updated, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if updated[0].ArrivalTimeActual == nil {
		t.Fatal("ArrivalTimeActual should be set after update")
	}
	if !updated[0].ArrivalTimeActual.Equal(actualArr) {
		t.Errorf("ArrivalTimeActual: got %v, want %v", updated[0].ArrivalTimeActual, actualArr)
	}
	if updated[0].DelayMinutes == nil || *updated[0].DelayMinutes != 12 {
		t.Errorf("DelayMinutes: got %v, want 12", updated[0].DelayMinutes)
	}
	if legsChanged {
		t.Error("legsChanged should be false for delay-only update (no platform/cancellation change)")
	}
}

func TestApplyTripUpdates_DetectsPlatformChange(t *testing.T) {
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	oldPlatform := "3"
	newPlatform := "7"

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			PlatformActual:     &oldPlatform,
			Stops: []journey.Stop{
				{StationID: "8000105", ArrivalTimePlanned: arr},
			},
		},
	}

	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", ActualArrival: &arr, ArrivalPlatform: &newPlatform},
			},
		},
	}

	_, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if !legsChanged {
		t.Error("legsChanged should be true when platform changes")
	}
}

func TestApplyTripUpdates_DetectsCancellation(t *testing.T) {
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	cancelled := true

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			Status:             journey.LegStatusRunning,
			Stops:              []journey.Stop{{StationID: "8000105", ArrivalTimePlanned: arr}},
		},
	}

	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", Cancelled: &cancelled},
			},
		},
	}

	updated, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if updated[0].Status != journey.LegStatusCancelled {
		t.Errorf("Status should be cancelled, got %q", updated[0].Status)
	}
	if !legsChanged {
		t.Error("legsChanged should be true for cancellation")
	}
}

func TestSummaryChanged_DetectsETAChange(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	old := journey.Summary{ETA: base, Status: journey.StatusOK}
	new := journey.Summary{ETA: base.Add(5 * time.Minute), Status: journey.StatusOK}
	if !journey.SummaryChanged(old, new) {
		t.Error("ETA change should be detected")
	}
}

func TestSummaryChanged_NoChangeReturnsFalse(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	s := journey.Summary{ETA: base, Status: journey.StatusOK, DataConfidence: journey.DataConfidenceHigh}
	if journey.SummaryChanged(s, s) {
		t.Error("identical summaries should not trigger a state change")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/journey/... -run TestApplyTrip -run TestSummaryChanged -v
```

Expected: `FAIL`

- [ ] **Step 3: Write poller.go**

```go
// backend/internal/journey/poller.go
package journey

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"sync"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/metrics"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// TripUpdate holds realtime data for one trip, keyed by stationID.
type TripUpdate struct {
	Stopovers []StopoverUpdate
}

// StopoverUpdate holds per-stop realtime fields from a HAFAS trip fetch.
type StopoverUpdate struct {
	StationID        string
	ActualArrival    *time.Time
	ArrivalDelaySecs *int
	ArrivalPlatform  *string
	Cancelled        *bool
}

// SummaryChanged reports whether a meaningful state change occurred between old and new.
func SummaryChanged(old, new Summary) bool {
	return !old.ETA.Equal(new.ETA) ||
		old.Status != new.Status ||
		old.CriticalTransfer != new.CriticalTransfer ||
		old.AlternativeAvailable != new.AlternativeAvailable ||
		old.DataConfidence != new.DataConfidence
}

// ApplyTripUpdates applies realtime HAFAS data to legs.
// Returns updated legs and whether legs structurally changed (platform or cancellation).
func ApplyTripUpdates(legs []Leg, updates map[string]TripUpdate) ([]Leg, bool) {
	out := make([]Leg, len(legs))
	copy(out, legs)
	legsChanged := false

	for i, leg := range out {
		trip, ok := updates[leg.TripID]
		if !ok || len(leg.Stops) == 0 {
			continue
		}
		// Match on the last stop of this leg (the arrival station)
		destID := leg.Stops[len(leg.Stops)-1].StationID
		for _, s := range trip.Stopovers {
			if s.StationID != destID {
				continue
			}
			if s.ActualArrival != nil {
				out[i].ArrivalTimeActual = s.ActualArrival
			}
			if s.ArrivalDelaySecs != nil {
				mins := *s.ArrivalDelaySecs / 60
				out[i].DelayMinutes = &mins
				if mins > 0 && out[i].Status == LegStatusRunning {
					out[i].Status = LegStatusDelayed
				}
			}
			if s.ArrivalPlatform != nil {
				old := leg.PlatformActual
				if old == nil || *old != *s.ArrivalPlatform {
					out[i].PlatformActual = s.ArrivalPlatform
					legsChanged = true
				}
			}
			if s.Cancelled != nil && *s.Cancelled && out[i].Status != LegStatusCancelled {
				out[i].Status = LegStatusCancelled
				legsChanged = true
			}
			break
		}
	}
	return out, legsChanged
}

// PollerManager manages one goroutine per active journey plus the shared worker pool.
type PollerManager struct {
	ctx       context.Context
	store     Store
	hafas     *hafas.Client
	coalescer *hafas.Coalescer
	engine    routing.Engine
	pool      *WorkerPool
	interval  time.Duration
	ttlHours  int
	logger    *slog.Logger
	mu        sync.Mutex
	cancels   map[string]context.CancelFunc
}

// NewPollerManager creates a PollerManager. ctx should be the server lifetime context.
func NewPollerManager(
	ctx context.Context,
	store Store,
	h *hafas.Client,
	c *hafas.Coalescer,
	e routing.Engine,
	p *WorkerPool,
	interval time.Duration,
	ttlHours int,
	logger *slog.Logger,
) *PollerManager {
	return &PollerManager{
		ctx:      ctx,
		store:    store,
		hafas:    h,
		coalescer: c,
		engine:   e,
		pool:     p,
		interval: interval,
		ttlHours: ttlHours,
		logger:   logger,
		cancels:  make(map[string]context.CancelFunc),
	}
}

// Start launches a poller goroutine for journeyID. Idempotent — noop if already running.
func (pm *PollerManager) Start(journeyID string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if _, ok := pm.cancels[journeyID]; ok {
		return
	}
	ctx, cancel := context.WithCancel(pm.ctx)
	pm.cancels[journeyID] = cancel
	metrics.ActiveJourneys.Inc()
	go pm.loop(ctx, journeyID)
}

// Stop cancels the poller goroutine for journeyID. Idempotent.
func (pm *PollerManager) Stop(journeyID string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	if cancel, ok := pm.cancels[journeyID]; ok {
		cancel()
		delete(pm.cancels, journeyID)
		metrics.ActiveJourneys.Dec()
	}
}

// ActiveCount returns the number of running poller goroutines.
func (pm *PollerManager) ActiveCount() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	return len(pm.cancels)
}

func (pm *PollerManager) loop(ctx context.Context, journeyID string) {
	ticker := time.NewTicker(pm.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			id := journeyID // capture for closure
			submitted := pm.pool.Submit(func() { pm.poll(ctx, id) })
			if !submitted {
				pm.logger.Warn("worker pool full — skipping poll tick", "journeyId", journeyID)
			}
		}
	}
}

func (pm *PollerManager) poll(ctx context.Context, journeyID string) {
	// Inject a fresh request ID for HAFAS call correlation
	ctx = reqid.Set(ctx, newPollRequestID())

	j, err := pm.store.Get(ctx, journeyID)
	if err != nil {
		// Journey expired or terminated — stop the poller
		pm.Stop(journeyID)
		return
	}

	// Stop if journey exceeded TTL
	if time.Since(j.CreatedAt) > time.Duration(pm.ttlHours)*time.Hour {
		pm.Stop(journeyID)
		return
	}

	// Fetch realtime data for each unique trip ID (coalesced)
	tripUpdates := pm.fetchTripUpdates(ctx, j.Legs)

	// Apply updates
	updatedLegs, legsChanged := ApplyTripUpdates(j.Legs, tripUpdates)

	// Recompute summary using updated legs
	newSummary := hafas.RecomputeSummary(updatedLegs, j.Destination, j.Filters, time.Now())
	newSummary.DataFetchedAt = time.Now()
	newSummary.LastUpdatedAt = j.Summary.LastUpdatedAt
	newSummary.AlternativeAvailable = j.Summary.AlternativeAvailable

	// Only write if something changed
	if !SummaryChanged(j.Summary, newSummary) && !legsChanged {
		return
	}
	newSummary.LastUpdatedAt = time.Now()

	if err := pm.store.UpdateState(ctx, journeyID, newSummary, updatedLegs, legsChanged); err != nil {
		pm.logger.Warn("store.UpdateState failed", "journeyId", journeyID, "error", err)
		return
	}

	pm.logger.Info("poll_state_change",
		"journeyId", journeyID,
		"requestId", reqid.Get(ctx),
		"status", newSummary.Status,
		"dataFetchedAt", newSummary.DataFetchedAt,
	)

	// Re-run routing if status became critical or alternative was already flagged
	if newSummary.Status == StatusCritical || newSummary.CriticalTransfer {
		pm.recomputeAlternatives(ctx, j, newSummary)
	}

	// Update Prometheus gauge periodically
	metrics.HAFASCircuitState.Set(float64(pm.hafas.CircuitState()))
}

func (pm *PollerManager) fetchTripUpdates(ctx context.Context, legs []Leg) map[string]TripUpdate {
	updates := make(map[string]TripUpdate)
	seen := make(map[string]bool)
	for _, leg := range legs {
		if leg.TripID == "" || leg.IsWalkingSegment || seen[leg.TripID] {
			continue
		}
		seen[leg.TripID] = true
		tripID := leg.TripID

		v, err := pm.coalescer.Do(tripID, func() (any, error) {
			metrics.CoalescerDedupTotal.Inc()
			start := time.Now()
			t, err := pm.hafas.GetTrip(ctx, tripID)
			metrics.HAFASFetchDuration.Observe(time.Since(start).Seconds())
			if err != nil {
				metrics.HAFASFetchTotal.WithLabelValues("error").Inc()
				return nil, err
			}
			metrics.HAFASFetchTotal.WithLabelValues("success").Inc()
			return t, nil
		})
		if err != nil || v == nil {
			continue
		}
		hafasTrip := v.(*hafas.HAFASTrip)
		update := TripUpdate{}
		for _, s := range hafasTrip.Stopovers {
			su := StopoverUpdate{StationID: s.Stop.ID}
			if s.Arrival != nil {
				su.ActualArrival = s.Arrival
			}
			if s.ArrivalDelay != nil {
				su.ArrivalDelaySecs = s.ArrivalDelay
			}
			if s.ArrivalPlatform != nil {
				su.ArrivalPlatform = s.ArrivalPlatform
			}
			if s.Cancelled {
				b := true
				su.Cancelled = &b
			}
			update.Stopovers = append(update.Stopovers, su)
		}
		updates[tripID] = update
	}
	return updates
}

func (pm *PollerManager) recomputeAlternatives(ctx context.Context, j *Journey, summary Summary) {
	result, err := pm.engine.Route(ctx, routing.RoutingRequest{
		TrainNumber:    j.TrainNumber,
		ToStationID:    j.Destination.ID,
		ToStationName:  j.Destination.Name,
		DepartureAfter: time.Now(),
		Filters:        j.Filters,
		InstallID:      j.InstallID,
	})
	if err != nil {
		return
	}
	if len(result.Alternatives) == 0 {
		return
	}
	pm.store.UpdateAlternatives(ctx, j.ID, result.Alternatives)

	// Update alternativeAvailable flag if it changed
	newSummary := summary
	newSummary.AlternativeAvailable = true
	if !summary.AlternativeAvailable {
		pm.store.UpdateState(ctx, j.ID, newSummary, j.Legs, false)
	}
}

func newPollRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

Also add `RecomputeSummary` to `hafas/mapper.go` — the poller needs to recompute summary from updated legs without a full HAFAS journey. Append to `backend/internal/hafas/mapper.go`:

```go
// RecomputeSummary recomputes a journey summary from updated legs and current time.
// Used by the poller after applying trip updates. Does not recompute nextStep freshly
// from HAFAS — uses existing leg data only.
func RecomputeSummary(legs []journey.Leg, destination journey.StationRef, filters journey.Filters, now time.Time) journey.Summary {
	return computeSummary(legs, destination, filters, nil, now)
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/journey/... -run TestApplyTrip -run TestSummaryChanged -v
```

Expected: `PASS`

- [ ] **Step 5: Build to verify no compile errors**

```bash
cd backend && go build ./...
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/journey/poller.go backend/internal/journey/poller_test.go \
        backend/internal/hafas/mapper.go
git commit -m "feat(backend): journey poller with trip update, state change detection"
```

---

### Task 5: Summary handler

**Files:**
- Create: `backend/internal/api/handlers/summary.go`
- Create: `backend/internal/api/handlers/summary_test.go`

The hot polling path. Returns 304 when ETag matches (no body, ~zero bandwidth).

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/summary_test.go
package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func makeTestJourney(id string) *journey.Journey {
	return &journey.Journey{
		ID:          id,
		ETagEpoch:   1749600000,
		ETagCounter: 42,
		Summary: journey.Summary{
			ETA:           time.Date(2026, 6, 10, 17, 24, 0, 0, time.UTC),
			Status:        journey.StatusOK,
			DataFetchedAt: time.Now(),
			LastUpdatedAt: time.Now(),
		},
		Legs:  []journey.Leg{},
		Stops: []journey.Stop{},
	}
}

func routeSummaryRequest(h *handlers.SummaryHandler, id, ifNoneMatch string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/summary", h.Get)
	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/"+id+"/summary", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func TestSummary_NoETag_Returns200WithBody(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000001")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	rr := routeSummaryRequest(h, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") == "" {
		t.Error("ETag header must be set on 200")
	}
	if rr.Header().Get("Cache-Control") != "private, no-cache, must-revalidate" {
		t.Errorf("Cache-Control: got %q", rr.Header().Get("Cache-Control"))
	}
	var body journey.Summary
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("body not decodable: %v", err)
	}
}

func TestSummary_MatchingETag_Returns304NoBody(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000002")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	etag := fmt.Sprintf(`"%s"`, j.ETag())
	rr := routeSummaryRequest(h, j.ID, etag)

	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr.Code)
	}
	if rr.Body.Len() != 0 {
		t.Errorf("304 must have no body, got %d bytes", rr.Body.Len())
	}
}

func TestSummary_StaleETag_Returns200(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000003")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	rr := routeSummaryRequest(h, j.ID, `"jrn_testid00000000000000000003:1749600000:41"`) // counter=41, current=42

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for stale ETag, got %d", rr.Code)
	}
}

func TestSummary_NotFound_Returns404(t *testing.T) {
	h := handlers.NewSummaryHandler(newMockStore())
	rr := routeSummaryRequest(h, "jrn_notexist0000000000000001", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestSummary -v
```

Expected: `FAIL`

- [ ] **Step 3: Write summary.go**

```go
// backend/internal/api/handlers/summary.go
package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/metrics"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// SummaryHandler handles GET /v1/journeys/{id}/summary.
type SummaryHandler struct {
	store journey.Store
}

func NewSummaryHandler(store journey.Store) *SummaryHandler {
	return &SummaryHandler{store: store}
}

// Get returns the journey summary. Returns 304 when the client ETag matches.
// Rate-limit headers are already set by the middleware and present on 304 too.
func (h *SummaryHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}

	etagValue := j.ETag()
	etagHeader := `"` + etagValue + `"`

	w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")

	if r.Header.Get("If-None-Match") == etagHeader {
		w.WriteHeader(http.StatusNotModified)
		metrics.PollETag304Total.Inc()
		return
	}

	w.Header().Set("ETag", etagHeader)
	metrics.PollETag200Total.Inc()
	writeJSON(w, http.StatusOK, j.Summary)
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestSummary -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/handlers/summary.go backend/internal/api/handlers/summary_test.go
git commit -m "feat(backend): GET /v1/journeys/{id}/summary with ETag 304 fast path"
```

---

### Task 6: Legs handler

**Files:**
- Create: `backend/internal/api/handlers/legs.go`
- Create: `backend/internal/api/handlers/legs_test.go`

Same ETag pattern as summary. Returns legs + stops. Called once on CompanionScreen mount, then only when `alternativeAvailable` changes.

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/legs_test.go
package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"fmt"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
)

func routeLegsRequest(h *handlers.LegsHandler, id, ifNoneMatch string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/legs", h.Get)
	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/"+id+"/legs", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func TestLegs_Returns200WithLegsAndStops(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_legstest000000000000001")
	store.journeys[j.ID] = j
	h := handlers.NewLegsHandler(store)

	rr := routeLegsRequest(h, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") == "" {
		t.Error("ETag header must be set")
	}
}

func TestLegs_MatchingETag_Returns304(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_legstest000000000000002")
	store.journeys[j.ID] = j
	h := handlers.NewLegsHandler(store)

	etag := fmt.Sprintf(`"%s"`, j.ETag())
	rr := routeLegsRequest(h, j.ID, etag)

	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr.Code)
	}
}

func TestLegs_NotFound_Returns404(t *testing.T) {
	h := handlers.NewLegsHandler(newMockStore())
	rr := routeLegsRequest(h, "jrn_notexist0000000000000002", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestLegs -v
```

Expected: `FAIL`

- [ ] **Step 3: Write legs.go**

```go
// backend/internal/api/handlers/legs.go
package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// LegsHandler handles GET /v1/journeys/{id}/legs.
type LegsHandler struct {
	store journey.Store
}

func NewLegsHandler(store journey.Store) *LegsHandler {
	return &LegsHandler{store: store}
}

type legsResponse struct {
	Legs  []journey.Leg  `json:"legs"`
	Stops []journey.Stop `json:"stops"`
}

// Get returns legs and stops for the Perlschnur timeline. ETag-cached.
func (h *LegsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}

	etagHeader := `"` + j.ETag() + `"`
	w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")

	if r.Header.Get("If-None-Match") == etagHeader {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("ETag", etagHeader)
	legs := j.Legs
	if legs == nil {
		legs = []journey.Leg{}
	}
	stops := j.Stops
	if stops == nil {
		stops = []journey.Stop{}
	}
	writeJSON(w, http.StatusOK, legsResponse{Legs: legs, Stops: stops})
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestLegs -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/handlers/legs.go backend/internal/api/handlers/legs_test.go
git commit -m "feat(backend): GET /v1/journeys/{id}/legs with ETag 304"
```

---

### Task 7: Alternatives handlers

**Files:**
- Create: `backend/internal/api/handlers/alternatives.go`
- Create: `backend/internal/api/handlers/alternatives_test.go`

GET returns cached list (ETag-cached). POST triggers fresh recomputation → 202 Accepted.

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/alternatives_test.go
package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func routeAltsRequest(h *handlers.AlternativesHandler, method, id, ifNoneMatch string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/alternatives", h.Get)
	r.Post("/v1/journeys/{id}/alternatives", h.Trigger)
	req := httptest.NewRequest(method, "/v1/journeys/"+id+"/alternatives", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func TestAlternatives_Get_Returns200(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000001")
	store.journeys[j.ID] = j
	store.alts[j.ID] = []journey.Alternative{
		{JourneyID: "jrn_alt1000000000000000000001"},
	}
	h := handlers.NewAlternativesHandler(store, &mockEngine{result: &mockEngineResult})

	rr := routeAltsRequest(h, http.MethodGet, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["data"] == nil {
		t.Error("response must have 'data' field")
	}
}

func TestAlternatives_Get_MatchingETag_Returns304(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000002")
	store.journeys[j.ID] = j
	store.alts[j.ID] = []journey.Alternative{}
	h := handlers.NewAlternativesHandler(store, &mockEngine{})

	// First call to get the ETag
	rr1 := routeAltsRequest(h, http.MethodGet, j.ID, "")
	etag := rr1.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag must be set on first GET")
	}

	// Second call with matching ETag
	rr2 := routeAltsRequest(h, http.MethodGet, j.ID, etag)
	if rr2.Code != http.StatusNotModified {
		t.Errorf("expected 304, got %d", rr2.Code)
	}
}

func TestAlternatives_Post_Returns202(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000003")
	store.journeys[j.ID] = j
	h := handlers.NewAlternativesHandler(store, &mockEngine{result: &mockEngineResult})

	rr := routeAltsRequest(h, http.MethodPost, j.ID, "")

	if rr.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["status"] != "computing" {
		t.Errorf("body.status: got %v, want computing", body["status"])
	}
	if body["pollPath"] == "" {
		t.Error("pollPath must be set")
	}
}

// mockEngineResult is a reusable non-nil RoutingResult for tests.
var mockEngineResult = routing.RoutingResult{
	Alternatives: []journey.Alternative{},
	Plausibility: journey.Plausibility{OnTrainConfidence: "high"},
}
```

- [ ] **Step 2: Add missing import to the test file**

The test references `routing` package. Add import to the test file:

```go
import (
    ...
    "github.com/verspaetungsbegleiter/backend/internal/routing"
)
```

- [ ] **Step 3: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestAlternatives -v
```

Expected: `FAIL`

- [ ] **Step 4: Write alternatives.go**

```go
// backend/internal/api/handlers/alternatives.go
package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// AlternativesHandler handles GET and POST /v1/journeys/{id}/alternatives.
type AlternativesHandler struct {
	store  journey.Store
	engine routing.Engine
}

func NewAlternativesHandler(store journey.Store, engine routing.Engine) *AlternativesHandler {
	return &AlternativesHandler{store: store, engine: engine}
}

type alternativesResponse struct {
	Data       []journey.Alternative `json:"data"`
	TotalCount int                   `json:"totalCount"`
}

// Get returns the cached alternatives list. ETag-cached.
func (h *AlternativesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	limit := 5
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, _ := strconv.Atoi(l); v >= 1 && v <= 20 {
			limit = v
		}
	}

	// Verify journey exists
	if _, err := h.store.Get(r.Context(), id); errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}

	alts, altsETag, err := h.store.GetAlternatives(r.Context(), id)
	if err != nil {
		alts = []journey.Alternative{}
		altsETag = fmt.Sprintf("%s:alts:0", id)
	}

	etagHeader := `"` + altsETag + `"`
	w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")

	if r.Header.Get("If-None-Match") == etagHeader {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	if len(alts) > limit {
		alts = alts[:limit]
	}
	if alts == nil {
		alts = []journey.Alternative{}
	}

	w.Header().Set("ETag", etagHeader)
	writeJSON(w, http.StatusOK, alternativesResponse{Data: alts, TotalCount: len(alts)})
}

// Trigger kicks off a fresh alternatives recomputation. Returns 202 immediately.
// Client polls GET /alternatives for results.
func (h *AlternativesHandler) Trigger(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}

	// Fire-and-forget recomputation
	go func() {
		result, err := h.engine.Route(r.Context(), routing.RoutingRequest{
			TrainNumber:    j.TrainNumber,
			ToStationID:    j.Destination.ID,
			ToStationName:  j.Destination.Name,
			DepartureAfter: time.Now(),
			Filters:        j.Filters,
			InstallID:      j.InstallID,
		})
		if err != nil || len(result.Alternatives) == 0 {
			return
		}
		h.store.UpdateAlternatives(r.Context(), id, result.Alternatives)
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":   "computing",
		"pollPath": "/v1/journeys/" + id + "/alternatives",
	})
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestAlternatives -v
```

Expected: `PASS`

- [ ] **Step 6: Run all handler tests**

```bash
cd backend && go test ./internal/api/handlers/... -v
```

Expected: all `PASS`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/api/handlers/alternatives.go \
        backend/internal/api/handlers/alternatives_test.go
git commit -m "feat(backend): GET/POST /v1/journeys/{id}/alternatives"
```

---

### Task 8: Full wire-up — router + main.go + boot recovery + GC

**Files:**
- Modify: `backend/internal/api/handlers/journeys.go`
- Modify: `backend/internal/api/router.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Update JourneysHandler to start/stop poller**

In `backend/internal/api/handlers/journeys.go`, change the struct and constructor:

```go
// JourneysHandler handles POST/GET/DELETE /v1/journeys[/{id}].
type JourneysHandler struct {
	store     journey.Store
	engine    routing.Engine
	poller    *journey.PollerManager // nil = no polling (tests)
	maxActive int
}

func NewJourneysHandler(store journey.Store, engine routing.Engine, poller *journey.PollerManager, maxActive int) *JourneysHandler {
	return &JourneysHandler{store: store, engine: engine, poller: poller, maxActive: maxActive}
}
```

In `Create`, after `h.store.Create(...)` succeeds:
```go
if h.poller != nil {
    h.poller.Start(j.ID)
}
```

In `Delete`, before `return`:
```go
if h.poller != nil {
    h.poller.Stop(id)
}
```

Update the test file `journeys_test.go` — the `newTestJourneysHandler` helper becomes:
```go
func newTestJourneysHandler(store journey.Store, engine routing.Engine, max int) *handlers.JourneysHandler {
    return handlers.NewJourneysHandler(store, engine, nil, max) // nil poller in tests
}
```

- [ ] **Step 2: Update router.go**

```go
// backend/internal/api/router.go
package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

// Deps holds all handler dependencies injected at startup.
type Deps struct {
	Health             *handlers.HealthHandler
	Stations           *handlers.StationsHandler
	Trains             *handlers.TrainsHandler
	Journeys           *handlers.JourneysHandler
	Summary            *handlers.SummaryHandler
	Legs               *handlers.LegsHandler
	Alternatives       *handlers.AlternativesHandler
	Logger             *slog.Logger
	CORSOrigins        []string
	InstallRateLimiter *mw.RateLimiter
	IPRateLimiter      *mw.RateLimiter
	PerInstallLimit    int
	PerIPLimit         int
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(mw.RequestID)
	r.Use(mw.Logging(deps.Logger))
	r.Use(mw.CORS(deps.CORSOrigins))
	r.Use(chimw.Recoverer)

	r.Get("/health", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)

	// Metrics: internal only — nginx blocks /metrics from external access
	r.Handle("/metrics", promhttp.Handler())

	r.Route("/v1", func(r chi.Router) {
		r.Use(mw.RateLimit(
			deps.InstallRateLimiter,
			deps.IPRateLimiter,
			deps.PerInstallLimit,
			deps.PerIPLimit,
		))

		r.Get("/stations", deps.Stations.Search)
		r.Get("/trains/{number}", deps.Trains.Get)

		r.Post("/journeys", deps.Journeys.Create)
		r.Get("/journeys/{id}", deps.Journeys.Get)
		r.Delete("/journeys/{id}", deps.Journeys.Delete)

		r.Get("/journeys/{id}/summary", deps.Summary.Get)
		r.Get("/journeys/{id}/legs", deps.Legs.Get)
		r.Get("/journeys/{id}/alternatives", deps.Alternatives.Get)
		r.Post("/journeys/{id}/alternatives", deps.Alternatives.Trigger)
	})

	return r
}
```

- [ ] **Step 3: Write the complete main.go with boot recovery + GC**

```go
// backend/cmd/server/main.go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/migrate"
	_ "github.com/verspaetungsbegleiter/backend/internal/metrics" // register Prometheus metrics
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func main() {
	cfg := config.Load()
	logger := newLogger(cfg.LogLevel)

	// Server lifetime context — cancelled on shutdown to stop all goroutines
	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()

	rdb, err := connectRedis(cfg.RedisURL)
	if err != nil {
		logger.Error("redis connect failed", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	db, err := connectDB(context.Background(), cfg)
	if err != nil {
		logger.Error("postgres connect failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := migrate.Run(context.Background(), db, cfg.MigrationsDir); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations complete")

	hafasClient := hafas.NewClient(cfg)
	coalescer := &hafas.Coalescer{}
	store := journey.NewStore(db, rdb, cfg.JourneyTTLHours, cfg.DBWriteTimeout)
	engine := routing.NewBFSEngine(hafasClient, coalescer)

	pool := journey.NewWorkerPool(cfg.HAFASWorkerPoolSize, cfg.HAFASQueueDepth)
	pollerManager := journey.NewPollerManager(
		serverCtx, store, hafasClient, coalescer, engine, pool,
		30*time.Second, cfg.JourneyTTLHours, logger,
	)

	// Boot recovery — rehydrate Redis + restart pollers with staggered start
	if err := bootRecovery(serverCtx, store, pollerManager, cfg.JourneyTTLHours, logger); err != nil {
		logger.Warn("boot recovery partial failure", "error", err)
		// Non-fatal: server still starts, journeys that failed rehydration will serve
		// from Postgres on next poll
	}

	installLimiter := mw.NewRateLimiter(cfg.RateLimitPerInstall)
	ipLimiter := mw.NewRateLimiter(cfg.RateLimitPerIP)

	go rateLimiterCleanup(serverCtx, installLimiter, ipLimiter)
	go gcJob(serverCtx, db, logger)

	router := api.NewRouter(api.Deps{
		Health:             handlers.NewHealthHandler(db, rdb, cfg.HAFASBaseURL),
		Stations:           handlers.NewStationsHandler(hafasClient, rdb),
		Trains:             handlers.NewTrainsHandler(hafasClient),
		Journeys:           handlers.NewJourneysHandler(store, engine, pollerManager, cfg.MaxActiveJourneys),
		Summary:            handlers.NewSummaryHandler(store),
		Legs:               handlers.NewLegsHandler(store),
		Alternatives:       handlers.NewAlternativesHandler(store, engine),
		Logger:             logger,
		CORSOrigins:        cfg.CORSAllowedOrigins,
		InstallRateLimiter: installLimiter,
		IPRateLimiter:      ipLimiter,
		PerInstallLimit:    cfg.RateLimitPerInstall,
		PerIPLimit:         cfg.RateLimitPerIP,
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan struct{})
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
		sig := <-quit
		logger.Info("shutdown signal received", "signal", sig)

		// 1. Stop accepting new requests; drain in-flight HTTP requests
		httpCtx, httpCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer httpCancel()
		srv.Shutdown(httpCtx)

		// 2. Cancel all poller goroutines
		serverCancel()

		// 3. Drain worker pool (bounded by HAFAS_REQUEST_TIMEOUT)
		pool.Shutdown()

		logger.Info("shutdown complete")
		close(done)
	}()

	logger.Info("server starting", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
	<-done
}

// bootRecovery rehydrates active journeys into Redis and restarts their pollers
// with a staggered start to avoid a HAFAS burst on restart.
func bootRecovery(ctx context.Context, store *journey.RedisPostgresStore, pm *journey.PollerManager, ttlHours int, logger *slog.Logger) error {
	active, err := store.GetActive(ctx, ttlHours)
	if err != nil {
		return err
	}
	if len(active) == 0 {
		logger.Info("boot recovery: no active journeys")
		return nil
	}
	logger.Info("boot recovery: rehydrating journeys", "count", len(active))

	// Staggered start: spread poller launches over 10s to avoid HAFAS burst
	delay := 10 * time.Second
	if len(active) > 0 {
		delay = time.Duration(10000/len(active)) * time.Millisecond
	}

	for _, j := range active {
		j := j // capture loop variable
		// Rehydrate Redis with new epoch (existing epoch is stale after restart)
		j.ETagEpoch = time.Now().Unix()
		if wErr := store.Create(ctx, &j, nil); wErr != nil {
			// Tolerate individual failures — Postgres is authoritative
			logger.Warn("boot recovery: rehydrate failed", "journeyId", j.ID, "error", wErr)
		}
		pm.Start(j.ID)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	logger.Info("boot recovery complete", "restarted", len(active))
	return nil
}

// gcJob runs every 30 minutes and deletes terminated or stale journeys.
func gcJob(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			res, err := db.Exec(ctx, `
				WITH to_delete AS (
					SELECT id FROM journeys
					WHERE (terminated_at IS NOT NULL OR created_at < now() - interval '6 hours')
					FOR UPDATE SKIP LOCKED
				)
				DELETE FROM journeys WHERE id IN (SELECT id FROM to_delete)
			`)
			if err != nil {
				logger.Warn("GC job error", "error", err)
				continue
			}
			if n := res.RowsAffected(); n > 0 {
				logger.Info("GC job complete", "deleted", n)
			}
		}
	}
}

func rateLimiterCleanup(ctx context.Context, limiters ...*mw.RateLimiter) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, rl := range limiters {
				rl.Cleanup(2 * time.Minute)
			}
		}
	}
}

func connectRedis(rawURL string) (*redis.Client, error) {
	opt, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	c := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c, c.Ping(ctx).Err()
}

func connectDB(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = int32(cfg.DBMaxOpenConns)
	pcfg.MinConns = int32(cfg.DBMaxIdleConns)
	db, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return db, db.Ping(ctx2)
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "DEBUG":
		l = slog.LevelDebug
	case "WARN":
		l = slog.LevelWarn
	case "ERROR":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
```

- [ ] **Step 4: Build**

```bash
cd backend && go build ./...
```

Expected: exits 0.

- [ ] **Step 5: Run all tests**

```bash
cd backend && go test ./...
```

Expected: all `PASS`. Note: `journeys_test.go` must use `nil` for the poller parameter — verify the helper was updated in Step 1.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/handlers/journeys.go \
        backend/internal/api/router.go \
        backend/cmd/server/main.go
git commit -m "feat(backend): wire all routes, poller, boot recovery, GC, graceful shutdown"
```

---

### Task 9: Smoke test — full live monitoring

No files created. Verifies the complete monitoring loop end-to-end.

- [ ] **Step 1: Start the stack**

```bash
docker compose up --build -d
```

Expected: all services healthy.

- [ ] **Step 2: Create a journey**

```bash
INSTALL_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
JOURNEY=$(curl -s -X POST http://localhost/v1/journeys \
  -H "Content-Type: application/json" \
  -H "X-Install-Id: $INSTALL_ID" \
  -d '{"trainNumber":"ICE 123","destination":"8000105","iAmOnThisTrain":true}')
echo $JOURNEY | jq .journeyId
JOURNEY_ID=$(echo $JOURNEY | jq -r .journeyId)
```

Expected: `jrn_` prefixed ID.

- [ ] **Step 3: Poll summary — first call returns 200 + ETag**

```bash
RESP=$(curl -si "http://localhost/v1/journeys/$JOURNEY_ID/summary" \
  -H "X-Install-Id: $INSTALL_ID")
echo "$RESP" | grep -i "HTTP\|ETag\|X-RateLimit"
```

Expected: `HTTP/1.1 200 OK`, `ETag: "jrn_...:..:1"`, `X-RateLimit-*` headers.

- [ ] **Step 4: Poll summary — same ETag returns 304**

```bash
ETAG=$(echo "$RESP" | grep -i ETag | awk '{print $2}' | tr -d '\r')
curl -si "http://localhost/v1/journeys/$JOURNEY_ID/summary" \
  -H "X-Install-Id: $INSTALL_ID" \
  -H "If-None-Match: $ETAG" | grep "HTTP/"
```

Expected: `HTTP/1.1 304 Not Modified`

- [ ] **Step 5: Get legs**

```bash
curl -s "http://localhost/v1/journeys/$JOURNEY_ID/legs" | jq 'keys'
```

Expected: `["legs","stops"]`

- [ ] **Step 6: Get alternatives**

```bash
curl -s "http://localhost/v1/journeys/$JOURNEY_ID/alternatives" | jq .
```

Expected: `{"data":[...],"totalCount":...}`

- [ ] **Step 7: Trigger alternatives recomputation**

```bash
curl -s -X POST "http://localhost/v1/journeys/$JOURNEY_ID/alternatives" \
  -H "X-Install-Id: $INSTALL_ID" | jq .
```

Expected: `{"status":"computing","pollPath":"/v1/journeys/.../alternatives"}`

- [ ] **Step 8: Verify Prometheus metrics**

Metrics are internal — accessible directly on the backend port (nginx blocks /metrics externally):

```bash
curl -s http://localhost:8080/metrics | grep -E "active_journeys|hafas_circuit"
```

Expected: `active_journeys_total 1` (one journey running), `hafas_circuit_state 0` (circuit closed).

If port 8080 isn't exposed on host in production mode, run via docker exec:

```bash
docker compose exec backend wget -qO- http://localhost:8080/metrics | grep active_journeys
```

- [ ] **Step 9: Wait 30s and verify poller ran**

```bash
sleep 32
curl -s "http://localhost/v1/journeys/$JOURNEY_ID/summary" | jq .dataFetchedAt
```

Expected: timestamp within last 35 seconds (poller ran).

- [ ] **Step 10: Delete journey + verify poller stops**

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE \
  "http://localhost/v1/journeys/$JOURNEY_ID" \
  -H "X-Install-Id: $INSTALL_ID"
```

Expected: `204`

```bash
sleep 2
curl -s http://localhost:8080/metrics | grep active_journeys
```

Expected: `active_journeys_total 0`

- [ ] **Step 11: Verify graceful shutdown**

```bash
docker compose stop backend
```

Expected: container stops cleanly (exit 0, no `killed` in docker logs).

```bash
docker compose logs backend | tail -5
```

Expected: `"shutdown complete"` log line.

- [ ] **Step 12: Stop stack**

```bash
docker compose down
```

- [ ] **Step 13: Final commit**

```bash
git add -A
git commit -m "feat(backend): Plan 4 complete — live monitoring, metrics, boot recovery"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered |
|-------------|---------|
| Background poller goroutine per journey | ✓ Task 4 |
| Bounded HAFAS worker pool (`HAFAS_WORKER_POOL_SIZE`) | ✓ Task 3 |
| Worker pool drops task when full (non-blocking Submit) | ✓ Task 3 |
| Singleflight coalescer on `(tripId)` key | ✓ Task 4 |
| Poll every 30s foreground | ✓ Task 4 (30s ticker) |
| State change → ETag counter incremented | ✓ Task 4 via store.UpdateState |
| Write-through on state change (Postgres then Redis) | ✓ Plan 3 store.UpdateState |
| `GET /v1/journeys/{id}/summary` → 200 with ETag | ✓ Task 5 |
| `GET /v1/journeys/{id}/summary` with matching ETag → 304 | ✓ Task 5 |
| Rate-limit headers on 304 responses | ✓ middleware runs before handler |
| `GET /v1/journeys/{id}/legs` → 200 / 304 | ✓ Task 6 |
| `GET /v1/journeys/{id}/alternatives` → list + ETag | ✓ Task 7 |
| `POST /v1/journeys/{id}/alternatives` → 202 + pollPath | ✓ Task 7 |
| Prometheus `/metrics` endpoint | ✓ Task 8 (promhttp.Handler) |
| All metrics defined: hafas_fetch, active_journeys, etag counters, circuit_state | ✓ Task 2 |
| Boot recovery: rehydrate Redis + restart pollers | ✓ Task 8 bootRecovery() |
| Staggered poller restart (spread over 10s) | ✓ Task 8 bootRecovery() |
| Graceful shutdown: HTTP drain → cancel pollers → drain pool | ✓ Task 8 signal handler |
| GC job: delete terminated/stale journeys every 30min | ✓ Task 8 gcJob() |
| GC uses `FOR UPDATE SKIP LOCKED` | ✓ Task 8 gcJob() |
| Rate limiter cleanup goroutine | ✓ Task 8 rateLimiterCleanup() |
| `X-Request-Id` propagated to HAFAS poll calls | ✓ Task 4 newPollRequestID() |
| Poller cancelled on DELETE | ✓ Task 8 JourneysHandler.Delete |
| Poller cancelled on TTL expiry | ✓ Task 4 poll() TTL check |
| Re-routing on critical status | ✓ Task 4 recomputeAlternatives() |

**Not in Plan 4 (V2+):**
- SSE endpoint `/v1/journeys/{id}/events` — reserved path, not implemented
- `PATCH /v1/journeys/{id}` — filter update without delete/recreate
- `adaptive polling to 10s` when `minTransferBufferMinutes < 5` — frontend-side logic, backend always polls at 30s

**Placeholder scan:** None.

**Type consistency:**
- `TripUpdate` + `StopoverUpdate` defined in `poller.go`, used in `poller_test.go` and `poll()`
- `RecomputeSummary` added to `hafas/mapper.go`, called from `poller.go`
- `PollerManager` accepted by `JourneysHandler` as `*journey.PollerManager` (pointer, nil-safe)
- `journey.Store` interface unchanged from Plan 3 — all Plan 4 calls use existing methods

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-11-backend-plan-4-monitoring.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans

Which approach?
