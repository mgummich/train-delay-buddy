-- backend/migrations/002_optimize_journeys.sql
--
-- Optimises the journeys table for a high-churn, poll-heavy workload
-- (≤2000 active journeys × one UPDATE every 30 s ≈ 67 dead tuples/sec).

-- 1. Drop the unused install_id index.
--    No SQL query filters by install_id alone — ownership is checked in Go after
--    a PK lookup. This index adds write overhead on every INSERT and poll UPDATE.
DROP INDEX IF EXISTS journeys_install_id_idx;

-- 2. Enable HOT updates for poll ticks.
--    UpdateState touches only unindexed columns (summary_json, legs_json,
--    etag_counter, last_polled_at), so every poll UPDATE qualifies for a
--    Heap-Only Tuple chain — skipping index maintenance entirely.
--    HOT requires free space on the same heap page; fillfactor=70 reserves 30%.
--    CLUSTER rewrites the heap immediately so the new fillfactor takes effect
--    now rather than waiting for autovacuum to cycle through every page.
--    (Takes ACCESS EXCLUSIVE for the duration; fast on ≤2000 rows.)
ALTER TABLE journeys SET (fillfactor = 70);
CLUSTER journeys USING journeys_active_idx;
ANALYZE journeys;

-- 3. Aggressive per-table autovacuum.
--    Default scale_factor=0.2 is fine for low-write tables.
--    journeys needs faster cycles to keep dead tuples and bloat in check.
--      vacuum_scale_factor=0.05  → vacuum at 5% dead-tuple ratio
--      vacuum_threshold=100      → also vacuum if ≥100 dead tuples regardless of ratio
--      analyze_scale_factor=0.05 → keep planner stats fresh under continuous writes
ALTER TABLE journeys SET (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_vacuum_threshold     = 100,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold    = 50
);
