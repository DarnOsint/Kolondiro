-- Store requests: track when approved items have been collected/given to the
-- barman. Printing (and future collection reconciliation) only includes
-- approved requests where collected_at is null, so already-given items are
-- never re-printed when additional batches are requested later the same day.

alter table store_requests
  add column if not exists collected_at     timestamptz,
  add column if not exists collected_by_name text;

create index if not exists idx_store_requests_collected_at on store_requests(collected_at);