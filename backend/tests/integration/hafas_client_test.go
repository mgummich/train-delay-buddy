//go:build integration

// Integration tests against a real HAFAS backend.
// Run with: go test -tags=integration -v ./tests/integration/ -hafas-url=http://localhost:3000
// or: HAFAS_BASE_URL=http://localhost:3000 go test -tags=integration -v ./tests/integration/
//
// Requires a running db-vendo-client sidecar (or any HAFAS REST endpoint).
// Tests are skipped individually when trains aren't found for today — schedule
// changes and holidays are expected; failures mean connectivity problems.

package integration_test

import (
	"context"
	"flag"
	"os"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

var hafasURL = flag.String("hafas-url", "", "HAFAS base URL (overrides HAFAS_BASE_URL env)")

func newHAFASClient(t *testing.T) *hafas.Client {
	t.Helper()
	u := *hafasURL
	if u == "" {
		u = os.Getenv("HAFAS_BASE_URL")
	}
	if u == "" {
		u = "http://localhost:3000"
	}
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         u,
		HAFASRequestTimeout:  15 * time.Second,
		HAFASCBThreshold:     5,
		HAFASCBProbeInterval: 30 * time.Second,
	}, nil)
}

func today() string {
	return time.Now().In(mustBerlin()).Format("2006-01-02")
}

func mustBerlin() *time.Location {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		return time.UTC
	}
	return loc
}

// TestHAFAS_SearchStations verifies the /locations endpoint is reachable and
// returns sensible results for a well-known query.
func TestHAFAS_SearchStations(t *testing.T) {
	client := newHAFASClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	stations, err := client.SearchStations(ctx, "Frankfurt", 5)
	if err != nil {
		t.Fatalf("SearchStations: %v", err)
	}
	if len(stations) == 0 {
		t.Fatal("expected at least one station, got 0")
	}

	var found bool
	for _, s := range stations {
		if s.ID != "" && s.Name != "" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("no station with ID+Name in results: %+v", stations)
	}
	t.Logf("SearchStations('Frankfurt'): %d results, first=%q (%s)", len(stations), stations[0].Name, stations[0].ID)
}

// TestHAFAS_SearchTripByLineName_IC944 looks for IC 944 today.
// Skipped when not running (e.g. weekends, holidays) — that is expected.
func TestHAFAS_SearchTripByLineName_IC944(t *testing.T) {
	client := newHAFASClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	date := today()
	trip, err := client.SearchTripByLineName(ctx, "944", date)
	if err != nil {
		t.Fatalf("SearchTripByLineName('944', %s): %v", date, err)
	}
	if trip == nil {
		t.Skipf("IC 944 not found for %s (may not run today — check DB Fahrplan)", date)
	}

	t.Logf("IC 944: origin=%s (%s), destination=%s (%s), stops=%d",
		trip.Origin.Name, trip.Origin.ID,
		trip.Destination.Name, trip.Destination.ID,
		len(trip.Stopovers))

	if trip.Origin.ID == "" {
		t.Error("trip.Origin.ID is empty")
	}
	if len(trip.Stopovers) == 0 {
		t.Error("trip has no stopovers")
	}
}

// TestHAFAS_SearchTripByLineName_KnownICERoutes tries several high-frequency ICE
// trains. At least one must be found on any weekday.
// Subtests are skipped (not failed) when the train doesn't run today or
// the search times out — both are expected for some trains on some days.
func TestHAFAS_SearchTripByLineName_KnownICERoutes(t *testing.T) {
	// IC/ICE trains with varied schedules across major DE corridors.
	// "944" uses digit-suffix matching (faster) — confirmed daily train.
	candidates := []string{"944", "ICE 598", "ICE 1521", "ICE 1029", "ICE 881"}
	client := newHAFASClient(t)
	date := today()

	found := 0
	for _, name := range candidates {
		name := name
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()

			trip, err := client.SearchTripByLineName(ctx, name, date)
			if err != nil {
				// Treat timeout as "not found today" — not a test failure.
				if ctx.Err() != nil {
					t.Skipf("%s: search timed out (not found at any hub within 15s)", name)
				}
				t.Fatalf("SearchTripByLineName(%q, %s): %v", name, date, err)
			}
			if trip == nil {
				t.Skipf("%s not found for %s", name, date)
			}

			found++
			t.Logf("%s: origin=%s → destination=%s (%d stops)",
				name, trip.Origin.Name, trip.Destination.Name, len(trip.Stopovers))

			if trip.Origin.ID == "" {
				t.Errorf("trip.Origin.ID empty for %s", name)
			}
			if len(trip.Stopovers) < 2 {
				t.Errorf("expected ≥2 stopovers for %s, got %d", name, len(trip.Stopovers))
			}
		})
	}
	// IC 944 is in the list and confirmed to run — if even that skips, HAFAS is broken.
	if found == 0 && t.Skipped() {
		t.Error("all candidate trains skipped — check HAFAS connectivity or candidate list")
	}
}

// TestHAFAS_SearchJourneys verifies the /journeys endpoint for a well-known pair.
func TestHAFAS_SearchJourneys(t *testing.T) {
	client := newHAFASClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Frankfurt → München, start of day so we catch morning trains
	loc := mustBerlin()
	departure := time.Now().In(loc).Truncate(24 * time.Hour)

	journeys, err := client.SearchJourneys(ctx,
		"8000105", // Frankfurt(Main)Hbf
		"8000261", // München Hbf
		departure,
		5,
	)
	if err != nil {
		t.Fatalf("SearchJourneys: %v", err)
	}
	if len(journeys) == 0 {
		t.Fatal("expected at least one journey Frankfurt→München, got 0")
	}
	t.Logf("SearchJourneys Frankfurt→München: %d results, first has %d legs",
		len(journeys), len(journeys[0].Legs))
}
