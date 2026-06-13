package journey

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"sync"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/metrics"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// TripUpdate holds realtime data for one trip.
type TripUpdate struct {
	Stopovers []StopoverUpdate
}

// StopoverUpdate holds per-stop realtime fields for ApplyTripUpdates.
type StopoverUpdate struct {
	StationID        string
	ActualArrival    *time.Time
	ArrivalDelaySecs *int
	ArrivalPlatform  *string
	Cancelled        *bool
}

// FetchTripUpdatesFn fetches realtime trip updates for the given legs.
// Injected from main.go to avoid an import cycle (journey ← routing ← hafas ← journey).
type FetchTripUpdatesFn func(ctx context.Context, legs []Leg) map[string]TripUpdate

// RecomputeAlternativesFn re-routes and returns fresh alternatives for a journey.
type RecomputeAlternativesFn func(ctx context.Context, j *Journey) []Alternative

// CircuitStateFn returns the HAFAS circuit breaker state (0=closed, 1=half-open, 2=open).
type CircuitStateFn func() int

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
	ctx          context.Context
	store        Store
	fetchUpdates FetchTripUpdatesFn
	recomputeAlts RecomputeAlternativesFn
	circuitState CircuitStateFn
	pool         *WorkerPool
	interval     time.Duration
	ttlHours     int
	logger       *slog.Logger
	mu           sync.Mutex
	cancels      map[string]context.CancelFunc
}

// NewPollerManager creates a PollerManager. ctx should be the server lifetime context.
// fetchUpdates, recomputeAlts, and circuitState are injected from main to avoid import cycles.
func NewPollerManager(
	ctx context.Context,
	store Store,
	fetchUpdates FetchTripUpdatesFn,
	recomputeAlts RecomputeAlternativesFn,
	circuitState CircuitStateFn,
	pool *WorkerPool,
	interval time.Duration,
	ttlHours int,
	logger *slog.Logger,
) *PollerManager {
	return &PollerManager{
		ctx:           ctx,
		store:         store,
		fetchUpdates:  fetchUpdates,
		recomputeAlts: recomputeAlts,
		circuitState:  circuitState,
		pool:          pool,
		interval:      interval,
		ttlHours:      ttlHours,
		logger:        logger,
		cancels:       make(map[string]context.CancelFunc),
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
	// Release cancel func and gauge even when the parent context cancels (bypassing Stop).
	defer func() {
		pm.mu.Lock()
		if cancel, ok := pm.cancels[journeyID]; ok {
			cancel()
			delete(pm.cancels, journeyID)
			metrics.ActiveJourneys.Dec()
		}
		pm.mu.Unlock()
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			submitted := pm.pool.Submit(func() { pm.poll(ctx, journeyID) })
			if !submitted {
				pm.logger.Warn("worker pool full — skipping poll tick", "journeyId", journeyID)
			}
		}
	}
}

func (pm *PollerManager) poll(ctx context.Context, journeyID string) {
	ctx = reqid.Set(ctx, newPollRequestID())

	j, err := pm.store.Get(ctx, journeyID)
	if err != nil {
		pm.Stop(journeyID)
		return
	}

	if time.Since(j.CreatedAt) > time.Duration(pm.ttlHours)*time.Hour {
		pm.Stop(journeyID)
		return
	}

	tripUpdates := pm.fetchUpdates(ctx, j.Legs)
	updatedLegs, legsChanged := ApplyTripUpdates(j.Legs, tripUpdates)

	newSummary := ComputeSummary(updatedLegs, j.Destination, j.Filters, nil, time.Now())
	newSummary.DataFetchedAt = time.Now()
	newSummary.LastUpdatedAt = j.Summary.LastUpdatedAt
	newSummary.AlternativeAvailable = j.Summary.AlternativeAvailable

	if !SummaryChanged(j.Summary, newSummary) && !legsChanged {
		return
	}
	newSummary.LastUpdatedAt = time.Now()

	// Compute alternatives before writing so AlternativeAvailable is correct in one write,
	// avoiding a second UpdateState call for the flag.
	var freshAlts []Alternative
	if newSummary.Status == StatusCritical || newSummary.CriticalTransfer {
		freshAlts = pm.recomputeAlts(ctx, j)
		if len(freshAlts) > 0 {
			newSummary.AlternativeAvailable = true
		}
	}

	if err := pm.store.UpdateState(ctx, j, newSummary, updatedLegs, legsChanged); err != nil {
		pm.logger.Warn("store.UpdateState failed", "journeyId", journeyID, "error", err)
		return
	}

	pm.logger.Info("poll_state_change",
		"journeyId", journeyID,
		"requestId", reqid.Get(ctx),
		"status", newSummary.Status,
		"dataFetchedAt", newSummary.DataFetchedAt,
	)

	if len(freshAlts) > 0 {
		if err := pm.store.UpdateAlternatives(ctx, j.ID, freshAlts); err != nil {
			pm.logger.Warn("store.UpdateAlternatives failed", "journeyId", journeyID, "error", err)
		}
	}

	if pm.circuitState != nil {
		metrics.HAFASCircuitState.Set(float64(pm.circuitState()))
	}
}

func newPollRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
