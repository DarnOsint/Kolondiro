-- Ensure closed_at is always set when order status becomes 'paid'
CREATE OR REPLACE FUNCTION ensure_order_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_closed_at ON orders;
CREATE TRIGGER ensure_closed_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION ensure_order_closed_at();

-- Backfill: fix any existing paid orders with null closed_at
UPDATE orders
SET closed_at = updated_at
WHERE status = 'paid'
  AND closed_at IS NULL
  AND updated_at IS NOT NULL;

UPDATE orders
SET closed_at = created_at
WHERE status = 'paid'
  AND closed_at IS NULL;

SELECT COUNT(*) AS backfilled_orders FROM orders WHERE status = 'paid' AND closed_at IS NOT NULL;
