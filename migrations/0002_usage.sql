-- Anonymous usage counts for the /usage page. A device is a random id the app keeps in
-- localStorage; the server stores only its SHA-256, never anything that identifies a person.

CREATE TABLE devices (
  device       TEXT PRIMARY KEY,                -- SHA-256 hex of the client's random device id
  first_seen   INTEGER NOT NULL,                -- ms since epoch
  last_seen    INTEGER NOT NULL
);

-- One row per app session ("open"), quiz created ("create") or quiz joined ("join").
-- Rows older than 30 days are deleted by the daily cron.
CREATE TABLE usage_events (
  device       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('open', 'create', 'join')),
  at           INTEGER NOT NULL
);
CREATE INDEX usage_events_at ON usage_events (at);
