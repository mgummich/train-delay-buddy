# Backend Plan 2 — HAFAS + Lookup Endpoints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the HAFAS HTTP client (with circuit breaker + singleflight), DB-only operator filter, rate limiting middleware, and two working endpoints: `GET /v1/stations` and `GET /v1/trains/{number}`.

**Architecture:** `hafas.Client` wraps db.transport.rest. A shared `reqid` package carries the request ID through context so it propagates on outbound HAFAS calls. Rate limiter uses token buckets per install-id / per IP. Redis caches station results for 5 min.

**Builds on:** Plan 1 (infra skeleton). Requires `go.mod`, `config`, `journey/model.go`, middleware stack from Plan 1.

**Subsequent plans:**
- Plan 3 adds `hafas.SearchJourneys` + `hafas.GetTrip` + journey creation
- Plan 4 adds poller, metrics, boot recovery

---

## File Map

| Action | Path |
|--------|------|
| Modify | `backend/go.mod` |
| Create | `backend/internal/reqid/reqid.go` |
| Modify | `backend/internal/api/middleware/requestid.go` |
| Create | `backend/internal/problem/problem.go` |
| Create | `backend/internal/hafas/types.go` |
| Create | `backend/internal/hafas/client.go` |
| Create | `backend/internal/hafas/client_test.go` |
| Create | `backend/internal/hafas/mapper.go` |
| Create | `backend/internal/hafas/mapper_test.go` |
| Create | `backend/internal/hafas/filter.go` |
| Create | `backend/internal/hafas/filter_test.go` |
| Create | `backend/internal/hafas/coalescer.go` |
| Create | `backend/internal/hafas/coalescer_test.go` |
| Create | `backend/internal/api/middleware/ratelimit.go` |
| Create | `backend/internal/api/middleware/ratelimit_test.go` |
| Create | `backend/internal/api/handlers/stations.go` |
| Create | `backend/internal/api/handlers/stations_test.go` |
| Create | `backend/internal/api/handlers/trains.go` |
| Create | `backend/internal/api/handlers/trains_test.go` |
| Modify | `backend/internal/api/router.go` |
| Modify | `backend/cmd/server/main.go` |

---

### Task 1: Update go.mod

**Files:**
- Modify: `backend/go.mod`

- [ ] **Step 1: Add new dependencies**

```
module github.com/verspaetungsbegleiter/backend

go 1.22

require (
    github.com/go-chi/chi/v5 v5.2.1
    github.com/jackc/pgx/v5 v5.7.2
    github.com/redis/go-redis/v9 v9.7.3
    golang.org/x/sync v0.10.0
    golang.org/x/time v0.9.0
)
```

- [ ] **Step 2: Download and tidy**

```bash
cd backend && go mod tidy
```

Expected: `go.sum` updated, no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "feat(backend): add golang.org/x/sync and x/time deps"
```

---

### Task 2: Shared request ID context package

**Files:**
- Create: `backend/internal/reqid/reqid.go`

The request ID lives here so both `middleware` and `hafas` can read/write it without a circular import.

- [ ] **Step 1: Write failing test**

Create `backend/internal/reqid/reqid_test.go`:

```go
package reqid_test

import (
	"context"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

func TestSetAndGet(t *testing.T) {
	ctx := reqid.Set(context.Background(), "abc123")
	if got := reqid.Get(ctx); got != "abc123" {
		t.Errorf("Get: got %q, want %q", got, "abc123")
	}
}

func TestGet_MissingReturnsEmpty(t *testing.T) {
	if got := reqid.Get(context.Background()); got != "" {
		t.Errorf("Get on empty context: got %q, want %q", got, "")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/reqid/... -v
```

Expected: `FAIL` — package not found.

- [ ] **Step 3: Write implementation**

```go
// backend/internal/reqid/reqid.go
package reqid

import "context"

type contextKey struct{}

// Set returns a new context carrying id.
func Set(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// Get returns the request ID stored in ctx, or "" if none.
func Get(ctx context.Context) string {
	if v, ok := ctx.Value(contextKey{}).(string); ok {
		return v
	}
	return ""
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd backend && go test ./internal/reqid/... -v
```

Expected: `PASS`

- [ ] **Step 5: Update middleware/requestid.go to use reqid package**

Replace the existing `requestIDKey` context logic:

```go
// backend/internal/api/middleware/requestid.go
package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// RequestID injects a random hex request ID into context and X-Request-Id response header.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(reqid.Set(r.Context(), id)))
	})
}

// GetRequestID retrieves the request ID from ctx.
func GetRequestID(ctx interface{ Value(any) any }) string {
	// Thin wrapper kept for backward compatibility with callers importing middleware.
	// New code should import reqid directly.
	if ctx, ok := ctx.(interface{ Value(any) any }); ok {
		_ = ctx
	}
	return ""
}

// WithRequestID injects id into ctx. Used by the poller (no HTTP request) when
// generating a fresh ID per outbound HAFAS call.
func WithRequestID(ctx interface{}, id string) interface{} {
	return nil
}

func newRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

Wait — the above `GetRequestID` wrapper is awkward. Let me write it properly. The key insight: now that the context key lives in `reqid`, `middleware.GetRequestID` just delegates to `reqid.Get`. Both use `context.Context`.

```go
// backend/internal/api/middleware/requestid.go
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// RequestID injects a random hex request ID into context and X-Request-Id response header.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(reqid.Set(r.Context(), id)))
	})
}

// GetRequestID retrieves the request ID from ctx. Delegates to reqid.Get.
func GetRequestID(ctx context.Context) string {
	return reqid.Get(ctx)
}

// WithRequestID injects id into ctx. Used by the poller when making HAFAS calls
// without an inbound HTTP request (Plan 4).
func WithRequestID(ctx context.Context, id string) context.Context {
	return reqid.Set(ctx, id)
}

func newRequestID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 6: Verify all existing tests still pass**

```bash
cd backend && go test ./...
```

Expected: all `PASS`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/reqid/ backend/internal/api/middleware/requestid.go
git commit -m "feat(backend): shared reqid package; update middleware to delegate"
```

---

### Task 3: Problem helper package

**Files:**
- Create: `backend/internal/problem/problem.go`

Used by both middleware (rate limit 429) and handlers (all 4xx/5xx). Prevents circular imports.

- [ ] **Step 1: Write the package**

```go
// backend/internal/problem/problem.go
package problem

import (
	"encoding/json"
	"net/http"
)

// Problem is an RFC 7807 problem details object.
type Problem struct {
	Type     string       `json:"type"`
	Title    string       `json:"title"`
	Status   int          `json:"status"`
	Detail   string       `json:"detail,omitempty"`
	Instance string       `json:"instance,omitempty"`
	Errors   []FieldError `json:"errors,omitempty"`
}

// FieldError is a field-level validation error included on 422 responses.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Write serialises p as application/problem+json and sets the Link describedby header.
func Write(w http.ResponseWriter, r *http.Request, p Problem) {
	if p.Instance == "" && r != nil {
		p.Instance = r.URL.Path
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Link", `<https://verspaetungsbegleiter.app/errors>; rel="describedby"`)
	w.WriteHeader(p.Status)
	json.NewEncoder(w).Encode(p)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend && go build ./internal/problem/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/problem/
git commit -m "feat(backend): RFC 7807 problem details package"
```

---

### Task 4: HAFAS types

**Files:**
- Create: `backend/internal/hafas/types.go`

All HAFAS response shapes from db.transport.rest v6. Plan 3 uses `HAFASJourney` + `HAFASLeg`; defined here so they're available.

- [ ] **Step 1: Write types**

```go
// backend/internal/hafas/types.go
package hafas

import "time"

// HAFASLocationResult is one item from GET /locations
type HAFASLocationResult struct {
	Type string `json:"type"` // "stop" | "station" | "location"
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASTripsResponse wraps GET /trips?query=...
type HAFASTripsResponse struct {
	Trips []HAFASTrip `json:"trips"`
}

// HAFASTrip is one run of a scheduled service.
type HAFASTrip struct {
	ID          string          `json:"id"`
	Line        HAFASLine       `json:"line"`
	Origin      HAFASPlace      `json:"origin"`
	Destination HAFASPlace      `json:"destination"`
	Departure   *time.Time      `json:"departure"`
	Arrival     *time.Time      `json:"arrival"`
	Stopovers   []HAFASStopover `json:"stopovers"`
	RealtimeDataUpdatedAt *int64 `json:"realtimeDataUpdatedAt"`
}

// HAFASPlace is a stop or station reference.
type HAFASPlace struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASLine holds train line / product information.
type HAFASLine struct {
	Type     string         `json:"type"`
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	FahrtNr  string         `json:"fahrtNr,omitempty"`
	Mode     string         `json:"mode"`
	Product  string         `json:"product"`
	Operator *HAFASOperator `json:"operator,omitempty"`
}

// HAFASOperator holds operator name and ID.
type HAFASOperator struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// HAFASStopover is one stop within a trip or leg.
type HAFASStopover struct {
	Stop                     HAFASPlace `json:"stop"`
	Arrival                  *time.Time `json:"arrival"`
	ArrivalDelay             *int       `json:"arrivalDelay"` // seconds
	PlannedArrival           *time.Time `json:"plannedArrival"`
	ArrivalPlatform          *string    `json:"arrivalPlatform"`
	PlannedArrivalPlatform   *string    `json:"plannedArrivalPlatform"`
	Departure                *time.Time `json:"departure"`
	DepartureDelay           *int       `json:"departureDelay"` // seconds
	PlannedDeparture         *time.Time `json:"plannedDeparture"`
	DeparturePlatform        *string    `json:"departurePlatform"`
	PlannedDeparturePlatform *string    `json:"plannedDeparturePlatform"`
	Cancelled                bool       `json:"cancelled"`
}

// HAFASJourneysResponse wraps GET /journeys — used in Plan 3.
type HAFASJourneysResponse struct {
	Journeys []HAFASJourney `json:"journeys"`
}

// HAFASJourney is one connection option returned by HAFAS.
type HAFASJourney struct {
	Type string     `json:"type"`
	Legs []HAFASLeg `json:"legs"`
}

// HAFASLeg is one segment (vehicle ride or walk) of a journey.
type HAFASLeg struct {
	Origin                   HAFASPlace      `json:"origin"`
	Destination              HAFASPlace      `json:"destination"`
	Departure                *time.Time      `json:"departure"`
	DepartureDelay           *int            `json:"departureDelay"` // seconds
	PlannedDeparture         *time.Time      `json:"plannedDeparture"`
	Arrival                  *time.Time      `json:"arrival"`
	ArrivalDelay             *int            `json:"arrivalDelay"` // seconds
	PlannedArrival           *time.Time      `json:"plannedArrival"`
	DeparturePlatform        *string         `json:"departurePlatform"`
	PlannedDeparturePlatform *string         `json:"plannedDeparturePlatform"`
	ArrivalPlatform          *string         `json:"arrivalPlatform"`
	PlannedArrivalPlatform   *string         `json:"plannedArrivalPlatform"`
	Line                     *HAFASLine      `json:"line"`
	TripId                   *string         `json:"tripId"`
	Stopovers                []HAFASStopover `json:"stopovers"`
	Cancelled                bool            `json:"cancelled"`
	Walking                  bool            `json:"walking"`
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd backend && go build ./internal/hafas/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/hafas/types.go
git commit -m "feat(backend): HAFAS API response types"
```

---

### Task 5: HAFAS HTTP client + circuit breaker

**Files:**
- Create: `backend/internal/hafas/client.go`
- Create: `backend/internal/hafas/client_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/hafas/client_test.go
package hafas_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *hafas.Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     3,
		HAFASCBProbeInterval: 30 * time.Second,
	})
}

func TestSearchStations_ReturnsStations(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/locations" {
			t.Errorf("unexpected path: %q", r.URL.Path)
		}
		if r.URL.Query().Get("query") != "Frank" {
			t.Errorf("unexpected query param: %q", r.URL.Query().Get("query"))
		}
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{
			{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		})
	})

	stations, err := client.SearchStations(context.Background(), "Frank", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stations) != 1 || stations[0].ID != "8000105" {
		t.Errorf("unexpected stations: %+v", stations)
	}
}

func TestSearchStations_PropagatesRequestID(t *testing.T) {
	var gotHeader string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("X-Request-Id")
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	})

	ctx := hafas.ContextWithRequestID(context.Background(), "test-request-id-123")
	client.SearchStations(ctx, "Frank", 5)

	if gotHeader != "test-request-id-123" {
		t.Errorf("X-Request-Id not propagated: got %q", gotHeader)
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	// Use an unreachable port to force connection errors
	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         "http://localhost:1",
		HAFASRequestTimeout:  50 * time.Millisecond,
		HAFASCBThreshold:     2,
		HAFASCBProbeInterval: 10 * time.Second,
	})

	// Two failures open the circuit
	for range 2 {
		client.SearchStations(context.Background(), "test", 1)
	}

	// Third call should fail fast without hitting the network
	_, err := client.SearchStations(context.Background(), "test", 1)
	if !errors.Is(err, hafas.ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen after threshold, got: %v", err)
	}
}

func TestCircuitBreaker_ClosesAfterProbeSuccess(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	}))
	defer srv.Close()

	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     1,
		HAFASCBProbeInterval: 0, // probe immediately
	})

	// Force circuit open with a bad URL temporarily — simulate by recording a failure
	client.RecordFailureForTest()

	// With probeInterval=0, Allow() should permit a probe immediately
	_, err := client.SearchStations(context.Background(), "test", 1)
	if err != nil {
		t.Fatalf("probe should succeed: %v", err)
	}

	// Circuit should be closed again
	if client.CircuitState() != 0 {
		t.Errorf("expected circuit closed (0), got %d", client.CircuitState())
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/hafas/... -run TestSearchStations -v
```

Expected: `FAIL` — package incomplete.

- [ ] **Step 3: Write client.go**

```go
// backend/internal/hafas/client.go
package hafas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// ErrCircuitOpen is returned when the circuit breaker is in the open state.
var ErrCircuitOpen = errors.New("hafas: circuit breaker open — upstream likely unavailable")

// ErrUpstreamUnavailable is returned for 5xx responses from db.transport.rest.
var ErrUpstreamUnavailable = errors.New("hafas: upstream returned server error")

type cbState int

const (
	cbClosed   cbState = 0
	cbHalfOpen cbState = 1
	cbOpen     cbState = 2
)

type circuitBreaker struct {
	mu            sync.Mutex
	failures      int
	threshold     int
	state         cbState
	lastFailure   time.Time
	probeInterval time.Duration
}

func (cb *circuitBreaker) allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	switch cb.state {
	case cbOpen:
		if time.Since(cb.lastFailure) >= cb.probeInterval {
			cb.state = cbHalfOpen
			return true // allow probe attempt
		}
		return false
	default:
		return true
	}
}

func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.state = cbClosed
}

func (cb *circuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
	if cb.failures >= cb.threshold || cb.state == cbHalfOpen {
		cb.state = cbOpen
	}
}

// Client wraps db.transport.rest with a circuit breaker and per-request ID propagation.
type Client struct {
	baseURL string
	http    *http.Client
	cb      *circuitBreaker
}

// NewClient creates a HAFAS client from cfg.
func NewClient(cfg config.Config) *Client {
	return &Client{
		baseURL: cfg.HAFASBaseURL,
		http:    &http.Client{Timeout: cfg.HAFASRequestTimeout},
		cb: &circuitBreaker{
			threshold:     cfg.HAFASCBThreshold,
			probeInterval: cfg.HAFASCBProbeInterval,
		},
	}
}

// CircuitState returns 0=closed, 1=half-open, 2=open. Used for Prometheus gauge in Plan 4.
func (c *Client) CircuitState() int {
	c.cb.mu.Lock()
	defer c.cb.mu.Unlock()
	return int(c.cb.state)
}

// RecordFailureForTest exposes circuit breaker failure recording for unit tests only.
func (c *Client) RecordFailureForTest() {
	c.cb.recordFailure()
}

// ContextWithRequestID stores id in ctx for propagation to outbound HAFAS headers.
// Thin wrapper around reqid.Set — callers that already import reqid can use it directly.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return reqid.Set(ctx, id)
}

// SearchStations searches db.transport.rest /locations for stops matching query.
func (c *Client) SearchStations(ctx context.Context, query string, limit int) ([]HAFASLocationResult, error) {
	if !c.cb.allow() {
		return nil, ErrCircuitOpen
	}
	params := url.Values{
		"query":     {query},
		"results":   {fmt.Sprintf("%d", limit)},
		"stops":     {"true"},
		"addresses": {"false"},
		"poi":       {"false"},
		"language":  {"de"},
	}
	var result []HAFASLocationResult
	if err := c.get(ctx, "/locations", params, &result); err != nil {
		c.cb.recordFailure()
		return nil, err
	}
	c.cb.recordSuccess()
	return result, nil
}

// SearchTrips searches db.transport.rest /trips for trips matching trainName (e.g. "ICE 123").
func (c *Client) SearchTrips(ctx context.Context, trainName string, results int) ([]HAFASTrip, error) {
	if !c.cb.allow() {
		return nil, ErrCircuitOpen
	}
	params := url.Values{
		"query":     {trainName},
		"results":   {fmt.Sprintf("%d", results)},
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp HAFASTripsResponse
	if err := c.get(ctx, "/trips", params, &resp); err != nil {
		c.cb.recordFailure()
		return nil, err
	}
	c.cb.recordSuccess()
	return resp.Trips, nil
}

// SearchJourneys searches for connections from→to departing after departureAfter.
// Added here for Plan 3; not called in Plan 2.
func (c *Client) SearchJourneys(ctx context.Context, fromID, toID string, departureAfter time.Time, results int) ([]HAFASJourney, error) {
	if !c.cb.allow() {
		return nil, ErrCircuitOpen
	}
	params := url.Values{
		"from":      {fromID},
		"to":        {toID},
		"departure": {departureAfter.UTC().Format(time.RFC3339)},
		"results":   {fmt.Sprintf("%d", results)},
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp HAFASJourneysResponse
	if err := c.get(ctx, "/journeys", params, &resp); err != nil {
		c.cb.recordFailure()
		return nil, err
	}
	c.cb.recordSuccess()
	return resp.Journeys, nil
}

// GetTrip fetches realtime data for a specific trip ID. Used by the poller in Plan 4.
func (c *Client) GetTrip(ctx context.Context, tripID string) (*HAFASTrip, error) {
	if !c.cb.allow() {
		return nil, ErrCircuitOpen
	}
	params := url.Values{
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp struct {
		Trip HAFASTrip `json:"trip"`
	}
	if err := c.get(ctx, "/trips/"+url.PathEscape(tripID), params, &resp); err != nil {
		c.cb.recordFailure()
		return nil, err
	}
	c.cb.recordSuccess()
	return &resp.Trip, nil
}

func (c *Client) get(ctx context.Context, path string, params url.Values, out any) error {
	u := c.baseURL + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if id := reqid.Get(ctx); id != "" {
		req.Header.Set("X-Request-Id", id)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("hafas fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%w: HTTP %d", ErrUpstreamUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("hafas error: HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/hafas/... -run TestSearch -run TestCircuit -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/hafas/client.go backend/internal/hafas/client_test.go
git commit -m "feat(backend): HAFAS HTTP client with circuit breaker"
```

---

### Task 6: HAFAS mapper (stations + trains)

**Files:**
- Create: `backend/internal/hafas/mapper.go`
- Create: `backend/internal/hafas/mapper_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/hafas/mapper_test.go
package hafas_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestNormalizeTrainNumber(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ICE123", "ICE 123"},
		{"ICE 123", "ICE 123"},
		{"ice123", "ICE 123"},
		{"RB27", "RB 27"},
		{"S3", "S 3"},
		{"IRE200", "IRE 200"},
		{"RE 42", "RE 42"},
	}
	for _, c := range cases {
		got := hafas.NormalizeTrainNumber(c.in)
		if got != c.want {
			t.Errorf("NormalizeTrainNumber(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMapStations_FiltersNonStop(t *testing.T) {
	results := []hafas.HAFASLocationResult{
		{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		{Type: "location", ID: "loc1", Name: "Some Address"}, // filtered out
		{Type: "stop", ID: "", Name: "Bad entry"},            // filtered — empty ID
	}
	stations := hafas.MapStations(results)
	if len(stations) != 1 {
		t.Fatalf("expected 1 station, got %d", len(stations))
	}
	if stations[0].ID != "8000105" {
		t.Errorf("unexpected station ID: %q", stations[0].ID)
	}
}

func TestMapTripToTrainResponse_NormalizesTrainNumber(t *testing.T) {
	dep := time.Now().Add(-1 * time.Hour)
	trip := hafas.HAFASTrip{
		Line:        hafas.HAFASLine{Name: "ICE123"},
		Origin:      hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
		Destination: hafas.HAFASPlace{ID: "8011160", Name: "Berlin Hbf"},
		Stopovers: []hafas.HAFASStopover{
			{Stop: hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"}, PlannedDeparture: &dep},
		},
	}
	resp := hafas.MapTripToTrainResponse(trip, "2026-06-10")
	if resp.TrainNumber != "ICE 123" {
		t.Errorf("TrainNumber: got %q, want %q", resp.TrainNumber, "ICE 123")
	}
	if len(resp.Stops) != 1 {
		t.Errorf("expected 1 stop, got %d", len(resp.Stops))
	}
}

func TestFilterTripsByDate_MatchesDate(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00+02:00")
	other, _ := time.Parse(time.RFC3339, "2026-06-11T14:00:00+02:00")

	trips := []hafas.HAFASTrip{
		{Stopovers: []hafas.HAFASStopover{{PlannedDeparture: &dep}}},
		{Stopovers: []hafas.HAFASStopover{{PlannedDeparture: &other}}},
	}
	filtered := hafas.FilterTripsByDate(trips, "2026-06-10")
	if len(filtered) != 1 {
		t.Errorf("expected 1 trip for 2026-06-10, got %d", len(filtered))
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/hafas/... -run TestNormalize -run TestMap -run TestFilter -v
```

Expected: `FAIL`

- [ ] **Step 3: Write mapper.go**

```go
// backend/internal/hafas/mapper.go
package hafas

import (
	"regexp"
	"strings"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

var trainNumberRe = regexp.MustCompile(`^([A-Z]+)([0-9].*)$`)

// NormalizeTrainNumber inserts a space between the letter prefix and numeric part.
// "ICE123" → "ICE 123". Already-spaced inputs like "ICE 123" pass through unchanged.
func NormalizeTrainNumber(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if m := trainNumberRe.FindStringSubmatch(s); len(m) == 3 {
		return m[1] + " " + m[2]
	}
	return s
}

// MapStations converts HAFAS location results to StationRef slice.
// Non-stop entries and entries with empty ID/Name are filtered out.
func MapStations(results []HAFASLocationResult) []journey.StationRef {
	out := make([]journey.StationRef, 0, len(results))
	for _, r := range results {
		if r.Type != "stop" && r.Type != "station" {
			continue
		}
		if r.ID == "" || r.Name == "" {
			continue
		}
		out = append(out, journey.StationRef{ID: r.ID, Name: r.Name})
	}
	return out
}

// TrainResponse is the API payload for GET /v1/trains/{number}.
type TrainResponse struct {
	TrainNumber string               `json:"trainNumber"`
	Date        string               `json:"date"`
	Origin      journey.StationRef   `json:"origin"`
	Destination journey.StationRef   `json:"destination"`
	Stops       []journey.StationRef `json:"stops"`
	Status      string               `json:"status"` // planned | running | delayed | cancelled
}

// MapTripToTrainResponse maps a HAFASTrip to the train validation response.
func MapTripToTrainResponse(trip HAFASTrip, date string) TrainResponse {
	resp := TrainResponse{
		TrainNumber: NormalizeTrainNumber(trip.Line.Name),
		Date:        date,
		Origin:      journey.StationRef{ID: trip.Origin.ID, Name: trip.Origin.Name},
		Destination: journey.StationRef{ID: trip.Destination.ID, Name: trip.Destination.Name},
		Status:      inferTripStatus(trip),
	}
	for _, s := range trip.Stopovers {
		if s.Stop.ID == "" {
			continue
		}
		resp.Stops = append(resp.Stops, journey.StationRef{ID: s.Stop.ID, Name: s.Stop.Name})
	}
	return resp
}

// FilterTripsByDate returns trips whose first stopover planned departure falls on date (YYYY-MM-DD).
// Date comparison uses Europe/Berlin timezone since DB operates on German timetable.
func FilterTripsByDate(trips []HAFASTrip, date string) []HAFASTrip {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		loc = time.UTC
	}
	var out []HAFASTrip
	for _, t := range trips {
		if len(t.Stopovers) == 0 {
			continue
		}
		dep := t.Stopovers[0].PlannedDeparture
		if dep == nil {
			dep = t.Stopovers[0].Departure
		}
		if dep == nil {
			continue
		}
		if dep.In(loc).Format("2006-01-02") == date {
			out = append(out, t)
		}
	}
	return out
}

func inferTripStatus(trip HAFASTrip) string {
	for _, s := range trip.Stopovers {
		if s.Cancelled {
			return "cancelled"
		}
	}
	hasDelay := false
	for _, s := range trip.Stopovers {
		if (s.DepartureDelay != nil && *s.DepartureDelay != 0) ||
			(s.ArrivalDelay != nil && *s.ArrivalDelay != 0) {
			hasDelay = true
			break
		}
	}
	now := time.Now()
	if trip.Departure != nil && trip.Arrival != nil &&
		now.After(*trip.Departure) && now.Before(*trip.Arrival) {
		if hasDelay {
			return "delayed"
		}
		return "running"
	}
	if hasDelay {
		return "delayed"
	}
	return "planned"
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/hafas/... -run TestNormalize -run TestMap -run TestFilter -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/hafas/mapper.go backend/internal/hafas/mapper_test.go
git commit -m "feat(backend): HAFAS mapper — station list and train response"
```

---

### Task 7: DB-only operator filter

**Files:**
- Create: `backend/internal/hafas/filter.go`
- Create: `backend/internal/hafas/filter_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/hafas/filter_test.go
package hafas_test

import (
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestIsDBOperator_KnownDB(t *testing.T) {
	for _, op := range []string{
		"DB Fernverkehr AG",
		"DB Regio AG",
		"S-Bahn Berlin GmbH",
		"S-Bahn Hamburg GmbH",
		"S-Bahn München GmbH",
	} {
		if !hafas.IsDBOperator(op) {
			t.Errorf("%q: want IsDBOperator=true", op)
		}
	}
}

func TestIsDBOperator_NonDB(t *testing.T) {
	for _, op := range []string{
		"Flixtrain",
		"Transdev GmbH",
		"",
		"DB Navigator", // app, not an operator
		"DB Cargo AG",  // freight, not passenger
	} {
		if hafas.IsDBOperator(op) {
			t.Errorf("%q: want IsDBOperator=false", op)
		}
	}
}

func TestIsDBOnlyJourney_AllDB(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}}},
	}
	if !hafas.IsDBOnlyJourney(legs) {
		t.Error("all-DB journey: expected true")
	}
}

func TestIsDBOnlyJourney_MixedFails(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "Flixtrain"}}},
	}
	if hafas.IsDBOnlyJourney(legs) {
		t.Error("mixed-operator journey: expected false")
	}
}

func TestIsDBOnlyJourney_WalkingLegIgnored(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}}},
		{Walking: true}, // no operator — must not fail the filter
	}
	if !hafas.IsDBOnlyJourney(legs) {
		t.Error("journey with walking segment: expected true (walking ignored)")
	}
}

func TestIsDBOnlyJourney_NilOperatorFails(t *testing.T) {
	legs := []hafas.HAFASLeg{
		{Line: &hafas.HAFASLine{Operator: nil}}, // no operator info → conservative: reject
	}
	if hafas.IsDBOnlyJourney(legs) {
		t.Error("nil operator: expected false (conservative reject)")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/hafas/... -run TestIsDB -v
```

Expected: `FAIL`

- [ ] **Step 3: Write filter.go**

```go
// backend/internal/hafas/filter.go
package hafas

import "strings"

// dbOperators is the allow-list of DB-operated passenger train services.
// Strings must be verified empirically against live db.transport.rest responses.
// Extend this list as new operator name variants are observed.
var dbOperators = map[string]bool{
	"DB Fernverkehr AG":               true, // ICE, IC, EC
	"DB Regio AG":                     true, // Regional trains
	"S-Bahn Berlin GmbH":              true,
	"S-Bahn Hamburg GmbH":             true,
	"S-Bahn München GmbH":             true,
	"DB RegioNetz Infrastruktur GmbH": true,
	"DB Regio Takt GmbH":              true,
}

// IsDBOperator reports whether operatorName is on the DB passenger rail allow-list.
func IsDBOperator(operatorName string) bool {
	return dbOperators[strings.TrimSpace(operatorName)]
}

// IsDBOnlyJourney reports whether all non-walking legs are operated by a DB entity.
// Journeys where any leg has an unknown or non-DB operator return false.
func IsDBOnlyJourney(legs []HAFASLeg) bool {
	for _, leg := range legs {
		if leg.Walking {
			continue
		}
		if leg.Line == nil || leg.Line.Operator == nil {
			return false // conservative: reject if operator unknown
		}
		if !IsDBOperator(leg.Line.Operator.Name) {
			return false
		}
	}
	return true
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/hafas/... -run TestIsDB -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/hafas/filter.go backend/internal/hafas/filter_test.go
git commit -m "feat(backend): DB-only operator filter with allow-list"
```

---

### Task 8: Singleflight coalescer

**Files:**
- Create: `backend/internal/hafas/coalescer.go`
- Create: `backend/internal/hafas/coalescer_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/hafas/coalescer_test.go
package hafas_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestCoalescer_DeduplicatesConcurrentCalls(t *testing.T) {
	var callCount atomic.Int64
	c := &hafas.Coalescer{}

	start := make(chan struct{})
	var wg sync.WaitGroup

	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			c.Do("same-key", func() (any, error) {
				callCount.Add(1)
				time.Sleep(20 * time.Millisecond) // hold open so all goroutines coalesce
				return "result", nil
			})
		}()
	}
	close(start) // release all goroutines at once
	wg.Wait()

	if callCount.Load() >= 10 {
		t.Errorf("expected deduplication; function called %d times (want < 10)", callCount.Load())
	}
}

func TestCoalescer_DifferentKeysAreIndependent(t *testing.T) {
	var callCount atomic.Int64
	c := &hafas.Coalescer{}

	c.Do("key-a", func() (any, error) { callCount.Add(1); return nil, nil })
	c.Do("key-b", func() (any, error) { callCount.Add(1); return nil, nil })

	if callCount.Load() != 2 {
		t.Errorf("expected 2 calls for 2 different keys, got %d", callCount.Load())
	}
}

func TestCoalescer_PropagatesError(t *testing.T) {
	c := &hafas.Coalescer{}
	_, err := c.Do("err-key", func() (any, error) {
		return nil, hafas.ErrCircuitOpen
	})
	if err == nil {
		t.Fatal("expected error to be propagated")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/hafas/... -run TestCoalescer -v
```

Expected: `FAIL`

- [ ] **Step 3: Write coalescer.go**

```go
// backend/internal/hafas/coalescer.go
package hafas

import "golang.org/x/sync/singleflight"

// Coalescer deduplicates concurrent HAFAS fetches keyed on (trainNumber, date) or tripId.
// Multiple goroutines calling Do with the same key share one upstream call; all receive the result.
type Coalescer struct {
	group singleflight.Group
}

// Do calls fn if no in-flight call with key exists; otherwise joins the in-flight call.
// The third return value (shared bool) is discarded — callers don't need to know.
func (c *Coalescer) Do(key string, fn func() (any, error)) (any, error) {
	v, err, _ := c.group.Do(key, fn)
	return v, err
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/hafas/... -run TestCoalescer -v
```

Expected: `PASS`

- [ ] **Step 5: Run all hafas tests**

```bash
cd backend && go test ./internal/hafas/... -v
```

Expected: all `PASS`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/hafas/coalescer.go backend/internal/hafas/coalescer_test.go
git commit -m "feat(backend): singleflight coalescer for HAFAS request deduplication"
```

---

### Task 9: Rate limiting middleware

**Files:**
- Create: `backend/internal/api/middleware/ratelimit.go`
- Create: `backend/internal/api/middleware/ratelimit_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/middleware/ratelimit_test.go
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

func TestRateLimiter_AllowsUnderBurst(t *testing.T) {
	rl := middleware.NewRateLimiter(60)
	for range 5 {
		if !rl.Allow("user-1") {
			t.Fatal("expected Allow=true for first 5 requests (burst=60)")
		}
	}
}

func TestRateLimiter_BlocksOverBurst(t *testing.T) {
	rl := middleware.NewRateLimiter(5) // burst = 5
	allowed := 0
	for range 20 {
		if rl.Allow("user-1") {
			allowed++
		}
	}
	if allowed > 5 {
		t.Errorf("expected ≤5 allowed with burst=5, got %d", allowed)
	}
}

func TestRateLimiter_IsolatesKeys(t *testing.T) {
	rl := middleware.NewRateLimiter(1) // burst = 1
	if !rl.Allow("user-a") {
		t.Fatal("first call for user-a must be allowed")
	}
	if rl.Allow("user-a") {
		t.Fatal("second call for user-a must be blocked (burst=1)")
	}
	if !rl.Allow("user-b") {
		t.Fatal("user-b must be unaffected by user-a rate limit")
	}
}

func TestRateLimiter_Cleanup_RemovesOldEntries(t *testing.T) {
	rl := middleware.NewRateLimiter(60)
	rl.Allow("user-x")
	rl.Cleanup(0) // clean entries older than 0 — removes all
	// After cleanup, user-x gets a fresh limiter; should be allowed again
	if !rl.Allow("user-x") {
		t.Fatal("expected Allow=true after cleanup (fresh limiter)")
	}
}

func TestRateLimit_Middleware_Returns429WhenExceeded(t *testing.T) {
	install := middleware.NewRateLimiter(1) // burst = 1
	ip := middleware.NewRateLimiter(60)

	handler := middleware.RateLimit(install, ip, 1, 60)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Install-Id", "install-abc")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call() != http.StatusOK {
		t.Fatal("first call must be 200")
	}
	if call() != http.StatusTooManyRequests {
		t.Fatal("second call must be 429 (burst=1)")
	}
}

func TestRateLimit_Middleware_FallsBackToIPWhenNoInstallId(t *testing.T) {
	install := middleware.NewRateLimiter(60)
	ip := middleware.NewRateLimiter(1) // burst = 1 on IP

	handler := middleware.RateLimit(install, ip, 60, 1)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		// No X-Install-Id → falls back to IP limiter
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call() != http.StatusOK {
		t.Fatal("first IP call must be 200")
	}
	if call() != http.StatusTooManyRequests {
		t.Fatal("second IP call must be 429 (IP burst=1)")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/middleware/... -run TestRateLimit -v
```

Expected: `FAIL`

- [ ] **Step 3: Write ratelimit.go**

```go
// backend/internal/api/middleware/ratelimit.go
package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter is a per-key token-bucket limiter backed by an in-memory map.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rlEntry
	limit   rate.Limit
	burst   int
}

type rlEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// NewRateLimiter creates a RateLimiter allowing perMinute requests per minute per key.
// The burst equals perMinute (full minute of requests available immediately).
func NewRateLimiter(perMinute int) *RateLimiter {
	return &RateLimiter{
		entries: make(map[string]*rlEntry),
		limit:   rate.Limit(perMinute) / 60.0,
		burst:   perMinute,
	}
}

// Allow reports whether the key is within its rate limit. Thread-safe.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[key]
	if !ok {
		e = &rlEntry{lim: rate.NewLimiter(rl.limit, rl.burst)}
		rl.entries[key] = e
	}
	e.lastSeen = time.Now()
	return e.lim.Allow()
}

// Cleanup removes entries not seen in the last olderThan duration.
// Call periodically (e.g. every minute) to prevent unbounded map growth.
func (rl *RateLimiter) Cleanup(olderThan time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-olderThan)
	for k, e := range rl.entries {
		if e.lastSeen.Before(cutoff) {
			delete(rl.entries, k)
		}
	}
}

// RateLimit returns an HTTP middleware that enforces per-install-id and per-IP limits.
// perInstallLimit and perIPLimit are the configured per-minute request limits.
func RateLimit(installLimiter, ipLimiter *RateLimiter, perInstallLimit, perIPLimit int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			installID := r.Header.Get("X-Install-Id")

			var allowed bool
			var limit int
			if installID != "" {
				allowed = installLimiter.Allow(installID)
				limit = perInstallLimit
			} else {
				allowed = ipLimiter.Allow(realIP(r))
				limit = perIPLimit
			}

			reset := nextMinuteUnix()
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))

			if !allowed {
				w.Header().Set("Retry-After", "30")
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("Content-Type", "application/problem+json")
				w.Header().Set("Link", `<https://verspaetungsbegleiter.app/errors>; rel="describedby"`)
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprintf(w, `{"type":"urn:verspbegl:error:rate-limit-exceeded","title":"Rate Limit Exceeded","status":429,"instance":%q}`,
					r.URL.Path)
				return
			}

			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(limit)) // approximate
			next.ServeHTTP(w, r)
		})
	}
}

func realIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return xff
	}
	return r.RemoteAddr
}

func nextMinuteUnix() int64 {
	now := time.Now()
	return now.Truncate(time.Minute).Add(time.Minute).Unix()
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/middleware/... -v
```

Expected: all `PASS`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/middleware/ratelimit.go backend/internal/api/middleware/ratelimit_test.go
git commit -m "feat(backend): per-install-id and per-IP rate limiting middleware"
```

---

### Task 10: Stations handler

**Files:**
- Create: `backend/internal/api/handlers/stations.go`
- Create: `backend/internal/api/handlers/stations_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/stations_test.go
package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func newTestHAFASClient(t *testing.T, h http.HandlerFunc) *hafas.Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     5,
		HAFASCBProbeInterval: 30 * time.Second,
	})
}

func TestStations_ShortQuery_Returns400(t *testing.T) {
	h := handlers.NewStationsHandler(newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {}), nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=x", nil)
	rr := httptest.NewRecorder()
	h.Search(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}
}

func TestStations_ValidQuery_ReturnsStations(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{
			{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
			{Type: "stop", ID: "8000104", Name: "Frankfurt (Main) Süd"},
		})
	})
	h := handlers.NewStationsHandler(client, nil)

	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=Frank", nil)
	rr := httptest.NewRecorder()
	h.Search(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body struct {
		Stations []journey.StationRef `json:"stations"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Stations) != 2 {
		t.Errorf("expected 2 stations, got %d", len(body.Stations))
	}
}

func TestStations_EmptyResult_ReturnsEmptyArray(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	})
	h := handlers.NewStationsHandler(client, nil)

	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=xyz", nil)
	rr := httptest.NewRecorder()
	h.Search(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	// Must return [] not null — frontend treats null as an error
	if body := rr.Body.String(); body == "" {
		t.Fatal("empty body")
	}
	var m map[string]any
	json.Unmarshal(rr.Body.Bytes(), &m)
	if m["stations"] == nil {
		t.Error("stations field must be [] not null")
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestStations -v
```

Expected: `FAIL`

- [ ] **Step 3: Write stations.go**

```go
// backend/internal/api/handlers/stations.go
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
	if stations == nil {
		stations = []journey.StationRef{} // never return null
	}

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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestStations -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/handlers/stations.go backend/internal/api/handlers/stations_test.go
git commit -m "feat(backend): GET /v1/stations handler with Redis caching"
```

---

### Task 11: Trains handler

**Files:**
- Create: `backend/internal/api/handlers/trains.go`
- Create: `backend/internal/api/handlers/trains_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/trains_test.go
package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func routeTrainRequest(h *handlers.TrainsHandler, trainNumber, date string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/v1/trains/{number}", h.Get)
	path := "/v1/trains/" + trainNumber
	if date != "" {
		path += "?date=" + date
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
	return rr
}

func TestTrains_ValidTrain_Returns200(t *testing.T) {
	today := time.Now().UTC().Format("2006-01-02")
	dep := time.Now().UTC().Add(-1 * time.Hour)
	arr := time.Now().UTC().Add(3 * time.Hour)

	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{
			Trips: []hafas.HAFASTrip{
				{
					Line:        hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
					Origin:      hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
					Destination: hafas.HAFASPlace{ID: "8011160", Name: "Berlin Hbf"},
					Departure:   &dep,
					Arrival:     &arr,
					Stopovers: []hafas.HAFASStopover{
						{Stop: hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"}, PlannedDeparture: &dep},
					},
				},
			},
		})
	})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE123", today)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["trainNumber"] != "ICE 123" {
		t.Errorf("trainNumber: got %v, want ICE 123", body["trainNumber"])
	}
	if body["status"] == nil {
		t.Error("status field missing")
	}
}

func TestTrains_NotFound_Returns404(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{Trips: []hafas.HAFASTrip{}})
	})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE999", "2020-01-01")

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}
}

func TestTrains_InvalidDate_Returns400(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE123", "not-a-date")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestTrains -v
```

Expected: `FAIL`

- [ ] **Step 3: Write trains.go**

```go
// backend/internal/api/handlers/trains.go
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestTrains -v
```

Expected: `PASS`

- [ ] **Step 5: Run all handler tests**

```bash
cd backend && go test ./internal/api/handlers/... -v
```

Expected: all `PASS`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/handlers/trains.go backend/internal/api/handlers/trains_test.go
git commit -m "feat(backend): GET /v1/trains/{number} handler"
```

---

### Task 12: Wire up router + main.go

**Files:**
- Modify: `backend/internal/api/router.go`
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Update router.go**

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

// Deps holds all handler dependencies injected at startup.
type Deps struct {
	Health      *handlers.HealthHandler
	Stations    *handlers.StationsHandler
	Trains      *handlers.TrainsHandler
	Logger      *slog.Logger
	CORSOrigins []string
	// Journey, Summary, Legs, Alternatives handlers added in Plans 3–4
	InstallRateLimiter *mw.RateLimiter
	IPRateLimiter      *mw.RateLimiter
	PerInstallLimit    int
	PerIPLimit         int
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(mw.RequestID)
	r.Use(mw.Logging(deps.Logger))
	r.Use(mw.CORS(deps.CORSOrigins))
	r.Use(chimw.Recoverer)

	r.Get("/health", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)

	r.Route("/v1", func(r chi.Router) {
		r.Use(mw.RateLimit(
			deps.InstallRateLimiter,
			deps.IPRateLimiter,
			deps.PerInstallLimit,
			deps.PerIPLimit,
		))

		r.Get("/stations", deps.Stations.Search)
		r.Get("/trains/{number}", deps.Trains.Get)

		// Journey routes added in Plan 3
	})

	return r
}
```

- [ ] **Step 2: Update main.go**

Replace `cmd/server/main.go` with:

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
	_ "time/tzdata" // embed timezone data for Europe/Berlin in FilterTripsByDate

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
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

	hafasClient := hafas.NewClient(cfg)

	installLimiter := mw.NewRateLimiter(cfg.RateLimitPerInstall)
	ipLimiter := mw.NewRateLimiter(cfg.RateLimitPerIP)

	// Cleanup stale rate-limit entries every minute
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			installLimiter.Cleanup(2 * time.Minute)
			ipLimiter.Cleanup(2 * time.Minute)
		}
	}()

	router := api.NewRouter(api.Deps{
		Health:             handlers.NewHealthHandler(db, rdb, cfg.HAFASBaseURL),
		Stations:           handlers.NewStationsHandler(hafasClient, rdb),
		Trains:             handlers.NewTrainsHandler(hafasClient),
		Logger:             logger,
		CORSOrigins:        cfg.CORSAllowedOrigins,
		InstallRateLimiter: installLimiter,
		IPRateLimiter:      ipLimiter,
		PerInstallLimit:    cfg.RateLimitPerInstall,
		PerIPLimit:         cfg.RateLimitPerIP,
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

func connectRedis(rawURL string) (*redis.Client, error) {
	opt, err := redis.ParseURL(rawURL)
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

- [ ] **Step 3: Build the binary**

```bash
cd backend && go build ./...
```

Expected: exits 0.

- [ ] **Step 4: Run all tests**

```bash
cd backend && go test ./...
```

Expected: all `PASS`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/router.go backend/cmd/server/main.go
git commit -m "feat(backend): wire stations + trains routes; rate limiter in main"
```

---

### Task 13: Smoke test — stations and trains live

No files created. Manual verification with running stack.

- [ ] **Step 1: Start the stack**

```bash
docker compose up --build -d
```

Expected: all services healthy.

- [ ] **Step 2: Test station search**

```bash
curl -s "http://localhost/v1/stations?q=Frank" | jq .
```

Expected response shape:
```json
{"stations":[{"id":"...","name":"Frankfurt (Main) Hbf"},{"id":"...","name":"..."}]}
```

If HAFAS is unavailable, expect 503 — that's correct behavior.

- [ ] **Step 3: Test station search — too short query**

```bash
curl -s "http://localhost/v1/stations?q=x" | jq .
```

Expected:
```json
{"type":"urn:verspbegl:error:malformed-request","title":"Malformed Request","status":400,...}
```

- [ ] **Step 4: Test train validation**

```bash
TODAY=$(date +%Y-%m-%d)
curl -s "http://localhost/v1/trains/ICE123?date=$TODAY" | jq .
```

Expected: either 200 with train metadata, or 404 if ICE 123 doesn't run today — both are correct.

- [ ] **Step 5: Verify rate limit headers present**

```bash
curl -sI "http://localhost/v1/stations?q=Frank" | grep -i x-ratelimit
```

Expected:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 60
X-RateLimit-Reset: <unix timestamp>
```

- [ ] **Step 6: Stop stack**

```bash
docker compose down
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(backend): Plan 2 complete — HAFAS client, stations, trains endpoints"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered |
|-------------|---------|
| `GET /v1/stations?q=...` → `{"stations":[...]}` | ✓ Task 10 |
| Empty station results returns `[]` not null | ✓ Task 10 test |
| Station results cached in Redis 5min | ✓ Task 10 |
| `GET /v1/trains/{number}?date=...` → train metadata | ✓ Task 11 |
| Train number normalized: ICE123 → ICE 123 | ✓ Task 6 |
| 404 when train not found for date | ✓ Task 11 |
| Circuit breaker: open after threshold failures | ✓ Task 5 |
| Circuit breaker: probe after interval, close on success | ✓ Task 5 |
| X-Request-Id propagated to outbound HAFAS calls | ✓ Task 5 |
| DB-only operator filter allow-list | ✓ Task 7 |
| Walking legs ignored by DB filter | ✓ Task 7 |
| Per-install-id rate limiting (60 req/min default) | ✓ Task 9 |
| Per-IP fallback when X-Install-Id missing | ✓ Task 9 |
| X-RateLimit-* headers on all /v1/ responses | ✓ Task 9 |
| 429 + Retry-After when rate limited | ✓ Task 9 |
| RFC 7807 problem+json on all errors | ✓ Task 3 |
| `_ "time/tzdata"` embedded for Europe/Berlin | ✓ Task 12 |

**Not in Plan 2 (deferred):**
- `POST /v1/journeys` → Plan 3
- `GET /v1/journeys/*` → Plans 3–4
- Prometheus metrics → Plan 4
- Alternatives computation → Plan 3
- Poller → Plan 4

**Placeholder scan:** None found.

**Type consistency:** `HAFASLocationResult`, `HAFASTrip`, `HAFASLine`, `HAFASOperator`, `HAFASStopover` defined once in `types.go`. `TrainResponse` defined in `mapper.go`. `StationRef` defined in `journey/model.go`. All references consistent.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-11-backend-plan-2-hafas-lookup.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans

Which approach?
