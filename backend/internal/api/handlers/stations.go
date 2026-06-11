package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

// StationsHandler handles GET /v1/stations.
type StationsHandler struct {
	hafas *hafas.Client
	redis *redis.Client
}

func NewStationsHandler(h *hafas.Client, rdb *redis.Client) *StationsHandler {
	return &StationsHandler{hafas: h, redis: rdb}
}

type stationsResponse struct {
	Stations []journey.StationRef `json:"stations"`
}

// Search proxies GET /v1/stations?q=...&limit=... to db.transport.rest with Redis caching.
func (h *StationsHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:malformed-request",
			Title:  "Malformed Request",
			Status: http.StatusBadRequest,
			Detail: "Query parameter 'q' must be at least 2 characters.",
		})
		return
	}

	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v >= 1 && v <= 50 {
			limit = v
		}
	}

	cacheKey := fmt.Sprintf("stations:%s:%d", strings.ToLower(q), limit)

	if h.redis != nil {
		if cached, err := h.redis.Get(r.Context(), cacheKey).Bytes(); err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "public, max-age=300")
			w.WriteHeader(http.StatusOK)
			w.Write(cached)
			return
		}
	}

	// TODO(plan3): coalesce concurrent requests on query+limit cache key
	results, err := h.hafas.SearchStations(r.Context(), q, limit)
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:upstream-unavailable",
			Title:  "Service Unavailable",
			Status: http.StatusServiceUnavailable,
			Detail: "Station search is temporarily unavailable.",
		})
		return
	}

	stations := hafas.MapStations(results)

	body, _ := json.Marshal(stationsResponse{Stations: stations})

	if h.redis != nil {
		cacheCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		h.redis.Set(cacheCtx, cacheKey, body, 5*time.Minute)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}
