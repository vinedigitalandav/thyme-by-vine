-- Add Clerk user ID to owners table for Clerk authentication
ALTER TABLE owners ADD COLUMN clerk_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_clerk_id ON owners (clerk_id);
