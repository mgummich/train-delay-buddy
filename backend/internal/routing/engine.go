// backend/internal/routing/engine.go
package routing

import (
	"context"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// RoutingRequest carries all inputs for a routing computation.
type RoutingRequest struct {
	TrainNumber    string
	FromStationID  string // origin of the user's train
	ToStationID    string // user's destination (HAFAS station ID)
	ToStationName  string
	DepartureAfter time.Time
	Filters        journey.Filters
	InstallID      string
}

// RoutingResult holds the user's current journey and the ranked alternatives.
type RoutingResult struct {
	Original     journey.Journey
	Alternatives []journey.Alternative
	Plausibility journey.Plausibility
}

// Engine is the routing interface. BFSEngine is the MVP implementation.
// Swap for RAPTOR behind this interface when timetable data is available.
type Engine interface {
	Route(ctx context.Context, req RoutingRequest) (*RoutingResult, error)
}
