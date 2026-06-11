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
