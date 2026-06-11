package hafas

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

var trainNumberRe = regexp.MustCompile(`^([A-Z]+)([0-9].*)$`)

// NormalizeTrainNumber inserts a space between the letter prefix and numeric part.
// "ICE123" → "ICE 123". Already-spaced inputs pass through unchanged.
func NormalizeTrainNumber(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if m := trainNumberRe.FindStringSubmatch(s); len(m) == 3 {
		return m[1] + " " + m[2]
	}
	return s
}

// MapStations converts HAFAS location results to StationRef slice.
// Non-stop entries and entries with empty ID/Name are filtered out.
func MapStations(results []HAFASLocationResult) []journey.StationRef {
	out := make([]journey.StationRef, 0, len(results))
	for _, r := range results {
		if r.Type != "stop" && r.Type != "station" {
			continue
		}
		if r.ID == "" || r.Name == "" {
			continue
		}
		out = append(out, journey.StationRef{ID: r.ID, Name: r.Name})
	}
	return out
}

// TrainResponse is the API payload for GET /v1/trains/{number}.
type TrainResponse struct {
	TrainNumber string               `json:"trainNumber"`
	Date        string               `json:"date"`
	Origin      journey.StationRef   `json:"origin"`
	Destination journey.StationRef   `json:"destination"`
	Stops       []journey.StationRef `json:"stops"`
	Status      string               `json:"status"` // planned | running | delayed | cancelled
}

// MapTripToTrainResponse maps a HAFASTrip to the train validation response.
// now is used to determine whether the trip is currently running; pass time.Now() in
// production or a fixed time in tests to exercise the "running"/"delayed" branches.
func MapTripToTrainResponse(trip HAFASTrip, date string, now time.Time) TrainResponse {
	stops := make([]journey.StationRef, 0)
	for _, s := range trip.Stopovers {
		if s.Stop.ID == "" {
			continue
		}
		stops = append(stops, journey.StationRef{ID: s.Stop.ID, Name: s.Stop.Name})
	}
	return TrainResponse{
		TrainNumber: NormalizeTrainNumber(trip.Line.Name),
		Date:        date,
		Origin:      journey.StationRef{ID: trip.Origin.ID, Name: trip.Origin.Name},
		Destination: journey.StationRef{ID: trip.Destination.ID, Name: trip.Destination.Name},
		Status:      inferTripStatus(trip, now),
		Stops:       stops,
	}
}

// FilterTripsByDate returns trips whose first stopover planned departure falls on date (YYYY-MM-DD).
// Date comparison uses Europe/Berlin since DB operates on German timetable.
func FilterTripsByDate(trips []HAFASTrip, date string) []HAFASTrip {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		loc = time.UTC
	}
	var out []HAFASTrip
	for _, t := range trips {
		if len(t.Stopovers) == 0 {
			continue
		}
		dep := t.Stopovers[0].PlannedDeparture
		if dep == nil {
			dep = t.Stopovers[0].Departure
		}
		if dep == nil {
			continue
		}
		if dep.In(loc).Format("2006-01-02") == date {
			out = append(out, t)
		}
	}
	return out
}

func inferTripStatus(trip HAFASTrip, now time.Time) string {
	for _, s := range trip.Stopovers {
		if s.Cancelled {
			return "cancelled"
		}
	}
	hasDelay := false
	for _, s := range trip.Stopovers {
		if (s.DepartureDelay != nil && *s.DepartureDelay != 0) ||
			(s.ArrivalDelay != nil && *s.ArrivalDelay != 0) {
			hasDelay = true
			break
		}
	}
	if trip.Departure != nil && trip.Arrival != nil &&
		now.After(*trip.Departure) && now.Before(*trip.Arrival) {
		if hasDelay {
			return "delayed"
		}
		return "running"
	}
	if hasDelay {
		return "delayed"
	}
	return "planned"
}

// MapHAFASJourney converts a HAFASJourney to the internal Journey model.
// now is used for status computation (caller passes time.Now() in production).
func MapHAFASJourney(
	hj HAFASJourney,
	id, installID, trainNumber string,
	destination journey.StationRef,
	filters journey.Filters,
	originalETA *time.Time,
	now time.Time,
) journey.Journey {
	legs := mapLegs(hj.Legs)
	stops := collectStops(hj.Legs)
	summary := computeSummary(legs, destination, filters, originalETA, now)

	return journey.Journey{
		ID:          id,
		InstallID:   installID,
		TrainNumber: trainNumber,
		Destination: destination,
		Filters:     filters,
		Summary:     summary,
		Legs:        legs,
		Stops:       stops,
		ETagEpoch:   now.Unix(),
		ETagCounter: 1,
		CreatedAt:   now,
	}
}

func mapLegs(hafasLegs []HAFASLeg) []journey.Leg {
	legs := make([]journey.Leg, 0, len(hafasLegs))
	for i, hl := range hafasLegs {
		leg := journey.Leg{
			LegID:            fmt.Sprintf("leg_%02d", i+1),
			IsWalkingSegment: hl.Walking,
			Stops:            mapStopovers(hl.Stopovers),
		}
		if hl.Line != nil {
			leg.VehicleNumber = hl.Line.Name
			leg.LineName = hl.Line.Name
			if hl.Line.Operator != nil {
				leg.Operator = hl.Line.Operator.Name
			}
		}
		if hl.TripId != nil {
			leg.TripID = *hl.TripId
		}

		dep := firstNonNil(hl.PlannedDeparture, hl.Departure)
		arr := firstNonNil(hl.PlannedArrival, hl.Arrival)
		if dep != nil {
			leg.DepartureTimePlanned = *dep
		}
		if arr != nil {
			leg.ArrivalTimePlanned = *arr
		}
		if hl.Departure != nil && hl.PlannedDeparture != nil && !hl.Departure.Equal(*hl.PlannedDeparture) {
			leg.DepartureTimeActual = hl.Departure
		}
		if hl.Arrival != nil && hl.PlannedArrival != nil && !hl.Arrival.Equal(*hl.PlannedArrival) {
			leg.ArrivalTimeActual = hl.Arrival
		}
		if hl.ArrivalDelay != nil {
			mins := *hl.ArrivalDelay / 60
			leg.DelayMinutes = &mins
		}
		leg.PlatformPlanned = firstNonNilStr(hl.PlannedDeparturePlatform, hl.PlannedArrivalPlatform)
		leg.PlatformActual = firstNonNilStr(hl.DeparturePlatform, hl.ArrivalPlatform)
		leg.Status = inferLegStatus(hl)
		legs = append(legs, leg)
	}
	return legs
}

func mapStopovers(ss []HAFASStopover) []journey.Stop {
	stops := make([]journey.Stop, 0, len(ss))
	for _, s := range ss {
		stop := journey.Stop{
			StationID:   s.Stop.ID,
			StationName: s.Stop.Name,
		}
		planned := firstNonNil(s.PlannedArrival, s.Arrival)
		if planned != nil {
			stop.ArrivalTimePlanned = *planned
		}
		if s.Arrival != nil && s.PlannedArrival != nil && !s.Arrival.Equal(*s.PlannedArrival) {
			stop.ArrivalTimeActual = s.Arrival
		}
		depPlanned := firstNonNil(s.PlannedDeparture, s.Departure)
		if depPlanned != nil {
			stop.DepartureTimePlanned = depPlanned
		}
		if s.Departure != nil && s.PlannedDeparture != nil && !s.Departure.Equal(*s.PlannedDeparture) {
			stop.DepartureTimeActual = s.Departure
		}
		if s.ArrivalDelay != nil {
			mins := *s.ArrivalDelay / 60
			stop.DelayMinutes = &mins
		}
		stop.PlatformPlanned = firstNonNilStr(s.PlannedArrivalPlatform, s.PlannedDeparturePlatform)
		stop.PlatformActual = firstNonNilStr(s.ArrivalPlatform, s.DeparturePlatform)
		stops = append(stops, stop)
	}
	return stops
}

func collectStops(hafasLegs []HAFASLeg) []journey.Stop {
	var stops []journey.Stop
	seen := make(map[string]bool)
	for _, leg := range hafasLegs {
		for _, s := range mapStopovers(leg.Stopovers) {
			if !seen[s.StationID] {
				stops = append(stops, s)
				seen[s.StationID] = true
			}
		}
	}
	return stops
}

func inferLegStatus(hl HAFASLeg) journey.LegStatus {
	if hl.Cancelled {
		return journey.LegStatusCancelled
	}
	if (hl.DepartureDelay != nil && *hl.DepartureDelay > 0) ||
		(hl.ArrivalDelay != nil && *hl.ArrivalDelay > 0) {
		return journey.LegStatusDelayed
	}
	now := time.Now()
	dep := firstNonNil(hl.Departure, hl.PlannedDeparture)
	arr := firstNonNil(hl.Arrival, hl.PlannedArrival)
	if dep != nil && arr != nil && now.After(*dep) && now.Before(*arr) {
		return journey.LegStatusRunning
	}
	return journey.LegStatusPlanned
}

func computeSummary(legs []journey.Leg, destination journey.StationRef, filters journey.Filters, originalETA *time.Time, now time.Time) journey.Summary {
	if len(legs) == 0 {
		return journey.Summary{}
	}
	first := legs[0]
	last := legs[len(legs)-1]

	eta := last.ArrivalTimePlanned
	if last.ArrivalTimeActual != nil {
		eta = *last.ArrivalTimeActual
	}

	minBuf := computeMinTransferBuffer(legs)
	threshold := journey.SafetyThresholdMinutes(filters.SafetyLevel)
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

	return journey.Summary{
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

func computeMinTransferBuffer(legs []journey.Leg) *int {
	var minBuf *int
	for i := 0; i < len(legs)-1; i++ {
		curr, next := legs[i], legs[i+1]
		currArr := firstNonNilTime(curr.ArrivalTimeActual, &curr.ArrivalTimePlanned)
		nextDep := firstNonNilTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
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

func computeStatus(legs []journey.Leg, criticalTransfer bool) journey.Status {
	for _, leg := range legs {
		if leg.Status == journey.LegStatusCancelled {
			return journey.StatusFailed
		}
	}
	if criticalTransfer {
		return journey.StatusCritical
	}
	for _, leg := range legs {
		if leg.Status == journey.LegStatusDelayed {
			return journey.StatusCritical
		}
	}
	return journey.StatusOK
}

func computeDataConfidence(legs []journey.Leg) journey.DataConfidence {
	hasRealtime, missing := false, false
	for _, leg := range legs {
		if leg.DepartureTimeActual != nil || leg.ArrivalTimeActual != nil {
			hasRealtime = true
		} else {
			missing = true
		}
	}
	if hasRealtime && !missing {
		return journey.DataConfidenceHigh
	}
	if hasRealtime {
		return journey.DataConfidenceLow
	}
	return journey.DataConfidenceUnavailable
}

func computeNextStep(legs []journey.Leg, now time.Time, destinationID string) *journey.NextStep {
	for i, leg := range legs {
		dep := firstNonNilTime(leg.DepartureTimeActual, &leg.DepartureTimePlanned)
		arr := firstNonNilTime(leg.ArrivalTimeActual, &leg.ArrivalTimePlanned)
		if dep == nil || arr == nil {
			continue
		}
		// Currently riding this leg
		if now.After(*dep) && now.Before(*arr) {
			if i+1 < len(legs) {
				next := legs[i+1]
				nextDep := firstNonNilTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
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
				return &journey.NextStep{
					Type:          journey.NextStepTransfer,
					StationName:   transferStation,
					StationID:     transferStationID,
					TrainNumber:   &tn,
					DepartureTime: nextDep,
					BufferMinutes: &buf,
					Platform:      next.PlatformActual,
				}
			}
			// On last leg — disembark
			dest := ""
			destID := destinationID
			if len(leg.Stops) > 0 {
				last := leg.Stops[len(leg.Stops)-1]
				dest = last.StationName
			}
			return &journey.NextStep{Type: journey.NextStepDisembark, StationName: dest, StationID: destID}
		}
		// Hasn't departed yet — ride
		if now.Before(*dep) {
			tn := leg.VehicleNumber
			origin := ""
			originID := ""
			if len(leg.Stops) > 0 {
				origin = leg.Stops[0].StationName
				originID = leg.Stops[0].StationID
			}
			return &journey.NextStep{
				Type:        journey.NextStepRide,
				StationName: origin,
				StationID:   originID,
				TrainNumber: &tn,
			}
		}
	}
	return nil
}

func firstNonNil(a, b *time.Time) *time.Time {
	if a != nil {
		return a
	}
	return b
}

func firstNonNilTime(a, b *time.Time) *time.Time {
	return firstNonNil(a, b)
}

func firstNonNilStr(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}
