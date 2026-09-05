-- Migrate rental_pending_data for new upload format:
-- Deployed Date, DB Current Status, Vehicle Status, Current Status, Client, Contact No,
-- Rider Name, EV91 Rider ID, Rider ID, Vehicle Number, City, Week Start/End,
-- Rent / week, Source Name, Deficit Amount Week N, WK N EV Rent, Total Rent Amount,
-- Payout Deductions, Total SD Amount, Pending Amount, Manual Collection,
-- Actual pending for Week, Payment Collected Date, In-active Days, Eff/inff,
-- Current week orders, Remarks
--
-- Run in Supabase SQL Editor (safe to re-run).

alter table public.rental_pending_data
  add column if not exists db_current_status text;

alter table public.rental_pending_data
  add column if not exists ev91_rider_id text;

create index if not exists rental_pending_data_ev91_rider_id_idx
  on public.rental_pending_data (ev91_rider_id);

-- Refresh PostgREST schema cache so new columns are insertable immediately
notify pgrst, 'reload schema';
