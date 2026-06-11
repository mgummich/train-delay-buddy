package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type HealthHandler struct {
	db           *pgxpool.Pool
	rdb          *redis.Client
	hafasBaseURL string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, hafasBaseURL string) *HealthHandler {
	return &HealthHandler{db: db, rdb: rdb, hafasBaseURL: hafasBaseURL}
}

func (h *HealthHandler) Liveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type readinessResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

func (h *HealthHandler) Readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	checks := map[string]string{
		"redis":    "ok",
		"postgres": "ok",
		"hafas":    "ok",
	}
	coreDegraded := false

	if h.rdb != nil {
		if err := h.rdb.Ping(ctx).Err(); err != nil {
			checks["redis"] = "error"
			coreDegraded = true
		}
	}

	if h.db != nil {
		if _, err := h.db.Exec(ctx, "SELECT 1"); err != nil {
			checks["postgres"] = "error"
			coreDegraded = true
		}
	}

	if h.hafasBaseURL != "" {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			h.hafasBaseURL+"/stations?query=test&results=1", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			checks["hafas"] = "error"
		} else {
			resp.Body.Close()
			if resp.StatusCode >= 500 {
				checks["hafas"] = "error"
			}
		}
	}

	overall := "ok"
	if coreDegraded || checks["hafas"] == "error" {
		overall = "degraded"
	}

	code := http.StatusOK
	if coreDegraded {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, readinessResponse{Status: overall, Checks: checks})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
