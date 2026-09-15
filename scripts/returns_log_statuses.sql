alter table returns_log drop constraint if exists returns_log_status_check;

alter table returns_log add constraint returns_log_status_check check (
  status in (
    'pending',
    'bar_accepted',
    'kitchen_accepted',
    'griller_accepted',
    'accepted',
    'rejected',
    'manager_rejected',
    'expired'
  )
);
