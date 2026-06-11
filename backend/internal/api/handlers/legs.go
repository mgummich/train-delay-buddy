package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// LegsHandler handles GET /v1/journeys/{id}/legs.
type LegsHandler struct {
	store journey.Store
}

func NewLegsHandler(store journey.Store) *LegsHandler {
	return &LegsHandler{store: store}
}

type legsResponse struct {
	Legs  []journey.Leg  `json:"legs"`
	Stops []journey.Stop `json:"stops"`
}

// Get returns legs and stops for the journey timeline. ETag-cached.
func (h *LegsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
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

	etagHeader := `"` + j.ETag() + `"`
	w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")

	if r.Header.Get("If-None-Match") == etagHeader {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	legs := j.Legs
	if legs == nil {
		legs = []journey.Leg{}
	}
	stops := j.Stops
	if stops == nil {
		stops = []journey.Stop{}
	}

	w.Header().Set("ETag", etagHeader)
	writeJSON(w, http.StatusOK, legsResponse{Legs: legs, Stops: stops})
}
