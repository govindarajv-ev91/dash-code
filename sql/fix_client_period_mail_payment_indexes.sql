-- Optional repair if scheduled payment reads time out (57014).
-- Run in Supabase SQL Editor. Preserves payment data and existing permissions.
-- These match the date/id and accounting-month/id scans used by the mailer.
create index if not exists rider_payment_data_period_start_id_idx
  on public.rider_payment_data (period_start, id);
create index if not exists rider_payment_data_month_id_idx
  on public.rider_payment_data (month, id);
analyze public.rider_payment_data;
