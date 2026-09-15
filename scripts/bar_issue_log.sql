create table if not exists public.bar_issue_log (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null,
  order_id uuid not null,
  order_item_id uuid not null unique,
  table_id uuid null,
  table_name text null,
  waitron_id uuid null,
  waitron_name text null,
  menu_item_id uuid null,
  item_name text not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null default 0,
  total_price numeric not null default 0,
  station text not null default 'bar' check (station in ('bar')),
  source text not null default 'pos_order' check (source in ('pos_order')),
  recorded_by uuid null,
  recorded_by_name text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bar_issue_log_issue_date on public.bar_issue_log (issue_date desc);
create index if not exists idx_bar_issue_log_waitron on public.bar_issue_log (waitron_name);
create index if not exists idx_bar_issue_log_order on public.bar_issue_log (order_id);
create index if not exists idx_bar_issue_log_item on public.bar_issue_log (item_name);

alter table public.bar_issue_log enable row level security;

drop policy if exists "authenticated_select_bar_issue_log" on public.bar_issue_log;
drop policy if exists "authenticated_insert_bar_issue_log" on public.bar_issue_log;
drop policy if exists "authenticated_update_bar_issue_log" on public.bar_issue_log;
drop policy if exists "authenticated_delete_bar_issue_log" on public.bar_issue_log;

create policy "authenticated_select_bar_issue_log"
on public.bar_issue_log
for select
to authenticated
using (true);

create policy "authenticated_insert_bar_issue_log"
on public.bar_issue_log
for insert
to authenticated
with check (true);

create policy "authenticated_update_bar_issue_log"
on public.bar_issue_log
for update
to authenticated
using (true)
with check (true);

create policy "authenticated_delete_bar_issue_log"
on public.bar_issue_log
for delete
to authenticated
using (true);
