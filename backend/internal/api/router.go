package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

// Deps holds all handler dependencies. Fields added in Plans 2-4.
type Deps struct {
	Health      *handlers.HealthHandler
	Logger      *slog.Logger
	CORSOrigins []string
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.Recoverer)
	r.Use(mw.RequestID)
	r.Use(mw.Logging(deps.Logger))
	r.Use(mw.CORS(deps.CORSOrigins))

	r.Get("/health", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)

	// /v1/ routes added in Plans 2-4
	r.Route("/v1", func(r chi.Router) {})

	return r
}
