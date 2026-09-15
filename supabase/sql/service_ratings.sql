-- Run this in Supabase SQL editor to enable customer service ratings.
-- Table used by:
-- - Public customer menu page: inserts thumbs up/down
-- - Management dashboard: reads daily summary

create table if not exists public.service_ratings (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid null,
  zone_name text null,
  rating text not null check (rating in ('up', 'down')),
  created_at timestamptz not null default now()
);

create index if not exists service_ratings_created_at_idx on public.service_ratings (created_at desc);
create index if not exists service_ratings_zone_id_idx on public.service_ratings (zone_id);

alter table public.service_ratings enable row level security;

-- Allow anyone (including anon) to submit a rating.
drop policy if exists "service_ratings_insert_anyone" on public.service_ratings;
create policy "service_ratings_insert_anyone"
on public.service_ratings
for insert
to public
with check (true);

-- Allow logged-in staff to view ratings.
drop policy if exists "service_ratings_select_authenticated" on public.service_ratings;
create policy "service_ratings_select_authenticated"
on public.service_ratings
for select
to authenticated
using (true);

