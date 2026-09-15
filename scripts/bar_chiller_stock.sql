-- Bar Chiller daily stock register
-- Mirrors kitchen_stock structure for bar drinks

create table if not exists bar_chiller_stock (
  id            uuid primary key default gen_random_uuid(),
  date          date not null default current_date,
  item_name     text not null,
  unit          text not null default 'bottles',
  opening_qty   numeric(10,2) not null default 0,
  received_qty  numeric(10,2) not null default 0,
  sold_qty      numeric(10,2) not null default 0,
  void_qty      numeric(10,2) not null default 0,
  closing_qty   numeric(10,2) not null default 0,
  note          text,
  recorded_by   uuid references profiles(id),
  updated_at    timestamptz default now(),
  unique(date, item_name)
);

-- RLS
alter table bar_chiller_stock enable row level security;

create policy "bar_chiller_stock_select" on bar_chiller_stock
  for select using (true);

create policy "bar_chiller_stock_insert" on bar_chiller_stock
  for insert with check (true);

create policy "bar_chiller_stock_update" on bar_chiller_stock
  for update using (true);

create policy "bar_chiller_stock_delete" on bar_chiller_stock
  for delete using (true);
