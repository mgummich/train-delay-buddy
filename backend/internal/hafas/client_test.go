package hafas_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	}, nil)
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
	client.SearchStations(ctx, "Frank", 5) //nolint:errcheck

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
	}, nil)

	for range 2 {
		client.SearchStations(context.Background(), "test", 1) //nolint:errcheck
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
	}, nil)

	client.RecordFailureForTest()

	_, err := client.SearchStations(context.Background(), "test", 1)
	if err != nil {
		t.Fatalf("probe should succeed: %v", err)
	}

	if client.CircuitState() != 0 {
		t.Errorf("expected circuit closed (0), got %d", client.CircuitState())
	}
}

func TestSearchTripByLineName_FindsTrip(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-14T10:00:00Z")

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/departures"):
			json.NewEncoder(w).Encode(hafas.HAFASDeparturesResponse{
				Departures: []hafas.HAFASDeparture{{
					TripId: "trip-1",
					Line:   &hafas.HAFASLine{Name: "ICE 100"},
				}},
			})
		case strings.HasPrefix(r.URL.Path, "/trips/"):
			json.NewEncoder(w).Encode(struct {
				Trip hafas.HAFASTrip `json:"trip"`
			}{Trip: hafas.HAFASTrip{
				ID:   "trip-1",
				Line: hafas.HAFASLine{Name: "ICE 100"},
				Stopovers: []hafas.HAFASStopover{
					{Stop: hafas.HAFASPlace{ID: "8000261"}, PlannedDeparture: &dep},
				},
			}})
		default:
			http.NotFound(w, r)
		}
	})

	trip, err := client.SearchTripByLineName(context.Background(), "ICE 100", "2026-06-14")
	if err != nil {
		t.Fatalf("SearchTripByLineName: %v", err)
	}
	if trip == nil {
		t.Fatal("expected trip, got nil")
	}
	if trip.ID != "trip-1" {
		t.Errorf("TripID = %q, want trip-1", trip.ID)
	}
}

func TestSearchTripByLineName_NotFound(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/departures") {
			json.NewEncoder(w).Encode(hafas.HAFASDeparturesResponse{Departures: []hafas.HAFASDeparture{}})
		}
	})

	trip, err := client.SearchTripByLineName(context.Background(), "ICE 999", "2026-06-14")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if trip != nil {
		t.Errorf("expected nil, got trip %q", trip.ID)
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
