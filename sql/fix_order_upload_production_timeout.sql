-- Fix Order Upload timeouts in production (large order_upload_data).
-- Run once in Supabase SQL Editor after create_order_upload_table.sql.

-- Keyset pagination + month filter (Order History / summary)
create index if not exists order_upload_data_month_id_idx
  on public.order_upload_data (month, id);

-- Recent preview: ORDER BY id DESC LIMIT n
create index if not exists order_upload_data_id_desc_idx
  on public.order_upload_data (id desc);

-- Upsert conflict target — ensure unique index exists (safe if already created)
create unique index if not exists order_upload_data_worker_date_client_delivered_uidx
  on public.order_upload_data (worker_code, date_record, client, delivered);

-- Faster distinct month list for reset dropdown
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
