-- Fix Rider Payment Upload statement timeouts on large rider_payment_data.
-- Run once in Supabase SQL Editor.

-- Helps month filters / resets: WHERE month = ? ORDER BY id
create index if not exists rider_payment_data_month_id_idx
  on public.rider_payment_data (month, id);

create index if not exists manual_collation_data_month_id_idx
  on public.manual_collation_data (month, id);

create index if not exists rental_pending_data_month_id_idx
  on public.rental_pending_data (month, id);

-- Faster distinct month lists (group by uses month index; avoid btrim in WHERE)
create or replace function public.distinct_rider_payment_months()
returns table (month text)
language sql
stable
security definer
set search_path = public
as $$
  select m.month
  from public.rider_payment_data m
  where m.month is not null and m.month <> ''
  group by m.month
  order by m.month desc;
$$;

create or replace function public.distinct_manual_collation_months()
returns table (month text)
language sql
stable
security definer
set search_path = public
as $$
  select m.month
  from public.manual_collation_data m
  where m.month is not null and m.month <> ''
  group by m.month
  order by m.month desc;
$$;

create or replace function public.distinct_rental_pending_months()
returns table (month text)
language sql
stable
security definer
set search_path = public
as $$
  select m.month
  from public.rental_pending_data m
  where m.month is not null and m.month <> ''
  group by m.month
  order by m.month desc;
$$;

grant execute on function public.distinct_rider_payment_months() to anon, authenticated;
grant execute on function public.distinct_manual_collation_months() to anon, authenticated;
grant execute on function public.distinct_rental_pending_months() to anon, authenticated;
