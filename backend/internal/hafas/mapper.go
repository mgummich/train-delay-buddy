package hafas

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

var trainNumberRe = regexp.MustCompile(`^([A-Z]+)([0-9].*)$`)

// berlinLoc is cached once at startup; LoadLocation reads tzdata on every call.
var berlinLoc = func() *time.Location {
	l, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		return time.UTC
	}
	return l
}()

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
		if dep.In(berlinLoc).Format("2006-01-02") == date {
			out = append(out, t)
		}
	}
	return out
}

func inferTripStatus(trip HAFASTrip, now time.Time) string {
	hasDelay := false
	for _, s := range trip.Stopovers {
		if s.Cancelled {
			return "cancelled"
		}
		if !hasDelay && ((s.DepartureDelay != nil && *s.DepartureDelay != 0) ||
			(s.ArrivalDelay != nil && *s.ArrivalDelay != 0)) {
			hasDelay = true
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
	legs := mapLegs(hj.Legs, now)
	stops := collectStopsFromLegs(legs)
	summary := journey.ComputeSummary(legs, destination, filters, originalETA, now)

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

func mapLegs(hafasLegs []HAFASLeg, now time.Time) []journey.Leg {
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
		leg.Status = inferLegStatus(hl, now)
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

// collectStopsFromLegs builds a deduplicated stop list from already-mapped legs,
// avoiding a second pass over raw HAFAS stopovers.
func collectStopsFromLegs(legs []journey.Leg) []journey.Stop {
	var stops []journey.Stop
	seen := make(map[string]bool)
	for _, leg := range legs {
		for _, s := range leg.Stops {
			if !seen[s.StationID] {
				stops = append(stops, s)
				seen[s.StationID] = true
			}
		}
	}
	return stops
}

func inferLegStatus(hl HAFASLeg, now time.Time) journey.LegStatus {
	if hl.Cancelled {
		return journey.LegStatusCancelled
	}
	if (hl.DepartureDelay != nil && *hl.DepartureDelay > 0) ||
		(hl.ArrivalDelay != nil && *hl.ArrivalDelay > 0) {
		return journey.LegStatusDelayed
	}
	dep := firstNonNil(hl.Departure, hl.PlannedDeparture)
	arr := firstNonNil(hl.Arrival, hl.PlannedArrival)
	if dep != nil && arr != nil && now.After(*dep) && now.Before(*arr) {
		return journey.LegStatusRunning
	}
	return journey.LegStatusPlanned
}

func firstNonNil(a, b *time.Time) *time.Time {
	if a != nil {
		return a
	}
	return b
}

func firstNonNilStr(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}
