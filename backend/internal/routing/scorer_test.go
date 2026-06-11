package routing_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func makeJourney(eta time.Time, minBuffer *int) journey.Journey {
	return journey.Journey{
		Summary: journey.Summary{
			ETA:                      eta,
			MinTransferBufferMinutes: minBuffer,
		},
	}
}

func intPtr(i int) *int { return &i }

func TestSort_ByETAAscending(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(base.Add(30*time.Minute), nil),
		makeJourney(base.Add(10*time.Minute), nil),
		makeJourney(base.Add(20*time.Minute), nil),
	}
	routing.Sort(journeys)
	if !journeys[0].Summary.ETA.Equal(base.Add(10 * time.Minute)) {
		t.Errorf("first element should have earliest ETA, got %v", journeys[0].Summary.ETA)
	}
}

func TestSort_ByBufferDescendingOnETATie(t *testing.T) {
	eta := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(eta, intPtr(5)),
		makeJourney(eta, intPtr(15)),
		makeJourney(eta, intPtr(3)),
	}
	routing.Sort(journeys)
	if *journeys[0].Summary.MinTransferBufferMinutes != 15 {
		t.Errorf("first element should have highest buffer (15), got %d",
			*journeys[0].Summary.MinTransferBufferMinutes)
	}
}

func TestSort_NilBufferLast(t *testing.T) {
	eta := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(eta, nil),
		makeJourney(eta, intPtr(8)),
	}
	routing.Sort(journeys)
	if journeys[0].Summary.MinTransferBufferMinutes == nil {
		t.Error("journey with nil buffer should sort after journey with buffer")
	}
}

func TestFilterBetterThan_OnlyKeepsFasterETAs(t *testing.T) {
	base := time.Date(2026, 6, 10, 18, 0, 0, 0, time.UTC)
	reference := base
	journeys := []journey.Journey{
		makeJourney(base.Add(-30*time.Minute), nil), // 30 min faster — keep
		makeJourney(base, nil),                       // same ETA — discard
		makeJourney(base.Add(10*time.Minute), nil),   // slower — discard
	}
	filtered := routing.FilterBetterThan(journeys, reference)
	if len(filtered) != 1 {
		t.Errorf("expected 1 alternative, got %d", len(filtered))
	}
}
