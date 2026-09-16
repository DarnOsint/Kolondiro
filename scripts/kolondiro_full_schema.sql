-- ============================================================================
-- Kolondiro RestaurantOS — FULL DATABASE SCHEMA
-- Target : Supabase project monobortfaujxakwvvlk (fresh, no restaurant schema)
-- Purpose: recreate every table, trigger, RPC, policy, storage and realtime
--          membership the Kolondiro app depends on.
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE.
-- Legacy plain-text admin PIN is created at the END (owner role bypasses the
-- owner-escalation trigger via session_replication_role = replica).
-- ============================================================================

-- ── 0. Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

-- 1.1 profiles ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text NOT NULL DEFAULT '',
  role             text NOT NULL DEFAULT 'manager',
  email            text,
  phone            text,
  pin              text,
  approval_pin     text,
  is_active        boolean NOT NULL DEFAULT true,
  hire_date        text,
  emergency_contact text,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
      CHECK (role IS NOT NULL AND btrim(role) <> '');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role      ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active    ON profiles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_profiles_pin       ON profiles(pin) WHERE pin IS NOT NULL;

-- 1.2 audit_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action             text NOT NULL,
  entity             text,
  entity_id          text,
  entity_name        text,
  old_value          jsonb,
  new_value          jsonb,
  performed_by       uuid,
  performed_by_name  text,
  performed_by_role  text,
  ip_address         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed  ON audit_log(performed_by, created_at DESC);

-- 1.3 settings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id         text PRIMARY KEY,
  value      text NOT NULL DEFAULT '[]',
  updated_at timestamptz DEFAULT now()
);

-- 1.4 menu_categories ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  destination text NOT NULL DEFAULT 'kitchen',
  created_at  timestamptz DEFAULT now()
);

-- 1.5 menu_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  price          numeric(12,2) NOT NULL DEFAULT 0,
  category_id    uuid REFERENCES menu_categories(id) ON DELETE SET NULL,
  description    text,
  image_url      text,
  is_available   boolean NOT NULL DEFAULT true,
  current_stock  numeric(12,2) NOT NULL DEFAULT 0,
  cost_price     numeric(12,2) NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available) WHERE is_available = true;

-- 1.6 table_categories (zones) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  hire_fee   numeric(12,2),
  created_at timestamptz DEFAULT now()
);

-- 1.7 menu_item_zone_prices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item_zone_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id   uuid REFERENCES menu_items(id) ON DELETE CASCADE,
  category_id    uuid REFERENCES table_categories(id) ON DELETE CASCADE,
  price          numeric(12,2) NOT NULL DEFAULT 0,
  units_per_sale integer NOT NULL DEFAULT 1 CHECK (units_per_sale >= 1),
  created_at     timestamptz DEFAULT now(),
  UNIQUE (menu_item_id, category_id)
);

-- 1.8 tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tables (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available', 'occupied', 'reserved')),
  category_id    uuid REFERENCES table_categories(id) ON DELETE SET NULL,
  assigned_staff uuid,
  capacity       integer,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tables_category ON tables(category_id);
CREATE INDEX IF NOT EXISTS idx_tables_status   ON tables(status);

-- 1.9 zone_assignments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zone_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES table_categories(id) ON DELETE CASCADE,
  staff_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_active ON zone_assignments(staff_id) WHERE is_active = true;

-- 1.10 orders ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id       uuid REFERENCES tables(id) ON DELETE SET NULL,
  staff_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  order_type     text NOT NULL DEFAULT 'table',
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'paid', 'voided', 'pending')),
  total_amount   numeric(12,2) NOT NULL DEFAULT 0,
  notes          text,
  covers         integer,
  payment_method text,
  customer_name  text,
  customer_phone text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  updated_at     timestamptz,
  depleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_staff_id   ON orders(staff_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_open ON orders(table_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_orders_depleted   ON orders(depleted_at) WHERE depleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_covers     ON orders(covers) WHERE covers IS NOT NULL;

-- 1.11 order_items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id     uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  quantity         integer NOT NULL DEFAULT 1,
  unit_price       numeric(12,2) NOT NULL DEFAULT 0,
  total_price      numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending',
  destination      text NOT NULL DEFAULT 'kitchen',
  modifier_notes   text,
  extra_charge     numeric(12,2) NOT NULL DEFAULT 0,
  return_requested boolean NOT NULL DEFAULT false,
  return_accepted  boolean NOT NULL DEFAULT false,
  return_reason    text,
  void_qty         integer NOT NULL DEFAULT 0,
  is_hire_fee      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status   ON order_items(status);

-- 1.12 customer_orders (QR customer menu) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id         uuid REFERENCES tables(id) ON DELETE SET NULL,
  table_name       text,
  items            jsonb NOT NULL DEFAULT '[]',
  total_amount     numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending',
  accepted_by      uuid,
  accepted_by_name text,
  accepted_at      timestamptz,
  decline_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status    ON customer_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_table_id  ON customer_orders(table_id);

-- 1.13 tips ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid,
  waitron_id       uuid,
  waitron_name     text,
  table_id         uuid,
  table_name       text,
  order_total      numeric(12,2) NOT NULL DEFAULT 0,
  amount_received  numeric(12,2) NOT NULL DEFAULT 0,
  tip_amount       numeric(12,2) NOT NULL DEFAULT 0,
  payment_method   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tips_waitron ON tips(waitron_id, created_at DESC);

-- 1.14 waiter_calls ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waiter_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id        uuid,
  table_name      text,
  waitron_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  waitron_name    text,
  status          text NOT NULL DEFAULT 'pending',
  called_at       timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waiter_calls_status ON waiter_calls(status, called_at DESC);

-- 1.15 void_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS void_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_name  text,
  quantity        integer,
  unit_price      numeric(12,2),
  total_value     numeric(12,2),
  void_type       text NOT NULL DEFAULT 'item',
  approved_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by_name text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_void_log_created_at ON void_log(created_at DESC);

-- ============================================================================
-- 2. INVENTORY / STOCK / ACCOUNTING
-- ============================================================================

-- 2.1 inventory ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name     text NOT NULL,
  category      text NOT NULL DEFAULT 'Drinks',
  unit          text NOT NULL DEFAULT 'bottles',
  current_stock numeric(12,2) NOT NULL DEFAULT 0,
  minimum_stock numeric(12,2) NOT NULL DEFAULT 5,
  cost_price    numeric(12,2) NOT NULL DEFAULT 0,
  selling_price numeric(12,2) NOT NULL DEFAULT 0,
  menu_item_id  uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_active ON inventory(is_active) WHERE is_active = true;

-- 2.2 suppliers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_name   text,
  phone          text,
  email          text,
  address        text,
  items_supplied text,
  payment_terms  text,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- 2.3 purchase_orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name  text,
  items          jsonb NOT NULL DEFAULT '[]',
  total_cost     numeric(12,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending',
  payment_status text NOT NULL DEFAULT 'unpaid',
  expected_date  text,
  notes          text,
  ordered_by     uuid,
  ordered_by_name text,
  received_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created ON purchase_orders(created_at DESC);

-- 2.4 restock_log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restock_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id       uuid REFERENCES inventory(id) ON DELETE SET NULL,
  item_name          text,
  quantity_added     numeric(12,2) NOT NULL DEFAULT 0,
  previous_stock     numeric(12,2) NOT NULL DEFAULT 0,
  new_stock          numeric(12,2) NOT NULL DEFAULT 0,
  cost_price_per_unit numeric(12,2) NOT NULL DEFAULT 0,
  total_cost         numeric(12,2) NOT NULL DEFAULT 0,
  supplier_name      text,
  supplier_phone     text,
  invoice_number     text,
  payment_method     text,
  delivery_person    text,
  condition          text,
  notes              text,
  restocked_by       uuid,
  restocked_by_name  text,
  restocked_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_restock_log_inventory ON restock_log(inventory_id, created_at DESC);

-- 2.5 kitchen_stock ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kitchen_stock (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL DEFAULT current_date,
  item_name    text NOT NULL,
  unit         text NOT NULL DEFAULT 'kg',
  opening_qty  numeric(10,2) NOT NULL DEFAULT 0,
  received_qty numeric(10,2) NOT NULL DEFAULT 0,
  sold_qty     numeric(10,2) NOT NULL DEFAULT 0,
  void_qty     numeric(10,2) NOT NULL DEFAULT 0,
  closing_qty  numeric(10,2) NOT NULL DEFAULT 0,
  note         text,
  recorded_by  uuid REFERENCES profiles(id),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (date, item_name)
);

-- 2.6 kitchen_stock_entries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kitchen_stock_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL DEFAULT current_date,
  item_name    text NOT NULL,
  unit         text NOT NULL DEFAULT 'kg',
  opening_qty  numeric(10,2) NOT NULL DEFAULT 0,
  received_qty numeric(10,2) NOT NULL DEFAULT 0,
  sold_qty     numeric(10,2) NOT NULL DEFAULT 0,
  void_qty     numeric(10,2) NOT NULL DEFAULT 0,
  closing_qty  numeric(10,2) NOT NULL DEFAULT 0,
  note         text,
  recorded_by  uuid REFERENCES profiles(id),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kse_date ON kitchen_stock_entries(date DESC);

-- 2.7 returns_log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS returns_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid,
  order_item_id   uuid,
  item_name       text,
  quantity        numeric(10,2) NOT NULL DEFAULT 0,
  item_total      numeric(12,2) NOT NULL DEFAULT 0,
  table_name      text,
  waitron_id      uuid,
  waitron_name    text,
  return_reason   text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','bar_accepted','kitchen_accepted','griller_accepted','accepted','rejected','manager_rejected','expired')),
  requested_at    timestamptz DEFAULT now(),
  handled_by      uuid,
  handled_by_name text,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_returns_log_order_item ON returns_log(order_item_id);
CREATE INDEX IF NOT EXISTS idx_returns_log_status     ON returns_log(status);

-- 2.8 debtors ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debtors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  phone          text,
  email          text,
  debt_type      text NOT NULL DEFAULT 'general',
  credit_limit   numeric(12,2) NOT NULL DEFAULT 0,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid    numeric(12,2) NOT NULL DEFAULT 0,
  due_date       date,
  notes          text,
  status         text NOT NULL DEFAULT 'outstanding'
                 CHECK (status IN ('outstanding','partial','paid')),
  is_active      boolean NOT NULL DEFAULT true,
  recorded_by    uuid,
  recorded_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debtors_active ON debtors(is_active) WHERE is_active = true;

-- 2.9 debt_payments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debt_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id        uuid REFERENCES debtors(id) ON DELETE CASCADE,
  amount           numeric(12,2) NOT NULL,
  payment_method   text,
  payment_reference text,
  notes            text,
  recorded_by      uuid,
  recorded_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debtor ON debt_payments(debtor_id, created_at DESC);

-- 2.10 debtor_payments (legacy alias) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debtor_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debtor_id        uuid REFERENCES debtors(id) ON DELETE CASCADE,
  amount           numeric(12,2) NOT NULL,
  payment_method   text,
  payment_reference text,
  notes            text,
  recorded_by      uuid,
  recorded_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 2.11 bank_accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name      text NOT NULL,
  account_name   text,
  account_number text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- 2.12 till_sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS till_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  opening_float  numeric(12,2) NOT NULL DEFAULT 0,
  closing_float  numeric(12,2),
  total_sales    numeric(12,2) NOT NULL DEFAULT 0,
  total_payouts  numeric(12,2) NOT NULL DEFAULT 0,
  expected_cash  numeric(12,2) NOT NULL DEFAULT 0,
  shortfall      numeric(12,2),
  surplus        numeric(12,2),
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes          text
);
CREATE INDEX IF NOT EXISTS idx_till_sessions_staff ON till_sessions(staff_id, status);

-- 2.13 payouts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  till_session_id uuid REFERENCES till_sessions(id) ON DELETE SET NULL,
  amount         numeric(12,2) NOT NULL,
  reason         text,
  category       text,
  staff_id       uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_till ON payouts(till_session_id);
CREATE INDEX IF NOT EXISTS idx_payouts_created ON payouts(created_at DESC);

-- 2.14 attendance ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL,
  date         date NOT NULL DEFAULT current_date,
  clock_in     timestamptz DEFAULT now(),
  clock_out    timestamptz,
  confirmed_at timestamptz,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance(staff_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_open ON attendance(staff_id) WHERE clock_out IS NULL;

-- 2.15 period_closes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS period_closes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type        text NOT NULL,
  period_label       text NOT NULL UNIQUE,
  period_start       date,
  period_end         date,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','closed')),
  gross_revenue      numeric(12,2) NOT NULL DEFAULT 0,
  total_voids        numeric(12,2) NOT NULL DEFAULT 0,
  total_payouts      numeric(12,2) NOT NULL DEFAULT 0,
  net_revenue        numeric(12,2) NOT NULL DEFAULT 0,
  cash_revenue       numeric(12,2) NOT NULL DEFAULT 0,
  card_revenue       numeric(12,2) NOT NULL DEFAULT 0,
  transfer_revenue   numeric(12,2) NOT NULL DEFAULT 0,
  credit_revenue     numeric(12,2) NOT NULL DEFAULT 0,
  order_count        integer NOT NULL DEFAULT 0,
  opening_debtors    numeric(12,2) NOT NULL DEFAULT 0,
  closing_debtors    numeric(12,2) NOT NULL DEFAULT 0,
  new_credit_issued  numeric(12,2) NOT NULL DEFAULT 0,
  credit_recovered   numeric(12,2) NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 2.16 period_stock_counts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS period_stock_counts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_close_id  uuid REFERENCES period_closes(id) ON DELETE CASCADE,
  item_name        text NOT NULL,
  unit             text,
  system_qty       numeric(12,2) NOT NULL DEFAULT 0,
  physical_qty     numeric(12,2),
  cost_per_unit    numeric(12,2) NOT NULL DEFAULT 0,
  variance_value   numeric(12,2) NOT NULL DEFAULT 0,
  variance         numeric(12,2),
  updated_at       timestamptz DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psc_period ON period_stock_counts(period_close_id);

-- 2.17 service_log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid,
  order_item_id   uuid,
  table_id        uuid,
  item_name       text,
  table_name      text,
  served_by       uuid,
  served_by_name  text,
  served_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_log_order ON service_log(order_id);
CREATE INDEX IF NOT EXISTS idx_service_log_served_at ON service_log(served_at DESC);

-- ============================================================================
-- 3. PUSH
-- ============================================================================

-- 3.1 push_subscriptions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  user_agent   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (staff_id, subscription)
);

-- ============================================================================
-- 4. OPERATIONS TABLES (from original scripts)
-- ============================================================================

-- 4.1 store_requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name        text NOT NULL,
  inventory_id     uuid REFERENCES inventory(id),
  quantity         numeric(10,2) NOT NULL,
  unit             text NOT NULL DEFAULT 'bottles',
  requested_by     uuid REFERENCES profiles(id),
  requested_by_name text,
  status           text NOT NULL DEFAULT 'pending',
  approved_by      uuid REFERENCES profiles(id),
  approved_by_name text,
  reason           text,
  reject_reason    text,
  collected_at     timestamptz,
  collected_by_name text,
  created_at       timestamptz DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_store_requests_status ON store_requests(status);
CREATE INDEX IF NOT EXISTS idx_store_requests_created_at ON store_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_requests_collected_at ON store_requests(collected_at);

-- 4.2 void_requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS void_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name          text NOT NULL,
  quantity           integer NOT NULL DEFAULT 1,
  reason             text,
  station            text NOT NULL DEFAULT 'bar',
  requested_by       uuid REFERENCES profiles(id),
  requested_by_name  text,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by_name   text
);

-- 4.3 bar_chiller_stock ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bar_chiller_stock (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL DEFAULT current_date,
  item_name     text NOT NULL,
  unit          text NOT NULL DEFAULT 'bottles',
  opening_qty   numeric(10,2) NOT NULL DEFAULT 0,
  received_qty  numeric(10,2) NOT NULL DEFAULT 0,
  sold_qty      numeric(10,2) NOT NULL DEFAULT 0,
  void_qty      numeric(10,2) NOT NULL DEFAULT 0,
  closing_qty   numeric(10,2) NOT NULL DEFAULT 0,
  note          text,
  recorded_by   uuid REFERENCES profiles(id),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (date, item_name)
);

-- 4.4 bar_issue_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bar_issue_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_date date NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL UNIQUE,
  table_id uuid NULL,
  table_name text NULL,
  waitron_id uuid NULL,
  waitron_name text NULL,
  menu_item_id uuid NULL,
  item_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  station text NOT NULL DEFAULT 'bar' CHECK (station in ('bar')),
  source text NOT NULL DEFAULT 'pos_order' CHECK (source in ('pos_order')),
  recorded_by uuid NULL,
  recorded_by_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bar_issue_log_issue_date ON public.bar_issue_log (issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_bar_issue_log_waitron ON public.bar_issue_log (waitron_name);
CREATE INDEX IF NOT EXISTS idx_bar_issue_log_order ON public.bar_issue_log (order_id);
CREATE INDEX IF NOT EXISTS idx_bar_issue_log_item ON public.bar_issue_log (item_name);

-- 4.5 kitchen_fridge_log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kitchen_fridge_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name        text NOT NULL,
  menu_item_id     uuid,
  quantity         integer NOT NULL DEFAULT 1,
  cost_price       numeric(12,2) NOT NULL DEFAULT 0,
  total_cost       numeric(12,2) NOT NULL DEFAULT 0,
  waitron_id       uuid REFERENCES profiles(id),
  waitron_name     text,
  recorded_by      uuid REFERENCES profiles(id),
  recorded_by_name text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kitchen_fridge_created ON kitchen_fridge_log(created_at DESC);

-- 4.6 kitchen_stock_benchmarks ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kitchen_stock_benchmarks (
  item_name       text PRIMARY KEY,
  expected_yield  numeric(10,2) NOT NULL,
  tolerance_pct   numeric(5,2)  NOT NULL DEFAULT 5,
  raw_unit        text NOT NULL DEFAULT 'kg',
  cooked_unit     text NOT NULL DEFAULT 'portion',
  raw_qty         numeric NOT NULL DEFAULT 1,
  cooked_qty      numeric,
  note            text,
  set_by          uuid REFERENCES profiles(id),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT kitchen_stock_benchmarks_qty_positive CHECK (raw_qty > 0 AND (cooked_qty IS NULL OR cooked_qty > 0))
);

-- 4.7 games & shisha ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  price         numeric(10,2) NOT NULL DEFAULT 0,
  duration_mins int,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type_id  uuid REFERENCES game_types(id),
  game_name     text NOT NULL,
  quantity      int NOT NULL DEFAULT 1,
  unit_price    numeric(10,2) NOT NULL,
  total_price   numeric(10,2) NOT NULL,
  customer_name text,
  payment_method text NOT NULL DEFAULT 'cash',
  status        text NOT NULL DEFAULT 'paid',
  notes         text,
  recorded_by   uuid REFERENCES profiles(id),
  recorded_by_name text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shisha_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'pot',
  price         numeric(10,2) NOT NULL DEFAULT 0,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shisha_sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid REFERENCES shisha_variants(id),
  variant_name  text NOT NULL,
  flavour       text,
  quantity      int NOT NULL DEFAULT 1,
  unit_price    numeric(10,2) NOT NULL,
  total_price   numeric(10,2) NOT NULL,
  customer_name text,
  payment_method text NOT NULL DEFAULT 'cash',
  status        text NOT NULL DEFAULT 'paid',
  notes         text,
  recorded_by   uuid REFERENCES profiles(id),
  recorded_by_name text,
  created_at    timestamptz DEFAULT now()
);

-- 4.8 payroll ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        uuid REFERENCES profiles(id),
  staff_name      text NOT NULL,
  role            text,
  bank_name       text,
  account_number  text,
  base_salary     numeric(12,2) NOT NULL DEFAULT 0,
  daily_rate      numeric(12,2) NOT NULL DEFAULT 0,
  outstanding     numeric(12,2) NOT NULL DEFAULT 0,
  docking         numeric(12,2) NOT NULL DEFAULT 0,
  month           text NOT NULL,
  updated_by      text,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (staff_id, month)
);
CREATE INDEX IF NOT EXISTS idx_payroll_month ON payroll(month);
CREATE INDEX IF NOT EXISTS idx_payroll_staff ON payroll(staff_id);

-- 4.9 service_ratings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NULL,
  zone_name text NULL,
  rating text NOT NULL CHECK (rating in ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_ratings_created_at_idx ON public.service_ratings (created_at DESC);
CREATE INDEX IF NOT EXISTS service_ratings_zone_id_idx ON public.service_ratings (zone_id);

-- ============================================================================
-- 6. RLS — permissive app-wide access (anon + authenticated)
--    Mirrors the original DB where the PIN-session app operates as anon.
--    The REAL control is the owner-escalation trigger (section 7).
-- ============================================================================
DO $$
DECLARE
  t text;
  tables_to_open text[] := ARRAY[
    'profiles','audit_log','settings','menu_categories','menu_items',
    'menu_item_zone_prices','table_categories','tables','zone_assignments',
    'orders','order_items','customer_orders','tips','waiter_calls','void_log',
    'inventory','suppliers','purchase_orders','restock_log','kitchen_stock',
    'kitchen_stock_entries','returns_log','debtors','debt_payments','debtor_payments',
    'bank_accounts','till_sessions','payouts','attendance','period_closes',
    'period_stock_counts','service_log',
    'push_subscriptions','store_requests','void_requests','bar_chiller_stock',
    'bar_issue_log','kitchen_fridge_log','kitchen_stock_benchmarks','game_types',
    'game_sales','shisha_variants','shisha_sales','payroll','service_ratings'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_open LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "app_full_access" ON %I;', t);
    EXECUTE format(
      'CREATE POLICY "app_full_access" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

-- profiles view without sensitive columns (belt & suspenders)
CREATE OR REPLACE VIEW profiles_public AS
  SELECT id, full_name, role, email, phone, is_active, created_at
  FROM profiles;
GRANT SELECT ON profiles_public TO anon, authenticated;

-- ============================================================================
-- 7. TRIGGERS & FUNCTIONS
-- ============================================================================

-- 7.1 Prevent non-owners assigning the 'owner' role
CREATE OR REPLACE FUNCTION prevent_owner_role_escalation()
RETURNS TRIGGER AS $$
DECLARE
  caller_role text;
BEGIN
  IF NEW.role <> 'owner' THEN
    RETURN NEW;
  END IF;
  SELECT role INTO caller_role FROM profiles WHERE id = auth.uid() LIMIT 1;
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

-- 7.2 Always stamp closed_at when an order is paid
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

-- 7.3 Recalculate order total from line items on close (anti-tamper)
CREATE OR REPLACE FUNCTION recalculate_order_total()
RETURNS TRIGGER AS $$
DECLARE
  real_total numeric;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT COALESCE(SUM(total_price), 0)
      INTO real_total
      FROM order_items
     WHERE order_id = NEW.id
       AND void_qty IS NULL OR void_qty = 0;
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

-- 7.4 Prevent duplicate open orders per table
CREATE OR REPLACE FUNCTION prevent_duplicate_open_orders()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'open' AND NEW.table_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM orders
      WHERE table_id = NEW.table_id AND status = 'open' AND id != NEW.id
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

-- 7.5 Server-side customer order total verification (QR menu)
CREATE OR REPLACE FUNCTION verify_customer_order_total()
RETURNS TRIGGER AS $$
DECLARE
  real_total numeric := 0;
  item jsonb;
  menu_price numeric;
  item_qty int;
BEGIN
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

-- 7.6 Rate-limit QR orders per table (3 per 60s)
CREATE OR REPLACE FUNCTION check_customer_order_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
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

-- 7.7 Enforce SSP50,000/day payout limit per staff
CREATE OR REPLACE FUNCTION check_daily_payout_limit()
RETURNS TRIGGER AS $$
DECLARE
  daily_total numeric;
  payout_limit numeric := 50000;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO daily_total
    FROM payouts
   WHERE DATE(created_at AT TIME ZONE 'Africa/Lagos') = DATE(NOW() AT TIME ZONE 'Africa/Lagos');
  IF daily_total + NEW.amount > payout_limit THEN
    RAISE EXCEPTION 'Daily payout limit of SSP% exceeded. Total so far: SSP%. Requested: SSP%',
      payout_limit, daily_total, NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_daily_payout_limit ON payouts;
CREATE TRIGGER enforce_daily_payout_limit
  BEFORE INSERT ON payouts
  FOR EACH ROW EXECUTE FUNCTION check_daily_payout_limit();

-- ============================================================================
-- 8. RPCs
-- ============================================================================

-- 8.1 verify_pin_and_get_profile — THE PIN-login RPC the app actually calls.
--     Matches plain-text PINs only (legacy storage) and returns the staff row.
CREATE OR REPLACE FUNCTION verify_pin_and_get_profile(entered_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff profiles%ROWTYPE;
BEGIN
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

-- 8.2 verify_staff_pin — legacy variant (kept for parity)
CREATE OR REPLACE FUNCTION verify_staff_pin(entered_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_row profiles%ROWTYPE;
BEGIN
  FOR staff_row IN
    SELECT * FROM profiles
    WHERE is_active = true AND pin IS NOT NULL AND pin = entered_pin
    LIMIT 1
  LOOP
    RETURN json_build_object(
      'id',         staff_row.id,
      'full_name',  staff_row.full_name,
      'role',       staff_row.role,
      'email',      staff_row.email,
      'is_active',  staff_row.is_active,
      'approval_pin', NULL
    );
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO anon, authenticated;

-- 8.3 approve_store_request — manager approves bar→chiller store request
DROP FUNCTION IF EXISTS approve_store_request CASCADE;
CREATE OR REPLACE FUNCTION approve_store_request(
  req_id uuid,
  approver_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec store_requests;
  inv inventory;
BEGIN
  SELECT * INTO rec FROM store_requests WHERE id = req_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('status', 'not_found');
  END IF;
  IF rec.status <> 'pending' THEN
    RETURN json_build_object('status', rec.status);
  END IF;
  UPDATE store_requests
     SET status = 'approved',
         approved_by_name = COALESCE(approver_name, 'Manager'),
         resolved_at = now()
   WHERE id = req_id;
  IF rec.inventory_id IS NOT NULL THEN
    UPDATE inventory
       SET current_stock = current_stock - rec.quantity
     WHERE id = rec.inventory_id;
  END IF;
  RETURN json_build_object('status', 'approved');
END;
$$;

REVOKE ALL ON FUNCTION approve_store_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_store_request(uuid, text) TO anon, authenticated;

-- ============================================================================
-- 9. STORAGE BUCKET (menu item images)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('menu-items', 'menu-items', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 10. REALTIME — subscribe every business table
-- ============================================================================
DO $$
DECLARE
  t text;
  rt_tables text[] := ARRAY[
    'profiles','settings','menu_categories','menu_items','menu_item_zone_prices',
    'table_categories','tables','zone_assignments','orders','order_items',
    'customer_orders','tips','waiter_calls','void_log','inventory','suppliers',
    'purchase_orders','restock_log','kitchen_stock','kitchen_stock_entries',
    'returns_log','debtors','debt_payments','debtor_payments','bank_accounts',
    'till_sessions','payouts','attendance','period_closes','period_stock_counts',
    'service_log','push_subscriptions',
    'store_requests','void_requests','bar_chiller_stock','bar_issue_log',
    'kitchen_fridge_log','kitchen_stock_benchmarks','game_types','game_sales',
    'shisha_variants','shisha_sales','payroll','service_ratings'
  ];
BEGIN
  FOREACH t IN ARRAY rt_tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;

-- ============================================================================
-- 11. DEFAULT SETTINGS SEED
-- ============================================================================
SELECT 'kolondiro_full_schema applied' AS status, now() AS at;