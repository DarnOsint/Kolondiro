-- Add covers column to orders table
-- "covers" = number of people seated at the table for this order
-- Only relevant for table orders (order_type = 'table')
-- Cash sales and takeaways leave this NULL

ALTER TABLE orders ADD COLUMN IF NOT EXISTS covers integer;

-- Index for fast footfall aggregation in reports
CREATE INDEX IF NOT EXISTS idx_orders_covers ON orders(covers) WHERE covers IS NOT NULL;

-- Verify
SELECT 
  COUNT(*) as total_orders,
  COUNT(covers) as orders_with_covers,
  SUM(covers) as total_covers_all_time
FROM orders
WHERE status = 'paid';
