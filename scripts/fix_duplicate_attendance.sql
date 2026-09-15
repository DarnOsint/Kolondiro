-- Fix duplicate attendance rows (clock_out IS NULL for same staff on same date)
-- Run in Supabase SQL editor

-- Preview duplicates first:
SELECT staff_id, date, COUNT(*) as cnt
FROM attendance
WHERE clock_out IS NULL
GROUP BY staff_id, date
HAVING COUNT(*) > 1;

-- Delete the OLDER duplicate rows, keep the most recent clock_in per staff per day:
DELETE FROM attendance
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY staff_id, date
             ORDER BY clock_in DESC  -- keep the most recent
           ) as rn
    FROM attendance
    WHERE clock_out IS NULL
  ) ranked
  WHERE rn > 1
);

-- Verify: should return no rows after cleanup
SELECT staff_id, date, COUNT(*) as cnt
FROM attendance
WHERE clock_out IS NULL
GROUP BY staff_id, date
HAVING COUNT(*) > 1;
