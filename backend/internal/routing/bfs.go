// backend/internal/routing/bfs.go
package routing

import (
	"context"
	"fmt"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// BFSEngine is the MVP routing engine — delegates graph traversal to HAFAS,
// applies filter + ranking on top of returned results.
type BFSEngine struct {
	hafas *hafas.Client
}

// NewBFSEngine creates a BFSEngine.
func NewBFSEngine(h *hafas.Client) *BFSEngine {
	return &BFSEngine{hafas: h}
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
	if origIdx < 0 {
		return nil, fmt.Errorf("train %q not found in HAFAS journey results for route %s→%s",
			req.TrainNumber, fromID, req.ToStationID)
	}

	// 3a. Resolve destination name from trip stopovers if not provided
	toStationName := req.ToStationName
	if toStationName == "" {
		for _, trip := range trips {
			for _, s := range trip.Stopovers {
				if s.Stop.ID == req.ToStationID && s.Stop.Name != "" {
					toStationName = s.Stop.Name
					break
				}
			}
			if toStationName != "" {
				break
			}
		}
	}

	// Fallback: resolve destination name from journey legs if trips were empty
	if toStationName == "" {
		for _, hj := range hafasJourneys {
			for _, leg := range hj.Legs {
				if leg.Destination.ID == req.ToStationID && leg.Destination.Name != "" {
					toStationName = leg.Destination.Name
					break
				}
				// Also check origin in case destination is an intermediate stop
				if leg.Origin.ID == req.ToStationID && leg.Origin.Name != "" {
					toStationName = leg.Origin.Name
					break
				}
			}
			if toStationName != "" {
				break
			}
		}
	}

	now := req.DepartureAfter // use departure time as "now" for initial mapping

	originalJourney := hafas.MapHAFASJourney(
		hafasJourneys[origIdx],
		journey.NewID(), req.InstallID, req.TrainNumber,
		journey.StationRef{ID: req.ToStationID, Name: toStationName},
		req.Filters, nil, now,
	)

	// 4. Map and filter alternatives
	origETA := &originalJourney.Summary.ETA
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
			journey.StationRef{ID: req.ToStationID, Name: toStationName},
			req.Filters, origETA, now,
		)
		candidates = append(candidates, j)
	}

	// 5. Keep only alternatives that arrive before the original
	candidates = FilterBetterThan(candidates, originalJourney.Summary.ETA)
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
