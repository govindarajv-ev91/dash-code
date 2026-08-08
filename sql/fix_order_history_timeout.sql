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
as $$
  select m.month
  from public.order_upload_data m
  where m.month is not null and btrim(m.month) <> ''
  group by m.month
  order by m.month desc;
$$;

grant execute on function public.distinct_order_upload_months() to anon;
grant execute on function public.distinct_order_upload_months() to authenticated;
