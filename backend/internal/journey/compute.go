package journey

import "time"

// ComputeSummary derives a journey Summary from legs and current time.
// Called by hafas.MapHAFASJourney and by the poller after applying trip updates.
func ComputeSummary(legs []Leg, destination StationRef, filters Filters, originalETA *time.Time, now time.Time) Summary {
	if len(legs) == 0 {
		return Summary{}
	}
	first := legs[0]
	last := legs[len(legs)-1]

	eta := last.ArrivalTimePlanned
	if last.ArrivalTimeActual != nil {
		eta = *last.ArrivalTimeActual
	}

	minBuf := computeMinTransferBuffer(legs)
	threshold := SafetyThresholdMinutes(filters.SafetyLevel)
	criticalTransfer := minBuf != nil && *minBuf < threshold

	var timeGain *int
	if originalETA != nil {
		g := int(originalETA.Sub(eta).Minutes())
		timeGain = &g
	}

	fromStation := ""
	if len(first.Stops) > 0 {
		fromStation = first.Stops[0].StationName
	}

	return Summary{
		FromStation:               fromStation,
		FromTime:                  first.DepartureTimePlanned,
		ToStation:                 destination.Name,
		ToTime:                    last.ArrivalTimePlanned,
		ETA:                       eta,
		TimeGainVsOriginalMinutes: timeGain,
		MinTransferBufferMinutes:  minBuf,
		Status:                    computeStatus(legs, criticalTransfer),
		CriticalTransfer:          criticalTransfer,
		DataConfidence:            computeDataConfidence(legs),
		NextStep:                  computeNextStep(legs, now, destination.ID),
		DataFetchedAt:             now,
		LastUpdatedAt:             now,
	}
}

func computeMinTransferBuffer(legs []Leg) *int {
	var minBuf *int
	for i := 0; i < len(legs)-1; i++ {
		curr, next := legs[i], legs[i+1]
		currArr := nilCoalesceTime(curr.ArrivalTimeActual, &curr.ArrivalTimePlanned)
		nextDep := nilCoalesceTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
		if currArr == nil || nextDep == nil {
			continue
		}
		buf := int(nextDep.Sub(*currArr).Minutes())
		if minBuf == nil || buf < *minBuf {
			b := buf
			minBuf = &b
		}
	}
	return minBuf
}

func computeStatus(legs []Leg, criticalTransfer bool) Status {
	for _, leg := range legs {
		if leg.Status == LegStatusCancelled {
			return StatusFailed
		}
	}
	if criticalTransfer {
		return StatusCritical
	}
	for _, leg := range legs {
		if leg.Status == LegStatusDelayed {
			return StatusCritical
		}
	}
	return StatusOK
}

func computeDataConfidence(legs []Leg) DataConfidence {
	hasRealtime, missing := false, false
	for _, leg := range legs {
		if leg.DepartureTimeActual != nil || leg.ArrivalTimeActual != nil {
			hasRealtime = true
		} else {
			missing = true
		}
	}
	if hasRealtime && !missing {
		return DataConfidenceHigh
	}
	if hasRealtime {
		return DataConfidenceLow
	}
	return DataConfidenceUnavailable
}

func computeNextStep(legs []Leg, now time.Time, destinationID string) *NextStep {
	for i, leg := range legs {
		dep := nilCoalesceTime(leg.DepartureTimeActual, &leg.DepartureTimePlanned)
		arr := nilCoalesceTime(leg.ArrivalTimeActual, &leg.ArrivalTimePlanned)
		if dep == nil || arr == nil {
			continue
		}
		if now.After(*dep) && now.Before(*arr) {
			if i+1 < len(legs) {
				next := legs[i+1]
				nextDep := nilCoalesceTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
				buf := 0
				if arr != nil && nextDep != nil {
					buf = int(nextDep.Sub(*arr).Minutes())
				}
				transferStation := ""
				transferStationID := ""
				if len(leg.Stops) > 0 {
					last := leg.Stops[len(leg.Stops)-1]
					transferStation = last.StationName
					transferStationID = last.StationID
				}
				tn := next.VehicleNumber
				return &NextStep{
					Type:          NextStepTransfer,
					StationName:   transferStation,
					StationID:     transferStationID,
					TrainNumber:   &tn,
					DepartureTime: nextDep,
					BufferMinutes: &buf,
					Platform:      next.PlatformActual,
				}
			}
			dest := ""
			destID := destinationID
			if len(leg.Stops) > 0 {
				last := leg.Stops[len(leg.Stops)-1]
				dest = last.StationName
			}
			return &NextStep{Type: NextStepDisembark, StationName: dest, StationID: destID}
		}
		if now.Before(*dep) {
			tn := leg.VehicleNumber
			origin := ""
			originID := ""
			if len(leg.Stops) > 0 {
				origin = leg.Stops[0].StationName
				originID = leg.Stops[0].StationID
			}
			return &NextStep{
				Type:        NextStepRide,
				StationName: origin,
				StationID:   originID,
				TrainNumber: &tn,
			}
		}
	}
	return nil
}

func nilCoalesceTime(a, b *time.Time) *time.Time {
	if a != nil {
		return a
	}
	return b
}
