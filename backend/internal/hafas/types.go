package hafas

import "time"

// HAFASLocationResult is one item from GET /locations
type HAFASLocationResult struct {
	Type string `json:"type"` // "stop" | "station" | "location"
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASTripsResponse wraps GET /trips?query=...
type HAFASTripsResponse struct {
	Trips []HAFASTrip `json:"trips"`
}

// HAFASTrip is one run of a scheduled service.
type HAFASTrip struct {
	ID                    string          `json:"id"`
	Line                  HAFASLine       `json:"line"`
	Origin                HAFASPlace      `json:"origin"`
	Destination           HAFASPlace      `json:"destination"`
	Departure             *time.Time      `json:"departure"`
	Arrival               *time.Time      `json:"arrival"`
	Stopovers             []HAFASStopover `json:"stopovers"`
	RealtimeDataUpdatedAt *int64          `json:"realtimeDataUpdatedAt"`
}

// HAFASPlace is a stop or station reference.
type HAFASPlace struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASLine holds train line / product information.
type HAFASLine struct {
	Type     string         `json:"type"`
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	FahrtNr  string         `json:"fahrtNr,omitempty"`
	Mode     string         `json:"mode"`
	Product  string         `json:"product"`
	Operator *HAFASOperator `json:"operator,omitempty"`
}

// HAFASOperator holds operator name and ID.
type HAFASOperator struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASStopover is one stop within a trip or leg.
type HAFASStopover struct {
	Stop                     HAFASPlace `json:"stop"`
	Arrival                  *time.Time `json:"arrival"`
	ArrivalDelay             *int       `json:"arrivalDelay"` // seconds
	PlannedArrival           *time.Time `json:"plannedArrival"`
	ArrivalPlatform          *string    `json:"arrivalPlatform"`
	PlannedArrivalPlatform   *string    `json:"plannedArrivalPlatform"`
	Departure                *time.Time `json:"departure"`
	DepartureDelay           *int       `json:"departureDelay"` // seconds
	PlannedDeparture         *time.Time `json:"plannedDeparture"`
	DeparturePlatform        *string    `json:"departurePlatform"`
	PlannedDeparturePlatform *string    `json:"plannedDeparturePlatform"`
	Cancelled                bool       `json:"cancelled"`
}

// HAFASJourneysResponse wraps GET /journeys.
type HAFASJourneysResponse struct {
	Journeys []HAFASJourney `json:"journeys"`
}

// HAFASJourney is one connection option returned by HAFAS.
type HAFASJourney struct {
	Type string     `json:"type"`
	Legs []HAFASLeg `json:"legs"`
}

// HAFASLeg is one segment (vehicle ride or walk) of a journey.
type HAFASLeg struct {
	Origin                   HAFASPlace      `json:"origin"`
	Destination              HAFASPlace      `json:"destination"`
	Departure                *time.Time      `json:"departure"`
	DepartureDelay           *int            `json:"departureDelay"` // seconds
	PlannedDeparture         *time.Time      `json:"plannedDeparture"`
	Arrival                  *time.Time      `json:"arrival"`
	ArrivalDelay             *int            `json:"arrivalDelay"` // seconds
	PlannedArrival           *time.Time      `json:"plannedArrival"`
	DeparturePlatform        *string         `json:"departurePlatform"`
	PlannedDeparturePlatform *string         `json:"plannedDeparturePlatform"`
	ArrivalPlatform          *string         `json:"arrivalPlatform"`
	PlannedArrivalPlatform   *string         `json:"plannedArrivalPlatform"`
	Line                     *HAFASLine      `json:"line"`
	TripId                   *string         `json:"tripId"`
	Stopovers                []HAFASStopover `json:"stopovers"`
	Cancelled                bool            `json:"cancelled"`
	Walking                  bool            `json:"walking"`
}
