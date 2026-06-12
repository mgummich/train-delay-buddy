// backend/internal/journey/store.go
package journey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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

// journeyCacheEntry is the Redis wire format for a Journey.
// It includes fields that are json:"-" on Journey (excluded from the public API).
type journeyCacheEntry struct {
	Journey
	CacheInstallID    string     `json:"_installId"`
	CacheETagEpoch    int64      `json:"_etagEpoch"`
	CacheETagCounter  int        `json:"_etagCounter"`
	CacheCreatedAt    time.Time  `json:"_createdAt"`
	CacheTerminatedAt *time.Time `json:"_terminatedAt,omitempty"`
	CacheLastPolledAt *time.Time `json:"_lastPolledAt,omitempty"`
}

func newCacheEntry(j *Journey) journeyCacheEntry {
	return journeyCacheEntry{
		Journey:           *j,
		CacheInstallID:    j.InstallID,
		CacheETagEpoch:    j.ETagEpoch,
		CacheETagCounter:  j.ETagCounter,
		CacheCreatedAt:    j.CreatedAt,
		CacheTerminatedAt: j.TerminatedAt,
		CacheLastPolledAt: j.LastPolledAt,
	}
}

func (e journeyCacheEntry) toJourney() *Journey {
	j := e.Journey
	j.InstallID    = e.CacheInstallID
	j.ETagEpoch    = e.CacheETagEpoch
	j.ETagCounter  = e.CacheETagCounter
	j.CreatedAt    = e.CacheCreatedAt
	j.TerminatedAt = e.CacheTerminatedAt
	j.LastPolledAt = e.CacheLastPolledAt
	return &j
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
	log      *slog.Logger
}

// NewStore creates a RedisPostgresStore with the given dependencies.
func NewStore(db *pgxpool.Pool, rdb *redis.Client, ttlHours int, writeTimeout time.Duration, log *slog.Logger) *RedisPostgresStore {
	return &RedisPostgresStore{
		db:       db,
		rdb:      rdb,
		ttl:      time.Duration(ttlHours) * time.Hour,
		writeTTL: writeTimeout,
		log:      log,
	}
}

func redisKey(id string) string  { return "journey:" + id }
func altsKey(id string) string   { return "alts:" + id }
func idempKey(key string) string { return "idemp:" + key }

// Create writes to Postgres synchronously, then to Redis.
func (s *RedisPostgresStore) Create(ctx context.Context, j *Journey, alts []Alternative) error {
	summaryJSON, _ := json.Marshal(j.Summary)
	legsJSON, _ := json.Marshal(j.Legs)
	stopsJSON, _ := json.Marshal(j.Stops)
	filtersJSON, _ := json.Marshal(j.Filters)

	wctx, cancel := context.WithTimeout(ctx, s.writeTTL)
	defer cancel()

	// C3: include etag_epoch ($11) in the INSERT so it is persisted and survives Postgres fallback.
	_, err := s.db.Exec(wctx, `
		INSERT INTO journeys
			(id, install_id, train_number, destination_id, destination_name,
			 filters_json, summary_json, legs_json, stops_json, etag_counter, etag_epoch)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		j.ID, j.InstallID, j.TrainNumber,
		j.Destination.ID, j.Destination.Name,
		filtersJSON, summaryJSON, legsJSON, stopsJSON,
		j.ETagCounter, j.ETagEpoch,
	)
	if err != nil {
		return fmt.Errorf("store.Create postgres: %w", err)
	}

	if err := s.writeToRedis(ctx, j, alts); err != nil {
		s.log.Warn("store.Create: redis cache write failed (non-fatal)", "error", err, "journeyId", j.ID)
	}
	return nil
}

// writeToRedis writes the journey cache entry and, when alts is non-nil, the alts record.
// C1: skip the alts key write when alts == nil so UpdateState never resets the alts counter.
// C2: use journeyCacheEntry (newCacheEntry) so json:"-" operational fields survive the round-trip.
func (s *RedisPostgresStore) writeToRedis(ctx context.Context, j *Journey, alts []Alternative) error {
	entry := newCacheEntry(j)
	jBytes, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	pipe := s.rdb.Pipeline()
	pipe.Set(ctx, redisKey(j.ID), jBytes, s.ttl)

	if alts != nil {
		altsRec := AltsRecord{Counter: 1, Items: alts}
		aBytes, _ := json.Marshal(altsRec)
		pipe.Set(ctx, altsKey(j.ID), aBytes, s.ttl)
	}

	_, err = pipe.Exec(ctx)
	return err
}

// Get reads from Redis; on miss or Redis error, reconstructs from Postgres and re-warms Redis.
// C2: unmarshal into journeyCacheEntry to restore operational fields (InstallID, ETagEpoch, etc.).
func (s *RedisPostgresStore) Get(ctx context.Context, id string) (*Journey, error) {
	raw, err := s.rdb.Get(ctx, redisKey(id)).Bytes()
	if err == nil {
		var entry journeyCacheEntry
		if err := json.Unmarshal(raw, &entry); err == nil {
			return entry.toJourney(), nil
		}
	} else if !errors.Is(err, redis.Nil) {
		// Redis error (not cache miss) — log and fall through to Postgres
		_ = err // fall through
	}
	// Redis miss or error — reconstruct from Postgres
	return s.getFromPostgres(ctx, id)
}

func (s *RedisPostgresStore) getFromPostgres(ctx context.Context, id string) (*Journey, error) {
	var j Journey
	var summaryJSON, legsJSON, stopsJSON, filtersJSON []byte
	var terminatedAt *time.Time

	// C3: SELECT etag_epoch and scan it — no longer overwrite with time.Now().Unix().
	err := s.db.QueryRow(ctx, `
		SELECT id, install_id, train_number, destination_id, destination_name,
		       filters_json, summary_json, legs_json, stops_json,
		       etag_counter, etag_epoch, created_at, terminated_at, last_polled_at
		FROM journeys WHERE id = $1`, id,
	).Scan(
		&j.ID, &j.InstallID, &j.TrainNumber,
		&j.Destination.ID, &j.Destination.Name,
		&filtersJSON, &summaryJSON, &legsJSON, &stopsJSON,
		&j.ETagCounter, &j.ETagEpoch, &j.CreatedAt, &terminatedAt, &j.LastPolledAt,
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
	if err := json.Unmarshal(summaryJSON, &j.Summary); err != nil {
		return nil, fmt.Errorf("store.Get: corrupt summary: %w", err)
	}
	if err := json.Unmarshal(legsJSON, &j.Legs); err != nil {
		return nil, fmt.Errorf("store.Get: corrupt legs: %w", err)
	}
	if err := json.Unmarshal(stopsJSON, &j.Stops); err != nil {
		return nil, fmt.Errorf("store.Get: corrupt stops: %w", err)
	}
	if err := json.Unmarshal(filtersJSON, &j.Filters); err != nil {
		return nil, fmt.Errorf("store.Get: corrupt filters: %w", err)
	}
	j.TerminatedAt = terminatedAt
	return &j, nil
}

// GetAlternatives returns the alternatives list and its ETag string.
// M3: distinguish redis.Nil (true miss → ErrNotFound) from other Redis errors (return wrapped error).
func (s *RedisPostgresStore) GetAlternatives(ctx context.Context, id string) ([]Alternative, string, error) {
	raw, err := s.rdb.Get(ctx, altsKey(id)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, "", ErrNotFound
		}
		return nil, "", fmt.Errorf("store.GetAlternatives redis: %w", err)
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

	var newCounter int
	if updateLegs {
		legsJSON, _ := json.Marshal(legs)
		if err := s.db.QueryRow(wctx, `
			UPDATE journeys SET summary_json=$1, legs_json=$2,
			etag_counter=etag_counter+1, last_polled_at=now()
			WHERE id=$3 AND terminated_at IS NULL
			RETURNING etag_counter`,
			summaryJSON, legsJSON, id).Scan(&newCounter); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("store.UpdateState postgres: %w", err)
		}
	} else {
		if err := s.db.QueryRow(wctx, `
			UPDATE journeys SET summary_json=$1,
			etag_counter=etag_counter+1, last_polled_at=now()
			WHERE id=$2 AND terminated_at IS NULL
			RETURNING etag_counter`,
			summaryJSON, id).Scan(&newCounter); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
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
	j.ETagCounter = newCounter
	return s.writeToRedis(ctx, j, nil) // nil alts = don't touch alts key (C1)
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
// M4: Redis eviction failure is non-fatal — Postgres is source of truth. Log and return nil.
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
	if _, err := pipe.Exec(ctx); err != nil {
		// Redis eviction failed but Postgres is the source of truth — journey is terminated.
		// Log and continue; next Get will miss Redis and read the terminated row from Postgres.
		s.log.Warn("store.Terminate: redis eviction failed (non-fatal)", "error", err, "journeyId", id)
	}
	return nil
}

// GetActive returns journeys that are not terminated and were created within ttlHours.
func (s *RedisPostgresStore) GetActive(ctx context.Context, ttlHours int) ([]Journey, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, install_id, train_number, destination_id, destination_name,
		       filters_json, summary_json, legs_json, stops_json,
		       etag_counter, etag_epoch, created_at, last_polled_at
		FROM journeys
		WHERE terminated_at IS NULL
		  AND created_at > now() - $1 * interval '1 hour'
		ORDER BY created_at`,
		ttlHours,
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
			&j.ETagCounter, &j.ETagEpoch, &j.CreatedAt, &j.LastPolledAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(summaryJSON, &j.Summary); err != nil {
			s.log.Warn("store.GetActive: skipping corrupt journey", "journeyId", j.ID, "field", "summary", "error", err)
			continue
		}
		if err := json.Unmarshal(legsJSON, &j.Legs); err != nil {
			s.log.Warn("store.GetActive: skipping corrupt journey", "journeyId", j.ID, "field", "legs", "error", err)
			continue
		}
		if err := json.Unmarshal(stopsJSON, &j.Stops); err != nil {
			s.log.Warn("store.GetActive: skipping corrupt journey", "journeyId", j.ID, "field", "stops", "error", err)
			continue
		}
		if err := json.Unmarshal(filtersJSON, &j.Filters); err != nil {
			s.log.Warn("store.GetActive: skipping corrupt journey", "journeyId", j.ID, "field", "filters", "error", err)
			continue
		}
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
		if errors.Is(err, redis.Nil) {
			return nil, nil // cache miss — no entry
		}
		return nil, fmt.Errorf("store.GetIdempotency redis: %w", err)
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
