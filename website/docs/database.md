---
id: database
title: Database
---

# Database

PostgreSQL 18. One table. Two migrations.

## Schema

```sql
CREATE TABLE journeys (
  id               TEXT PRIMARY KEY,    -- jrn_<ulid>
  install_id       TEXT NOT NULL,       -- device UUID
  train_number     TEXT NOT NULL,
  destination_id   TEXT NOT NULL,       -- HAFAS station ID
  destination_name TEXT NOT NULL,
  filters_json     JSONB NOT NULL,
  summary_json     JSONB NOT NULL,
  legs_json        JSONB NOT NULL,
  stops_json       JSONB NOT NULL,
  etag_epoch       BIGINT  NOT NULL,
  etag_counter     INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  terminated_at    TIMESTAMPTZ,
  last_polled_at   TIMESTAMPTZ
);

CREATE INDEX journeys_active_idx
  ON journeys (last_polled_at)
  WHERE terminated_at IS NULL;
```

## Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | ULID-prefixed PK, monotonic, sortable |
| `install_id` | `TEXT` | Per-device UUIDv7 — ownership + rate-limit attribution |
| `train_number` | `TEXT` | As entered (`ICE 123`, `RE 5`) |
| `destination_id` | `TEXT` | HAFAS station ID |
| `destination_name` | `TEXT` | Cached pretty name |
| `filters_json` | `JSONB` | `{ dbOnly, safetyLevel, maxTransfers }` |
| `summary_json` | `JSONB` | Latest snapshot — ETA, status, confidence, nextStep |
| `legs_json` | `JSONB` | Current legs with realtime times |
| `stops_json` | `JSONB` | All stops across legs (timeline render) |
| `etag_epoch` | `BIGINT` | Bumped on Postgres → Valkey reload |
| `etag_counter` | `INTEGER` | Bumped per state change |
| `created_at` | `TIMESTAMPTZ` | At INSERT |
| `terminated_at` | `TIMESTAMPTZ` | NULL = active; set by DELETE or janitor |
| `last_polled_at` | `TIMESTAMPTZ` | Updated per successful tick; drives janitor GC |

## Indexes

`journeys_active_idx` — partial index, active only. Janitor scans for `last_polled_at < now() - JOURNEY_TTL_HOURS`. Migration 002 clusters the heap on it and sets `fillfactor=70` so tick `UPDATE`s qualify for HOT (Heap-Only Tuple) chains — no index maintenance per tick.

`journeys_install_id_idx` was in 001, removed in 002. Ownership is enforced in Go after PK lookup, so the index added write overhead unused by any query.

## Migrations

Runner: `backend/internal/migrate`.

- Reads `*.sql` under `MIGRATIONS_DIR`.
- Sorts alphabetical (zero-pad names: `001_`, `002_`, …).
- Filters already in `schema_migrations`.
- Applies **one per transaction**, records before commit.

Runs **on every server start**. Failure aborts startup — never half-applied.

| File | What |
|------|------|
| `001_initial.sql` | Creates `journeys` + initial indexes |
| `002_optimize_journeys.sql` | Drops unused `journeys_install_id_idx`, `fillfactor=70`, clusters heap, tunes autovacuum |

### Adding a migration

```bash
touch backend/migrations/003_add_user_preferences.sql
```

```sql
ALTER TABLE journeys ADD COLUMN preferences_json JSONB DEFAULT '{}'::jsonb;
```

Verify:

```bash
docker compose exec postgres psql -U vbb vbb -c "SELECT * FROM schema_migrations ORDER BY applied_at"
```

### Conventions

- **Never modify a shipped migration** — add a new one.
- Idempotent SQL preferred but not required (per-file tx makes re-runs unnecessary).
- Avoid Postgres reserved words (`user`, `order`) as column names.

## Connect directly

```bash
# Docker (prod-style)
docker compose exec postgres psql -U vbb vbb

# Docker (dev — port exposed)
psql postgres://vbb:${POSTGRES_PASSWORD}@localhost:5432/vbb

# One-off
docker compose exec postgres psql -U vbb vbb \
  -c "SELECT id, train_number, summary_json->>'status' AS status, last_polled_at FROM journeys WHERE terminated_at IS NULL ORDER BY last_polled_at DESC LIMIT 10"
```

## Operational queries

```sql
-- active journeys (poller load)
SELECT count(*) FROM journeys WHERE terminated_at IS NULL;

-- stuck (should be GCed but aren't)
SELECT id, last_polled_at FROM journeys
WHERE terminated_at IS NULL
  AND last_polled_at < now() - INTERVAL '2 hours';

-- recently terminated
SELECT id, train_number, terminated_at FROM journeys
WHERE terminated_at > now() - INTERVAL '1 hour'
ORDER BY terminated_at DESC;

-- per-install activity (last day)
SELECT install_id, count(*) FROM journeys
WHERE created_at > now() - INTERVAL '1 day'
GROUP BY install_id ORDER BY count(*) DESC LIMIT 20;

-- operator distribution
SELECT summary_json->'origin'->>'operator' AS operator, count(*)
FROM journeys
WHERE terminated_at IS NULL
GROUP BY 1 ORDER BY 2 DESC;
```

## Backups

Journeys rows are small (&lt;50 KB, retention hours) — `pg_dump` runs in seconds:

```bash
docker compose exec postgres pg_dump -U vbb vbb \
  | gzip > "/backups/vbb-$(date -Iseconds).sql.gz"
```

Restore:

```bash
gunzip < vbb-2026-06-12T03:00:00Z.sql.gz \
  | docker compose exec -T postgres psql -U vbb vbb
```

For robust setups: WAL-G or pgBackRest. Data is transient; daily snapshots are fine.

## Reset all local data

```bash
docker compose down -v   # drops postgres_data
docker compose up -d     # fresh DB, migrations re-applied
```
