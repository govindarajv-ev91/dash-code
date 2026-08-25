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

-- Batched reset: one short DELETE per call so Reset Data does not hit statement_timeout.
-- The app loops this until 0 rows are deleted.
create or replace function public.reset_upload_table_batch(
  p_table text,
  p_month text default null,
  p_limit integer default 1500
)
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  tbl text;
  lim integer;
  n integer := 0;
  month_label text;
begin
  tbl := case p_table
    when 'rider_payment_data' then 'rider_payment_data'
    when 'manual_collation_data' then 'manual_collation_data'
    when 'rental_pending_data' then 'rental_pending_data'
    when 'ev91_sd_data' then 'ev91_sd_data'
    else null
  end;
  if tbl is null then
    raise exception 'unsupported table: %', p_table;
  end if;

  lim := greatest(50, least(coalesce(p_limit, 1500), 3000));
  month_label := nullif(btrim(coalesce(p_month, '')), '');

  if month_label is null or tbl = 'ev91_sd_data' then
    execute format(
      'delete from public.%I where id in (select id from public.%I order by id limit %s)',
      tbl, tbl, lim
    );
  else
    execute format(
      'delete from public.%I where id in (select id from public.%I where month = $1 order by id limit %s)',
      tbl, tbl, lim
    ) using month_label;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.reset_upload_table_batch(text, text, integer) to anon, authenticated;

-- Optional: raise DB statement_timeout for this role if inserts still fail (Supabase default is often ~8s).
-- Uncomment only if your project allows it:
-- alter role authenticator set statement_timeout = '60s';
-- alter role anon set statement_timeout = '60s';
-- notify pgrst, 'reload config';
