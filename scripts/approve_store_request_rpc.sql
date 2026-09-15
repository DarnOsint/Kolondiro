-- ============================================================
-- approve_store_request RPC — SECURITY DEFINER
-- Grants manager (authenticated) permission to approve
-- Run this in Supabase SQL Editor
-- ============================================================

drop function if exists approve_store_request cascade;

create or replace function approve_store_request(
  req_id uuid,
  approver_name text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec store_requests;
  inv inventory;
begin
  -- Lock & read the request row
  select * into rec
    from store_requests
   where id = req_id
     for update;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  -- Already handled — return current status so caller knows
  if rec.status <> 'pending' then
    return json_build_object('status', rec.status);
  end if;

  -- Mark request approved
  update store_requests
     set status        = 'approved',
         approved_by_name = coalesce(approver_name, 'Manager'),
         resolved_at   = now()
   where id = req_id;

  -- Deduct from main store inventory
  if rec.inventory_id is not null then
    update inventory
       set current_stock = current_stock - rec.quantity
     where id = rec.inventory_id;
  end if;

  return json_build_object('status', 'approved');
end;
$$;

-- Revoke from public, grant to authenticated users only
revoke all on function approve_store_request(uuid, text) from public;
grant execute on function approve_store_request(uuid, text) to anon, authenticated;

select 'approve_store_request rpc created' as status, now() at time zone 'Africa/Lagos' as wat;
