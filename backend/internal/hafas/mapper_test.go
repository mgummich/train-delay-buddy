package hafas_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestNormalizeTrainNumber(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ICE123", "ICE 123"},
		{"ICE 123", "ICE 123"},
		{"ice123", "ICE 123"},
		{"RB27", "RB 27"},
		{"S3", "S 3"},
		{"IRE200", "IRE 200"},
		{"RE 42", "RE 42"},
	}
	for _, c := range cases {
		got := hafas.NormalizeTrainNumber(c.in)
		if got != c.want {
			t.Errorf("NormalizeTrainNumber(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMapStations_FiltersNonStop(t *testing.T) {
	results := []hafas.HAFASLocationResult{
		{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		{Type: "location", ID: "loc1", Name: "Some Address"},
		{Type: "stop", ID: "", Name: "Bad entry"},
	}
	stations := hafas.MapStations(results)
	if len(stations) != 1 {
		t.Fatalf("expected 1 station, got %d", len(stations))
	}
	if stations[0].ID != "8000105" {
		t.Errorf("unexpected station ID: %q", stations[0].ID)
	}
}

func TestMapTripToTrainResponse_NormalizesTrainNumber(t *testing.T) {
	dep := time.Now().Add(-1 * time.Hour)
	trip := hafas.HAFASTrip{
		Line:        hafas.HAFASLine{Name: "ICE123"},
		Origin:      hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
		Destination: hafas.HAFASPlace{ID: "8011160", Name: "Berlin Hbf"},
		Stopovers: []hafas.HAFASStopover{
			{Stop: hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"}, PlannedDeparture: &dep},
		},
	}
	resp := hafas.MapTripToTrainResponse(trip, "2026-06-10")
	if resp.TrainNumber != "ICE 123" {
		t.Errorf("TrainNumber: got %q, want %q", resp.TrainNumber, "ICE 123")
	}
	if len(resp.Stops) != 1 {
		t.Errorf("expected 1 stop, got %d", len(resp.Stops))
	}
}

func TestFilterTripsByDate_MatchesDate(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00+02:00")
	other, _ := time.Parse(time.RFC3339, "2026-06-11T14:00:00+02:00")

	trips := []hafas.HAFASTrip{
		{Stopovers: []hafas.HAFASStopover{{PlannedDeparture: &dep}}},
		{Stopovers: []hafas.HAFASStopover{{PlannedDeparture: &other}}},
	}
	filtered := hafas.FilterTripsByDate(trips, "2026-06-10")
	if len(filtered) != 1 {
		t.Errorf("expected 1 trip for 2026-06-10, got %d", len(filtered))
	}
}
