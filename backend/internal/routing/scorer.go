package routing

import (
	"sort"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// Sort sorts journeys in-place by: ETA asc → minBuffer desc → criticalTransfers asc → numLegs asc.
func Sort(journeys []journey.Journey) {
	sort.SliceStable(journeys, func(i, j int) bool {
		a, b := journeys[i].Summary, journeys[j].Summary
		if !a.ETA.Equal(b.ETA) {
			return a.ETA.Before(b.ETA)
		}
		aBuf := bufVal(a.MinTransferBufferMinutes)
		bBuf := bufVal(b.MinTransferBufferMinutes)
		if aBuf != bBuf {
			return aBuf > bBuf // higher buffer is better
		}
		aLegs, bLegs := len(journeys[i].Legs), len(journeys[j].Legs)
		return aLegs < bLegs
	})
}

// FilterBetterThan returns only journeys whose ETA is strictly before referenceETA.
func FilterBetterThan(journeys []journey.Journey, referenceETA time.Time) []journey.Journey {
	var out []journey.Journey
	for _, j := range journeys {
		if j.Summary.ETA.Before(referenceETA) {
			out = append(out, j)
		}
	}
	return out
}

func bufVal(p *int) int {
	if p == nil {
		return -1 // nil buffer sorts worse than any real buffer
	}
	return *p
}
