-- Fix missing columns across all tables the app code writes to
-- 2026-09-16 — comprehensive schema fix

-- 1. attendance — ShiftManager, AttendanceTab, TimesheetTab, POS, Supervisor, DailyReport, Executive
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS staff_name        text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS role              text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS recorded_by      uuid;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS recorded_by_name text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS duration_minutes  integer;

-- 2. tips — TipsTab select/update
ALTER TABLE tips ADD COLUMN IF NOT EXISTS shift_date         date;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'pending';
ALTER TABLE tips ADD COLUMN IF NOT EXISTS disbursed_at       timestamptz;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS disbursed_by       uuid;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS disbursed_by_name  text;
ALTER TABLE tips ADD COLUMN IF NOT EXISTS notes              text;

-- 3. returns_log — ReturnsTab, KDS Bar/Mixologist/Kitchen/Griller
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS shift_date         date;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS reviewed           boolean DEFAULT false;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS reviewed_by        uuid;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS reviewed_by_name   text;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS reviewed_at        timestamptz;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS notes              text;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS barman_id          uuid;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS barman_name        text;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS kitchen_name       text;
ALTER TABLE returns_log ADD COLUMN IF NOT EXISTS griller_name       text;

-- 4. order_items — KDS return flow (BarKDS, GrillerKDS, KitchenKDS, MixologistKDS)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS return_accepted_at  timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS return_requested_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total_amount        numeric;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS updated_at          timestamptz;

-- 5. orders — TillManagement (payment_status select)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text;

-- 6. payouts — PayoutsTab insert/select, LedgerTab
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS paid_to     text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS recorded_by uuid;

-- 7. period_closes — MonthEnd lock
ALTER TABLE period_closes ADD COLUMN IF NOT EXISTS closed_at      timestamptz;
ALTER TABLE period_closes ADD COLUMN IF NOT EXISTS closed_by      uuid;
ALTER TABLE period_closes ADD COLUMN IF NOT EXISTS closed_by_name text;

-- 8. debtors — CashSaleModal (order_id)
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS order_id uuid;

-- 9. push_subscriptions — usePushNotifications.ts
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS staff_id    uuid;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS subscription jsonb;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at  timestamptz;

-- 10. bar_chiller_stock — BarKDS insert uses created_at
ALTER TABLE bar_chiller_stock ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 11. restock_log — Suppliers.tsx insert
ALTER TABLE restock_log ADD COLUMN IF NOT EXISTS change_amount numeric;
ALTER TABLE restock_log ADD COLUMN IF NOT EXISTS reason         text;
ALTER TABLE restock_log ADD COLUMN IF NOT EXISTS recorded_by    uuid;
