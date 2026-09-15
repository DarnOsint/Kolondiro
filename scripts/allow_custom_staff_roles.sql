-- Allow custom staff roles in profiles.role.
-- Run this in Supabase SQL Editor before using custom roles from Staff Management.

alter table profiles drop constraint if exists profiles_role_check;

alter table profiles add constraint profiles_role_check check (
  role is not null and btrim(role) <> ''
);
