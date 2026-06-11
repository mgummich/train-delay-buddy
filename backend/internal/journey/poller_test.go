package journey_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func TestApplyTripUpdates_UpdatesDelay(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	actualArr, _ := time.Parse(time.RFC3339, "2026-06-10T17:12:00Z")

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			Stops: []journey.Stop{
				{StationID: "8000261", StationName: "München Hbf", ArrivalTimePlanned: dep},
				{StationID: "8000105", StationName: "Frankfurt (Main) Hbf", ArrivalTimePlanned: arr},
			},
			Status: journey.LegStatusRunning,
		},
	}

	arrivalDelaySecs := 720
	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", ActualArrival: &actualArr, ArrivalDelaySecs: &arrivalDelaySecs},
			},
		},
	}

	updated, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if updated[0].ArrivalTimeActual == nil {
		t.Fatal("ArrivalTimeActual should be set after update")
	}
	if !updated[0].ArrivalTimeActual.Equal(actualArr) {
		t.Errorf("ArrivalTimeActual: got %v, want %v", updated[0].ArrivalTimeActual, actualArr)
	}
	if updated[0].DelayMinutes == nil || *updated[0].DelayMinutes != 12 {
		t.Errorf("DelayMinutes: got %v, want 12", updated[0].DelayMinutes)
	}
	if legsChanged {
		t.Error("legsChanged should be false for delay-only update")
	}
}

func TestApplyTripUpdates_DetectsPlatformChange(t *testing.T) {
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	oldPlatform := "3"
	newPlatform := "7"

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			PlatformActual:     &oldPlatform,
			Stops: []journey.Stop{
				{StationID: "8000105", ArrivalTimePlanned: arr},
			},
		},
	}

	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", ActualArrival: &arr, ArrivalPlatform: &newPlatform},
			},
		},
	}

	_, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if !legsChanged {
		t.Error("legsChanged should be true when platform changes")
	}
}

func TestApplyTripUpdates_DetectsCancellation(t *testing.T) {
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	cancelled := true

	legs := []journey.Leg{
		{
			LegID:              "leg_01",
			TripID:             "trip-abc",
			ArrivalTimePlanned: arr,
			Status:             journey.LegStatusRunning,
			Stops:              []journey.Stop{{StationID: "8000105", ArrivalTimePlanned: arr}},
		},
	}

	updates := map[string]journey.TripUpdate{
		"trip-abc": {
			Stopovers: []journey.StopoverUpdate{
				{StationID: "8000105", Cancelled: &cancelled},
			},
		},
	}

	updated, legsChanged := journey.ApplyTripUpdates(legs, updates)

	if updated[0].Status != journey.LegStatusCancelled {
		t.Errorf("Status should be cancelled, got %q", updated[0].Status)
	}
	if !legsChanged {
		t.Error("legsChanged should be true for cancellation")
	}
}

func TestSummaryChanged_DetectsETAChange(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	old := journey.Summary{ETA: base, Status: journey.StatusOK}
	newS := journey.Summary{ETA: base.Add(5 * time.Minute), Status: journey.StatusOK}
	if !journey.SummaryChanged(old, newS) {
		t.Error("ETA change should be detected")
	}
}

func TestSummaryChanged_NoChangeReturnsFalse(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	s := journey.Summary{ETA: base, Status: journey.StatusOK, DataConfidence: journey.DataConfidenceHigh}
	if journey.SummaryChanged(s, s) {
		t.Error("identical summaries should not trigger a state change")
	}
}
