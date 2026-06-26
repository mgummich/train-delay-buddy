package routing_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func newBFSEngine(t *testing.T, handler http.HandlerFunc) routing.Engine {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     5,
		HAFASCBProbeInterval: 30 * time.Second,
	}, nil)
	return routing.NewBFSEngine(client)
}

// bfsHandler builds an httptest handler that serves departure boards, trip details,
// and journeys for BFS routing tests.
func bfsHandler(
	departureLineName string, tripID string, trip hafas.HAFASTrip,
	journeys []hafas.HAFASJourney,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/departures"):
			json.NewEncoder(w).Encode(hafas.HAFASDeparturesResponse{ //nolint:errcheck
				Departures: []hafas.HAFASDeparture{{
					TripId: tripID,
					Line:   &hafas.HAFASLine{Name: departureLineName},
				}},
			})
		case strings.HasPrefix(r.URL.Path, "/trips/"):
			json.NewEncoder(w).Encode(struct { //nolint:errcheck
				Trip hafas.HAFASTrip `json:"trip"`
			}{Trip: trip})
		case r.URL.Path == "/journeys":
			json.NewEncoder(w).Encode(hafas.HAFASJourneysResponse{Journeys: journeys}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	}
}

func TestBFS_ReturnsOriginalAndAlternatives(t *testing.T) {
	dep1, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr1, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	dep2, _ := time.Parse(time.RFC3339, "2026-06-10T14:30:00Z")
	arr2, _ := time.Parse(time.RFC3339, "2026-06-10T16:30:00Z")

	trip := hafas.HAFASTrip{
		ID:     "trip-ice-123",
		Line:   hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
		Origin: hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
		Stopovers: []hafas.HAFASStopover{
			{Stop: hafas.HAFASPlace{ID: "8000261"}, PlannedDeparture: &dep1},
			{Stop: hafas.HAFASPlace{ID: "8000105"}, PlannedArrival: &arr1},
		},
	}
	journeys := []hafas.HAFASJourney{
		{Legs: []hafas.HAFASLeg{{
			Origin: hafas.HAFASPlace{ID: "8000261"}, Destination: hafas.HAFASPlace{ID: "8000105"},
			PlannedDeparture: &dep1, PlannedArrival: &arr1,
			Line: &hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
		}}},
		{Legs: []hafas.HAFASLeg{{
			Origin: hafas.HAFASPlace{ID: "8000261"}, Destination: hafas.HAFASPlace{ID: "8000105"},
			PlannedDeparture: &dep2, PlannedArrival: &arr2,
			Line: &hafas.HAFASLine{Name: "ICE 456", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
		}}},
	}

	engine := newBFSEngine(t, bfsHandler("ICE 123", "trip-ice-123", trip, journeys))

	result, err := engine.Route(context.Background(), routing.RoutingRequest{
		TrainNumber:    "ICE 123",
		FromStationID:  "8000261",
		ToStationID:    "8000105",
		ToStationName:  "Frankfurt (Main) Hbf",
		DepartureAfter: dep1,
		Filters:        journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal},
		InstallID:      "test-install",
	})
	if err != nil {
		t.Fatalf("Route error: %v", err)
	}
	if result.Original.TrainNumber != "ICE 123" {
		t.Errorf("original train: got %q", result.Original.TrainNumber)
	}
	if len(result.Alternatives) != 1 {
		t.Errorf("expected 1 alternative, got %d", len(result.Alternatives))
	}
}

func TestBFS_DBOnlyFilterExcludesNonDB(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arrOrig, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	arrAlt, _ := time.Parse(time.RFC3339, "2026-06-10T16:00:00Z")

	trip := hafas.HAFASTrip{
		ID:     "trip-ice-1",
		Line:   hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
		Origin: hafas.HAFASPlace{ID: "A"},
		Stopovers: []hafas.HAFASStopover{
			{Stop: hafas.HAFASPlace{ID: "A"}, PlannedDeparture: &dep},
		},
	}
	journeys := []hafas.HAFASJourney{
		{Legs: []hafas.HAFASLeg{{
			Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
			PlannedDeparture: &dep, PlannedArrival: &arrOrig,
			Line: &hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
		}}},
		{Legs: []hafas.HAFASLeg{{
			Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
			PlannedDeparture: &dep, PlannedArrival: &arrAlt,
			Line: &hafas.HAFASLine{Name: "FLX 1", Operator: &hafas.HAFASOperator{Name: "Flixtrain"}},
		}}},
	}

	engine := newBFSEngine(t, bfsHandler("ICE 1", "trip-ice-1", trip, journeys))

	result, err := engine.Route(context.Background(), routing.RoutingRequest{
		TrainNumber: "ICE 1", FromStationID: "A", ToStationID: "B",
		DepartureAfter: dep,
		Filters:        journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal},
		InstallID:      "test",
	})
	if err != nil {
		t.Fatalf("Route error: %v", err)
	}
	if len(result.Alternatives) != 0 {
		t.Errorf("Flixtrain should be filtered out; got %d alternatives", len(result.Alternatives))
	}
}
