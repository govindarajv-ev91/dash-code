-- Keep localhost-style alias in sync (optional if full RPC file already applied).
-- Run after create_rental_pending_transfer_rpc.sql

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
