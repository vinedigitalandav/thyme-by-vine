-- Add color column to resources for UI slot coloring
ALTER TABLE resources ADD COLUMN color TEXT NOT NULL DEFAULT '#3b82f6';
