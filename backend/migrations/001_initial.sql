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
