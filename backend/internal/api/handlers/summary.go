package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/metrics"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// SummaryHandler handles GET /v1/journeys/{id}/summary.
type SummaryHandler struct {
	store journey.Store
}

// NewSummaryHandler creates a SummaryHandler backed by the given store.
func NewSummaryHandler(store journey.Store) *SummaryHandler {
	return &SummaryHandler{store: store}
}

// Get returns the journey summary. Returns 304 when the client ETag matches.
func (h *SummaryHandler) Get(w http.ResponseWriter, r *http.Request) {
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
		metrics.PollETag304Total.Inc()
		return
	}

	w.Header().Set("ETag", etagHeader)
	metrics.PollETag200Total.Inc()
	writeJSON(w, http.StatusOK, j.Summary)
}
