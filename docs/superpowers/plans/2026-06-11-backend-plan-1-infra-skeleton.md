# Backend Plan 1 — Infra Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Go backend skeleton — HTTP server, DB connections, migrations, health endpoints — so `docker compose up` works and `/health` returns 200.

**Architecture:** Single Go process with chi router, pgx (Postgres), go-redis (Redis). Config via env vars. SQL migrations run at boot from `backend/migrations/`. Plan 1 wires only `/health` and `/readyz`; all other routes added in Plans 2–4.

**Tech Stack:** Go 1.22, chi v5, pgx v5, go-redis v9, slog (stdlib)

**Subsequent plans:**
- Plan 2: HAFAS client + stations + trains handlers
- Plan 3: Routing engine + journey creation
- Plan 4: Poller + monitoring + metrics + boot recovery

---

## File Map

| Action | Path |
|--------|------|
| Create | `backend/go.mod` |
| Create | `backend/internal/config/config.go` |
| Create | `backend/internal/config/config_test.go` |
| Create | `backend/internal/journey/model.go` |
| Create | `backend/internal/migrate/migrate.go` |
| Create | `backend/internal/migrate/migrate_test.go` |
| Create | `backend/migrations/001_initial.sql` |
| Create | `backend/internal/api/middleware/requestid.go` |
| Create | `backend/internal/api/middleware/requestid_test.go` |
| Create | `backend/internal/api/middleware/logging.go` |
| Create | `backend/internal/api/middleware/cors.go` |
| Create | `backend/internal/api/handlers/health.go` |
| Create | `backend/internal/api/handlers/health_test.go` |
| Create | `backend/internal/api/router.go` |
| Create | `backend/cmd/server/main.go` |
| Create | `backend/Dockerfile` |
| Create | `nginx/nginx.conf` |
| Create | `docker-compose.yml` |
| Create | `docker-compose.override.yml` |
| Create | `.env.example` |

---

### Task 1: Go module + directory scaffold

**Files:**
- Create: `backend/go.mod`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p backend/cmd/server \
         backend/internal/config \
         backend/internal/journey \
         backend/internal/migrate \
         backend/internal/api/handlers \
         backend/internal/api/middleware \
         backend/internal/hafas \
         backend/internal/routing \
         backend/migrations \
         nginx
```

- [ ] **Step 2: Write go.mod**

```
module github.com/verspaetungsbegleiter/backend

go 1.22

require (
    github.com/go-chi/chi/v5 v5.2.1
    github.com/jackc/pgx/v5 v5.7.2
    github.com/redis/go-redis/v9 v9.7.3
)
```

- [ ] **Step 3: Download deps + generate go.sum**

Run from `backend/`:
```bash
go mod tidy
```

Expected: `go.sum` created, no errors.

- [ ] **Step 4: Verify module compiles (empty main)**

Create `backend/cmd/server/main.go` temporarily:
```go
package main

func main() {}
```

Run:
```bash
cd backend && go build ./...
```

Expected: exits 0, no output.

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/cmd/server/main.go
git commit -m "feat(backend): initialize Go module"
```

---

### Task 2: Config package

**Files:**
- Create: `backend/internal/config/config.go`
- Create: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/config/config_test.go
package config_test

import (
	"os"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	os.Clearenv()
	cfg := config.Load()

	if cfg.Port != "8080" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "8080")
	}
	if cfg.HAFASWorkerPoolSize != 50 {
		t.Errorf("HAFASWorkerPoolSize: got %d, want 50", cfg.HAFASWorkerPoolSize)
	}
	if cfg.HAFASRequestTimeout != 8*time.Second {
		t.Errorf("HAFASRequestTimeout: got %v, want 8s", cfg.HAFASRequestTimeout)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("HAFAS_WORKER_POOL_SIZE", "100")
	t.Cleanup(func() {
		os.Unsetenv("PORT")
		os.Unsetenv("HAFAS_WORKER_POOL_SIZE")
	})

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "9090")
	}
	if cfg.HAFASWorkerPoolSize != 100 {
		t.Errorf("HAFASWorkerPoolSize: got %d, want 100", cfg.HAFASWorkerPoolSize)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/config/... -v
```

Expected: `FAIL` — package not found.

- [ ] **Step 3: Write implementation**

```go
// backend/internal/config/config.go
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port                 string
	RedisURL             string
	DatabaseURL          string
	HAFASBaseURL         string
	HAFASWorkerPoolSize  int
	MaxActiveJourneys    int
	JourneyTTLHours      int
	RateLimitPerInstall  int
	RateLimitPerIP       int
	LogLevel             string
	HAFASRequestTimeout  time.Duration
	HAFASQueueDepth      int
	HAFASCBThreshold     int
	HAFASCBProbeInterval time.Duration
	DBMaxOpenConns       int
	DBMaxIdleConns       int
	DBWriteTimeout       time.Duration
	MigrationsDir        string
	CORSAllowedOrigins   []string
}

func Load() Config {
	return Config{
		Port:                 env("PORT", "8080"),
		RedisURL:             env("REDIS_URL", "redis://redis:6379"),
		DatabaseURL:          env("DATABASE_URL", "postgres://vbb:vbb@postgres:5432/vbb"),
		HAFASBaseURL:         env("HAFAS_BASE_URL", "https://v6.db.transport.rest"),
		HAFASWorkerPoolSize:  envInt("HAFAS_WORKER_POOL_SIZE", 50),
		MaxActiveJourneys:    envInt("MAX_ACTIVE_JOURNEYS", 2000),
		JourneyTTLHours:      envInt("JOURNEY_TTL_HOURS", 2),
		RateLimitPerInstall:  envInt("RATE_LIMIT_PER_INSTALL", 60),
		RateLimitPerIP:       envInt("RATE_LIMIT_PER_IP", 30),
		LogLevel:             env("LOG_LEVEL", "INFO"),
		HAFASRequestTimeout:  envDuration("HAFAS_REQUEST_TIMEOUT", 8*time.Second),
		HAFASQueueDepth:      envInt("HAFAS_QUEUE_DEPTH", 200),
		HAFASCBThreshold:     envInt("HAFAS_CB_THRESHOLD", 5),
		HAFASCBProbeInterval: envDuration("HAFAS_CB_PROBE_INTERVAL", 30*time.Second),
		DBMaxOpenConns:       envInt("DB_MAX_OPEN_CONNS", 20),
		DBMaxIdleConns:       envInt("DB_MAX_IDLE_CONNS", 5),
		DBWriteTimeout:       envDuration("DB_WRITE_TIMEOUT", 5*time.Second),
		MigrationsDir:        env("MIGRATIONS_DIR", "./migrations"),
		CORSAllowedOrigins:   envList("CORS_ALLOWED_ORIGINS"),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func envList(key string) []string {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	var out []string
	for _, s := range strings.Split(v, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd backend && go test ./internal/config/... -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/
git commit -m "feat(backend): config package with env var loading"
```

---

### Task 3: Journey model types

**Files:**
- Create: `backend/internal/journey/model.go`

No unit test needed — pure type definitions with no logic. The `SafetyThresholdMinutes` function is the only testable logic; it's trivially verified by the routing scorer tests in Plan 3.

- [ ] **Step 1: Write model types**

```go
// backend/internal/journey/model.go
package journey

import (
	"fmt"
	"time"
)

type Status string

const (
	StatusOK       Status = "ok"
	StatusCritical Status = "critical"
	StatusFailed   Status = "failed"
)

type DataConfidence string

const (
	DataConfidenceHigh        DataConfidence = "high"
	DataConfidenceLow         DataConfidence = "low"
	DataConfidenceUnavailable DataConfidence = "unavailable"
)

type NextStepType string

const (
	NextStepRide      NextStepType = "ride"
	NextStepTransfer  NextStepType = "transfer"
	NextStepDisembark NextStepType = "disembark"
)

type LegStatus string

const (
	LegStatusPlanned   LegStatus = "planned"
	LegStatusRunning   LegStatus = "running"
	LegStatusDelayed   LegStatus = "delayed"
	LegStatusCancelled LegStatus = "cancelled"
)

type SafetyLevel string

const (
	SafetyLevelAggressive SafetyLevel = "aggressive"
	SafetyLevelNormal     SafetyLevel = "normal"
	SafetyLevelCautious   SafetyLevel = "cautious"
)

// SafetyThresholdMinutes returns the minimum transfer buffer for a given safety level.
func SafetyThresholdMinutes(level SafetyLevel) int {
	switch level {
	case SafetyLevelAggressive:
		return 3
	case SafetyLevelCautious:
		return 15
	default:
		return 8
	}
}

type Plausibility struct {
	OnTrainConfidence string  `json:"onTrainConfidence"` // high | low | unknown
	Reason            *string `json:"reason"`
}

type StationRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type NextStep struct {
	Type          NextStepType `json:"type"`
	StationName   string       `json:"stationName"`
	StationID     string       `json:"stationId"`
	TrainNumber   *string      `json:"trainNumber"`
	Platform      *string      `json:"platform"`
	DepartureTime *time.Time   `json:"departureTime"`
	BufferMinutes *int         `json:"bufferMinutes"`
}

type Summary struct {
	FromStation                   string         `json:"fromStation"`
	FromTime                      time.Time      `json:"fromTime"`
	ToStation                     string         `json:"toStation"`
	ToTime                        time.Time      `json:"toTime"`
	ETA                           time.Time      `json:"eta"`
	TimeGainVsOriginalMinutes     *int           `json:"timeGainVsOriginalMinutes"`
	TimeGainVsCurrentRouteMinutes *int           `json:"timeGainVsCurrentRouteMinutes"`
	MinTransferBufferMinutes      *int           `json:"minTransferBufferMinutes"`
	Status                        Status         `json:"status"`
	CriticalTransfer              bool           `json:"criticalTransfer"`
	AlternativeAvailable          bool           `json:"alternativeAvailable"`
	DataConfidence                DataConfidence `json:"dataConfidence"`
	NextStep                      *NextStep      `json:"nextStep"`
	DataFetchedAt                 time.Time      `json:"dataFetchedAt"`
	LastUpdatedAt                 time.Time      `json:"lastUpdatedAt"`
}

type Stop struct {
	StationID             string     `json:"stationId"`
	StationName           string     `json:"stationName"`
	ArrivalTimePlanned    time.Time  `json:"arrivalTimePlanned"`
	ArrivalTimeActual     *time.Time `json:"arrivalTimeActual"`
	DepartureTimePlanned  *time.Time `json:"departureTimePlanned"`
	DepartureTimeActual   *time.Time `json:"departureTimeActual"`
	DelayMinutes          *int       `json:"delayMinutes"`
	PlatformPlanned       *string    `json:"platformPlanned"`
	PlatformActual        *string    `json:"platformActual"`
	TransferBufferMinutes *int       `json:"transferBufferMinutes"`
}

type Leg struct {
	LegID                string     `json:"legId"`
	VehicleNumber        string     `json:"vehicleNumber"`
	LineName             string     `json:"lineName"`
	Operator             string     `json:"operator"`
	DepartureTimePlanned time.Time  `json:"departureTimePlanned"`
	DepartureTimeActual  *time.Time `json:"departureTimeActual"`
	ArrivalTimePlanned   time.Time  `json:"arrivalTimePlanned"`
	ArrivalTimeActual    *time.Time `json:"arrivalTimeActual"`
	DelayMinutes         *int       `json:"delayMinutes"`
	PlatformPlanned      *string    `json:"platformPlanned"`
	PlatformActual       *string    `json:"platformActual"`
	Status               LegStatus  `json:"status"`
	IsWalkingSegment     bool       `json:"isWalkingSegment"`
	Stops                []Stop     `json:"stops"`
	TripID               string     `json:"-"` // used by poller for realtime fetches
}

type Filters struct {
	DBOnly       bool        `json:"dbOnly"`
	MaxTransfers *int        `json:"maxTransfers"`
	SafetyLevel  SafetyLevel `json:"safetyLevel"`
}

type Alternative struct {
	JourneyID string  `json:"journeyId"`
	Summary   Summary `json:"summary"`
	Legs      []Leg   `json:"legs"`
}

type Journey struct {
	ID           string     `json:"journeyId"`
	InstallID    string     `json:"-"`
	TrainNumber  string     `json:"trainNumber"`
	Destination  StationRef `json:"destination"`
	Filters      Filters    `json:"filters"`
	Summary      Summary    `json:"summary"`
	Legs         []Leg      `json:"legs"`
	Stops        []Stop     `json:"stops"`
	ETagEpoch    int64      `json:"-"`
	ETagCounter  int        `json:"-"`
	CreatedAt    time.Time  `json:"-"`
	TerminatedAt *time.Time `json:"-"`
	LastPolledAt *time.Time `json:"-"`
}

// ETag returns the opaque ETag string for conditional GET requests.
func (j *Journey) ETag() string {
	return fmt.Sprintf("%s:%d:%d", j.ID, j.ETagEpoch, j.ETagCounter)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend && go build ./internal/journey/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/journey/model.go
git commit -m "feat(backend): journey domain model types"
```

---

### Task 4: Migration runner + SQL schema

**Files:**
- Create: `backend/internal/migrate/migrate.go`
- Create: `backend/internal/migrate/migrate_test.go`
- Create: `backend/migrations/001_initial.sql`

- [ ] **Step 1: Write SQL migration**

```sql
-- backend/migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS journeys (
    id               TEXT PRIMARY KEY,
    install_id       TEXT NOT NULL,
    train_number     TEXT NOT NULL,
    destination_id   TEXT NOT NULL,
    destination_name TEXT NOT NULL,
    filters_json     JSONB NOT NULL,
    summary_json     JSONB NOT NULL,
    legs_json        JSONB NOT NULL DEFAULT '[]',
    stops_json       JSONB NOT NULL DEFAULT '[]',
    etag_counter     INTEGER NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    terminated_at    TIMESTAMPTZ,
    last_polled_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS journeys_active_idx
    ON journeys (created_at)
    WHERE terminated_at IS NULL;

CREATE INDEX IF NOT EXISTS journeys_install_id_idx
    ON journeys (install_id);
```

- [ ] **Step 2: Write failing test**

```go
// backend/internal/migrate/migrate_test.go
package migrate_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/migrate"
)

func TestListMigrations_OrderedAndFiltered(t *testing.T) {
	dir := t.TempDir()

	// Write files in non-alphabetical order to verify sorting
	os.WriteFile(filepath.Join(dir, "002_second.sql"), []byte("SELECT 2"), 0644)
	os.WriteFile(filepath.Join(dir, "001_first.sql"), []byte("SELECT 1"), 0644)
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("ignore me"), 0644)

	files, err := migrate.ListFiles(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0] != "001_first.sql" {
		t.Errorf("first file: got %q, want %q", files[0], "001_first.sql")
	}
	if files[1] != "002_second.sql" {
		t.Errorf("second file: got %q, want %q", files[1], "002_second.sql")
	}
}
```

- [ ] **Step 3: Run test — expect failure**

```bash
cd backend && go test ./internal/migrate/... -v
```

Expected: `FAIL` — package not found.

- [ ] **Step 4: Write migration runner**

```go
// backend/internal/migrate/migrate.go
package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ListFiles returns SQL filenames in the given directory, sorted alphabetically.
// Exported so it can be tested independently of a live database.
func ListFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// Run applies all pending SQL migrations in dir to db. Safe to call on every boot.
func Run(ctx context.Context, db *pgxpool.Pool, dir string) error {
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name       TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	files, err := ListFiles(dir)
	if err != nil {
		return err
	}

	for _, name := range files {
		var applied bool
		if err := db.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = $1)", name,
		).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}

		sql, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}

		tx, err := db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin %s: %w", name, err)
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("execute %s: %w", name, err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES($1)", name); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", name, err)
		}
		if err = tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", name, err)
		}
	}
	return nil
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
cd backend && go test ./internal/migrate/... -v
```

Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add backend/internal/migrate/ backend/migrations/
git commit -m "feat(backend): migration runner and initial schema"
```

---

### Task 5: Request ID middleware

**Files:**
- Create: `backend/internal/api/middleware/requestid.go`
- Create: `backend/internal/api/middleware/requestid_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/middleware/requestid_test.go
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

func TestRequestID_SetsHeader(t *testing.T) {
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	id := rr.Header().Get("X-Request-Id")
	if id == "" {
		t.Fatal("X-Request-Id header not set")
	}
	if len(id) != 32 {
		t.Errorf("X-Request-Id length: got %d, want 32 hex chars", len(id))
	}
}

func TestRequestID_UniquePerRequest(t *testing.T) {
	var ids [2]string
	i := 0
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ids[i] = middleware.GetRequestID(r.Context())
		i++
	}))

	for range 2 {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}

	if ids[0] == "" || ids[1] == "" {
		t.Fatal("request ID not propagated to context")
	}
	if ids[0] == ids[1] {
		t.Errorf("request IDs should be unique, both are %q", ids[0])
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/middleware/... -v
```

Expected: `FAIL`

- [ ] **Step 3: Write implementation**

```go
// backend/internal/api/middleware/requestid.go
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

type contextKey string

const requestIDKey contextKey = "requestID"

// RequestID injects a UUID-style request ID into context and the X-Request-Id response header.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID retrieves the request ID from ctx. Returns "" if not set.
func GetRequestID(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

func newRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd backend && go test ./internal/api/middleware/... -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/middleware/requestid.go backend/internal/api/middleware/requestid_test.go
git commit -m "feat(backend): request ID middleware"
```

---

### Task 6: Logging + CORS middleware

**Files:**
- Create: `backend/internal/api/middleware/logging.go`
- Create: `backend/internal/api/middleware/cors.go`

No separate tests — logging is output-only and CORS behavior is covered implicitly by integration tests in later plans.

- [ ] **Step 1: Write logging middleware**

```go
// backend/internal/api/middleware/logging.go
package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// Logging logs method, path, status, and duration for every request.
func Logging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &statusWriter{ResponseWriter: w, code: http.StatusOK}
			next.ServeHTTP(rw, r)
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.code,
				"duration_ms", time.Since(start).Milliseconds(),
				"requestId", GetRequestID(r.Context()),
			)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.code = code
	sw.ResponseWriter.WriteHeader(code)
}
```

- [ ] **Step 2: Write CORS middleware**

Only active when `origins` is non-empty. Used in `docker-compose.override.yml` dev mode where the frontend dev server (`:5173`) calls the backend (`:8080`) directly, bypassing nginx.

```go
// backend/internal/api/middleware/cors.go
package middleware

import "net/http"

// CORS adds Access-Control-* headers for allowed origins.
// Pass nil/empty to disable (production default — nginx handles same-origin).
func CORS(origins []string) func(http.Handler) http.Handler {
	if len(origins) == 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers",
					"Content-Type, X-Install-Id, If-None-Match, Idempotency-Key")
				w.Header().Set("Access-Control-Expose-Headers",
					"ETag, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Location")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 3: Verify compiles**

```bash
cd backend && go build ./internal/api/middleware/...
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/api/middleware/logging.go backend/internal/api/middleware/cors.go
git commit -m "feat(backend): logging and CORS middleware"
```

---

### Task 7: Health handlers

**Files:**
- Create: `backend/internal/api/handlers/health.go`
- Create: `backend/internal/api/handlers/health_test.go`

- [ ] **Step 1: Write failing tests**

```go
// backend/internal/api/handlers/health_test.go
package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
)

func TestLiveness_Returns200(t *testing.T) {
	h := handlers.NewHealthHandler(nil, nil, "")
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()

	h.Liveness(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("body.status: got %q, want %q", body["status"], "ok")
	}
}

func TestLiveness_ContentType(t *testing.T) {
	h := handlers.NewHealthHandler(nil, nil, "")
	rr := httptest.NewRecorder()
	h.Liveness(rr, httptest.NewRequest(http.MethodGet, "/health", nil))

	ct := rr.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type: got %q, want %q", ct, "application/json")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -v
```

Expected: `FAIL`

- [ ] **Step 3: Write health handlers**

```go
// backend/internal/api/handlers/health.go
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
	overall := "ok"

	if h.rdb != nil {
		if err := h.rdb.Ping(ctx).Err(); err != nil {
			checks["redis"] = "error"
			overall = "degraded"
		}
	}

	if h.db != nil {
		if _, err := h.db.Exec(ctx, "SELECT 1"); err != nil {
			checks["postgres"] = "error"
			overall = "degraded"
		}
	}

	if h.hafasBaseURL != "" {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
			h.hafasBaseURL+"/stations?query=test&results=1", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode >= 500 {
			checks["hafas"] = "error"
			overall = "degraded"
		}
		if resp != nil {
			resp.Body.Close()
		}
	}

	code := http.StatusOK
	if overall != "ok" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, readinessResponse{Status: overall, Checks: checks})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/handlers/
git commit -m "feat(backend): health and readiness handlers"
```

---

### Task 8: Router

**Files:**
- Create: `backend/internal/api/router.go`

- [ ] **Step 1: Write router**

```go
// backend/internal/api/router.go
package api

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

// Deps holds all handler dependencies. Fields added in Plans 2–4.
type Deps struct {
	Health *handlers.HealthHandler
	Logger *slog.Logger
	CORSOrigins []string
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(mw.RequestID)
	r.Use(mw.Logging(deps.Logger))
	r.Use(mw.CORS(deps.CORSOrigins))
	r.Use(chimw.Recoverer)

	r.Get("/health", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)

	// /v1/ routes added in Plans 2–4
	r.Route("/v1", func(r chi.Router) {})

	return r
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd backend && go build ./internal/api/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/api/router.go
git commit -m "feat(backend): chi router with middleware stack"
```

---

### Task 9: main.go

**Files:**
- Create: `backend/cmd/server/main.go`

- [ ] **Step 1: Write main.go**

```go
// backend/cmd/server/main.go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/migrate"
)

func main() {
	cfg := config.Load()
	logger := newLogger(cfg.LogLevel)

	rdb, err := connectRedis(cfg.RedisURL)
	if err != nil {
		logger.Error("redis connect failed", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	db, err := connectDB(context.Background(), cfg)
	if err != nil {
		logger.Error("postgres connect failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := migrate.Run(context.Background(), db, cfg.MigrationsDir); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations complete")

	router := api.NewRouter(api.Deps{
		Health:      handlers.NewHealthHandler(db, rdb, cfg.HAFASBaseURL),
		Logger:      logger,
		CORSOrigins: cfg.CORSAllowedOrigins,
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan struct{})
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
		sig := <-quit
		logger.Info("shutdown signal received", "signal", sig)

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("shutdown error", "error", err)
		}
		close(done)
	}()

	logger.Info("server starting", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
	<-done
	logger.Info("server stopped")
}

func connectRedis(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	c := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c, c.Ping(ctx).Err()
}

func connectDB(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = int32(cfg.DBMaxOpenConns)
	pcfg.MinConns = int32(cfg.DBMaxIdleConns)

	db, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return db, db.Ping(ctx2)
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "DEBUG":
		l = slog.LevelDebug
	case "WARN":
		l = slog.LevelWarn
	case "ERROR":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
```

- [ ] **Step 2: Build the binary**

```bash
cd backend && go build ./cmd/server/...
```

Expected: exits 0, `server` binary created.

- [ ] **Step 3: Run all tests**

```bash
cd backend && go test ./...
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(backend): main.go with boot, migration, graceful shutdown"
```

---

### Task 10: Dockerfile

**Files:**
- Create: `backend/Dockerfile`

- [ ] **Step 1: Write multi-stage Dockerfile**

```dockerfile
# backend/Dockerfile

# ── dev stage (used by docker-compose.override.yml) ─────────────────────────
FROM golang:1.22-alpine AS dev
WORKDIR /app
RUN apk add --no-cache curl
COPY go.mod go.sum ./
RUN go mod download
CMD ["go", "run", "./cmd/server"]

# ── builder ──────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /bin/server \
    ./cmd/server

# ── production ───────────────────────────────────────────────────────────────
FROM alpine:3.21
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /bin/server ./server
COPY --from=builder /app/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["./server"]
```

- [ ] **Step 2: Build image locally to verify**

```bash
cd backend && docker build -t vbb-backend:dev .
```

Expected: build succeeds, image created.

- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile
git commit -m "feat(backend): multi-stage Dockerfile"
```

---

### Task 11: Nginx config

**Files:**
- Create: `nginx/nginx.conf`

- [ ] **Step 1: Write nginx.conf**

Note: In Plan 1 there is no frontend build yet — the `frontend_build` volume is empty. Nginx will return 404 for `/` until frontend is built. `/health`, `/readyz`, and `/v1/` are proxied to the backend.

```nginx
# nginx/nginx.conf

server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    # Security headers
    # HSTS only activates when TLS terminates upstream; harmless on plain HTTP.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                             always;
    add_header X-Frame-Options           "DENY"                                always;
    add_header Referrer-Policy           "no-referrer"                         always;
    add_header Permissions-Policy        "geolocation=(), camera=(), microphone=()" always;
    add_header Content-Security-Policy
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self'"
        always;

    gzip on;
    gzip_types application/json text/plain application/javascript text/css;
    gzip_min_length 1024;

    # API + health proxied to Go backend
    location /v1/ {
        proxy_pass         http://backend:8080;
        proxy_read_timeout 15s;
        proxy_connect_timeout 5s;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering    off;
    }

    location /health {
        proxy_pass http://backend:8080;
    }

    location /readyz {
        proxy_pass http://backend:8080;
    }

    # /metrics must NOT be exposed through nginx
    location /metrics {
        deny all;
    }

    # SPA fallback (no-cache for index.html — service worker handles caching)
    location / {
        try_files $uri $uri/ /index.html;
        expires -1;
    }

    # Vite content-hashed static assets — immutable cache
    location ~* \.(js|css|woff2|png|svg|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # DDoS-level flood protection (app-level quota enforced in Go middleware)
    limit_req_zone $binary_remote_addr zone=api:10m rate=200r/s;
    location ~ ^/v1/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://backend:8080;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add nginx/nginx.conf
git commit -m "feat(infra): nginx config with security headers and proxy rules"
```

---

### Task 12: docker-compose + .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.override.yml`
- Create: `.env.example`

- [ ] **Step 1: Write docker-compose.yml**

```yaml
# docker-compose.yml
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - frontend_build:/usr/share/nginx/html:ro
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  backend:
    build:
      context: ./backend
      target: production  # uses the final alpine stage
    env_file: .env
    environment:
      - PORT=8080
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgres://vbb:vbb@postgres:5432/vbb
      - MIGRATIONS_DIR=/app/migrations
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: "1.0"

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy volatile-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 300m

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vbb
      POSTGRES_USER: vbb
      POSTGRES_PASSWORD: vbb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vbb"]
      interval: 5s
      timeout: 3s
      retries: 10
    deploy:
      resources:
        limits:
          memory: 256m

volumes:
  postgres_data:
  frontend_build:
```

- [ ] **Step 2: Write docker-compose.override.yml**

```yaml
# docker-compose.override.yml
# Local development overrides — hot reload, exposed ports, no resource limits.
# Do NOT commit secrets; use .env for sensitive values.

services:
  backend:
    build:
      context: ./backend
      target: dev
    volumes:
      - ./backend:/app:cached
    ports: ["8080:8080"]
    environment:
      - LOG_LEVEL=DEBUG
      - CORS_ALLOWED_ORIGINS=http://localhost:5173
    deploy:
      resources: {}

  postgres:
    ports: ["5432:5432"]
```

- [ ] **Step 3: Write .env.example**

```bash
# .env.example — copy to .env and fill in values
# Do NOT commit .env

# Go backend
PORT=8080
LOG_LEVEL=INFO
HAFAS_BASE_URL=https://v6.db.transport.rest
HAFAS_WORKER_POOL_SIZE=50
HAFAS_QUEUE_DEPTH=200
HAFAS_REQUEST_TIMEOUT=8s
HAFAS_CB_THRESHOLD=5
HAFAS_CB_PROBE_INTERVAL=30s
MAX_ACTIVE_JOURNEYS=2000
JOURNEY_TTL_HOURS=2
RATE_LIMIT_PER_INSTALL=60
RATE_LIMIT_PER_IP=30
DB_MAX_OPEN_CONNS=20
DB_MAX_IDLE_CONNS=5
DB_WRITE_TIMEOUT=5s
MIGRATIONS_DIR=/app/migrations

# Dev only — comma-separated allowed CORS origins (empty = disabled in prod)
# CORS_ALLOWED_ORIGINS=http://localhost:5173
```

- [ ] **Step 4: Add .env to .gitignore**

Check `backend/` or root `.gitignore`. Add if not present:

```bash
echo ".env" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-compose.override.yml .env.example .gitignore nginx/nginx.conf
git commit -m "feat(infra): docker-compose, nginx config, .env.example"
```

---

### Task 13: Smoke test — `docker compose up`

No files created. Manual verification.

- [ ] **Step 1: Copy env file**

```bash
cp .env.example .env
```

- [ ] **Step 2: Start the stack**

```bash
docker compose up --build -d
```

Expected: all 4 services start (nginx, backend, redis, postgres). No exit codes.

- [ ] **Step 3: Verify liveness**

```bash
curl -s http://localhost/health
```

Expected:
```json
{"status":"ok"}
```

- [ ] **Step 4: Verify readiness**

```bash
curl -s http://localhost/readyz
```

Expected:
```json
{"status":"ok","checks":{"hafas":"ok","postgres":"ok","redis":"ok"}}
```

If `hafas` is `"error"`, db.transport.rest may be temporarily unavailable — redis and postgres must both be `"ok"`.

- [ ] **Step 5: Verify X-Request-Id header present**

```bash
curl -sI http://localhost/health | grep X-Request-Id
```

Expected: `X-Request-Id: <32-char hex string>`

- [ ] **Step 6: Verify /metrics is blocked**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost/metrics
```

Expected: `403`

- [ ] **Step 7: Stop stack**

```bash
docker compose down
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(backend): Plan 1 complete — infra skeleton with health endpoints"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered |
|-------------|---------|
| `GET /health` → 200 `{"status":"ok"}` | ✓ Task 7 |
| `GET /readyz` → 200/503 with checks | ✓ Task 7 |
| `X-Request-Id` on all responses | ✓ Task 5 |
| JSON structured logging to stdout | ✓ Task 6 |
| SQL migrations auto-run at boot | ✓ Task 4 + Task 9 |
| `docker compose up` works | ✓ Task 12 + 13 |
| `.env.example` committed | ✓ Task 12 |
| Redis `volatile-lru` eviction | ✓ docker-compose.yml |
| nginx security headers + CSP | ✓ Task 11 |
| `/metrics` blocked via nginx | ✓ Task 11 |
| `journeys` table with indexes | ✓ Task 4 (SQL migration) |
| CORS for dev (override.yml) | ✓ Task 6 + 12 |
| Per-install + per-IP rate limit env vars | ✓ config (enforced in Plan 2) |
| Graceful shutdown (15s drain) | ✓ Task 9 |

**Not in Plan 1 (deferred):**
- `/v1/*` routes → Plans 2–4
- Prometheus metrics → Plan 4
- Rate limiting middleware → Plan 2
- Boot recovery (rehydrate Redis) → Plan 4
- Poller goroutines → Plan 4

**Placeholder scan:** None found. All code blocks are complete and compilable.

**Type consistency:** `Journey`, `Summary`, `Leg`, `Stop`, `StationRef`, `Alternative` defined once in `model.go` and referenced consistently throughout.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-11-backend-plan-1-infra-skeleton.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans

Which approach?
