-- Fast rental pending transfer RPC (index-friendly).
-- Run in Supabase SQL Editor (replaces previous function — safe to re-run).
--
-- Browser GET (must include Supabase apikey — PostgREST always requires it):
--   https://arnxvnkednpzyzyfculx.supabase.co/rest/v1/rpc/rental_pending_transfer?p_ev91_rider_id=CHE-26-R001580&p_api_key=ev91-rental-pending-2026&apikey=sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH
--
-- Prefer POST (more reliable than GET for this RPC):
--   POST /rest/v1/rpc/rental_pending_transfer
--   Headers: apikey, Authorization: Bearer <anon>, Content-Type: application/json
--   Body: {"p_ev91_rider_id":"CHE-26-R001580","p_api_key":"ev91-rental-pending-2026","p_history":false}

create or replace function public.rental_pending_transfer(
  p_ev91_rider_id text,
  p_api_key text,
  p_history boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_key text := 'ev91-rental-pending-2026';
  ev91 text := nullif(trim(coalesce(p_ev91_rider_id, '')), '');
  damage_amt numeric := null;
  traffic_amt numeric := null;
  latest_rider_id text := null;
  mapped jsonb;
  history_arr jsonb := '[]'::jsonb;
  row_rec record;
begin
  if coalesce(trim(p_api_key), '') is distinct from expected_key then
    return jsonb_build_object(
      'success', false,
      'message', 'Unauthorized. Provide a valid p_api_key / x-api-key.'
    );
  end if;

  if ev91 is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Missing required parameter: p_ev91_rider_id'
    );
  end if;

  -- Exact match so ev91_rider_id index is used (avoid trim() on column)
  select r.*
  into row_rec
  from public.rental_pending_data r
  where r.ev91_rider_id = ev91
  order by r.id desc
  limit 1;

  if row_rec.id is null then
    return jsonb_build_object(
      'success', false,
      'ev91_rider_id', ev91,
      'message', 'No rental pending data found for this EV91 Rider ID'
    );
  end if;

  latest_rider_id := nullif(trim(row_rec.rider_id), '');

  if latest_rider_id is not null
     and to_regclass('public.rider_payment_data') is not null then
    select p.damage, p.traffic
    into damage_amt, traffic_amt
    from public.rider_payment_data p
    where p.rider_id = latest_rider_id
      and (p.damage is not null or p.traffic is not null)
    order by p.id desc
    limit 1;
  end if;

  if coalesce(p_history, false) then
    select coalesce(jsonb_agg(x.obj order by x.id desc), '[]'::jsonb)
    into history_arr
    from (
      select
        r.id,
        jsonb_build_object(
          'ev91_rider_id', nullif(trim(r.ev91_rider_id), ''),
          'rider_id', nullif(trim(r.rider_id), ''),
          'rider_name', nullif(trim(r.rider_name), ''),
          'city', nullif(trim(r.city), ''),
          'client_name', nullif(trim(r.client_name), ''),
          'month', nullif(trim(r.month), ''),
          'week_start_date', nullif(trim(r.week_start_date), ''),
          'week_end_date', nullif(trim(r.week_end_date), ''),
          'actual_pending_for_week', r.actual_pending_for_week_after_sd,
          'total_rent_amount', r.total_rent_amount,
          'total_sd_amount', r.total_sd_amount,
          'pending_amount', r.pending_amount,
          'manual_collection', r.manual_payment_collection,
          'payout_deductions', r.payout_deduction_week_23,
          'rent_per_week', r.rent_per_week,
          'current_status', nullif(trim(r.current_status), ''),
          'db_current_status', nullif(trim(r.db_current_status), ''),
          'vehicle_status', nullif(trim(r.vehicle_status), ''),
          'vehicle_number', nullif(trim(r.vehicle_number), ''),
          'contact_no', nullif(trim(r.contact_no), ''),
          'source_name', nullif(trim(r.source_name), ''),
          'inactive_days', r.inactive_days,
          'current_week_orders', r.current_week_orders,
          'damage_amount', damage_amt,
          'traffic_challan_amount', traffic_amt
        ) as obj
      from public.rental_pending_data r
      where r.ev91_rider_id = ev91
      order by r.id desc
      limit 500
    ) x;

    return jsonb_build_object(
      'success', true,
      'ev91_rider_id', ev91,
      'count', jsonb_array_length(history_arr),
      'data', history_arr
    );
  end if;

  mapped := jsonb_build_object(
    'ev91_rider_id', nullif(trim(row_rec.ev91_rider_id), ''),
    'rider_id', nullif(trim(row_rec.rider_id), ''),
    'rider_name', nullif(trim(row_rec.rider_name), ''),
    'city', nullif(trim(row_rec.city), ''),
    'client_name', nullif(trim(row_rec.client_name), ''),
    'month', nullif(trim(row_rec.month), ''),
    'week_start_date', nullif(trim(row_rec.week_start_date), ''),
    'week_end_date', nullif(trim(row_rec.week_end_date), ''),
    'actual_pending_for_week', row_rec.actual_pending_for_week_after_sd,
    'total_rent_amount', row_rec.total_rent_amount,
    'total_sd_amount', row_rec.total_sd_amount,
    'pending_amount', row_rec.pending_amount,
    'manual_collection', row_rec.manual_payment_collection,
    'payout_deductions', row_rec.payout_deduction_week_23,
    'rent_per_week', row_rec.rent_per_week,
    'current_status', nullif(trim(row_rec.current_status), ''),
    'db_current_status', nullif(trim(row_rec.db_current_status), ''),
    'vehicle_status', nullif(trim(row_rec.vehicle_status), ''),
    'vehicle_number', nullif(trim(row_rec.vehicle_number), ''),
    'contact_no', nullif(trim(row_rec.contact_no), ''),
    'source_name', nullif(trim(row_rec.source_name), ''),
    'inactive_days', row_rec.inactive_days,
    'current_week_orders', row_rec.current_week_orders,
    'damage_amount', damage_amt,
    'traffic_challan_amount', traffic_amt
  );

  return jsonb_build_object(
    'success', true,
    'ev91_rider_id', ev91,
    'data', mapped
  );
end;
$$;

grant execute on function public.rental_pending_transfer(text, text, boolean) to anon, authenticated;

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
