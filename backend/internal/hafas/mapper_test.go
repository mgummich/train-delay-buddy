package hafas_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
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

func TestTrainNumberMatches(t *testing.T) {
	cases := []struct {
		candidate, query string
		want             bool
	}{
		{"IC 944", "IC 944", true},
		{"IC944", "IC 944", true},
		{"IC 944", "944", true},  // numeric-only query matches suffix
		{"ICE 944", "944", true}, // different prefix, same number
		{"IC 943", "944", false},
		{"IC 944", "IC 943", false},
		{"944", "944", true},
	}
	for _, c := range cases {
		got := hafas.TrainNumberMatches(c.candidate, c.query)
		if got != c.want {
			t.Errorf("TrainNumberMatches(%q, %q) = %v, want %v", c.candidate, c.query, got, c.want)
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
	resp := hafas.MapTripToTrainResponse(trip, "2026-06-10", time.Now())
	if resp.TrainNumber != "ICE 123" {
		t.Errorf("TrainNumber: got %q, want %q", resp.TrainNumber, "ICE 123")
	}
	if len(resp.Stops) != 1 {
		t.Errorf("expected 1 stop, got %d", len(resp.Stops))
	}
}

func TestMapTripToTrainResponse_RunningStatus(t *testing.T) {
	dep := time.Now().Add(-1 * time.Hour)
	arr := time.Now().Add(3 * time.Hour)
	trip := hafas.HAFASTrip{
		Line:      hafas.HAFASLine{Name: "IC 42"},
		Departure: &dep,
		Arrival:   &arr,
		Stopovers: []hafas.HAFASStopover{},
	}
	resp := hafas.MapTripToTrainResponse(trip, "2026-06-11", time.Now())
	if resp.Status != "running" {
		t.Errorf("status: got %q, want \"running\"", resp.Status)
	}
}

func TestMapTripToTrainResponse_StopsNeverNull(t *testing.T) {
	trip := hafas.HAFASTrip{Line: hafas.HAFASLine{Name: "RE 1"}}
	resp := hafas.MapTripToTrainResponse(trip, "2026-06-11", time.Now())
	if resp.Stops == nil {
		t.Error("Stops must never be nil (would serialize as JSON null)")
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

func TestMapHAFASJourney_BasicFields(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:24:00Z")

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin:           hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
				Destination:      hafas.HAFASPlace{ID: "8000105", Name: "Frankfurt (Main) Hbf"},
				PlannedDeparture: &dep,
				PlannedArrival:   &arr,
				Line: &hafas.HAFASLine{
					Name:     "ICE 123",
					Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"},
				},
			},
		},
	}

	j := hafas.MapHAFASJourney(
		hj,
		"jrn_test001",
		"install-1",
		"ICE 123",
		journey.StationRef{ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		nil,
		dep,
	)

	if j.ID != "jrn_test001" {
		t.Errorf("ID: got %q", j.ID)
	}
	if j.Summary.ETA.IsZero() {
		t.Error("ETA must not be zero")
	}
	if len(j.Legs) != 1 {
		t.Fatalf("expected 1 leg, got %d", len(j.Legs))
	}
	if j.Legs[0].VehicleNumber != "ICE 123" {
		t.Errorf("VehicleNumber: got %q", j.Legs[0].VehicleNumber)
	}
}

func TestMapHAFASJourney_ComputesTransferBuffer(t *testing.T) {
	t1dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	t1arr, _ := time.Parse(time.RFC3339, "2026-06-10T16:00:00Z")
	t2dep, _ := time.Parse(time.RFC3339, "2026-06-10T16:12:00Z") // 12-min buffer
	t2arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:30:00Z")

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin: hafas.HAFASPlace{ID: "A", Name: "A"}, Destination: hafas.HAFASPlace{ID: "B", Name: "B"},
				PlannedDeparture: &t1dep, PlannedArrival: &t1arr,
				Line: &hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
			},
			{
				Origin: hafas.HAFASPlace{ID: "B", Name: "B"}, Destination: hafas.HAFASPlace{ID: "C", Name: "C"},
				PlannedDeparture: &t2dep, PlannedArrival: &t2arr,
				Line: &hafas.HAFASLine{Name: "RE 42", Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}},
			},
		},
	}

	j := hafas.MapHAFASJourney(hj, "jrn_x", "inst", "ICE 1",
		journey.StationRef{ID: "C", Name: "C"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		nil, t1dep)

	if j.Summary.MinTransferBufferMinutes == nil {
		t.Fatal("MinTransferBufferMinutes must not be nil for journey with transfer")
	}
	if *j.Summary.MinTransferBufferMinutes != 12 {
		t.Errorf("MinTransferBufferMinutes: got %d, want 12", *j.Summary.MinTransferBufferMinutes)
	}
}

func TestMapHAFASJourney_TimeGainVsOriginal(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:24:00Z")
	originalETA, _ := time.Parse(time.RFC3339, "2026-06-10T18:00:00Z") // 36 min later

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
				PlannedDeparture: &dep, PlannedArrival: &arr,
				Line: &hafas.HAFASLine{Name: "RE 1", Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}},
			},
		},
	}

	j := hafas.MapHAFASJourney(hj, "jrn_x", "inst", "ICE 1",
		journey.StationRef{ID: "B"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		&originalETA, dep)

	if j.Summary.TimeGainVsOriginalMinutes == nil {
		t.Fatal("TimeGainVsOriginalMinutes must not be nil when originalETA provided")
	}
	if *j.Summary.TimeGainVsOriginalMinutes != 36 {
		t.Errorf("TimeGainVsOriginalMinutes: got %d, want 36", *j.Summary.TimeGainVsOriginalMinutes)
	}
}
