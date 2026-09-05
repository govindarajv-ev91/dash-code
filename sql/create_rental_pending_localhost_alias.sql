-- Localhost-style params for production GET (same as /api/rental-pending).
-- Run in Supabase SQL Editor after create_rental_pending_transfer_rpc.sql (safe to re-run).
--
-- Production (Amplify — after amplify-redirects deploy):
--   https://main.d2y6lleakorn3s.amplifyapp.com/api/rental-pending?ev91_rider_id=12345&api_key=ev91-rental-pending-2026
--
-- Direct Supabase (same query shape; needs apikey header or ?apikey=):
--   https://arnxvnkednpzyzyfculx.supabase.co/rest/v1/rpc/rental_pending?ev91_rider_id=12345&api_key=ev91-rental-pending-2026

create or replace function public.rental_pending(
  ev91_rider_id text,
  api_key text,
  history text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.rental_pending_transfer(
    ev91_rider_id,
    api_key,
    lower(trim(coalesce(history, ''))) in ('1', 'true', 'yes', 'y')
  );
$$;

grant execute on function public.rental_pending(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
