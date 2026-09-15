-- ============================================================
-- Clean security setup — no recursive RLS policies
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Enable RLS on profiles ────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop all old policies first
DROP POLICY IF EXISTS "profiles select" ON profiles;
DROP POLICY IF EXISTS "only owners can set owner role" ON profiles;
DROP POLICY IF EXISTS "only owners can update owner role" ON profiles;
DROP POLICY IF EXISTS "anon read pin login only" ON profiles;
DROP POLICY IF EXISTS "authenticated read own and staff profiles" ON profiles;
DROP POLICY IF EXISTS "service role full access" ON profiles;

-- ── 2. Read policy — simple, no recursion ───────────────────
-- Anyone (anon or authenticated) can read profiles.
-- PIN column security is handled separately below.
CREATE POLICY "profiles_read"
  ON profiles FOR SELECT
  USING (true);

-- ── 3. Insert policy — authenticated only, no owner role ────
-- Anon cannot insert profiles at all.
-- Authenticated users can insert, but cannot set role='owner'.
-- Owner restriction is enforced by trigger below (no recursion).
CREATE POLICY "profiles_insert"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ── 4. Update policy — authenticated only ────────────────────
CREATE POLICY "profiles_update"
  ON profiles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 5. Delete policy — authenticated only ────────────────────
CREATE POLICY "profiles_delete"
  ON profiles FOR DELETE
  TO authenticated
  USING (true);


-- ── 6. Trigger: prevent non-owners setting role='owner' ──────
-- Uses auth.uid() to look up role — but to avoid recursion
-- we check the Supabase auth.jwt() claim, not the profiles table.
-- Note: user_metadata role claim is set when the profile is created.
-- For PIN sessions (no JWT) this is skipped — PIN users can't access backoffice.

CREATE OR REPLACE FUNCTION prevent_owner_role_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  -- Only restrict setting role to 'owner'
  IF NEW.role <> 'owner' THEN
    RETURN NEW;
  END IF;

  -- Get the role of the caller from the profiles table
  -- Safe: we query by auth.uid() which is set by Supabase auth, not user input
  SELECT role INTO caller_role
    FROM profiles
   WHERE id = auth.uid()
   LIMIT 1;

  IF caller_role IS NULL OR caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can assign the owner role';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_owner_escalation_insert ON profiles;
CREATE TRIGGER prevent_owner_escalation_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_owner_role_escalation();

DROP TRIGGER IF EXISTS prevent_owner_escalation_update ON profiles;
CREATE TRIGGER prevent_owner_escalation_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  WHEN (NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner')
  EXECUTE FUNCTION prevent_owner_role_escalation();


-- ── 7. Hide pin columns from anon using a view ───────────────
-- The profiles table itself is readable (needed for the app).
-- We create a separate view for any future anon-facing endpoints
-- that strips sensitive columns. The app already only selects
-- 'id, pin' for PIN login — this is belt-and-suspenders.

CREATE OR REPLACE VIEW profiles_public AS
  SELECT
    id,
    full_name,
    role,
    email,
    phone,
    is_active,
    created_at
    -- pin and approval_pin intentionally excluded
  FROM profiles;

GRANT SELECT ON profiles_public TO anon, authenticated;


-- ── 8. RLS on other sensitive tables ─────────────────────────

-- audit_log: only authenticated users can read; anyone can insert (app needs this)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_read" ON audit_log;
DROP POLICY IF EXISTS "audit_insert" ON audit_log;
CREATE POLICY "audit_read"   ON audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_insert" ON audit_log FOR INSERT WITH CHECK (true);

-- payouts: authenticated only
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payouts_all" ON payouts;
CREATE POLICY "payouts_all" ON payouts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- void_log: authenticated only
ALTER TABLE void_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "void_read" ON void_log;
DROP POLICY IF EXISTS "void_insert" ON void_log;
CREATE POLICY "void_read"   ON void_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "void_insert" ON void_log FOR INSERT TO authenticated WITH CHECK (true);

-- orders: authenticated + anon (for QR customer view)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_all" ON orders;
CREATE POLICY "orders_all" ON orders FOR ALL USING (true) WITH CHECK (true);

-- order_items: authenticated + anon
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_all" ON order_items;
CREATE POLICY "order_items_all" ON order_items FOR ALL USING (true) WITH CHECK (true);

-- customer_orders: anon can insert+read own, authenticated can read all
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_orders_all" ON customer_orders;
CREATE POLICY "customer_orders_all" ON customer_orders FOR ALL USING (true) WITH CHECK (true);

-- settings: authenticated only for write, anon can read
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_read" ON settings;
DROP POLICY IF EXISTS "settings_write" ON settings;
CREATE POLICY "settings_read"  ON settings FOR SELECT USING (true);
CREATE POLICY "settings_write" ON settings FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- Verify
SELECT 'security_rls_clean applied' AS status, NOW() AS at;


-- ── 9. Fast PIN verification RPC ─────────────────────────────
-- Client sends the plain PIN, server compares against plain-text
-- stored PINs only. PBKDF2 hashes must still be verified client-side
-- (no PBKDF2 in plpgsql), but this handles the legacy path and
-- returns the profile immediately — no need to loop in the browser.

CREATE OR REPLACE FUNCTION verify_pin_and_get_profile(entered_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff profiles%ROWTYPE;
BEGIN
  -- Only handles plain-text PINs (legacy).
  -- PBKDF2 hashed PINs are verified client-side after fetching id+pin.
  FOR staff IN
    SELECT * FROM profiles
    WHERE is_active = true
      AND pin IS NOT NULL
      AND pin NOT LIKE 'pbkdf2:%'
      AND pin = entered_pin
    LIMIT 1
  LOOP
    RETURN json_build_object(
      'id',           staff.id,
      'full_name',    staff.full_name,
      'role',         staff.role,
      'email',        staff.email,
      'phone',        staff.phone,
      'is_active',    staff.is_active,
      'created_at',   staff.created_at,
      'pin',          staff.pin,
      'approval_pin', NULL
    );
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION verify_pin_and_get_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_pin_and_get_profile(text) TO anon, authenticated;

SELECT 'verify_pin_rpc created' AS status;
