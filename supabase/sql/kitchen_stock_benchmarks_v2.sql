-- Kitchen stock benchmarks v2: allow benchmarking from any raw quantity to expected cooked output.
-- Run this once in Supabase SQL editor.

alter table if exists public.kitchen_stock_benchmarks
  add column if not exists raw_qty numeric not null default 1;

alter table if exists public.kitchen_stock_benchmarks
  add column if not exists cooked_qty numeric;

-- Backfill cooked_qty from expected_yield for existing benchmarks (assumes raw_qty=1).
update public.kitchen_stock_benchmarks
set cooked_qty = expected_yield * raw_qty
where cooked_qty is null
  and expected_yield is not null;

-- Helpful constraint: both quantities must be positive when set.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kitchen_stock_benchmarks_qty_positive'
  ) then
    alter table public.kitchen_stock_benchmarks
      add constraint kitchen_stock_benchmarks_qty_positive
      check (raw_qty > 0 and (cooked_qty is null or cooked_qty > 0));
  end if;
end $$;

