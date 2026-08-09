package journey_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// stubStore implements journey.Store for PollerManager tests.
// Only Get and UpdateState are exercised; other methods return errors/zero values.
type stubStore struct {
	getJourney *journey.Journey
	getErr     error
	updateErr  error
	updated    chan struct{}
}

func (s *stubStore) Create(_ context.Context, _ *journey.Journey, _ []journey.Alternative) error {
	return errors.New("not implemented")
}
func (s *stubStore) Get(_ context.Context, _ string) (*journey.Journey, error) {
	return s.getJourney, s.getErr
}
func (s *stubStore) GetAlternatives(_ context.Context, _ string) ([]journey.Alternative, string, error) {
	return nil, "", nil
}
func (s *stubStore) UpdateState(_ context.Context, _ *journey.Journey, _ journey.Summary, _ []journey.Leg, _ bool) error {
	if s.updated != nil {
		select {
		case s.updated <- struct{}{}:
		default:
		}
	}
	return s.updateErr
}
func (s *stubStore) UpdateAlternatives(_ context.Context, _ string, _ []journey.Alternative) error {
	return nil
}
func (s *stubStore) Terminate(_ context.Context, _ string) error {
	return nil
}
func (s *stubStore) GetActive(_ context.Context, _ int) ([]journey.Journey, error) {
	return nil, nil
}
func (s *stubStore) CountActive(_ context.Context) (int, error) {
	return 0, nil
}
func (s *stubStore) GetIdempotency(_ context.Context, _ string) (*journey.IdempotencyEntry, error) {
	return nil, nil
}
func (s *stubStore) SetIdempotency(_ context.Context, _ string, _ journey.IdempotencyEntry) error {
	return nil
}

func newTestPollerManager(ctx context.Context, store journey.Store, interval time.Duration) *journey.PollerManager {
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	pool := journey.NewWorkerPool(2, 16)
	noopFetch := func(_ context.Context, _ []journey.Leg) map[string]journey.TripUpdate {
		return nil
	}
	noopRecompute := func(_ context.Context, _ *journey.Journey) []journey.Alternative {
		return nil
	}
	return journey.NewPollerManager(ctx, store, noopFetch, noopRecompute, nil, pool, interval, 24, log)
}

func TestPollerManager_StartStopActiveCount(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store := &stubStore{getErr: errors.New("not found")} // poll will Stop immediately on error
	pm := newTestPollerManager(ctx, store, 10*time.Millisecond)

	if pm.ActiveCount() != 0 {
		t.Fatalf("initial ActiveCount = %d, want 0", pm.ActiveCount())
	}

	pm.Start("jrn_test_001")

	// Give the goroutine time to start.
	deadline := time.Now().Add(500 * time.Millisecond)
	for pm.ActiveCount() != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if pm.ActiveCount() != 1 {
		t.Fatalf("ActiveCount after Start = %d, want 1", pm.ActiveCount())
	}

	pm.Stop("jrn_test_001")

	deadline = time.Now().Add(500 * time.Millisecond)
	for pm.ActiveCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if pm.ActiveCount() != 0 {
		t.Fatalf("ActiveCount after Stop = %d, want 0", pm.ActiveCount())
	}
}

func TestPollerManager_Start_Idempotent(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	store := &stubStore{getErr: errors.New("not found")}
	pm := newTestPollerManager(ctx, store, 50*time.Millisecond)

	pm.Start("jrn_idem")
	pm.Start("jrn_idem") // second call is a noop

	deadline := time.Now().Add(500 * time.Millisecond)
	for pm.ActiveCount() < 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if pm.ActiveCount() != 1 {
		t.Errorf("ActiveCount = %d, want 1 after duplicate Start", pm.ActiveCount())
	}
}

func TestPollerManager_Poll_StopsWhenStoreGetFails(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// store.Get returns error → poll must call Stop and decrement ActiveCount.
	store := &stubStore{getErr: errors.New("journey not found")}
	pm := newTestPollerManager(ctx, store, 5*time.Millisecond)

	pm.Start("jrn_stop_on_err")

	// Poll fires, gets error, calls Stop; wait for count to drop back to 0.
	deadline := time.Now().Add(2 * time.Second)
	for pm.ActiveCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if pm.ActiveCount() != 0 {
		t.Errorf("ActiveCount = %d after store error; expected poll to self-stop", pm.ActiveCount())
	}
}

func TestPollerManager_Poll_StopsWhenJourneyExpired(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Journey was created 25 hours ago — exceeds ttlHours=24.
	expired := &journey.Journey{
		ID:          "jrn_expired",
		CreatedAt:   time.Now().Add(-25 * time.Hour),
		Legs:        []journey.Leg{},
		Destination: journey.StationRef{ID: "dest", Name: "Berlin"},
		Filters:     journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
	}
	store := &stubStore{getJourney: expired}
	pm := newTestPollerManager(ctx, store, 5*time.Millisecond)

	pm.Start("jrn_expired")

	deadline := time.Now().Add(2 * time.Second)
	for pm.ActiveCount() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if pm.ActiveCount() != 0 {
		t.Errorf("ActiveCount = %d; expired journey should self-stop", pm.ActiveCount())
	}
}

func TestPollerManager_Poll_UpdatesStateOnChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	updated := make(chan struct{}, 1)
	dep := time.Now().Add(10 * time.Minute)
	arr := time.Now().Add(70 * time.Minute)
	newArr := time.Now().Add(80 * time.Minute) // simulates delay → SummaryChanged

	j := &journey.Journey{
		ID:        "jrn_update",
		CreatedAt: time.Now(),
		Legs: []journey.Leg{
			{
				VehicleNumber:        "ICE 100",
				DepartureTimePlanned: dep,
				ArrivalTimePlanned:   arr,
				ArrivalTimeActual:    &newArr, // causes ETA change
				Status:               journey.LegStatusDelayed,
				Stops:                []journey.Stop{{StationID: "dest", StationName: "Berlin"}},
			},
		},
		Destination: journey.StationRef{ID: "dest", Name: "Berlin"},
		Filters:     journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		Summary:     journey.Summary{ETA: arr, Status: journey.StatusOK}, // old summary
	}

	store := &stubStore{getJourney: j, updated: updated}
	pm := newTestPollerManager(ctx, store, 5*time.Millisecond)
	pm.Start("jrn_update")

	select {
	case <-updated:
		// UpdateState was called — poll ran successfully
	case <-time.After(2 * time.Second):
		t.Error("UpdateState was not called within timeout")
	}
	pm.Stop("jrn_update")
}
