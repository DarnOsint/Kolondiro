-- Add confirmed_at column to attendance table
-- This tracks when staff actually logged in after being clocked in by a manager.
-- Run this in Supabase SQL Editor.

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS confirmed_at timestamptz DEFAULT NULL;

-- Backfill existing records: treat all past clock-ins as confirmed
UPDATE attendance SET confirmed_at = clock_in WHERE confirmed_at IS NULL;
