-- Fix payroll RLS for signed-in app users.
-- The frontend writes with the authenticated role, not anon.

alter table payroll enable row level security;

drop policy if exists "authenticated_select_payroll" on payroll;
drop policy if exists "authenticated_insert_payroll" on payroll;
drop policy if exists "authenticated_update_payroll" on payroll;
drop policy if exists "authenticated_delete_payroll" on payroll;

create policy "authenticated_select_payroll"
on payroll
for select
to authenticated
using (true);

create policy "authenticated_insert_payroll"
on payroll
for insert
to authenticated
with check (true);

create policy "authenticated_update_payroll"
on payroll
for update
to authenticated
using (true)
with check (true);

create policy "authenticated_delete_payroll"
on payroll
for delete
to authenticated
using (true);
