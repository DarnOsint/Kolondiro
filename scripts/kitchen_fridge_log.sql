create table if not exists kitchen_fridge_log (
  id              uuid primary key default gen_random_uuid(),
  item_name       text not null,
  menu_item_id    uuid,
  quantity        integer not null default 1,
  cost_price      numeric(12,2) not null default 0,
  total_cost      numeric(12,2) not null default 0,
  waitron_id      uuid references profiles(id),
  waitron_name    text,
  recorded_by     uuid references profiles(id),
  recorded_by_name text,
  created_at      timestamptz default now()
);

create index if not exists idx_kitchen_fridge_created on kitchen_fridge_log(created_at desc);

alter table kitchen_fridge_log enable row level security;
create policy "anon_select_kitchen_fridge" on kitchen_fridge_log for select to anon using (true);
create policy "anon_insert_kitchen_fridge" on kitchen_fridge_log for insert to anon with check (true);
