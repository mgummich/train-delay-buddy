// backend/internal/journey/model.go
package journey

import (
	"fmt"
	"time"
)

type Status string

const (
	StatusOK       Status = "ok"
	StatusCritical Status = "critical"
	StatusFailed   Status = "failed"
)

type DataConfidence string

const (
	DataConfidenceHigh        DataConfidence = "high"
	DataConfidenceLow         DataConfidence = "low"
	DataConfidenceUnavailable DataConfidence = "unavailable"
)

type NextStepType string

const (
	NextStepRide      NextStepType = "ride"
	NextStepTransfer  NextStepType = "transfer"
	NextStepDisembark NextStepType = "disembark"
)

type LegStatus string

const (
	LegStatusPlanned   LegStatus = "planned"
	LegStatusRunning   LegStatus = "running"
	LegStatusDelayed   LegStatus = "delayed"
	LegStatusCancelled LegStatus = "cancelled"
)

type SafetyLevel string

const (
	SafetyLevelAggressive SafetyLevel = "aggressive"
	SafetyLevelNormal     SafetyLevel = "normal"
	SafetyLevelCautious   SafetyLevel = "cautious"
)

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

type Plausibility struct {
	OnTrainConfidence string  `json:"onTrainConfidence"`
	Reason            *string `json:"reason"`
}

type StationRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type NextStep struct {
	Type          NextStepType `json:"type"`
	StationName   string       `json:"stationName"`
	StationID     string       `json:"stationId"`
	TrainNumber   *string      `json:"trainNumber"`
	Platform      *string      `json:"platform"`
	DepartureTime *time.Time   `json:"departureTime"`
	BufferMinutes *int         `json:"bufferMinutes"`
}

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

type Filters struct {
	DBOnly       bool        `json:"dbOnly"`
	MaxTransfers *int        `json:"maxTransfers"`
	SafetyLevel  SafetyLevel `json:"safetyLevel"`
}

type Alternative struct {
	JourneyID string  `json:"journeyId"`
	Summary   Summary `json:"summary"`
	Legs      []Leg   `json:"legs"`
}

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

func (j *Journey) ETag() string {
	return fmt.Sprintf("%s:%d:%d", j.ID, j.ETagEpoch, j.ETagCounter)
}
