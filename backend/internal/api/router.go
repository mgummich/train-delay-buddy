package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

// Deps holds all handler dependencies injected at startup.
type Deps struct {
	Health             *handlers.HealthHandler
	Stations           *handlers.StationsHandler
	Trains             *handlers.TrainsHandler
	Journeys           *handlers.JourneysHandler
	Logger             *slog.Logger
	CORSOrigins        []string
	InstallRateLimiter *mw.RateLimiter
	IPRateLimiter      *mw.RateLimiter
	PerInstallLimit    int
	PerIPLimit         int
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.Recoverer) // must be outermost to catch panics in all middleware below
	r.Use(mw.RequestID)
	r.Use(mw.Logging(deps.Logger))
	r.Use(mw.CORS(deps.CORSOrigins))

	r.Get("/health", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)

	r.Route("/v1", func(r chi.Router) {
		r.Use(mw.RateLimit(
			deps.InstallRateLimiter,
			deps.IPRateLimiter,
			deps.PerInstallLimit,
			deps.PerIPLimit,
		))

		r.Get("/stations", deps.Stations.Search)
		r.Get("/trains/{number}", deps.Trains.Get)

		r.Post("/journeys", deps.Journeys.Create)
		r.Get("/journeys/{id}", deps.Journeys.Get)
		r.Delete("/journeys/{id}", deps.Journeys.Delete)
		// summary, legs, alternatives added in Plan 4
	})

	return r
}
