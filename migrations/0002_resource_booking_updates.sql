-- Migration 0002: single slot duration + price per resource, email confirmation for bookings

-- Each resource now has one slot duration (minutes) and a price per slot (cents)
ALTER TABLE resources ADD COLUMN slot_duration INTEGER NOT NULL DEFAULT 60;
ALTER TABLE resources ADD COLUMN price_per_slot INTEGER NOT NULL DEFAULT 0;

-- Bookings get a confirmation token for email verification
ALTER TABLE bookings ADD COLUMN confirmation_token TEXT;

-- New status: pending_confirmation | confirmed | cancelled
-- (SQLite can't change DEFAULT, handled in application code)
