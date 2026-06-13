package journey_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// helpers

func ptr[T any](v T) *T { return &v }

func t0(offset time.Duration) time.Time {
	return time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC).Add(offset)
}

func leg(dep, arr time.Time, status journey.LegStatus, stops ...journey.Stop) journey.Leg {
	return journey.Leg{
		DepartureTimePlanned: dep,
		ArrivalTimePlanned:   arr,
		Status:               status,
		Stops:                stops,
		VehicleNumber:        "ICE 100",
	}
}

func stop(id, name string) journey.Stop {
	return journey.Stop{StationID: id, StationName: name}
}

// --- SafetyThresholdMinutes ---

func TestSafetyThresholdMinutes(t *testing.T) {
	cases := []struct {
		level journey.SafetyLevel
		want  int
	}{
		{journey.SafetyLevelAggressive, 3},
		{journey.SafetyLevelNormal, 8},
		{journey.SafetyLevelCautious, 15},
		{"unknown", 8},
	}
	for _, c := range cases {
		if got := journey.SafetyThresholdMinutes(c.level); got != c.want {
			t.Errorf("SafetyThresholdMinutes(%q) = %d, want %d", c.level, got, c.want)
		}
	}
}

// --- computeStatus (via ComputeSummary) ---

func TestComputeStatus(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}

	now := t0(30 * time.Minute)

	cases := []struct {
		name   string
		legs   []journey.Leg
		wantSt journey.Status
	}{
		{
			name:   "ok — no delays, no cancellations",
			legs:   []journey.Leg{leg(t0(0), t0(60*time.Minute), journey.LegStatusRunning)},
			wantSt: journey.StatusOK,
		},
		{
			name:   "critical — delayed leg",
			legs:   []journey.Leg{leg(t0(0), t0(60*time.Minute), journey.LegStatusDelayed)},
			wantSt: journey.StatusCritical,
		},
		{
			name:   "failed — cancelled leg",
			legs:   []journey.Leg{leg(t0(0), t0(60*time.Minute), journey.LegStatusCancelled)},
			wantSt: journey.StatusFailed,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := journey.ComputeSummary(c.legs, dest, filters, nil, now)
			if s.Status != c.wantSt {
				t.Errorf("Status = %q, want %q", s.Status, c.wantSt)
			}
		})
	}
}

// --- computeDataConfidence (via ComputeSummary) ---

func TestComputeDataConfidence(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}
	now := t0(30 * time.Minute)

	cases := []struct {
		name string
		legs []journey.Leg
		want journey.DataConfidence
	}{
		{
			name: "unavailable — no realtime",
			legs: []journey.Leg{leg(t0(0), t0(60*time.Minute), journey.LegStatusPlanned)},
			want: journey.DataConfidenceUnavailable,
		},
		{
			name: "high — all legs have realtime",
			legs: func() []journey.Leg {
				l := leg(t0(0), t0(60*time.Minute), journey.LegStatusRunning)
				l.ArrivalTimeActual = ptr(t0(65 * time.Minute))
				return []journey.Leg{l}
			}(),
			want: journey.DataConfidenceHigh,
		},
		{
			name: "low — partial realtime",
			legs: func() []journey.Leg {
				l1 := leg(t0(0), t0(30*time.Minute), journey.LegStatusRunning)
				l1.ArrivalTimeActual = ptr(t0(35 * time.Minute))
				l2 := leg(t0(40*time.Minute), t0(90*time.Minute), journey.LegStatusPlanned)
				return []journey.Leg{l1, l2}
			}(),
			want: journey.DataConfidenceLow,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := journey.ComputeSummary(c.legs, dest, filters, nil, now)
			if s.DataConfidence != c.want {
				t.Errorf("DataConfidence = %q, want %q", s.DataConfidence, c.want)
			}
		})
	}
}

// --- computeMinTransferBuffer / critical-transfer threshold ---

func TestComputeSummary_CriticalTransfer(t *testing.T) {
	dest := journey.StationRef{ID: "8011160", Name: "Berlin Hbf"}

	leg1Arr := t0(60 * time.Minute)
	leg2Dep := t0(63 * time.Minute) // 3 min buffer

	l1 := journey.Leg{
		DepartureTimePlanned: t0(0),
		ArrivalTimePlanned:   leg1Arr,
		ArrivalTimeActual:    &leg1Arr,
		Status:               journey.LegStatusRunning,
	}
	l2 := journey.Leg{
		DepartureTimePlanned: leg2Dep,
		DepartureTimeActual:  &leg2Dep,
		ArrivalTimePlanned:   t0(120 * time.Minute),
		Status:               journey.LegStatusPlanned,
	}

	// Normal safety level (8 min threshold) — 3 min buffer is critical
	sNormal := journey.ComputeSummary([]journey.Leg{l1, l2}, dest,
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal}, nil, t0(30*time.Minute))
	if !sNormal.CriticalTransfer {
		t.Errorf("CriticalTransfer should be true with 3-min buffer and 8-min threshold")
	}
	if sNormal.Status != journey.StatusCritical {
		t.Errorf("Status should be critical, got %q", sNormal.Status)
	}

	// Aggressive safety level (3 min threshold) — 3 min buffer is NOT critical
	sAggr := journey.ComputeSummary([]journey.Leg{l1, l2}, dest,
		journey.Filters{SafetyLevel: journey.SafetyLevelAggressive}, nil, t0(30*time.Minute))
	if sAggr.CriticalTransfer {
		t.Errorf("CriticalTransfer should be false with 3-min buffer and 3-min threshold")
	}
}

// --- TimeGainVsOriginalMinutes ---

func TestComputeSummary_TimeGain(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}
	now := t0(0)

	originalETA := t0(120 * time.Minute)
	l := leg(t0(0), t0(100*time.Minute), journey.LegStatusRunning)

	s := journey.ComputeSummary([]journey.Leg{l}, dest, filters, &originalETA, now)

	if s.TimeGainVsOriginalMinutes == nil {
		t.Fatal("TimeGainVsOriginalMinutes should not be nil")
	}
	if *s.TimeGainVsOriginalMinutes != 20 {
		t.Errorf("TimeGainVsOriginalMinutes = %d, want 20", *s.TimeGainVsOriginalMinutes)
	}
}

// --- computeNextStep ---

func TestComputeNextStep_Ride(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}

	depTime := t0(10 * time.Minute)
	arrTime := t0(90 * time.Minute)
	l := journey.Leg{
		DepartureTimePlanned: depTime,
		DepartureTimeActual:  &depTime,
		ArrivalTimePlanned:   arrTime,
		ArrivalTimeActual:    &arrTime,
		VehicleNumber:        "ICE 100",
		Status:               journey.LegStatusRunning,
		Stops: []journey.Stop{
			stop("8000261", "München Hbf"),
			stop("dest", "Berlin Hbf"),
		},
	}

	// now is before departure — should return a Ride NextStep
	s := journey.ComputeSummary([]journey.Leg{l}, dest, filters, nil, t0(0))
	if s.NextStep == nil {
		t.Fatal("NextStep should not be nil")
	}
	if s.NextStep.Type != journey.NextStepRide {
		t.Errorf("NextStep.Type = %q, want %q", s.NextStep.Type, journey.NextStepRide)
	}
	if s.NextStep.StationName != "München Hbf" {
		t.Errorf("NextStep.StationName = %q, want München Hbf", s.NextStep.StationName)
	}
}

func TestComputeNextStep_Transfer(t *testing.T) {
	dest := journey.StationRef{ID: "8011160", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}

	leg1Dep := t0(0)
	leg1Arr := t0(60 * time.Minute)
	leg2Dep := t0(70 * time.Minute)
	leg2Arr := t0(120 * time.Minute)

	l1 := journey.Leg{
		DepartureTimePlanned: leg1Dep,
		DepartureTimeActual:  &leg1Dep,
		ArrivalTimePlanned:   leg1Arr,
		ArrivalTimeActual:    &leg1Arr,
		VehicleNumber:        "ICE 100",
		Status:               journey.LegStatusRunning,
		Stops:                []journey.Stop{stop("8000105", "Frankfurt Hbf")},
	}
	l2 := journey.Leg{
		DepartureTimePlanned: leg2Dep,
		DepartureTimeActual:  &leg2Dep,
		ArrivalTimePlanned:   leg2Arr,
		ArrivalTimeActual:    &leg2Arr,
		VehicleNumber:        "ICE 200",
		Status:               journey.LegStatusRunning,
	}

	// now is during leg1 — should return Transfer NextStep
	s := journey.ComputeSummary([]journey.Leg{l1, l2}, dest, filters, nil, t0(30*time.Minute))
	if s.NextStep == nil {
		t.Fatal("NextStep should not be nil")
	}
	if s.NextStep.Type != journey.NextStepTransfer {
		t.Errorf("NextStep.Type = %q, want %q", s.NextStep.Type, journey.NextStepTransfer)
	}
	if *s.NextStep.BufferMinutes != 10 {
		t.Errorf("BufferMinutes = %d, want 10", *s.NextStep.BufferMinutes)
	}
}

func TestComputeNextStep_Nil_WhenPast(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}

	dep := t0(0)
	arr := t0(60 * time.Minute)
	l := journey.Leg{
		DepartureTimePlanned: dep,
		DepartureTimeActual:  &dep,
		ArrivalTimePlanned:   arr,
		ArrivalTimeActual:    &arr,
		VehicleNumber:        "ICE 100",
		Status:               journey.LegStatusRunning,
	}

	// now is after arrival — NextStep should be nil
	s := journey.ComputeSummary([]journey.Leg{l}, dest, filters, nil, t0(90*time.Minute))
	if s.NextStep != nil {
		t.Errorf("NextStep should be nil when journey is complete, got %+v", s.NextStep)
	}
}

// --- empty legs guard ---

func TestComputeSummary_EmptyLegs(t *testing.T) {
	dest := journey.StationRef{ID: "dest", Name: "Berlin Hbf"}
	filters := journey.Filters{SafetyLevel: journey.SafetyLevelNormal}

	s := journey.ComputeSummary(nil, dest, filters, nil, t0(0))
	if s.Status != "" {
		t.Errorf("empty legs should return zero Summary, got Status=%q", s.Status)
	}
}

// --- Journey.ETag ---

func TestJourney_ETag(t *testing.T) {
	j := &journey.Journey{ID: "jrn_abc", ETagEpoch: 1, ETagCounter: 3}
	want := "jrn_abc:1:3"
	if got := j.ETag(); got != want {
		t.Errorf("ETag() = %q, want %q", got, want)
	}
}
