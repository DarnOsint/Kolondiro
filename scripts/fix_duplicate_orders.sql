-- Prevent duplicate open orders on the same table
-- If a new order is inserted with status='open' for a table that already has one, reject it
CREATE OR REPLACE FUNCTION prevent_duplicate_open_orders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'open' AND NEW.table_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE table_id = NEW.table_id
        AND status = 'open'
        AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Table already has an open order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_duplicate_open_orders ON orders;
CREATE TRIGGER no_duplicate_open_orders
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_open_orders();

SELECT 'duplicate order prevention trigger created' AS status;
