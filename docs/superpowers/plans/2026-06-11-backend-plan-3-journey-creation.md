# Backend Plan 3 — Routing Engine + Journey Creation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /v1/journeys` creates a journey, runs HAFAS-backed BFS routing, stores the result, and returns alternatives. `GET /v1/journeys/{id}` returns the full journey. `DELETE /v1/journeys/{id}` terminates monitoring.

**Architecture:** BFS facade delegates routing to HAFAS (db.transport.rest), filters + ranks results, writes through Redis (L1) and Postgres (L2). The `Store` interface is defined here; the poller in Plan 4 uses the same interface.

**Builds on:** Plans 1–2. Requires HAFAS client, config, journey model, middleware stack.

**Subsequent plan:** Plan 4 adds the poller, summary/legs/alternatives polling endpoints, metrics, boot recovery.

---

## File Map

| Action | Path |
|--------|------|
| Create | `backend/internal/journey/id.go` |
| Create | `backend/internal/journey/id_test.go` |
| Create | `backend/internal/journey/store.go` |
| Modify | `backend/internal/hafas/mapper.go` |
| Modify | `backend/internal/hafas/mapper_test.go` |
| Create | `backend/internal/routing/engine.go` |
| Create | `backend/internal/routing/scorer.go` |
| Create | `backend/internal/routing/scorer_test.go` |
| Create | `backend/internal/routing/bfs.go` |
| Create | `backend/internal/routing/bfs_test.go` |
| Create | `backend/internal/api/handlers/journeys.go` |
| Create | `backend/internal/api/handlers/journeys_test.go` |
| Modify | `backend/internal/api/router.go` |
| Modify | `backend/cmd/server/main.go` |

---

### Task 1: Journey ID generator

**Files:**
- Create: `backend/internal/journey/id.go`
- Create: `backend/internal/journey/id_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/journey/id_test.go
package journey_test

import (
	"regexp"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

var journeyIDPattern = regexp.MustCompile(`^jrn_[0-9a-z]{26}$`)

func TestNewID_MatchesPattern(t *testing.T) {
	id := journey.NewID()
	if !journeyIDPattern.MatchString(id) {
		t.Errorf("NewID() = %q does not match ^jrn_[0-9a-z]{26}$", id)
	}
}

func TestNewID_Unique(t *testing.T) {
	seen := make(map[string]bool, 1000)
	for range 1000 {
		id := journey.NewID()
		if seen[id] {
			t.Fatalf("duplicate ID generated: %q", id)
		}
		seen[id] = true
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/journey/... -run TestNewID -v
```

Expected: `FAIL`

- [ ] **Step 3: Write id.go**

```go
// backend/internal/journey/id.go
package journey

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
)

// NewID generates a journey ID matching ^jrn_[0-9a-z]{26}$.
// Uses 16 random bytes encoded as lowercase base32 (no padding) = 26 chars.
// base32 alphabet a–z + 2–7 ⊆ [0-9a-z].
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("journey.NewID: crypto/rand unavailable: " + err.Error())
	}
	enc := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	return "jrn_" + enc
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd backend && go test ./internal/journey/... -run TestNewID -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/journey/id.go backend/internal/journey/id_test.go
git commit -m "feat(backend): journey ID generator"
```

---

### Task 2: Journey store interface + implementation

**Files:**
- Create: `backend/internal/journey/store.go`

The store interface is defined here so handlers (Plan 3) and the poller (Plan 4) both use it. The concrete `RedisPostgresStore` implements it.

- [ ] **Step 1: Write store.go**

```go
// backend/internal/journey/store.go
package journey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// ErrNotFound is returned when a journey ID does not exist or has expired.
var ErrNotFound = errors.New("journey not found")

// ErrTerminated is returned when attempting to act on an already-terminated journey.
var ErrTerminated = errors.New("journey already terminated")

// IdempotencyEntry caches a journey-creation response for Idempotency-Key replay.
type IdempotencyEntry struct {
	JourneyID    string `json:"journeyId"`
	BodyHash     string `json:"bodyHash"`
	StatusCode   int    `json:"statusCode"`
	ResponseBody []byte `json:"responseBody"`
}

// AltsRecord wraps the alternatives list with its own ETag counter.
type AltsRecord struct {
	Counter int           `json:"counter"`
	Items   []Alternative `json:"items"`
}

// Store is the persistence interface used by handlers and the poller.
type Store interface {
	// Create writes the journey and its initial alternatives (write-through: Postgres then Redis).
	Create(ctx context.Context, j *Journey, alts []Alternative) error
	// Get reads a journey by ID (Redis first, falls back to Postgres).
	Get(ctx context.Context, id string) (*Journey, error)
	// GetAlternatives returns the current alternatives list and its ETag.
	GetAlternatives(ctx context.Context, id string) ([]Alternative, string, error)
	// UpdateState writes a state change (write-through). updateLegs must be true when
	// platform or cancellation data changed.
	UpdateState(ctx context.Context, id string, summary Summary, legs []Leg, updateLegs bool) error
	// UpdateAlternatives replaces the alternatives list and increments the alts ETag counter.
	UpdateAlternatives(ctx context.Context, id string, alts []Alternative) error
	// Terminate sets terminated_at and evicts the journey from Redis.
	Terminate(ctx context.Context, id string) error
	// GetActive returns all journeys active within the last ttlHours hours (for boot recovery).
	GetActive(ctx context.Context, ttlHours int) ([]Journey, error)
	// CountActive returns the number of non-terminated journeys (for capacity check).
	CountActive(ctx context.Context) (int, error)
	// GetIdempotency retrieves a cached idempotency entry.
	GetIdempotency(ctx context.Context, key string) (*IdempotencyEntry, error)
	// SetIdempotency stores an idempotency entry with a 10-minute TTL.
	SetIdempotency(ctx context.Context, key string, entry IdempotencyEntry) error
}

// RedisPostgresStore is the production Store implementation.
type RedisPostgresStore struct {
	db       *pgxpool.Pool
	rdb      *redis.Client
	ttl      time.Duration
	writeTTL time.Duration
}

// NewStore creates a RedisPostgresStore with the given dependencies.
func NewStore(db *pgxpool.Pool, rdb *redis.Client, ttlHours int, writeTimeout time.Duration) *RedisPostgresStore {
	return &RedisPostgresStore{
		db:       db,
		rdb:      rdb,
		ttl:      time.Duration(ttlHours) * time.Hour,
		writeTTL: writeTimeout,
	}
}

func redisKey(id string) string    { return "journey:" + id }
func altsKey(id string) string     { return "alts:" + id }
func idempKey(key string) string   { return "idemp:" + key }

// Create writes to Postgres synchronously, then to Redis.
func (s *RedisPostgresStore) Create(ctx context.Context, j *Journey, alts []Alternative) error {
	summaryJSON, _ := json.Marshal(j.Summary)
	legsJSON, _ := json.Marshal(j.Legs)
	stopsJSON, _ := json.Marshal(j.Stops)
	filtersJSON, _ := json.Marshal(j.Filters)

	wctx, cancel := context.WithTimeout(ctx, s.writeTTL)
	defer cancel()

	_, err := s.db.Exec(wctx, `
		INSERT INTO journeys
			(id, install_id, train_number, destination_id, destination_name,
			 filters_json, summary_json, legs_json, stops_json, etag_counter)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		j.ID, j.InstallID, j.TrainNumber,
		j.Destination.ID, j.Destination.Name,
		filtersJSON, summaryJSON, legsJSON, stopsJSON,
		j.ETagCounter,
	)
	if err != nil {
		return fmt.Errorf("store.Create postgres: %w", err)
	}

	if err := s.writeToRedis(ctx, j, alts); err != nil {
		return fmt.Errorf("store.Create redis: %w", err)
	}
	return nil
}

func (s *RedisPostgresStore) writeToRedis(ctx context.Context, j *Journey, alts []Alternative) error {
	jBytes, err := json.Marshal(j)
	if err != nil {
		return err
	}
	altsRec := AltsRecord{Counter: 1, Items: alts}
	if alts == nil {
		altsRec.Items = []Alternative{}
	}
	aBytes, _ := json.Marshal(altsRec)

	pipe := s.rdb.Pipeline()
	pipe.Set(ctx, redisKey(j.ID), jBytes, s.ttl)
	pipe.Set(ctx, altsKey(j.ID), aBytes, s.ttl)
	_, err = pipe.Exec(ctx)
	return err
}

// Get reads from Redis; on miss, reconstructs from Postgres and re-warms Redis.
func (s *RedisPostgresStore) Get(ctx context.Context, id string) (*Journey, error) {
	raw, err := s.rdb.Get(ctx, redisKey(id)).Bytes()
	if err == nil {
		var j Journey
		if err := json.Unmarshal(raw, &j); err == nil {
			return &j, nil
		}
	}
	// Redis miss — reconstruct from Postgres
	return s.getFromPostgres(ctx, id)
}

func (s *RedisPostgresStore) getFromPostgres(ctx context.Context, id string) (*Journey, error) {
	var j Journey
	var summaryJSON, legsJSON, stopsJSON, filtersJSON []byte
	var terminatedAt *time.Time

	err := s.db.QueryRow(ctx, `
		SELECT id, install_id, train_number, destination_id, destination_name,
		       filters_json, summary_json, legs_json, stops_json,
		       etag_counter, created_at, terminated_at, last_polled_at
		FROM journeys WHERE id = $1`, id,
	).Scan(
		&j.ID, &j.InstallID, &j.TrainNumber,
		&j.Destination.ID, &j.Destination.Name,
		&filtersJSON, &summaryJSON, &legsJSON, &stopsJSON,
		&j.ETagCounter, &j.CreatedAt, &terminatedAt, &j.LastPolledAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("store.Get postgres: %w", err)
	}
	if terminatedAt != nil {
		return nil, ErrNotFound
	}
	json.Unmarshal(summaryJSON, &j.Summary)
	json.Unmarshal(legsJSON, &j.Legs)
	json.Unmarshal(stopsJSON, &j.Stops)
	json.Unmarshal(filtersJSON, &j.Filters)
	j.TerminatedAt = terminatedAt
	j.ETagEpoch = time.Now().Unix() // new epoch on rehydration
	return &j, nil
}

// GetAlternatives returns the alternatives list and its ETag string.
func (s *RedisPostgresStore) GetAlternatives(ctx context.Context, id string) ([]Alternative, string, error) {
	raw, err := s.rdb.Get(ctx, altsKey(id)).Bytes()
	if err != nil {
		return nil, "", ErrNotFound
	}
	var rec AltsRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, "", err
	}
	etag := fmt.Sprintf("%s:alts:%d", id, rec.Counter)
	return rec.Items, etag, nil
}

// UpdateState writes summary (and optionally legs) through Postgres then Redis.
func (s *RedisPostgresStore) UpdateState(ctx context.Context, id string, summary Summary, legs []Leg, updateLegs bool) error {
	summaryJSON, _ := json.Marshal(summary)

	wctx, cancel := context.WithTimeout(ctx, s.writeTTL)
	defer cancel()

	if updateLegs {
		legsJSON, _ := json.Marshal(legs)
		_, err := s.db.Exec(wctx, `
			UPDATE journeys SET summary_json=$1, legs_json=$2,
			etag_counter=etag_counter+1, last_polled_at=now()
			WHERE id=$3 AND terminated_at IS NULL`,
			summaryJSON, legsJSON, id)
		if err != nil {
			return fmt.Errorf("store.UpdateState postgres: %w", err)
		}
	} else {
		_, err := s.db.Exec(wctx, `
			UPDATE journeys SET summary_json=$1,
			etag_counter=etag_counter+1, last_polled_at=now()
			WHERE id=$2 AND terminated_at IS NULL`,
			summaryJSON, id)
		if err != nil {
			return fmt.Errorf("store.UpdateState postgres: %w", err)
		}
	}

	j, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	j.Summary = summary
	if updateLegs {
		j.Legs = legs
	}
	j.ETagCounter++
	return s.writeToRedis(ctx, j, nil) // nil alts = don't touch alts key
}

// UpdateAlternatives replaces the alternatives and increments the alts counter.
func (s *RedisPostgresStore) UpdateAlternatives(ctx context.Context, id string, alts []Alternative) error {
	raw, err := s.rdb.Get(ctx, altsKey(id)).Bytes()
	counter := 1
	if err == nil {
		var rec AltsRecord
		if json.Unmarshal(raw, &rec) == nil {
			counter = rec.Counter + 1
		}
	}
	rec := AltsRecord{Counter: counter, Items: alts}
	b, _ := json.Marshal(rec)
	return s.rdb.Set(ctx, altsKey(id), b, s.ttl).Err()
}

// Terminate marks the journey terminated in Postgres and removes it from Redis.
func (s *RedisPostgresStore) Terminate(ctx context.Context, id string) error {
	wctx, cancel := context.WithTimeout(ctx, s.writeTTL)
	defer cancel()

	res, err := s.db.Exec(wctx,
		"UPDATE journeys SET terminated_at=now() WHERE id=$1 AND terminated_at IS NULL", id)
	if err != nil {
		return fmt.Errorf("store.Terminate postgres: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	pipe := s.rdb.Pipeline()
	pipe.Del(ctx, redisKey(id))
	pipe.Del(ctx, altsKey(id))
	_, err = pipe.Exec(ctx)
	return err
}

// GetActive returns journeys that are not terminated and were created within ttlHours.
func (s *RedisPostgresStore) GetActive(ctx context.Context, ttlHours int) ([]Journey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, install_id, train_number, destination_id, destination_name,
		       filters_json, summary_json, legs_json, stops_json,
		       etag_counter, created_at, last_polled_at
		FROM journeys
		WHERE terminated_at IS NULL
		  AND created_at > now() - ($1 || ' hours')::interval
		ORDER BY created_at`,
		fmt.Sprintf("%d", ttlHours),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var journeys []Journey
	for rows.Next() {
		var j Journey
		var summaryJSON, legsJSON, stopsJSON, filtersJSON []byte
		if err := rows.Scan(
			&j.ID, &j.InstallID, &j.TrainNumber,
			&j.Destination.ID, &j.Destination.Name,
			&filtersJSON, &summaryJSON, &legsJSON, &stopsJSON,
			&j.ETagCounter, &j.CreatedAt, &j.LastPolledAt,
		); err != nil {
			return nil, err
		}
		json.Unmarshal(summaryJSON, &j.Summary)
		json.Unmarshal(legsJSON, &j.Legs)
		json.Unmarshal(stopsJSON, &j.Stops)
		json.Unmarshal(filtersJSON, &j.Filters)
		journeys = append(journeys, j)
	}
	return journeys, rows.Err()
}

// CountActive returns the number of non-terminated journeys.
func (s *RedisPostgresStore) CountActive(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM journeys WHERE terminated_at IS NULL").Scan(&count)
	return count, err
}

// GetIdempotency retrieves a cached idempotency entry from Redis.
func (s *RedisPostgresStore) GetIdempotency(ctx context.Context, key string) (*IdempotencyEntry, error) {
	raw, err := s.rdb.Get(ctx, idempKey(key)).Bytes()
	if err != nil {
		return nil, nil // not found = no entry
	}
	var entry IdempotencyEntry
	if err := json.Unmarshal(raw, &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}

// SetIdempotency stores an idempotency entry with a 10-minute TTL.
func (s *RedisPostgresStore) SetIdempotency(ctx context.Context, key string, entry IdempotencyEntry) error {
	b, _ := json.Marshal(entry)
	return s.rdb.Set(ctx, idempKey(key), b, 10*time.Minute).Err()
}
```

- [ ] **Step 2: Verify compiles**

```bash
cd backend && go build ./internal/journey/...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/journey/store.go
git commit -m "feat(backend): journey Store interface and RedisPostgresStore"
```

---

### Task 3: HAFAS journey mapper

Add `MapHAFASJourney` and helpers to the existing `hafas/mapper.go`. This maps a `HAFASJourney` to an internal `journey.Journey`.

**Files:**
- Modify: `backend/internal/hafas/mapper.go`
- Modify: `backend/internal/hafas/mapper_test.go`

- [ ] **Step 1: Write failing tests**

Append to `backend/internal/hafas/mapper_test.go`:

```go
func TestMapHAFASJourney_BasicFields(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:24:00Z")

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin:           hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
				Destination:      hafas.HAFASPlace{ID: "8000105", Name: "Frankfurt (Main) Hbf"},
				PlannedDeparture: &dep,
				PlannedArrival:   &arr,
				Line: &hafas.HAFASLine{
					Name:     "ICE 123",
					Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"},
				},
			},
		},
	}

	j := hafas.MapHAFASJourney(
		hj,
		"jrn_test001",
		"install-1",
		"ICE 123",
		journey.StationRef{ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		nil,
		dep,
	)

	if j.ID != "jrn_test001" {
		t.Errorf("ID: got %q", j.ID)
	}
	if j.Summary.ETA.IsZero() {
		t.Error("ETA must not be zero")
	}
	if len(j.Legs) != 1 {
		t.Fatalf("expected 1 leg, got %d", len(j.Legs))
	}
	if j.Legs[0].VehicleNumber != "ICE 123" {
		t.Errorf("VehicleNumber: got %q", j.Legs[0].VehicleNumber)
	}
}

func TestMapHAFASJourney_ComputesTransferBuffer(t *testing.T) {
	t1dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	t1arr, _ := time.Parse(time.RFC3339, "2026-06-10T16:00:00Z")
	t2dep, _ := time.Parse(time.RFC3339, "2026-06-10T16:12:00Z") // 12-min buffer
	t2arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:30:00Z")

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin: hafas.HAFASPlace{ID: "A", Name: "A"}, Destination: hafas.HAFASPlace{ID: "B", Name: "B"},
				PlannedDeparture: &t1dep, PlannedArrival: &t1arr,
				Line: &hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
			},
			{
				Origin: hafas.HAFASPlace{ID: "B", Name: "B"}, Destination: hafas.HAFASPlace{ID: "C", Name: "C"},
				PlannedDeparture: &t2dep, PlannedArrival: &t2arr,
				Line: &hafas.HAFASLine{Name: "RE 42", Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}},
			},
		},
	}

	j := hafas.MapHAFASJourney(hj, "jrn_x", "inst", "ICE 1",
		journey.StationRef{ID: "C", Name: "C"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		nil, t1dep)

	if j.Summary.MinTransferBufferMinutes == nil {
		t.Fatal("MinTransferBufferMinutes must not be nil for journey with transfer")
	}
	if *j.Summary.MinTransferBufferMinutes != 12 {
		t.Errorf("MinTransferBufferMinutes: got %d, want 12", *j.Summary.MinTransferBufferMinutes)
	}
}

func TestMapHAFASJourney_TimeGainVsOriginal(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr, _ := time.Parse(time.RFC3339, "2026-06-10T17:24:00Z")
	originalETA, _ := time.Parse(time.RFC3339, "2026-06-10T18:00:00Z") // 36 min later

	hj := hafas.HAFASJourney{
		Legs: []hafas.HAFASLeg{
			{
				Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
				PlannedDeparture: &dep, PlannedArrival: &arr,
				Line: &hafas.HAFASLine{Name: "RE 1", Operator: &hafas.HAFASOperator{Name: "DB Regio AG"}},
			},
		},
	}

	j := hafas.MapHAFASJourney(hj, "jrn_x", "inst", "ICE 1",
		journey.StationRef{ID: "B"},
		journey.Filters{SafetyLevel: journey.SafetyLevelNormal},
		&originalETA, dep)

	if j.Summary.TimeGainVsOriginalMinutes == nil {
		t.Fatal("TimeGainVsOriginalMinutes must not be nil when originalETA provided")
	}
	if *j.Summary.TimeGainVsOriginalMinutes != 36 {
		t.Errorf("TimeGainVsOriginalMinutes: got %d, want 36", *j.Summary.TimeGainVsOriginalMinutes)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/hafas/... -run TestMapHAFAS -v
```

Expected: `FAIL`

- [ ] **Step 3: Append to mapper.go**

Append the following to `backend/internal/hafas/mapper.go` (after the existing functions):

```go
// MapHAFASJourney converts a HAFASJourney to the internal Journey model.
// now is used for status computation (caller passes time.Now() in production).
func MapHAFASJourney(
	hj HAFASJourney,
	id, installID, trainNumber string,
	destination journey.StationRef,
	filters journey.Filters,
	originalETA *time.Time,
	now time.Time,
) journey.Journey {
	legs := mapLegs(hj.Legs)
	stops := collectStops(hj.Legs)
	summary := computeSummary(legs, destination, filters, originalETA, now)

	return journey.Journey{
		ID:          id,
		InstallID:   installID,
		TrainNumber: trainNumber,
		Destination: destination,
		Filters:     filters,
		Summary:     summary,
		Legs:        legs,
		Stops:       stops,
		ETagEpoch:   now.Unix(),
		ETagCounter: 1,
		CreatedAt:   now,
	}
}

func mapLegs(hafasLegs []HAFASLeg) []journey.Leg {
	legs := make([]journey.Leg, 0, len(hafasLegs))
	for i, hl := range hafasLegs {
		leg := journey.Leg{
			LegID:            fmt.Sprintf("leg_%02d", i+1),
			IsWalkingSegment: hl.Walking,
			Stops:            mapStopovers(hl.Stopovers),
		}
		if hl.Line != nil {
			leg.VehicleNumber = hl.Line.Name
			leg.LineName = hl.Line.Name
			if hl.Line.Operator != nil {
				leg.Operator = hl.Line.Operator.Name
			}
		}
		if hl.TripId != nil {
			leg.TripID = *hl.TripId
		}

		dep := firstNonNil(hl.PlannedDeparture, hl.Departure)
		arr := firstNonNil(hl.PlannedArrival, hl.Arrival)
		if dep != nil {
			leg.DepartureTimePlanned = *dep
		}
		if arr != nil {
			leg.ArrivalTimePlanned = *arr
		}
		if hl.Departure != nil && hl.PlannedDeparture != nil && !hl.Departure.Equal(*hl.PlannedDeparture) {
			leg.DepartureTimeActual = hl.Departure
		}
		if hl.Arrival != nil && hl.PlannedArrival != nil && !hl.Arrival.Equal(*hl.PlannedArrival) {
			leg.ArrivalTimeActual = hl.Arrival
		}
		if hl.ArrivalDelay != nil {
			mins := *hl.ArrivalDelay / 60
			leg.DelayMinutes = &mins
		}
		leg.PlatformPlanned = firstNonNilStr(hl.PlannedDeparturePlatform, hl.PlannedArrivalPlatform)
		leg.PlatformActual = firstNonNilStr(hl.DeparturePlatform, hl.ArrivalPlatform)
		leg.Status = inferLegStatus(hl)
		legs = append(legs, leg)
	}
	return legs
}

func mapStopovers(ss []HAFASStopover) []journey.Stop {
	stops := make([]journey.Stop, 0, len(ss))
	for _, s := range ss {
		stop := journey.Stop{
			StationID:   s.Stop.ID,
			StationName: s.Stop.Name,
		}
		planned := firstNonNil(s.PlannedArrival, s.Arrival)
		if planned != nil {
			stop.ArrivalTimePlanned = *planned
		}
		if s.Arrival != nil && s.PlannedArrival != nil && !s.Arrival.Equal(*s.PlannedArrival) {
			stop.ArrivalTimeActual = s.Arrival
		}
		depPlanned := firstNonNil(s.PlannedDeparture, s.Departure)
		if depPlanned != nil {
			stop.DepartureTimePlanned = depPlanned
		}
		if s.Departure != nil && s.PlannedDeparture != nil && !s.Departure.Equal(*s.PlannedDeparture) {
			stop.DepartureTimeActual = s.Departure
		}
		if s.ArrivalDelay != nil {
			mins := *s.ArrivalDelay / 60
			stop.DelayMinutes = &mins
		}
		stop.PlatformPlanned = firstNonNilStr(s.PlannedArrivalPlatform, s.PlannedDeparturePlatform)
		stop.PlatformActual = firstNonNilStr(s.ArrivalPlatform, s.DeparturePlatform)
		stops = append(stops, stop)
	}
	return stops
}

func collectStops(hafasLegs []HAFASLeg) []journey.Stop {
	var stops []journey.Stop
	seen := make(map[string]bool)
	for _, leg := range hafasLegs {
		for _, s := range mapStopovers(leg.Stopovers) {
			if !seen[s.StationID] {
				stops = append(stops, s)
				seen[s.StationID] = true
			}
		}
	}
	return stops
}

func inferLegStatus(hl HAFASLeg) journey.LegStatus {
	if hl.Cancelled {
		return journey.LegStatusCancelled
	}
	if (hl.DepartureDelay != nil && *hl.DepartureDelay > 0) ||
		(hl.ArrivalDelay != nil && *hl.ArrivalDelay > 0) {
		return journey.LegStatusDelayed
	}
	now := time.Now()
	dep := firstNonNil(hl.Departure, hl.PlannedDeparture)
	arr := firstNonNil(hl.Arrival, hl.PlannedArrival)
	if dep != nil && arr != nil && now.After(*dep) && now.Before(*arr) {
		return journey.LegStatusRunning
	}
	return journey.LegStatusPlanned
}

func computeSummary(legs []journey.Leg, destination journey.StationRef, filters journey.Filters, originalETA *time.Time, now time.Time) journey.Summary {
	if len(legs) == 0 {
		return journey.Summary{}
	}
	first := legs[0]
	last := legs[len(legs)-1]

	eta := last.ArrivalTimePlanned
	if last.ArrivalTimeActual != nil {
		eta = *last.ArrivalTimeActual
	}

	minBuf := computeMinTransferBuffer(legs)
	threshold := journey.SafetyThresholdMinutes(filters.SafetyLevel)
	criticalTransfer := minBuf != nil && *minBuf < threshold

	var timeGain *int
	if originalETA != nil {
		g := int(originalETA.Sub(eta).Minutes())
		timeGain = &g
	}

	return journey.Summary{
		FromStation:               first.Stops[0].StationName,
		FromTime:                  first.DepartureTimePlanned,
		ToStation:                 destination.Name,
		ToTime:                    last.ArrivalTimePlanned,
		ETA:                       eta,
		TimeGainVsOriginalMinutes: timeGain,
		MinTransferBufferMinutes:  minBuf,
		Status:                    computeStatus(legs, criticalTransfer),
		CriticalTransfer:          criticalTransfer,
		DataConfidence:            computeDataConfidence(legs),
		NextStep:                  computeNextStep(legs, now, destination.ID),
		DataFetchedAt:             now,
		LastUpdatedAt:             now,
	}
}

func computeMinTransferBuffer(legs []journey.Leg) *int {
	var minBuf *int
	for i := 0; i < len(legs)-1; i++ {
		curr, next := legs[i], legs[i+1]
		currArr := firstNonNilTime(curr.ArrivalTimeActual, &curr.ArrivalTimePlanned)
		nextDep := firstNonNilTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
		if currArr == nil || nextDep == nil {
			continue
		}
		buf := int(nextDep.Sub(*currArr).Minutes())
		if minBuf == nil || buf < *minBuf {
			b := buf
			minBuf = &b
		}
	}
	return minBuf
}

func computeStatus(legs []journey.Leg, criticalTransfer bool) journey.Status {
	for _, leg := range legs {
		if leg.Status == journey.LegStatusCancelled {
			return journey.StatusFailed
		}
	}
	if criticalTransfer {
		return journey.StatusCritical
	}
	for _, leg := range legs {
		if leg.Status == journey.LegStatusDelayed {
			return journey.StatusCritical
		}
	}
	return journey.StatusOK
}

func computeDataConfidence(legs []journey.Leg) journey.DataConfidence {
	hasRealtime, missing := false, false
	for _, leg := range legs {
		if leg.DepartureTimeActual != nil || leg.ArrivalTimeActual != nil {
			hasRealtime = true
		} else {
			missing = true
		}
	}
	if hasRealtime && !missing {
		return journey.DataConfidenceHigh
	}
	if hasRealtime {
		return journey.DataConfidenceLow
	}
	return journey.DataConfidenceUnavailable
}

func computeNextStep(legs []journey.Leg, now time.Time, destinationID string) *journey.NextStep {
	for i, leg := range legs {
		dep := firstNonNilTime(leg.DepartureTimeActual, &leg.DepartureTimePlanned)
		arr := firstNonNilTime(leg.ArrivalTimeActual, &leg.ArrivalTimePlanned)
		if dep == nil || arr == nil {
			continue
		}
		// Currently riding this leg
		if now.After(*dep) && now.Before(*arr) {
			if i+1 < len(legs) {
				next := legs[i+1]
				nextDep := firstNonNilTime(next.DepartureTimeActual, &next.DepartureTimePlanned)
				buf := 0
				if arr != nil && nextDep != nil {
					buf = int(nextDep.Sub(*arr).Minutes())
				}
				transferStation := ""
				transferStationID := ""
				if len(leg.Stops) > 0 {
					last := leg.Stops[len(leg.Stops)-1]
					transferStation = last.StationName
					transferStationID = last.StationID
				}
				tn := next.VehicleNumber
				return &journey.NextStep{
					Type:          journey.NextStepTransfer,
					StationName:   transferStation,
					StationID:     transferStationID,
					TrainNumber:   &tn,
					DepartureTime: nextDep,
					BufferMinutes: &buf,
					Platform:      next.PlatformActual,
				}
			}
			// On last leg — disembark
			dest := ""
			destID := destinationID
			if len(leg.Stops) > 0 {
				last := leg.Stops[len(leg.Stops)-1]
				dest = last.StationName
			}
			return &journey.NextStep{Type: journey.NextStepDisembark, StationName: dest, StationID: destID}
		}
		// Hasn't departed yet — ride
		if now.Before(*dep) {
			tn := leg.VehicleNumber
			origin := ""
			originID := ""
			if len(leg.Stops) > 0 {
				origin = leg.Stops[0].StationName
				originID = leg.Stops[0].StationID
			}
			return &journey.NextStep{
				Type:        journey.NextStepRide,
				StationName: origin,
				StationID:   originID,
				TrainNumber: &tn,
			}
		}
	}
	return nil
}

func firstNonNil(a, b *time.Time) *time.Time {
	if a != nil {
		return a
	}
	return b
}

func firstNonNilTime(a, b *time.Time) *time.Time {
	return firstNonNil(a, b)
}

func firstNonNilStr(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}
```

Also add `"fmt"` and `"time"` to the existing imports in mapper.go (they may already be present).

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/hafas/... -run TestMapHAFAS -v
```

Expected: `PASS`

- [ ] **Step 5: Run full test suite**

```bash
cd backend && go test ./...
```

Expected: all `PASS`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/hafas/mapper.go backend/internal/hafas/mapper_test.go
git commit -m "feat(backend): HAFAS journey → internal model mapper"
```

---

### Task 4: Routing scorer

**Files:**
- Create: `backend/internal/routing/scorer.go`
- Create: `backend/internal/routing/scorer_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/routing/scorer_test.go
package routing_test

import (
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func makeJourney(eta time.Time, minBuffer *int) journey.Journey {
	return journey.Journey{
		Summary: journey.Summary{
			ETA:                      eta,
			MinTransferBufferMinutes: minBuffer,
		},
	}
}

func intPtr(i int) *int { return &i }

func TestSort_ByETAAscending(t *testing.T) {
	base := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(base.Add(30*time.Minute), nil),
		makeJourney(base.Add(10*time.Minute), nil),
		makeJourney(base.Add(20*time.Minute), nil),
	}
	routing.Sort(journeys)
	if !journeys[0].Summary.ETA.Equal(base.Add(10 * time.Minute)) {
		t.Errorf("first element should have earliest ETA, got %v", journeys[0].Summary.ETA)
	}
}

func TestSort_ByBufferDescendingOnETATie(t *testing.T) {
	eta := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(eta, intPtr(5)),
		makeJourney(eta, intPtr(15)),
		makeJourney(eta, intPtr(3)),
	}
	routing.Sort(journeys)
	if *journeys[0].Summary.MinTransferBufferMinutes != 15 {
		t.Errorf("first element should have highest buffer (15), got %d",
			*journeys[0].Summary.MinTransferBufferMinutes)
	}
}

func TestSort_NilBufferLast(t *testing.T) {
	eta := time.Date(2026, 6, 10, 17, 0, 0, 0, time.UTC)
	journeys := []journey.Journey{
		makeJourney(eta, nil),
		makeJourney(eta, intPtr(8)),
	}
	routing.Sort(journeys)
	if journeys[0].Summary.MinTransferBufferMinutes == nil {
		t.Error("journey with nil buffer should sort after journey with buffer")
	}
}

func TestFilterBetterThan_OnlyKeepsFasterETAs(t *testing.T) {
	base := time.Date(2026, 6, 10, 18, 0, 0, 0, time.UTC)
	reference := base
	journeys := []journey.Journey{
		makeJourney(base.Add(-30*time.Minute), nil), // 30 min faster — keep
		makeJourney(base, nil),                       // same ETA — discard
		makeJourney(base.Add(10*time.Minute), nil),   // slower — discard
	}
	filtered := routing.FilterBetterThan(journeys, reference)
	if len(filtered) != 1 {
		t.Errorf("expected 1 alternative, got %d", len(filtered))
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/routing/... -run TestSort -run TestFilter -v
```

Expected: `FAIL`

- [ ] **Step 3: Write scorer.go**

```go
// backend/internal/routing/scorer.go
package routing

import (
	"sort"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// Sort sorts journeys in-place by: ETA asc → minBuffer desc → criticalTransfers asc → numLegs asc.
func Sort(journeys []journey.Journey) {
	sort.SliceStable(journeys, func(i, j int) bool {
		a, b := journeys[i].Summary, journeys[j].Summary
		if !a.ETA.Equal(b.ETA) {
			return a.ETA.Before(b.ETA)
		}
		aBuf := bufVal(a.MinTransferBufferMinutes)
		bBuf := bufVal(b.MinTransferBufferMinutes)
		if aBuf != bBuf {
			return aBuf > bBuf // higher buffer is better
		}
		aLegs, bLegs := len(journeys[i].Legs), len(journeys[j].Legs)
		return aLegs < bLegs
	})
}

// FilterBetterThan returns only journeys whose ETA is strictly before referenceETA.
func FilterBetterThan(journeys []journey.Journey, referenceETA time.Time) []journey.Journey {
	var out []journey.Journey
	for _, j := range journeys {
		if j.Summary.ETA.Before(referenceETA) {
			out = append(out, j)
		}
	}
	return out
}

func bufVal(p *int) int {
	if p == nil {
		return -1 // nil buffer sorts worse than any real buffer
	}
	return *p
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/routing/... -run TestSort -run TestFilter -v
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add backend/internal/routing/scorer.go backend/internal/routing/scorer_test.go
git commit -m "feat(backend): routing scorer — sort and filter alternatives"
```

---

### Task 5: Routing engine interface + BFS

**Files:**
- Create: `backend/internal/routing/engine.go`
- Create: `backend/internal/routing/bfs.go`
- Create: `backend/internal/routing/bfs_test.go`

- [ ] **Step 1: Write engine.go**

```go
// backend/internal/routing/engine.go
package routing

import (
	"context"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// RoutingRequest carries all inputs for a routing computation.
type RoutingRequest struct {
	TrainNumber    string
	FromStationID  string // origin of the user's train
	ToStationID    string // user's destination (HAFAS station ID)
	ToStationName  string
	DepartureAfter time.Time
	Filters        journey.Filters
	InstallID      string
}

// RoutingResult holds the user's current journey and the ranked alternatives.
type RoutingResult struct {
	Original    journey.Journey
	Alternatives []journey.Alternative
	Plausibility journey.Plausibility
}

// Engine is the routing interface. BFSEngine is the MVP implementation.
// Swap for RAPTOR behind this interface when timetable data is available.
type Engine interface {
	Route(ctx context.Context, req RoutingRequest) (*RoutingResult, error)
}
```

- [ ] **Step 2: Write failing BFS test**

```go
// backend/internal/routing/bfs_test.go
package routing_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func newBFSEngine(t *testing.T, handler http.HandlerFunc) routing.Engine {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     5,
		HAFASCBProbeInterval: 30 * time.Second,
	})
	return routing.NewBFSEngine(client, &hafas.Coalescer{})
}

func TestBFS_ReturnsOriginalAndAlternatives(t *testing.T) {
	dep1, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arr1, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z") // original: arrives 17:00
	dep2, _ := time.Parse(time.RFC3339, "2026-06-10T14:30:00Z")
	arr2, _ := time.Parse(time.RFC3339, "2026-06-10T16:30:00Z") // alt: arrives 16:30 — better

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/trips" {
			json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{
				Trips: []hafas.HAFASTrip{
					{
						Line:        hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
						Origin:      hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
						Destination: hafas.HAFASPlace{ID: "8011160", Name: "Berlin Hbf"},
						Departure:   &dep1,
						Stopovers: []hafas.HAFASStopover{
							{Stop: hafas.HAFASPlace{ID: "8000261"}, PlannedDeparture: &dep1},
							{Stop: hafas.HAFASPlace{ID: "8000105"}, PlannedArrival: &arr1},
						},
					},
				},
			})
			return
		}
		// /journeys endpoint
		json.NewEncoder(w).Encode(hafas.HAFASJourneysResponse{
			Journeys: []hafas.HAFASJourney{
				{ // original — has ICE 123
					Legs: []hafas.HAFASLeg{{
						Origin: hafas.HAFASPlace{ID: "8000261"}, Destination: hafas.HAFASPlace{ID: "8000105"},
						PlannedDeparture: &dep1, PlannedArrival: &arr1,
						Line: &hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
					}},
				},
				{ // alternative — arrives earlier
					Legs: []hafas.HAFASLeg{{
						Origin: hafas.HAFASPlace{ID: "8000261"}, Destination: hafas.HAFASPlace{ID: "8000105"},
						PlannedDeparture: &dep2, PlannedArrival: &arr2,
						Line: &hafas.HAFASLine{Name: "ICE 456", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
					}},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	client := hafas.NewClient(config.Config{
		HAFASBaseURL: srv.URL, HAFASRequestTimeout: 5 * time.Second,
		HAFASCBThreshold: 5, HAFASCBProbeInterval: 30 * time.Second,
	})
	engine := routing.NewBFSEngine(client, &hafas.Coalescer{})

	result, err := engine.Route(context.Background(), routing.RoutingRequest{
		TrainNumber:    "ICE 123",
		FromStationID:  "8000261",
		ToStationID:    "8000105",
		ToStationName:  "Frankfurt (Main) Hbf",
		DepartureAfter: dep1,
		Filters:        journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal},
		InstallID:      "test-install",
	})
	if err != nil {
		t.Fatalf("Route error: %v", err)
	}
	if result.Original.TrainNumber != "ICE 123" {
		t.Errorf("original train: got %q", result.Original.TrainNumber)
	}
	if len(result.Alternatives) != 1 {
		t.Errorf("expected 1 alternative, got %d", len(result.Alternatives))
	}
}

func TestBFS_DBOnlyFilterExcludesNonDB(t *testing.T) {
	dep, _ := time.Parse(time.RFC3339, "2026-06-10T14:00:00Z")
	arrOrig, _ := time.Parse(time.RFC3339, "2026-06-10T17:00:00Z")
	arrAlt, _ := time.Parse(time.RFC3339, "2026-06-10T16:00:00Z")

	engine := newBFSEngine(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/trips" {
			json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{
				Trips: []hafas.HAFASTrip{{
					Line: hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
					Origin: hafas.HAFASPlace{ID: "A"},
					Stopovers: []hafas.HAFASStopover{{Stop: hafas.HAFASPlace{ID: "A"}, PlannedDeparture: &dep}},
				}},
			})
			return
		}
		json.NewEncoder(w).Encode(hafas.HAFASJourneysResponse{
			Journeys: []hafas.HAFASJourney{
				{Legs: []hafas.HAFASLeg{{ // original
					Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
					PlannedDeparture: &dep, PlannedArrival: &arrOrig,
					Line: &hafas.HAFASLine{Name: "ICE 1", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
				}}},
				{Legs: []hafas.HAFASLeg{{ // Flixtrain — must be filtered
					Origin: hafas.HAFASPlace{ID: "A"}, Destination: hafas.HAFASPlace{ID: "B"},
					PlannedDeparture: &dep, PlannedArrival: &arrAlt,
					Line: &hafas.HAFASLine{Name: "FLX 1", Operator: &hafas.HAFASOperator{Name: "Flixtrain"}},
				}}},
			},
		})
	})

	result, err := engine.Route(context.Background(), routing.RoutingRequest{
		TrainNumber: "ICE 1", FromStationID: "A", ToStationID: "B",
		DepartureAfter: dep,
		Filters:        journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal},
		InstallID:      "test",
	})
	if err != nil {
		t.Fatalf("Route error: %v", err)
	}
	if len(result.Alternatives) != 0 {
		t.Errorf("Flixtrain should be filtered out; got %d alternatives", len(result.Alternatives))
	}
}
```

- [ ] **Step 3: Run test — expect failure**

```bash
cd backend && go test ./internal/routing/... -run TestBFS -v
```

Expected: `FAIL`

- [ ] **Step 4: Write bfs.go**

```go
// backend/internal/routing/bfs.go
package routing

import (
	"context"
	"strings"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

// BFSEngine is the MVP routing engine — delegates graph traversal to HAFAS,
// applies filter + ranking on top of returned results.
type BFSEngine struct {
	hafas     *hafas.Client
	coalescer *hafas.Coalescer
}

// NewBFSEngine creates a BFSEngine.
func NewBFSEngine(h *hafas.Client, c *hafas.Coalescer) *BFSEngine {
	return &BFSEngine{hafas: h, coalescer: c}
}

func (e *BFSEngine) Route(ctx context.Context, req RoutingRequest) (*RoutingResult, error) {
	// 1. Find trip metadata for plausibility + origin station
	trips, err := e.hafas.SearchTrips(ctx, req.TrainNumber, 3)
	if err != nil {
		return nil, err
	}
	plausibility := computePlausibility(trips, req.TrainNumber, req.ToStationID)

	fromID := req.FromStationID
	if len(trips) > 0 && trips[0].Origin.ID != "" {
		fromID = trips[0].Origin.ID
	}

	// 2. Search all connections from origin to destination
	hafasJourneys, err := e.hafas.SearchJourneys(ctx, fromID, req.ToStationID, req.DepartureAfter, 10)
	if err != nil {
		return nil, err
	}

	// 3. Find the original journey (contains user's train in first leg)
	origIdx := findOriginalIndex(hafasJourneys, req.TrainNumber)

	now := req.DepartureAfter // use departure time as "now" for initial mapping

	var originalJourney journey.Journey
	if origIdx >= 0 {
		originalJourney = hafas.MapHAFASJourney(
			hafasJourneys[origIdx],
			journey.NewID(), req.InstallID, req.TrainNumber,
			journey.StationRef{ID: req.ToStationID, Name: req.ToStationName},
			req.Filters, nil, now,
		)
	}

	// 4. Map and filter alternatives
	var candidates []journey.Journey
	for i, hj := range hafasJourneys {
		if i == origIdx {
			continue // skip the original
		}
		if req.Filters.DBOnly && !hafas.IsDBOnlyJourney(hj.Legs) {
			continue
		}
		if req.Filters.MaxTransfers != nil {
			transfers := countTransfers(hj.Legs)
			if transfers > *req.Filters.MaxTransfers {
				continue
			}
		}
		j := hafas.MapHAFASJourney(
			hj,
			journey.NewID(), req.InstallID, req.TrainNumber,
			journey.StationRef{ID: req.ToStationID, Name: req.ToStationName},
			req.Filters, &originalJourney.Summary.ETA, now,
		)
		candidates = append(candidates, j)
	}

	// 5. Keep only alternatives that arrive before the original
	if origIdx >= 0 {
		candidates = FilterBetterThan(candidates, originalJourney.Summary.ETA)
	}
	Sort(candidates)

	// 6. Convert to Alternative slice (top 5)
	limit := 5
	if len(candidates) < limit {
		limit = len(candidates)
	}
	alts := make([]journey.Alternative, limit)
	for i, c := range candidates[:limit] {
		alts[i] = journey.Alternative{
			JourneyID: c.ID,
			Summary:   c.Summary,
			Legs:      c.Legs,
		}
	}

	// Set alternativeAvailable on original
	if len(alts) > 0 {
		originalJourney.Summary.AlternativeAvailable = true
	}

	return &RoutingResult{
		Original:     originalJourney,
		Alternatives: alts,
		Plausibility: plausibility,
	}, nil
}

func findOriginalIndex(journeys []hafas.HAFASJourney, trainNumber string) int {
	norm := hafas.NormalizeTrainNumber(trainNumber)
	for i, j := range journeys {
		for _, leg := range j.Legs {
			if leg.Line != nil && hafas.NormalizeTrainNumber(leg.Line.Name) == norm {
				return i
			}
		}
	}
	return -1
}

func countTransfers(legs []hafas.HAFASLeg) int {
	transfers := 0
	for _, leg := range legs {
		if !leg.Walking {
			transfers++
		}
	}
	if transfers > 0 {
		return transfers - 1
	}
	return 0
}

func computePlausibility(trips []hafas.HAFASTrip, trainNumber, toStationID string) journey.Plausibility {
	norm := hafas.NormalizeTrainNumber(trainNumber)
	for _, t := range trips {
		if hafas.NormalizeTrainNumber(t.Line.Name) != norm {
			continue
		}
		for _, s := range t.Stopovers {
			if s.Stop.ID == toStationID {
				confidence := "high"
				reason := (*string)(nil)
				if s.Cancelled {
					confidence = "low"
					r := "destination stop is cancelled"
					reason = &r
				}
				return journey.Plausibility{OnTrainConfidence: confidence, Reason: reason}
			}
		}
		// Train found but destination not in stops
		r := "destination is not a stop on this train"
		return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
	}
	if len(trips) == 0 {
		r := "train not found in HAFAS"
		return journey.Plausibility{OnTrainConfidence: "unknown", Reason: &r}
	}
	_ = strings.ToLower // suppress unused import
	r := "train found but destination not matched"
	return journey.Plausibility{OnTrainConfidence: "low", Reason: &r}
}
```

- [ ] **Step 5: Run BFS tests — expect pass**

```bash
cd backend && go test ./internal/routing/... -v
```

Expected: all `PASS`

- [ ] **Step 6: Commit**

```bash
git add backend/internal/routing/
git commit -m "feat(backend): BFS routing engine with filter, rank, plausibility"
```

---

### Task 6: Journey create + get + delete handlers

**Files:**
- Create: `backend/internal/api/handlers/journeys.go`
- Create: `backend/internal/api/handlers/journeys_test.go`

- [ ] **Step 1: Write failing test**

```go
// backend/internal/api/handlers/journeys_test.go
package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// mockStore is an in-memory Store for handler tests.
type mockStore struct {
	journeys map[string]*journey.Journey
	alts     map[string][]journey.Alternative
}

func newMockStore() *mockStore {
	return &mockStore{
		journeys: make(map[string]*journey.Journey),
		alts:     make(map[string][]journey.Alternative),
	}
}
func (m *mockStore) Create(_ context.Context, j *journey.Journey, alts []journey.Alternative) error {
	m.journeys[j.ID] = j
	m.alts[j.ID] = alts
	return nil
}
func (m *mockStore) Get(_ context.Context, id string) (*journey.Journey, error) {
	j, ok := m.journeys[id]
	if !ok {
		return nil, journey.ErrNotFound
	}
	return j, nil
}
func (m *mockStore) GetAlternatives(_ context.Context, id string) ([]journey.Alternative, string, error) {
	return m.alts[id], id + ":alts:1", nil
}
func (m *mockStore) UpdateState(_ context.Context, _ string, _ journey.Summary, _ []journey.Leg, _ bool) error {
	return nil
}
func (m *mockStore) UpdateAlternatives(_ context.Context, id string, alts []journey.Alternative) error {
	m.alts[id] = alts
	return nil
}
func (m *mockStore) Terminate(_ context.Context, id string) error {
	if _, ok := m.journeys[id]; !ok {
		return journey.ErrNotFound
	}
	delete(m.journeys, id)
	return nil
}
func (m *mockStore) GetActive(_ context.Context, _ int) ([]journey.Journey, error)   { return nil, nil }
func (m *mockStore) CountActive(_ context.Context) (int, error)                       { return 0, nil }
func (m *mockStore) GetIdempotency(_ context.Context, _ string) (*journey.IdempotencyEntry, error) {
	return nil, nil
}
func (m *mockStore) SetIdempotency(_ context.Context, _ string, _ journey.IdempotencyEntry) error {
	return nil
}

// mockEngine returns a fixed RoutingResult.
type mockEngine struct {
	result *routing.RoutingResult
}

func (e *mockEngine) Route(_ context.Context, _ routing.RoutingRequest) (*routing.RoutingResult, error) {
	return e.result, nil
}

func newTestJourneysHandler(store journey.Store, engine routing.Engine, max int) *handlers.JourneysHandler {
	return handlers.NewJourneysHandler(store, engine, max)
}

func TestCreateJourney_Returns201(t *testing.T) {
	store := newMockStore()
	eta := time.Now().Add(3 * time.Hour)
	engine := &mockEngine{result: &routing.RoutingResult{
		Original: journey.Journey{
			ID: "jrn_testid00000000000000000",
			Summary: journey.Summary{
				ETA: eta, Status: journey.StatusOK,
				DataFetchedAt: time.Now(), LastUpdatedAt: time.Now(),
			},
		},
		Alternatives: []journey.Alternative{},
		Plausibility: journey.Plausibility{OnTrainConfidence: "high"},
	}}

	h := newTestJourneysHandler(store, engine, 2000)

	body := `{"trainNumber":"ICE 123","destination":"8000105","iAmOnThisTrain":true}`
	req := httptest.NewRequest(http.MethodPost, "/v1/journeys",
		bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Location") == "" {
		t.Error("Location header must be set")
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["journeyId"] == "" {
		t.Error("journeyId missing in response")
	}
}

func TestCreateJourney_MissingTrainNumber_Returns422(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	body := `{"destination":"8000105"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/journeys", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rr.Code)
	}
}

func TestGetJourney_Returns200(t *testing.T) {
	store := newMockStore()
	j := &journey.Journey{
		ID: "jrn_test00000000000000000001",
		Summary: journey.Summary{ETA: time.Now(), DataFetchedAt: time.Now(), LastUpdatedAt: time.Now()},
		Legs: []journey.Leg{}, Stops: []journey.Stop{},
	}
	store.journeys[j.ID] = j

	h := newTestJourneysHandler(store, &mockEngine{}, 2000)

	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}", h.Get)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/journeys/"+j.ID, nil))

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestGetJourney_NotFound_Returns404(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}", h.Get)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_notexist0000000000000", nil))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestDeleteJourney_Returns204(t *testing.T) {
	store := newMockStore()
	store.journeys["jrn_del00000000000000000001"] = &journey.Journey{ID: "jrn_del00000000000000000001"}

	h := newTestJourneysHandler(store, &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Delete("/v1/journeys/{id}", h.Delete)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/v1/journeys/jrn_del00000000000000000001", nil))
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestDeleteJourney_NotFound_Returns404(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Delete("/v1/journeys/{id}", h.Delete)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/v1/journeys/jrn_notexist0000000000000", nil))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd backend && go test ./internal/api/handlers/... -run TestCreateJourney -run TestGetJourney -run TestDeleteJourney -v
```

Expected: `FAIL`

- [ ] **Step 3: Write journeys.go**

```go
// backend/internal/api/handlers/journeys.go
package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// JourneysHandler handles POST/GET/DELETE /v1/journeys[/{id}].
type JourneysHandler struct {
	store     journey.Store
	engine    routing.Engine
	maxActive int
}

func NewJourneysHandler(store journey.Store, engine routing.Engine, maxActive int) *JourneysHandler {
	return &JourneysHandler{store: store, engine: engine, maxActive: maxActive}
}

type createRequest struct {
	TrainNumber    string          `json:"trainNumber"`
	Destination    string          `json:"destination"`
	IAmOnThisTrain bool            `json:"iAmOnThisTrain"`
	Filters        *journey.Filters `json:"filters"`
}

type createResponse struct {
	JourneyID    string               `json:"journeyId"`
	Plausibility journey.Plausibility `json:"plausibility"`
	Summary      journey.Summary      `json:"summary"`
	Alternatives []journey.Alternative `json:"alternatives"`
}

// Create handles POST /v1/journeys.
func (h *JourneysHandler) Create(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); ct != "application/json" {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:malformed-request", Title: "Malformed Request",
			Status: http.StatusBadRequest, Detail: "Content-Type must be application/json.",
		})
		return
	}

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:malformed-request", Title: "Malformed Request",
			Status: http.StatusBadRequest, Detail: "Request body is not valid JSON.",
		})
		return
	}

	// Validate
	var fieldErrors []problem.FieldError
	if req.TrainNumber == "" {
		fieldErrors = append(fieldErrors, problem.FieldError{Field: "trainNumber", Message: "required"})
	}
	if req.Destination == "" {
		fieldErrors = append(fieldErrors, problem.FieldError{Field: "destination", Message: "required"})
	}
	if len(fieldErrors) > 0 {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:validation-error", Title: "Validation Error",
			Status: http.StatusUnprocessableEntity, Errors: fieldErrors,
		})
		return
	}

	filters := journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal}
	if req.Filters != nil {
		filters = *req.Filters
		if filters.SafetyLevel == "" {
			filters.SafetyLevel = journey.SafetyLevelNormal
		}
	}

	// Idempotency-Key handling
	idempKey := r.Header.Get("Idempotency-Key")
	if idempKey != "" {
		bodyHash := hashBody(req)
		existing, _ := h.store.GetIdempotency(r.Context(), idempKey)
		if existing != nil {
			if existing.BodyHash != bodyHash {
				problem.Write(w, r, problem.Problem{
					Type: "urn:verspbegl:error:idempotency-conflict", Title: "Idempotency Conflict",
					Status: http.StatusConflict,
					Detail: "Idempotency-Key was already used with a different request body.",
				})
				return
			}
			// Replay cached response
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotency-Replayed", "true")
			w.WriteHeader(http.StatusOK)
			w.Write(existing.ResponseBody)
			return
		}
	}

	// Capacity check
	count, _ := h.store.CountActive(r.Context())
	if count >= h.maxActive {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:capacity-exceeded", Title: "Service Unavailable",
			Status: http.StatusServiceUnavailable, Detail: "Maximum active journey limit reached.",
		})
		return
	}

	// Route
	result, err := h.engine.Route(r.Context(), routing.RoutingRequest{
		TrainNumber:    req.TrainNumber,
		FromStationID:  "", // BFS will determine from trip data
		ToStationID:    req.Destination,
		DepartureAfter: time.Now(),
		Filters:        filters,
		InstallID:      r.Header.Get("X-Install-Id"),
	})
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:upstream-unavailable", Title: "Service Unavailable",
			Status: http.StatusServiceUnavailable, Detail: "Routing data temporarily unavailable.",
		})
		return
	}

	j := result.Original
	j.InstallID = r.Header.Get("X-Install-Id")

	if err := h.store.Create(r.Context(), &j, result.Alternatives); err != nil {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:internal-error", Title: "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}

	resp := createResponse{
		JourneyID:    j.ID,
		Plausibility: result.Plausibility,
		Summary:      j.Summary,
		Alternatives: result.Alternatives,
	}

	respBody, _ := json.Marshal(resp)

	if idempKey != "" {
		h.store.SetIdempotency(r.Context(), idempKey, journey.IdempotencyEntry{
			JourneyID:    j.ID,
			BodyHash:     hashBody(req),
			StatusCode:   http.StatusCreated,
			ResponseBody: respBody,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Location", "/v1/journeys/"+j.ID)
	w.WriteHeader(http.StatusCreated)
	w.Write(respBody)
}

// Get handles GET /v1/journeys/{id}.
func (h *JourneysHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:journey-not-found", Title: "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:internal-error", Title: "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// Delete handles DELETE /v1/journeys/{id}.
func (h *JourneysHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.Terminate(r.Context(), id); errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type: "urn:verspbegl:error:journey-not-found", Title: "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has already been terminated.", id),
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func hashBody(req createRequest) string {
	b, _ := json.Marshal(req)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && go test ./internal/api/handlers/... -run TestCreateJourney -run TestGetJourney -run TestDeleteJourney -v
```

Expected: `PASS`

- [ ] **Step 5: Run full test suite**

```bash
cd backend && go test ./...
```

Expected: all `PASS`

- [ ] **Step 6: Commit**

```bash
git add backend/internal/api/handlers/journeys.go backend/internal/api/handlers/journeys_test.go
git commit -m "feat(backend): POST/GET/DELETE /v1/journeys handlers with idempotency"
```

---

### Task 7: Wire router + main.go

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
	Health             *handlers.HealthHandler
	Stations           *handlers.StationsHandler
	Trains             *handlers.TrainsHandler
	Journeys           *handlers.JourneysHandler
	Logger             *slog.Logger
	CORSOrigins        []string
	InstallRateLimiter *mw.RateLimiter
	IPRateLimiter      *mw.RateLimiter
	PerInstallLimit    int
	PerIPLimit         int
	// Summary, Legs, Alternatives handlers added in Plan 4
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

		r.Post("/journeys", deps.Journeys.Create)
		r.Get("/journeys/{id}", deps.Journeys.Get)
		r.Delete("/journeys/{id}", deps.Journeys.Delete)
		// summary, legs, alternatives added in Plan 4
	})

	return r
}
```

- [ ] **Step 2: Update main.go**

Replace `cmd/server/main.go`:

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
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/migrate"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
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
	store := journey.NewStore(db, rdb, cfg.JourneyTTLHours, cfg.DBWriteTimeout)
	engine := routing.NewBFSEngine(hafasClient, &hafas.Coalescer{})

	installLimiter := mw.NewRateLimiter(cfg.RateLimitPerInstall)
	ipLimiter := mw.NewRateLimiter(cfg.RateLimitPerIP)

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
		Journeys:           handlers.NewJourneysHandler(store, engine, cfg.MaxActiveJourneys),
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
		srv.Shutdown(ctx)
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

- [ ] **Step 3: Build**

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
git commit -m "feat(backend): wire journey routes; inject store + engine in main"
```

---

### Task 8: Smoke test — journey creation live

No files created. Manual verification.

- [ ] **Step 1: Start stack**

```bash
docker compose up --build -d
```

- [ ] **Step 2: Validate a train**

```bash
TODAY=$(date +%Y-%m-%d)
curl -s "http://localhost/v1/trains/ICE123?date=$TODAY" | jq .trainNumber
```

Expected: `"ICE 123"` or 404 if train not running today.

- [ ] **Step 3: Find a station ID**

```bash
curl -s "http://localhost/v1/stations?q=Frankfurt" | jq '.stations[0]'
```

Note the `id` field (e.g. `"8000105"`).

- [ ] **Step 4: Create a journey**

```bash
curl -s -X POST http://localhost/v1/journeys \
  -H "Content-Type: application/json" \
  -H "X-Install-Id: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  -d '{"trainNumber":"ICE 123","destination":"8000105","iAmOnThisTrain":true}' | jq .
```

Expected: 201 with `journeyId`, `plausibility`, `summary`, `alternatives`.

- [ ] **Step 5: Retrieve the journey**

```bash
JOURNEY_ID=<journeyId from above>
curl -s "http://localhost/v1/journeys/$JOURNEY_ID" | jq .summary.status
```

Expected: `"ok"` or `"critical"`.

- [ ] **Step 6: Delete the journey**

```bash
curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost/v1/journeys/$JOURNEY_ID"
```

Expected: `204`

- [ ] **Step 7: Verify deleted**

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost/v1/journeys/$JOURNEY_ID"
```

Expected: `404`

- [ ] **Step 8: Stop stack**

```bash
docker compose down
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(backend): Plan 3 complete — journey creation, get, delete"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered |
|-------------|---------|
| `POST /v1/journeys` → 201 + journeyId + plausibility + alternatives | ✓ Task 6 |
| `POST /v1/journeys` with `Idempotency-Key` → replay or 409 | ✓ Task 6 |
| `GET /v1/journeys/{id}` → full journey (summary + legs + stops) | ✓ Task 6 |
| `DELETE /v1/journeys/{id}` → 204 or 404 (non-idempotent) | ✓ Task 6 |
| Capacity check → 503 when `MAX_ACTIVE_JOURNEYS` reached | ✓ Task 6 |
| DB-only filter applied when `filters.dbOnly=true` | ✓ Task 5 |
| `maxTransfers` filter | ✓ Task 5 |
| Alternatives ranked: ETA → buffer → transfers | ✓ Task 4 |
| Only alternatives with `eta < originalETA` returned | ✓ Task 4+5 |
| Plausibility: high/low/unknown based on HAFAS trip data | ✓ Task 5 |
| Write-through: Postgres then Redis on create | ✓ Task 2 |
| Redis TTL = `JOURNEY_TTL_HOURS` (default 2h) | ✓ Task 2 |
| ETag format `<id>:<epoch>:<counter>` on Journey | ✓ model.go Task 2 |
| Journey ID matches `^jrn_[0-9a-z]{26}$` | ✓ Task 1 |
| RFC 7807 errors on all 4xx/5xx | ✓ Task 6 |
| `Location` header on 201 | ✓ Task 6 |

**Not in Plan 3 (deferred to Plan 4):**
- Poller goroutines (background HAFAS polling)
- `GET /v1/journeys/{id}/summary` (ETag polling)
- `GET /v1/journeys/{id}/legs`
- `GET /v1/journeys/{id}/alternatives`
- `POST /v1/journeys/{id}/alternatives` (re-trigger)
- Prometheus metrics
- Boot recovery

**Placeholder scan:** None found.

**Type consistency:**
- `journey.Store` interface defined in `store.go`, used in `journeys.go` and mocked in `journeys_test.go`
- `routing.Engine` interface defined in `engine.go`, used in `journeys.go` and mocked in `journeys_test.go`
- `journey.NewID()` used in `bfs.go` for all journey IDs
- `hafas.MapHAFASJourney` signature matches all call sites in `bfs.go` and `mapper_test.go`

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-11-backend-plan-3-journey-creation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans

Which approach?
