package hafas_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *hafas.Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     3,
		HAFASCBProbeInterval: 30 * time.Second,
	})
}

func TestSearchStations_ReturnsStations(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/locations" {
			t.Errorf("unexpected path: %q", r.URL.Path)
		}
		if r.URL.Query().Get("query") != "Frank" {
			t.Errorf("unexpected query param: %q", r.URL.Query().Get("query"))
		}
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{
			{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		})
	})

	stations, err := client.SearchStations(context.Background(), "Frank", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stations) != 1 || stations[0].ID != "8000105" {
		t.Errorf("unexpected stations: %+v", stations)
	}
}

func TestSearchStations_PropagatesRequestID(t *testing.T) {
	var gotHeader string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("X-Request-Id")
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	})

	ctx := reqid.Set(context.Background(), "test-request-id-123")
	client.SearchStations(ctx, "Frank", 5)

	if gotHeader != "test-request-id-123" {
		t.Errorf("X-Request-Id not propagated: got %q", gotHeader)
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         "http://localhost:1",
		HAFASRequestTimeout:  50 * time.Millisecond,
		HAFASCBThreshold:     2,
		HAFASCBProbeInterval: 10 * time.Second,
	})

	for range 2 {
		client.SearchStations(context.Background(), "test", 1)
	}

	_, err := client.SearchStations(context.Background(), "test", 1)
	if !errors.Is(err, hafas.ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen after threshold, got: %v", err)
	}
}

func TestCircuitBreaker_ClosesAfterProbeSuccess(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	}))
	defer srv.Close()

	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     1,
		HAFASCBProbeInterval: 0,
	})

	client.RecordFailureForTest()

	_, err := client.SearchStations(context.Background(), "test", 1)
	if err != nil {
		t.Fatalf("probe should succeed: %v", err)
	}

	if client.CircuitState() != 0 {
		t.Errorf("expected circuit closed (0), got %d", client.CircuitState())
	}
}

func TestSearchTrips_ReturnsTrips(t *testing.T) {
	trip := hafas.HAFASTrip{
		ID: "trip-1",
		Line:   hafas.HAFASLine{Name: "ICE 100"},
	}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/trips" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{Trips: []hafas.HAFASTrip{trip}})
	})
	trips, err := client.SearchTrips(context.Background(), "ICE 100", 5)
	if err != nil {
		t.Fatalf("SearchTrips: %v", err)
	}
	if len(trips) != 1 || trips[0].ID != "trip-1" {
		t.Errorf("unexpected trips: %v", trips)
	}
}

func TestSearchTrips_CircuitOpen(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "server error", http.StatusInternalServerError)
	})
	// Trip the circuit breaker.
	for range 3 {
		client.SearchTrips(context.Background(), "ICE 1", 1) //nolint:errcheck
	}
	_, err := client.SearchTrips(context.Background(), "ICE 1", 1)
	if !errors.Is(err, hafas.ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestSearchJourneys_ReturnsJourneys(t *testing.T) {
	journey := hafas.HAFASJourney{Legs: []hafas.HAFASLeg{}}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/journeys" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(hafas.HAFASJourneysResponse{Journeys: []hafas.HAFASJourney{journey}})
	})
	journeys, err := client.SearchJourneys(context.Background(), "8000261", "8011160", time.Now(), 3)
	if err != nil {
		t.Fatalf("SearchJourneys: %v", err)
	}
	if len(journeys) != 1 {
		t.Errorf("expected 1 journey, got %d", len(journeys))
	}
}

func TestGetTrip_ReturnsTrip(t *testing.T) {
	trip := hafas.HAFASTrip{ID: "trip-42", Line: hafas.HAFASLine{Name: "RE 5"}}
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(struct {
			Trip hafas.HAFASTrip `json:"trip"`
		}{Trip: trip})
	})
	got, err := client.GetTrip(context.Background(), "trip-42")
	if err != nil {
		t.Fatalf("GetTrip: %v", err)
	}
	if got.ID != "trip-42" {
		t.Errorf("TripID = %q, want trip-42", got.ID)
	}
}
