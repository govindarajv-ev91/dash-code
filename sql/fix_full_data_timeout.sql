-- Full Data month queries. Run once in the Supabase SQL Editor.
-- These indexes preserve existing rows and permissions; safe to re-run.
create index if not exists iot_data_run_date_id_idx
  on public.iot_data (run_date, id);
create index if not exists order_upload_data_month_id_idx
  on public.order_upload_data (month, id);
