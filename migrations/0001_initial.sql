-- Thyme by Vine — Initial Schema
-- Run: wrangler d1 migrations apply thyme-by-vine-db --local

CREATE TABLE IF NOT EXISTS owners (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  password_hash TEXT  NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL UNIQUE REFERENCES owners(id) ON DELETE CASCADE,
  access_token         TEXT NOT NULL,
  refresh_token        TEXT NOT NULL,
  google_email         TEXT NOT NULL,
  default_calendar_id  TEXT,
  -- JSON object: { "resourceId": "calendarId" }
  resource_calendar_map TEXT DEFAULT '{}',
  token_expires_at     INTEGER,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS resources (
  id          TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Recurring weekly availability per resource
CREATE TABLE IF NOT EXISTS availability_rules (
  id             TEXT    PRIMARY KEY,
  resource_id    TEXT    NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday
  day_of_week    INTEGER NOT NULL,
  start_time     TEXT    NOT NULL, -- "HH:MM"
  end_time       TEXT    NOT NULL, -- "HH:MM"
  -- JSON array of durations in minutes, e.g. [30, 60, 120]
  slot_durations TEXT    NOT NULL DEFAULT '[60]',
  UNIQUE(resource_id, day_of_week)
);

-- Date-specific overrides (block day or custom hours)
CREATE TABLE IF NOT EXISTS availability_overrides (
  id          TEXT    PRIMARY KEY,
  resource_id TEXT    NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL, -- "YYYY-MM-DD"
  is_blocked  INTEGER NOT NULL DEFAULT 0,
  start_time  TEXT,             -- "HH:MM" — null when blocked
  end_time    TEXT,             -- "HH:MM" — null when blocked
  UNIQUE(resource_id, date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id               TEXT    PRIMARY KEY,
  owner_id         TEXT    NOT NULL REFERENCES owners(id),
  booker_name      TEXT    NOT NULL,
  booker_email     TEXT    NOT NULL,
  note             TEXT,
  start_at         INTEGER NOT NULL, -- Unix timestamp (seconds)
  end_at           INTEGER NOT NULL, -- Unix timestamp (seconds)
  duration_minutes INTEGER NOT NULL,
  -- "confirmed" | "cancelled"
  status           TEXT    NOT NULL DEFAULT 'confirmed',
  google_event_id  TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Many-to-many: a booking can span multiple resources
CREATE TABLE IF NOT EXISTS booking_resources (
  booking_id  TEXT NOT NULL REFERENCES bookings(id)  ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  PRIMARY KEY (booking_id, resource_id)
);

-- Temporary holds while a booker completes checkout (TTL: 5 min)
CREATE TABLE IF NOT EXISTS slot_holds (
  id            TEXT    PRIMARY KEY,
  session_token TEXT    NOT NULL UNIQUE,
  -- JSON array of resource IDs
  resource_ids  TEXT    NOT NULL,
  start_at      INTEGER NOT NULL, -- Unix timestamp
  end_at        INTEGER NOT NULL, -- Unix timestamp
  expires_at    INTEGER NOT NULL, -- Unix timestamp (start + 300)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resources_owner        ON resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_avail_rules_resource   ON availability_rules(resource_id);
CREATE INDEX IF NOT EXISTS idx_avail_overrides_res    ON availability_overrides(resource_id);
CREATE INDEX IF NOT EXISTS idx_bookings_owner         ON bookings(owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start         ON bookings(start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_booking_resources_res  ON booking_resources(resource_id);
CREATE INDEX IF NOT EXISTS idx_slot_holds_session     ON slot_holds(session_token);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expires     ON slot_holds(expires_at);
