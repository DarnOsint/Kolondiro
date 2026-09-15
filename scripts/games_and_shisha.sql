-- Games configuration and sales
create table if not exists game_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  price         numeric(10,2) not null default 0,
  duration_mins int,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz default now()
);

create table if not exists game_sales (
  id            uuid primary key default gen_random_uuid(),
  game_type_id  uuid references game_types(id),
  game_name     text not null,
  quantity      int not null default 1,
  unit_price    numeric(10,2) not null,
  total_price   numeric(10,2) not null,
  customer_name text,
  payment_method text not null default 'cash',
  status        text not null default 'paid',
  notes         text,
  recorded_by   uuid references profiles(id),
  recorded_by_name text,
  created_at    timestamptz default now()
);

-- Shisha configuration and sales
create table if not exists shisha_variants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'pot',
  price         numeric(10,2) not null default 0,
  description   text,
  is_active     boolean not null default true,
  created_at    timestamptz default now()
);

create table if not exists shisha_sales (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid references shisha_variants(id),
  variant_name  text not null,
  flavour       text,
  quantity      int not null default 1,
  unit_price    numeric(10,2) not null,
  total_price   numeric(10,2) not null,
  customer_name text,
  payment_method text not null default 'cash',
  status        text not null default 'paid',
  notes         text,
  recorded_by   uuid references profiles(id),
  recorded_by_name text,
  created_at    timestamptz default now()
);

-- RLS policies
alter table game_types enable row level security;
alter table game_sales enable row level security;
alter table shisha_variants enable row level security;
alter table shisha_sales enable row level security;

create policy "game_types_all" on game_types for all using (true) with check (true);
create policy "game_sales_all" on game_sales for all using (true) with check (true);
create policy "shisha_variants_all" on shisha_variants for all using (true) with check (true);
create policy "shisha_sales_all" on shisha_sales for all using (true) with check (true);
