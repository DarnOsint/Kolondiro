-- Kitchen Stock Benchmarks
-- Run once in Supabase SQL editor

create table if not exists kitchen_stock_benchmarks (
  item_name       text primary key,
  expected_yield  numeric(10,2) not null,   -- cooked units per 1 raw unit
  tolerance_pct   numeric(5,2)  not null default 5,  -- ±% band for OK status
  raw_unit        text not null default 'kg',
  cooked_unit     text not null default 'portion',
  note            text,
  set_by          uuid references profiles(id),
  updated_at      timestamptz default now()
);

alter table kitchen_stock_benchmarks enable row level security;

create policy "read benchmarks" on kitchen_stock_benchmarks
  for select to authenticated using (true);

create policy "manager write benchmarks" on kitchen_stock_benchmarks
  for all to authenticated using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role in ('owner', 'manager')
    )
  );

-- Also add guest_id_number column to room_stays if not already present
-- (added in apartment dashboard polish session)
alter table room_stays
  add column if not exists guest_id_number text;
