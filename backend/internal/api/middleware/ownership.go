// backend/internal/api/middleware/ownership.go
package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

type ctxKey int

const journeyCtxKey ctxKey = iota

// JourneyFromContext returns the ownership-verified journey attached by JourneyOwnership.
// Returns nil when the middleware was not applied to the route.
func JourneyFromContext(ctx context.Context) *journey.Journey {
	j, _ := ctx.Value(journeyCtxKey).(*journey.Journey)
	return j
}

// JourneyOwnership verifies that the X-Install-Id header matches the journey's stored InstallID.
// On miss or mismatch, returns 404 — never 403 — to avoid leaking existence to other installs.
// The verified journey is attached to the request context for downstream handlers to reuse.
func JourneyOwnership(store journey.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			if id == "" {
				next.ServeHTTP(w, r)
				return
			}

			notFound := func() {
				problem.Write(w, r, problem.Problem{
					Type:   "urn:verspbegl:error:journey-not-found",
					Title:  "Journey Not Found",
					Status: http.StatusNotFound,
					Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
				})
			}

			j, err := store.Get(r.Context(), id)
			if errors.Is(err, journey.ErrNotFound) {
				notFound()
				return
			}
			if err != nil {
				problem.Write(w, r, problem.Problem{
					Type:   "urn:verspbegl:error:internal-error",
					Title:  "Internal Server Error",
					Status: http.StatusInternalServerError,
				})
				return
			}

			installID := r.Header.Get("X-Install-Id")
			if installID == "" || installID != j.InstallID {
				notFound()
				return
			}

			ctx := context.WithValue(r.Context(), journeyCtxKey, j)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
