-- Payroll: monthly staff payment records
create table if not exists payroll (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid references profiles(id),
  staff_name      text not null,
  role            text,
  bank_name       text,
  account_number  text,
  base_salary     numeric(12,2) not null default 0,
  outstanding     numeric(12,2) not null default 0,
  docking         numeric(12,2) not null default 0,
  month           text not null,  -- e.g. '2026-04'
  updated_by      text,
  updated_at      timestamptz default now(),
  unique(staff_id, month)
);

create index if not exists idx_payroll_month on payroll(month);
create index if not exists idx_payroll_staff on payroll(staff_id);

alter table payroll enable row level security;
create policy "anon_select_payroll" on payroll for select to anon using (true);
create policy "anon_insert_payroll" on payroll for insert to anon with check (true);
create policy "anon_update_payroll" on payroll for update to anon using (true);
create policy "anon_delete_payroll" on payroll for delete to anon using (true);
