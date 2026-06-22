//go:build integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// TestRouting_IC944_MünchenToKöln tests the full BFS routing pipeline for IC 944.
// The destination is Köln Hbf — adjust if IC 944's route has changed.
// Skipped when IC 944 isn't found by SearchTripByLineName (train not running today).
func TestRouting_IC944_Hamburg_To_Frankfurt(t *testing.T) {
	client := newHAFASClient(t)
	engine := routing.NewBFSEngine(client)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	// First confirm IC 944 runs today.
	date := today()
	trip, err := client.SearchTripByLineName(ctx, "944", date)
	if err != nil {
		t.Fatalf("SearchTripByLineName: %v", err)
	}
	if trip == nil {
		t.Skipf("IC 944 not found for %s — skipping routing test", date)
	}

	t.Logf("IC 944 trip: %s → %s (%d stopovers)", trip.Origin.Name, trip.Destination.Name, len(trip.Stopovers))

	// Use the trip's actual destination as ToStationID so the test stays valid
	// even if IC 944's route changes. Requires at least 2 stopovers.
	if len(trip.Stopovers) < 2 {
		t.Skipf("IC 944 trip has only %d stopovers, need ≥2", len(trip.Stopovers))
	}
	lastStop := trip.Stopovers[len(trip.Stopovers)-1]

	result, err := engine.Route(ctx, routing.RoutingRequest{
		TrainNumber:    "944",
		ToStationID:    lastStop.Stop.ID,
		ToStationName:  lastStop.Stop.Name,
		DepartureAfter: time.Now(),
		Filters: journey.Filters{
			DBOnly:      false,
			SafetyLevel: journey.SafetyLevelNormal,
		},
		InstallID: "integration-test",
	})
	if err != nil {
		t.Fatalf("Route: %v", err)
	}

	t.Logf("Original journey: train=%s, destination=%s, legs=%d",
		result.Original.TrainNumber,
		result.Original.Destination.Name,
		len(result.Original.Legs))
	t.Logf("Alternatives: %d", len(result.Alternatives))
	t.Logf("Plausibility: confidence=%s", result.Plausibility.OnTrainConfidence)

	if result.Original.TrainNumber == "" {
		t.Error("original journey has empty TrainNumber")
	}
	if len(result.Original.Legs) == 0 {
		t.Error("original journey has no legs")
	}
	if result.Plausibility.OnTrainConfidence == "" {
		t.Error("plausibility has empty OnTrainConfidence")
	}
}

// TestRouting_WellKnownICE_Frankfurt_München tests routing for an ICE on one of
// Germany's busiest corridors. Uses a known departure today, falls back across
// several ICE numbers until one is found.
func TestRouting_WellKnownICE_Frankfurt_München(t *testing.T) {
	const (
		fromID = "8000105" // Frankfurt(Main)Hbf
		toID   = "8000261" // München Hbf
		toName = "München Hbf"
	)

	candidates := []string{"ICE 1521", "ICE 1029", "ICE 598", "ICE 881", "ICE 1613"}
	client := newHAFASClient(t)
	engine := routing.NewBFSEngine(client)
	date := today()

	var trainNumber string
	for _, name := range candidates {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		trip, err := client.SearchTripByLineName(ctx, name, date)
		cancel()
		if err != nil || trip == nil {
			continue
		}
		// Verify this train actually passes through Frankfurt and München.
		var hasFrom, hasTo bool
		for _, s := range trip.Stopovers {
			if s.Stop.ID == fromID {
				hasFrom = true
			}
			if s.Stop.ID == toID {
				hasTo = true
			}
		}
		if hasFrom && hasTo {
			trainNumber = name
			break
		}
	}

	if trainNumber == "" {
		t.Skipf("none of the candidate ICE trains found on route Frankfurt→München for %s", date)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	result, err := engine.Route(ctx, routing.RoutingRequest{
		TrainNumber:    trainNumber,
		ToStationID:    toID,
		ToStationName:  toName,
		DepartureAfter: time.Now(),
		Filters: journey.Filters{
			DBOnly:      false,
			SafetyLevel: journey.SafetyLevelNormal,
		},
		InstallID: "integration-test",
	})
	if err != nil {
		t.Fatalf("Route(%s, Frankfurt→München): %v", trainNumber, err)
	}

	t.Logf("%s Frankfurt→München: legs=%d, alternatives=%d, confidence=%s",
		trainNumber,
		len(result.Original.Legs),
		len(result.Alternatives),
		result.Plausibility.OnTrainConfidence)

	if result.Original.TrainNumber == "" {
		t.Error("original journey has empty TrainNumber")
	}
	if len(result.Original.Legs) == 0 {
		t.Error("original journey has no legs")
	}
}

// TestRouting_StationSearch_ThenRoute combines station search + routing to
// simulate the full user flow: type station name → pick result → enter train.
func TestRouting_StationSearch_ThenRoute(t *testing.T) {
	client := newHAFASClient(t)
	engine := routing.NewBFSEngine(client)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	stations, err := client.SearchStations(ctx, "Köln", 5)
	if err != nil {
		t.Fatalf("SearchStations: %v", err)
	}
	if len(stations) == 0 {
		t.Fatal("SearchStations('Köln') returned 0 results")
	}

	// Pick Köln Hbf (first result should be it, but search to confirm).
	var kölnID, kölnName string
	for _, s := range stations {
		if s.ID == "8000207" {
			kölnID = s.ID
			kölnName = s.Name
			break
		}
	}
	if kölnID == "" {
		// Fall back to first result — Köln Hbf has known ID 8000207 but
		// HAFAS sometimes returns sub-stations first.
		kölnID = stations[0].ID
		kölnName = stations[0].Name
	}

	t.Logf("Using destination: %s (%s)", kölnName, kölnID)

	// Find an ICE/IC that stops in Köln today.
	date := today()
	candidates := []string{"IC 944", "ICE 598", "ICE 1521", "ICE 881"}
	var trainNumber string
	for _, name := range candidates {
		ctx2, cancel2 := context.WithTimeout(context.Background(), 12*time.Second)
		trip, err := client.SearchTripByLineName(ctx2, name, date)
		cancel2()
		if err != nil || trip == nil {
			continue
		}
		for _, s := range trip.Stopovers {
			if s.Stop.ID == kölnID {
				trainNumber = name
				break
			}
		}
		if trainNumber != "" {
			break
		}
	}
	if trainNumber == "" {
		t.Skipf("no candidate train found stopping at %s (%s) for %s", kölnName, kölnID, date)
	}

	ctx3, cancel3 := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel3()

	result, err := engine.Route(ctx3, routing.RoutingRequest{
		TrainNumber:    trainNumber,
		ToStationID:    kölnID,
		ToStationName:  kölnName,
		DepartureAfter: time.Now(),
		Filters:        journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		InstallID:      "integration-test",
	})
	if err != nil {
		t.Fatalf("Route(%s → %s): %v", trainNumber, kölnName, err)
	}

	t.Logf("%s → %s: legs=%d, alternatives=%d, confidence=%s",
		trainNumber, kölnName,
		len(result.Original.Legs),
		len(result.Alternatives),
		result.Plausibility.OnTrainConfidence)

	if len(result.Original.Legs) == 0 {
		t.Error("original journey has no legs")
	}
}
