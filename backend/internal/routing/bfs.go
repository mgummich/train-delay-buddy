// backend/internal/routing/bfs.go
package routing

import (
	"context"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// BFSEngine is the MVP routing engine — delegates graph traversal to HAFAS,
// applies filter + ranking on top of returned results.
type BFSEngine struct {
	hafas     *hafas.Client
	coalescer *hafas.Coalescer
}

// NewBFSEngine creates a BFSEngine.
func NewBFSEngine(h *hafas.Client, c *hafas.Coalescer) *BFSEngine {
	return &BFSEngine{hafas: h, coalescer: c}
}

func (e *BFSEngine) Route(ctx context.Context, req RoutingRequest) (*RoutingResult, error) {
	// 1. Find trip metadata for plausibility + origin station
	trips, err := e.hafas.SearchTrips(ctx, req.TrainNumber, 3)
	if err != nil {
		return nil, err
	}
	plausibility := computePlausibility(trips, req.TrainNumber, req.ToStationID)

	fromID := req.FromStationID
	if len(trips) > 0 && trips[0].Origin.ID != "" {
		fromID = trips[0].Origin.ID
	}

	// 2. Search all connections from origin to destination
	hafasJourneys, err := e.hafas.SearchJourneys(ctx, fromID, req.ToStationID, req.DepartureAfter, 10)
	if err != nil {
		return nil, err
	}

	// 3. Find the original journey (contains user's train in first leg)
	origIdx := findOriginalIndex(hafasJourneys, req.TrainNumber)

	now := req.DepartureAfter // use departure time as "now" for initial mapping

	var originalJourney journey.Journey
	if origIdx >= 0 {
		originalJourney = hafas.MapHAFASJourney(
			hafasJourneys[origIdx],
			journey.NewID(), req.InstallID, req.TrainNumber,
			journey.StationRef{ID: req.ToStationID, Name: req.ToStationName},
			req.Filters, nil, now,
		)
	}

	// 4. Map and filter alternatives
	var candidates []journey.Journey
	for i, hj := range hafasJourneys {
		if i == origIdx {
			continue // skip the original
		}
		if req.Filters.DBOnly && !hafas.IsDBOnlyJourney(hj.Legs) {
			continue
		}
		if req.Filters.MaxTransfers != nil {
			transfers := countTransfers(hj.Legs)
			if transfers > *req.Filters.MaxTransfers {
				continue
			}
		}
		j := hafas.MapHAFASJourney(
			hj,
			journey.NewID(), req.InstallID, req.TrainNumber,
			journey.StationRef{ID: req.ToStationID, Name: req.ToStationName},
			req.Filters, &originalJourney.Summary.ETA, now,
		)
		candidates = append(candidates, j)
	}

	// 5. Keep only alternatives that arrive before the original
	if origIdx >= 0 {
		candidates = FilterBetterThan(candidates, originalJourney.Summary.ETA)
	}
	Sort(candidates)

	// 6. Convert to Alternative slice (top 5)
	limit := 5
	if len(candidates) < limit {
		limit = len(candidates)
	}
	alts := make([]journey.Alternative, limit)
	for i, c := range candidates[:limit] {
		alts[i] = journey.Alternative{
			JourneyID: c.ID,
			Summary:   c.Summary,
			Legs:      c.Legs,
		}
	}

	// Set alternativeAvailable on original
	if len(alts) > 0 {
		originalJourney.Summary.AlternativeAvailable = true
	}

	return &RoutingResult{
		Original:     originalJourney,
		Alternatives: alts,
		Plausibility: plausibility,
	}, nil
}

func findOriginalIndex(journeys []hafas.HAFASJourney, trainNumber string) int {
	norm := hafas.NormalizeTrainNumber(trainNumber)
	for i, j := range journeys {
		for _, leg := range j.Legs {
			if leg.Line != nil && hafas.NormalizeTrainNumber(leg.Line.Name) == norm {
				return i
			}
		}
	}
	return -1
}

func countTransfers(legs []hafas.HAFASLeg) int {
	transfers := 0
	for _, leg := range legs {
		if !leg.Walking {
			transfers++
		}
	}
	if transfers > 0 {
		return transfers - 1
	}
	return 0
}

func computePlausibility(trips []hafas.HAFASTrip, trainNumber, toStationID string) journey.Plausibility {
	norm := hafas.NormalizeTrainNumber(trainNumber)
	for _, t := range trips {
		if hafas.NormalizeTrainNumber(t.Line.Name) != norm {
			continue
		}
		for _, s := range t.Stopovers {
			if s.Stop.ID == toStationID {
				confidence := "high"
				reason := (*string)(nil)
				if s.Cancelled {
					confidence = "low"
					r := "destination stop is cancelled"
					reason = &r
				}
				return journey.Plausibility{OnTrainConfidence: confidence, Reason: reason}
			}
		}
		// Train found but destination not in stops
		r := "destination is not a stop on this train"
		return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
	}
	if len(trips) == 0 {
		r := "train not found in HAFAS"
		return journey.Plausibility{OnTrainConfidence: "unknown", Reason: &r}
	}
	r := "train found but destination not matched"
	return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
}
