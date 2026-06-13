package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// AlternativesHandler handles GET and POST /v1/journeys/{id}/alternatives.
type AlternativesHandler struct {
	store          journey.Store
	engine         routing.Engine
	triggerTimeout time.Duration
	serverCtx      context.Context
}

func NewAlternativesHandler(store journey.Store, engine routing.Engine, triggerTimeout time.Duration, serverCtx context.Context) *AlternativesHandler {
	return &AlternativesHandler{store: store, engine: engine, triggerTimeout: triggerTimeout, serverCtx: serverCtx}
}

type alternativesResponse struct {
	Data       []journey.Alternative `json:"data"`
	TotalCount int                   `json:"totalCount"`
}

// Get returns the cached alternatives list. ETag-cached.
func (h *AlternativesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	limit := 5
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, _ := strconv.Atoi(l); v >= 1 && v <= 20 {
			limit = v
		}
	}

	if _, err := h.store.Get(r.Context(), id); errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}

	alts, altsETag, err := h.store.GetAlternatives(r.Context(), id)
	if err != nil {
		alts = []journey.Alternative{}
		altsETag = fmt.Sprintf("%s:alts:0", id)
	}

	etagHeader := `"` + altsETag + `"`
	w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")

	if r.Header.Get("If-None-Match") == etagHeader {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	total := len(alts)
	if len(alts) > limit {
		alts = alts[:limit]
	}
	if alts == nil {
		alts = []journey.Alternative{}
	}

	w.Header().Set("ETag", etagHeader)
	writeJSON(w, http.StatusOK, alternativesResponse{Data: alts, TotalCount: total})
}

// Trigger kicks off a fresh alternatives recomputation. Returns 202 immediately.
func (h *AlternativesHandler) Trigger(w http.ResponseWriter, r *http.Request) {
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

	go func() {
		ctx, cancel := context.WithTimeout(h.serverCtx, h.triggerTimeout)
		defer cancel()
		result, err := h.engine.Route(ctx, routing.RoutingRequest{
			TrainNumber:    j.TrainNumber,
			ToStationID:    j.Destination.ID,
			ToStationName:  j.Destination.Name,
			DepartureAfter: time.Now(),
			Filters:        j.Filters,
			InstallID:      j.InstallID,
		})
		if err != nil || len(result.Alternatives) == 0 {
			return
		}
		h.store.UpdateAlternatives(ctx, id, result.Alternatives)
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":   "computing",
		"pollPath": "/v1/journeys/" + id + "/alternatives",
	})
}
