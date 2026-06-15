-- Add timezone column to owners for booking calendar display and calendar event creation
ALTER TABLE owners ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Chicago';
