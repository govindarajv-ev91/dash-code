-- Fix Order History statement timeouts on large order_upload_data.
-- Run once in Supabase SQL Editor.

-- Composite index for: WHERE month = ? ORDER BY id / id > cursor
create index if not exists order_upload_data_month_id_idx
  on public.order_upload_data (month, id);

-- Faster distinct month list for the month dropdown
create or replace function public.distinct_order_upload_months()
returns table (month text)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Seek once per distinct month through the month index instead of grouping
  -- every order row. Invoker security retains the caller's table/RLS policies.
  with recursive month_keys as (
    (
      select m.month from public.order_upload_data m
      where m.month > '' and btrim(m.month) <> ''
      order by m.month limit 1
    )
    union all
    select next_month.month
    from month_keys previous_month
    cross join lateral (
      select m.month from public.order_upload_data m
      where m.month > previous_month.month and btrim(m.month) <> ''
      order by m.month limit 1
    ) next_month
  )
  select month_keys.month from month_keys order by month_keys.month desc;
$$;

grant execute on function public.distinct_order_upload_months() to anon;
grant execute on function public.distinct_order_upload_months() to authenticated;
