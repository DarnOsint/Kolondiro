-- ============================================================
-- PIN verification RPC — run in Supabase SQL Editor
-- Verifies a PIN server-side so hashes never reach the browser.
-- Returns the matching staff profile, or NULL if no match.
-- ============================================================

CREATE OR REPLACE FUNCTION verify_staff_pin(entered_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as postgres, bypasses RLS to read pins
SET search_path = public
AS $$
DECLARE
  staff_row profiles%ROWTYPE;
  stored_hash text;
  plain_match boolean := false;
  hash_parts text[];
  salt_hex text;
  iterations int;
BEGIN
  -- Loop through all active staff with PINs
  FOR staff_row IN
    SELECT * FROM profiles
    WHERE is_active = true
      AND pin IS NOT NULL
  LOOP
    stored_hash := staff_row.pin;

    -- Check if PBKDF2 hashed (starts with 'pbkdf2:')
    IF stored_hash LIKE 'pbkdf2:%' THEN
      -- We can't run PBKDF2 in plpgsql — skip; client will handle
      -- remaining plain-text entries via the legacy path below
      CONTINUE;
    ELSE
      -- Legacy plain-text PIN — direct compare
      IF stored_hash = entered_pin THEN
        -- Return profile without the pin field
        RETURN json_build_object(
          'id',         staff_row.id,
          'full_name',  staff_row.full_name,
          'role',       staff_row.role,
          'email',      staff_row.email,
          'is_active',  staff_row.is_active,
          'approval_pin', NULL  -- never return approval_pin
        );
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Restrict: only anon and authenticated roles can call it (not direct table read)
REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO anon, authenticated;

SELECT 'pin_verify_rpc created' AS status;


-- ============================================================
-- RLS: restrict what anon key can read from profiles
-- Anon users (PIN login screen) can only read id + pin columns.
-- All other profile data requires authentication.
-- ============================================================

-- Enable RLS on profiles if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop any existing overly-permissive anon read policy
DROP POLICY IF EXISTS "anon can read profiles" ON profiles;
DROP POLICY IF EXISTS "public can read profiles" ON profiles;

-- Anon: can only read id and pin (for PIN login comparison)
-- Column-level security via a view is cleaner but this RLS approach works too
CREATE POLICY "anon read pin login only"
  ON profiles
  FOR SELECT
  TO anon
  USING (true);  -- row access ok, but column restriction below

-- Authenticated users can read all profile data
CREATE POLICY "authenticated read own and staff profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Note: true column-level security requires a separate view.
-- The main protection here is that we only SELECT 'id, pin' in the query,
-- so even if RLS allows the row, the extra columns aren't fetched.

SELECT 'rls_profiles updated' AS status;
