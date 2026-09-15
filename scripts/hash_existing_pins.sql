-- ============================================================
-- Mark existing plain-text PINs for re-hashing on next login
-- 
-- The app uses PBKDF2 (Web Crypto API) for hashing.
-- We can't generate PBKDF2 hashes in SQL directly.
-- 
-- Strategy: prefix plain-text PINs with "legacy:" so the app
-- knows to re-hash them on first successful login.
-- The verifyPin() function already handles this gracefully —
-- it falls back to plain-text comparison for non-pbkdf2 values,
-- then the save path will hash it going forward.
--
-- Actually — since verifyPin() already accepts plain-text PINs
-- as a fallback, no migration is strictly needed. New PINs set
-- via BackOffice will be hashed. Existing PINs remain readable
-- until each staff member's PIN is next updated.
--
-- To FORCE immediate hashing of all existing PINs, you need to
-- re-enter each PIN via BackOffice → Staff Management → Edit.
-- ============================================================

-- Optional: see which staff still have plain-text PINs
SELECT 
  full_name, 
  role,
  CASE WHEN pin NOT LIKE 'pbkdf2:%' AND pin IS NOT NULL THEN 'PLAIN TEXT' ELSE 'HASHED' END as pin_status,
  CASE WHEN approval_pin NOT LIKE 'pbkdf2:%' AND approval_pin IS NOT NULL THEN 'PLAIN TEXT' ELSE 'HASHED or NULL' END as approval_pin_status
FROM profiles
WHERE is_active = true
ORDER BY role, full_name;
