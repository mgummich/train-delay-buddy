package routing

import (
	"context"
	"fmt"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// BFSEngine routes via HAFAS, applying filter + ranking on returned results.
type BFSEngine struct {
	hafas *hafas.Client
}

// NewBFSEngine creates a BFSEngine.
func NewBFSEngine(h *hafas.Client) *BFSEngine {
	return &BFSEngine{hafas: h}
}

func (e *BFSEngine) Route(ctx context.Context, req RoutingRequest) (*RoutingResult, error) {
	date := hafas.BerlinDate(req.DepartureAfter)

	// Non-fatal: fromID falls back to req.FromStationID when the trip is not found.
	// tripErr is kept so plausibility distinguishes an upstream failure (unknown)
	// from a genuine "train not found".
	trip, tripErr := e.hafas.SearchTripByLineName(ctx, req.TrainNumber, date)

	fromID := req.FromStationID
	departureAfter := req.DepartureAfter
	if trip != nil {
		if trip.Origin.ID != "" {
			fromID = trip.Origin.ID
		}
		// Use the trip's actual departure so already-departed trains are still
		// included in the journeys response (HAFAS filters by departure time).
		if trip.Departure != nil && trip.Departure.Before(departureAfter) {
			departureAfter = *trip.Departure
		} else if len(trip.Stopovers) > 0 {
			dep := trip.Stopovers[0].PlannedDeparture
			if dep == nil {
				dep = trip.Stopovers[0].Departure
			}
			if dep != nil && dep.Before(departureAfter) {
				departureAfter = *dep
			}
		}
	}

	plausibility := computePlausibility(trip, tripErr, req.ToStationID)

	hafasJourneys, err := e.hafas.SearchJourneys(ctx, fromID, req.ToStationID, departureAfter, 10)
	if err != nil {
		return nil, err
	}

	origIdx := findOriginalIndex(hafasJourneys, req.TrainNumber)
	if origIdx < 0 {
		return nil, fmt.Errorf("train %q not found in HAFAS journey results for route %s→%s",
			req.TrainNumber, fromID, req.ToStationID)
	}

	toStationName := req.ToStationName
	if toStationName == "" && trip != nil {
		for _, s := range trip.Stopovers {
			if s.Stop.ID == req.ToStationID && s.Stop.Name != "" {
				toStationName = s.Stop.Name
				break
			}
		}
	}

	if toStationName == "" {
		for _, hj := range hafasJourneys {
			for _, leg := range hj.Legs {
				if leg.Destination.ID == req.ToStationID && leg.Destination.Name != "" {
					toStationName = leg.Destination.Name
					break
				}
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

	now := req.DepartureAfter
	originalJourney := hafas.MapHAFASJourney(
		hafasJourneys[origIdx],
		journey.NewID(), req.InstallID, req.TrainNumber,
		journey.StationRef{ID: req.ToStationID, Name: toStationName},
		req.Filters, nil, now,
	)

	origETA := &originalJourney.Summary.ETA
	var candidates []journey.Journey
	for i, hj := range hafasJourneys {
		if i == origIdx {
			continue
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

	candidates = FilterBetterThan(candidates, originalJourney.Summary.ETA)
	Sort(candidates)

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
			if leg.Line != nil && hafas.TrainNumberMatches(leg.Line.Name, norm) {
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

func computePlausibility(trip *hafas.HAFASTrip, tripErr error, toStationID string) journey.Plausibility {
	if tripErr != nil {
		r := "train lookup temporarily unavailable"
		return journey.Plausibility{OnTrainConfidence: "unknown", Reason: &r}
	}
	if trip == nil {
		r := "train not found in HAFAS"
		return journey.Plausibility{OnTrainConfidence: "unknown", Reason: &r}
	}
	for _, s := range trip.Stopovers {
		if s.Stop.ID == toStationID {
			if s.Cancelled {
				r := "destination stop is cancelled"
				return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
			}
			return journey.Plausibility{OnTrainConfidence: "high"}
		}
	}
	r := "destination is not a stop on this train"
	return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
}
