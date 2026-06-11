package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// TrainsHandler handles GET /v1/trains/{number}.
type TrainsHandler struct {
	hafas *hafas.Client
}

func NewTrainsHandler(h *hafas.Client) *TrainsHandler {
	return &TrainsHandler{hafas: h}
}

// Get validates a train number and returns its metadata for a given date.
func (h *TrainsHandler) Get(w http.ResponseWriter, r *http.Request) {
	rawNumber := chi.URLParam(r, "number")
	normalized := hafas.NormalizeTrainNumber(rawNumber)

	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:malformed-request",
			Title:  "Malformed Request",
			Status: http.StatusBadRequest,
			Detail: "date must be in YYYY-MM-DD format.",
		})
		return
	}

	trips, err := h.hafas.SearchTrips(r.Context(), normalized, 5)
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:upstream-unavailable",
			Title:  "Service Unavailable",
			Status: http.StatusServiceUnavailable,
			Detail: "Train data is temporarily unavailable.",
		})
		return
	}

	filtered := hafas.FilterTripsByDate(trips, date)
	if len(filtered) == 0 {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:train-not-found",
			Title:  "Train Not Found",
			Status: http.StatusNotFound,
			Detail: normalized + " does not operate on " + date + ".",
		})
		return
	}

	resp := hafas.MapTripToTrainResponse(filtered[0], date)
	writeJSON(w, http.StatusOK, resp)
}
