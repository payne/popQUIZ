-- Pop Quiz schema. Quizzes are deleted 30 days after creation (cron, step 7);
-- participants and answers go with them via ON DELETE CASCADE.

CREATE TABLE quizzes (
  code         TEXT PRIMARY KEY,                -- 6 chars, no 0/O/1/I
  pool         TEXT NOT NULL,                   -- tech | general | extra
  pool_version TEXT NOT NULL,                   -- e.g. 2026-2030
  mode         TEXT NOT NULL CHECK (mode IN ('full', 'custom')),
  items_json   TEXT NOT NULL,                   -- JSON array of question ids, display order
  created_at   INTEGER NOT NULL,                -- ms since epoch
  closes_at    INTEGER NOT NULL,                -- created_at + 7 days
  closed_at    INTEGER,                         -- set when the creator closes it early
  creator_pid  TEXT
);
CREATE INDEX quizzes_created_at ON quizzes (created_at);

CREATE TABLE participants (
  pid          TEXT PRIMARY KEY,                -- public id (shown to others)
  code         TEXT NOT NULL REFERENCES quizzes (code) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,                   -- SHA-256 of the secret bearer token
  display_name TEXT NOT NULL,
  name_key     TEXT NOT NULL,                   -- case-folded name for duplicate checks
  joined_at    INTEGER NOT NULL,
  finished_at  INTEGER,
  score        INTEGER,
  UNIQUE (code, name_key)
);

CREATE TABLE answers (
  pid          TEXT NOT NULL REFERENCES participants (pid) ON DELETE CASCADE,
  q_index      INTEGER NOT NULL,
  choice       INTEGER NOT NULL CHECK (choice BETWEEN 0 AND 3),
  answered_at  INTEGER NOT NULL,
  PRIMARY KEY (pid, q_index)
);
