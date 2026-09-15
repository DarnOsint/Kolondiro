-- Store requests: barman requests items from main store (inventory) to bar chiller
create table if not exists store_requests (
  id              uuid primary key default gen_random_uuid(),
  item_name       text not null,
  inventory_id    uuid references inventory(id),
  quantity        numeric(10,2) not null,
  unit            text not null default 'bottles',
  requested_by    uuid references profiles(id),
  requested_by_name text,
  status          text not null default 'pending',
  approved_by     uuid references profiles(id),
  approved_by_name text,
  reason          text,
  reject_reason   text,
  created_at      timestamptz default now(),
  resolved_at     timestamptz
);

create index if not exists idx_store_requests_status on store_requests(status);
create index if not exists idx_store_requests_created_at on store_requests(created_at desc);

alter table store_requests enable row level security;
create policy "anon_select_store_requests" on store_requests for select to anon using (true);
create policy "anon_insert_store_requests" on store_requests for insert to anon with check (true);
create policy "anon_update_store_requests" on store_requests for update to anon using (true);
