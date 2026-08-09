package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HealthHandler serves GET /health (liveness) and GET /readyz (readiness).
type HealthHandler struct {
	db           *pgxpool.Pool
	rdb          *redis.Client
	hafasBaseURL string
}

func NewHealthHandler(db *pgxpool.Pool, rdb *redis.Client, hafasBaseURL string) *HealthHandler {
	return &HealthHandler{db: db, rdb: rdb, hafasBaseURL: hafasBaseURL}
}

// Liveness handles GET /health. Always returns 200 while the process is running.
func (h *HealthHandler) Liveness(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type readinessResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// Readiness handles GET /readyz. Returns 200 when all dependencies respond within 3 s,
// 503 when Redis or Postgres is unreachable (HAFAS failure downgrades to "degraded" only).
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
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			h.hafasBaseURL+"/locations?query=test&results=1&stops=true&addresses=false&poi=false", nil)
		if err != nil {
			checks["hafas"] = "error"
		} else {
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				checks["hafas"] = "error"
			} else {
				// Drain (bounded — this is a hot probe path) before Close so the
				// keep-alive connection is reusable.
				io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10)) //nolint:errcheck
				resp.Body.Close()
				if resp.StatusCode >= 500 {
					checks["hafas"] = "error"
				}
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
