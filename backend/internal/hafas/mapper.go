package hafas

import (
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
