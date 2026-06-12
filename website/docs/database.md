---
id: database
title: Database
---

# Database

PostgreSQL 16. A single table. A single migration file.

## Schema

```sql
CREATE TABLE journeys (
  id               TEXT PRIMARY KEY,    -- jrn_<ulid>
  install_id       TEXT NOT NULL,       -- device UUID
  train_number     TEXT NOT NULL,
  destination_id   TEXT NOT NULL,       -- HAFAS station ID (e.g. "8000105")
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

CREATE INDEX journeys_install_id_idx
  ON journeys (install_id);
```

## Column-by-column

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT` | ULID-prefixed primary key, monotonic, sortable |
| `install_id` | `TEXT` | Per-device UUIDv7 — used for ownership and rate-limit attribution |
| `train_number` | `TEXT` | As entered by the user (`ICE 123`, `RE 5`) |
| `destination_id` | `TEXT` | HAFAS station ID, numeric string |
| `destination_name` | `TEXT` | Cached pretty name for fast read-side display |
| `filters_json` | `JSONB` | `{ dbOnly, safetyLevel, maxTransfers }` |
| `summary_json` | `JSONB` | Latest summary snapshot — ETA, status, dataConfidence, nextStep |
| `legs_json` | `JSONB` | Current route's legs with realtime arrival/departure times |
| `stops_json` | `JSONB` | All stops across all legs (for timeline rendering) |
| `etag_epoch` | `BIGINT` | Bumped when the journey is (re)loaded into Redis from Postgres |
| `etag_counter` | `INTEGER` | Bumped on every state change |
| `created_at` | `TIMESTAMPTZ` | Set at INSERT |
| `terminated_at` | `TIMESTAMPTZ` | NULL = active; set by `DELETE` handler or by the janitor |
| `last_polled_at` | `TIMESTAMPTZ` | Updated on every successful poller tick — drives the janitor's GC |

## Indexes

- **`journeys_active_idx`** is a partial index — covers only active journeys. The janitor scans this index for `last_polled_at < now() - JOURNEY_TTL_HOURS` to find candidates for GC.
- **`journeys_install_id_idx`** is used by future-thinking endpoints that may list "my journeys" for a given install. Currently consulted only by rate-limit lookups.

## Migrations

The migration runner is at `backend/internal/migrate`. Behaviour:

- Reads all `*.sql` files under `MIGRATIONS_DIR`.
- Sorts them alphabetically (so file names should be zero-padded: `001_`, `002_`, …).
- Filters out files already recorded in `schema_migrations`.
- Applies remaining files **one per transaction**, recording each one in `schema_migrations` before commit.

This runs **on every server start**. There is no separate `migrate up` command. Failure during a migration aborts startup; no half-applied schema is ever committed.

### Adding a migration

```bash
touch backend/migrations/002_add_user_preferences.sql
```

```sql
-- backend/migrations/002_add_user_preferences.sql
ALTER TABLE journeys ADD COLUMN preferences_json JSONB DEFAULT '{}'::jsonb;
```

The runner picks it up on the next server start. Verify with:

```bash
docker compose exec postgres psql -U vbb vbb -c "SELECT * FROM schema_migrations ORDER BY applied_at"
```

### Migration conventions

- **Never modify a migration after it has shipped.** Always add a new one.
- **Idempotent SQL is preferred** but not required (the per-file transaction makes re-runs unnecessary).
- **Postgres reserved words** like `user` or `order` should be avoided as column names.

## Connecting directly

```bash
# In Docker (production-style)
docker compose exec postgres psql -U vbb vbb

# In Docker (dev — port exposed)
psql postgres://vbb:${POSTGRES_PASSWORD}@localhost:5432/vbb

# Just a one-off query
docker compose exec postgres psql -U vbb vbb \
  -c "SELECT id, train_number, summary_json->>'status' AS status, last_polled_at FROM journeys WHERE terminated_at IS NULL ORDER BY last_polled_at DESC LIMIT 10"
```

## Useful operational queries

```sql
-- count active journeys (poller load)
SELECT count(*) FROM journeys WHERE terminated_at IS NULL;

-- journeys that should have been GCed but weren't
SELECT id, last_polled_at FROM journeys
WHERE terminated_at IS NULL
  AND last_polled_at < now() - INTERVAL '2 hours';

-- recently-terminated journeys (last hour)
SELECT id, train_number, terminated_at FROM journeys
WHERE terminated_at > now() - INTERVAL '1 hour'
ORDER BY terminated_at DESC;

-- per-install activity
SELECT install_id, count(*) FROM journeys
WHERE created_at > now() - INTERVAL '1 day'
GROUP BY install_id
ORDER BY count(*) DESC
LIMIT 20;

-- distribution of train operators across active journeys
SELECT summary_json->'origin'->>'operator' AS operator, count(*)
FROM journeys
WHERE terminated_at IS NULL
GROUP BY 1 ORDER BY 2 DESC;
```

## Backups and restore

`pg_dump` works as expected. The journeys table is small (rows are typically < 50 KB each, retention is hours) so a full-database `pg_dump` runs in seconds. Recommended cron-driven backup:

```bash
docker compose exec postgres pg_dump -U vbb vbb \
  | gzip > "/backups/vbb-$(date -Iseconds).sql.gz"
```

Restore:

```bash
gunzip < vbb-2026-06-12T03:00:00Z.sql.gz \
  | docker compose exec -T postgres psql -U vbb vbb
```

For a more robust setup, point Postgres at WAL-G or pgBackRest. The data is not historically valuable (journeys are transient), so daily snapshots are fine.

## Resetting all local data

```bash
docker compose down -v   # -v deletes the postgres_data named volume
docker compose up -d     # fresh database, migrations re-applied
```
