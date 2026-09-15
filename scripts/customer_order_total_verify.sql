-- ============================================================
-- Verify customer_orders total_amount against menu_items prices
-- Prevents client-side price manipulation on QR orders
-- ============================================================

CREATE OR REPLACE FUNCTION verify_customer_order_total()
RETURNS TRIGGER AS $$
DECLARE
  real_total numeric := 0;
  item jsonb;
  menu_price numeric;
  item_qty int;
BEGIN
  -- Recalculate total from items array against actual menu_items prices
  IF NEW.items IS NOT NULL THEN
    FOR item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      item_qty := (item->>'quantity')::int;

      SELECT price INTO menu_price
        FROM menu_items
       WHERE id = (item->>'menu_item_id')::uuid
         AND is_available = true
       LIMIT 1;

      IF menu_price IS NOT NULL AND item_qty > 0 THEN
        real_total := real_total + (menu_price * item_qty);
      END IF;
    END LOOP;
  END IF;

  -- Override client total with server-calculated total
  -- Only override if items were found (real_total > 0) to avoid
  -- wiping out legitimate zero-item edge cases
  IF real_total > 0 THEN
    NEW.total_amount := real_total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS verify_customer_order_total ON customer_orders;
CREATE TRIGGER verify_customer_order_total
  BEFORE INSERT ON customer_orders
  FOR EACH ROW EXECUTE FUNCTION verify_customer_order_total();

SELECT 'customer_order_total_verify created' AS status;
