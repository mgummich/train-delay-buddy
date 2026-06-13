package journey

import (
	"fmt"
	"time"
)

// Status represents the monitoring health of a journey.
type Status string

const (
	StatusOK       Status = "ok"       // All transfers safe, journey on track.
	StatusCritical Status = "critical" // At least one transfer is tight or a strong delay detected.
	StatusFailed   Status = "failed"   // Route no longer continuable — cancelled leg or missed connection.
)

// DataConfidence indicates the quality of HAFAS realtime data for a journey.
type DataConfidence string

const (
	DataConfidenceHigh        DataConfidence = "high"        // Full realtime data present for all active legs.
	DataConfidenceLow         DataConfidence = "low"         // Realtime partially missing or stale (>3 min).
	DataConfidenceUnavailable DataConfidence = "unavailable" // No realtime data in HAFAS response.
)

// NextStepType identifies the passenger action required at the current point in the journey.
type NextStepType string

const (
	NextStepRide      NextStepType = "ride"      // On a train; no action needed.
	NextStepTransfer  NextStepType = "transfer"  // Upcoming transfer — platform and connecting train details provided.
	NextStepDisembark NextStepType = "disembark" // Final destination reached; get off the train.
)

// LegStatus reflects the real-time operational state of one train segment.
type LegStatus string

const (
	LegStatusPlanned   LegStatus = "planned"   // Not yet departed; no realtime data available.
	LegStatusRunning   LegStatus = "running"   // En route, on schedule.
	LegStatusDelayed   LegStatus = "delayed"   // Running late — ArrivalTimeActual after ArrivalTimePlanned.
	LegStatusCancelled LegStatus = "cancelled" // Service cancelled; this leg breaks the route.
)

// SafetyLevel controls the minimum transfer buffer threshold applied during BFS routing.
type SafetyLevel string

const (
	SafetyLevelAggressive SafetyLevel = "aggressive" // 3-minute minimum buffer.
	SafetyLevelNormal     SafetyLevel = "normal"     // 8-minute minimum buffer (default).
	SafetyLevelCautious   SafetyLevel = "cautious"   // 15-minute minimum buffer.
)

// SafetyThresholdMinutes returns the minimum acceptable transfer buffer in minutes
// for the given level. Unrecognized levels return the normal (8 min) default.
func SafetyThresholdMinutes(level SafetyLevel) int {
	switch level {
	case SafetyLevelAggressive:
		return 3
	case SafetyLevelCautious:
		return 15
	default:
		return 8
	}
}

// Plausibility assesses how likely the user is actually aboard the stated train,
// based on the train's current route and realtime state.
type Plausibility struct {
	OnTrainConfidence string  `json:"onTrainConfidence"` // "high", "low", or "unknown".
	Reason            *string `json:"reason"`            // Human-readable reason when confidence is not high.
}

// StationRef is a minimal HAFAS station identifier used throughout the model.
type StationRef struct {
	ID   string `json:"id"`   // HAFAS station ID, e.g. "8000105".
	Name string `json:"name"` // Display name, e.g. "Frankfurt (Main) Hbf".
}

// NextStep describes the immediate action a passenger should take.
// Nil when the journey is complete or no active leg is found.
type NextStep struct {
	Type          NextStepType `json:"type"`
	StationName   string       `json:"stationName"`
	StationID     string       `json:"stationId"`
	TrainNumber   *string      `json:"trainNumber"`   // Nil for disembark steps.
	Platform      *string      `json:"platform"`      // Nil when platform is unknown.
	DepartureTime *time.Time   `json:"departureTime"` // Nil for ride and disembark steps.
	BufferMinutes *int         `json:"bufferMinutes"` // Transfer buffer at this stop; nil for non-transfer steps.
}

// Summary is a computed snapshot of a journey's current state.
// Recomputed by the poller after every HAFAS update cycle.
type Summary struct {
	FromStation                   string         `json:"fromStation"`
	FromTime                      time.Time      `json:"fromTime"`
	ToStation                     string         `json:"toStation"`
	ToTime                        time.Time      `json:"toTime"`
	ETA                           time.Time      `json:"eta"`
	TimeGainVsOriginalMinutes     *int           `json:"timeGainVsOriginalMinutes"`
	TimeGainVsCurrentRouteMinutes *int           `json:"timeGainVsCurrentRouteMinutes"`
	MinTransferBufferMinutes      *int           `json:"minTransferBufferMinutes"`
	Status                        Status         `json:"status"`
	CriticalTransfer              bool           `json:"criticalTransfer"`
	AlternativeAvailable          bool           `json:"alternativeAvailable"`
	DataConfidence                DataConfidence `json:"dataConfidence"`
	NextStep                      *NextStep      `json:"nextStep"`
	DataFetchedAt                 time.Time      `json:"dataFetchedAt"`
	LastUpdatedAt                 time.Time      `json:"lastUpdatedAt"`
}

// Stop is one scheduled halt within a Leg, enriched with realtime data when available.
type Stop struct {
	StationID             string     `json:"stationId"`
	StationName           string     `json:"stationName"`
	ArrivalTimePlanned    time.Time  `json:"arrivalTimePlanned"`
	ArrivalTimeActual     *time.Time `json:"arrivalTimeActual"`
	DepartureTimePlanned  *time.Time `json:"departureTimePlanned"`
	DepartureTimeActual   *time.Time `json:"departureTimeActual"`
	DelayMinutes          *int       `json:"delayMinutes"`
	PlatformPlanned       *string    `json:"platformPlanned"`
	PlatformActual        *string    `json:"platformActual"`
	TransferBufferMinutes *int       `json:"transferBufferMinutes"`
}

// Leg is one unbroken train segment within a Journey.
// Spans from boarding to alighting the same vehicle; TripID links to the HAFAS trip.
type Leg struct {
	LegID                string     `json:"legId"`
	VehicleNumber        string     `json:"vehicleNumber"`
	LineName             string     `json:"lineName"`
	Operator             string     `json:"operator"`
	DepartureTimePlanned time.Time  `json:"departureTimePlanned"`
	DepartureTimeActual  *time.Time `json:"departureTimeActual"`
	ArrivalTimePlanned   time.Time  `json:"arrivalTimePlanned"`
	ArrivalTimeActual    *time.Time `json:"arrivalTimeActual"`
	DelayMinutes         *int       `json:"delayMinutes"`
	PlatformPlanned      *string    `json:"platformPlanned"`
	PlatformActual       *string    `json:"platformActual"`
	Status               LegStatus  `json:"status"`
	IsWalkingSegment     bool       `json:"isWalkingSegment"`
	Stops                []Stop     `json:"stops"`
	TripID               string     `json:"-"`
}

// Filters constrains which alternative routes are considered during BFS routing.
// Stored with the journey so reruns use the same constraints.
type Filters struct {
	DBOnly       bool        `json:"dbOnly"`
	MaxTransfers *int        `json:"maxTransfers"`
	SafetyLevel  SafetyLevel `json:"safetyLevel"`
}

// Alternative is a ranked alternative route with its own summary and leg list.
// Returned by GET /journeys/{id}/alternatives, sorted by ETA improvement.
type Alternative struct {
	JourneyID string  `json:"journeyId"`
	Summary   Summary `json:"summary"`
	Legs      []Leg   `json:"legs"`
}

// Journey is the root entity created when a user begins monitoring a trip.
// Persisted in Postgres; cached in Redis for fast polling reads.
type Journey struct {
	ID           string     `json:"journeyId"`
	InstallID    string     `json:"-"`
	TrainNumber  string     `json:"trainNumber"`
	Destination  StationRef `json:"destination"`
	Filters      Filters    `json:"filters"`
	Summary      Summary    `json:"summary"`
	Legs         []Leg      `json:"legs"`
	Stops        []Stop     `json:"stops"`
	ETagEpoch    int64      `json:"-"`
	ETagCounter  int        `json:"-"`
	CreatedAt    time.Time  `json:"-"`
	TerminatedAt *time.Time `json:"-"`
	LastPolledAt *time.Time `json:"-"`
}

// ETag returns the HTTP conditional-request version string for this journey.
// Format: "<journeyId>:<redisEpoch>:<updateCounter>"
func (j *Journey) ETag() string {
	return fmt.Sprintf("%s:%d:%d", j.ID, j.ETagEpoch, j.ETagCounter)
}
