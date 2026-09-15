-- void_log table (actual column names as used by OrderPanel.tsx insert)
-- Run this if the table doesn't exist yet in Supabase
CREATE TABLE IF NOT EXISTS void_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_name  text,
  quantity        integer,
  unit_price      numeric(12,2),
  total_value     numeric(12,2),
  void_type       text DEFAULT 'item',  -- 'item' | 'order'
  approved_by     uuid REFERENCES auth.users(id),
  approved_by_name text,
  created_at      timestamptz DEFAULT now()
);

-- waiter_calls table (actual column names as used by TableView.tsx / ReceiptView.tsx insert)
-- Note: NO foreign-key join to tables — use table_name (text) directly
CREATE TABLE IF NOT EXISTS waiter_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id      uuid,
  table_name    text,
  waitron_id    uuid REFERENCES auth.users(id),
  waitron_name  text,
  status        text DEFAULT 'pending',  -- 'pending' | 'acknowledged' | 'dismissed'
  resolved_at   timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- RLS (run as service role)
ALTER TABLE void_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiter_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read void_log"    ON void_log     FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert void_log"  ON void_log     FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can read waiter_calls"   ON waiter_calls FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert waiter_calls" ON waiter_calls FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can update waiter_calls" ON waiter_calls FOR UPDATE TO authenticated USING (true);
