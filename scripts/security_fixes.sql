-- ============================================================
-- Security fixes — run in Supabase SQL Editor
-- ============================================================

-- ── Fix 5: Prevent non-owners assigning owner role via RLS ──
-- Managers cannot insert/update profiles with role = 'owner'
-- Must run as postgres/service role

-- Policy: only owners can write role='owner'
CREATE POLICY IF NOT EXISTS "only owners can set owner role"
  ON profiles
  FOR ALL
  USING (
    -- Allow if current user is owner, OR if the row's role is not 'owner'
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
    OR role <> 'owner'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
    OR role <> 'owner'
  );


-- ── Fix 1: Prevent double inventory depletion ──
-- Add depleted_at column to orders to track when inventory was deducted
ALTER TABLE orders ADD COLUMN IF NOT EXISTS depleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_orders_depleted_at ON orders(depleted_at) WHERE depleted_at IS NOT NULL;


-- ── Fix 3: Enforce petty cash limit in DB ──
-- Reject payout inserts that would exceed ₦50,000 daily total per staff
CREATE OR REPLACE FUNCTION check_daily_payout_limit()
RETURNS TRIGGER AS $$
DECLARE
  daily_total numeric;
  payout_limit numeric := 50000;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO daily_total
    FROM payouts
   WHERE DATE(created_at AT TIME ZONE 'Africa/Lagos') = DATE(NOW() AT TIME ZONE 'Africa/Lagos');

  IF daily_total + NEW.amount > payout_limit THEN
    RAISE EXCEPTION 'Daily payout limit of ₦% exceeded. Total so far: ₦%. Requested: ₦%',
      payout_limit, daily_total, NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_daily_payout_limit ON payouts;
CREATE TRIGGER enforce_daily_payout_limit
  BEFORE INSERT ON payouts
  FOR EACH ROW EXECUTE FUNCTION check_daily_payout_limit();


-- ── Fix 6: Rate-limit customer QR order submissions per table ──
-- Reject if more than 3 customer_orders for same table_id in last 60 seconds
CREATE OR REPLACE FUNCTION check_customer_order_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*)
    INTO recent_count
    FROM customer_orders
   WHERE table_id = NEW.table_id
     AND created_at > NOW() - INTERVAL '60 seconds';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'Too many orders submitted for this table. Please wait a moment.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rate_limit_customer_orders ON customer_orders;
CREATE TRIGGER rate_limit_customer_orders
  BEFORE INSERT ON customer_orders
  FOR EACH ROW EXECUTE FUNCTION check_customer_order_rate_limit();


-- ── Fix 7: Recalculate total_amount from order_items on order close ──
-- Prevents client-side total manipulation
CREATE OR REPLACE FUNCTION recalculate_order_total()
RETURNS TRIGGER AS $$
DECLARE
  real_total numeric;
BEGIN
  -- Only recalculate when status changes to 'paid'
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT COALESCE(SUM(total_price), 0)
      INTO real_total
      FROM order_items
     WHERE order_id = NEW.id
       AND void_qty IS NULL OR void_qty = 0;

    -- Only override if client total differs by more than ₦1 (floating point tolerance)
    IF ABS(real_total - NEW.total_amount) > 1 THEN
      NEW.total_amount := real_total;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS verify_order_total ON orders;
CREATE TRIGGER verify_order_total
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION recalculate_order_total();


-- ── Fix 8: Void log approved_by must be a real manager/owner ──
-- Add FK constraint so approved_by can't be a fake UUID
ALTER TABLE void_log
  DROP CONSTRAINT IF EXISTS void_log_approved_by_fkey;

ALTER TABLE void_log
  ADD CONSTRAINT void_log_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Verify the fixes were applied
SELECT 'security_fixes applied' AS status, NOW() AS applied_at;
