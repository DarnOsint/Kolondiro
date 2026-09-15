-- POS Machine tracking
-- Run in Supabase SQL editor

-- 1. Add pos_machine column to attendance table (nullable — not all staff use one)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS pos_machine text;

-- 2. Add POS machines setting (initial empty list)
-- This is managed via BackOffice → POS Machines
INSERT INTO settings (id, value, updated_at)
VALUES ('pos_machines', '[]', now())
ON CONFLICT (id) DO NOTHING;

-- 3. Index for filtering attendance by pos_machine
CREATE INDEX IF NOT EXISTS idx_attendance_pos_machine ON attendance(pos_machine)
  WHERE pos_machine IS NOT NULL;

-- Fix 3: Add check_in_time column to room_stays for apartment reservations
ALTER TABLE room_stays ADD COLUMN IF NOT EXISTS check_in_time text;
