-- Production transfer API for another web app.
-- Amplify hosts the SPA (https://main.d2y6lleakorn3s.amplifyapp.com/);
-- this Supabase RPC is the live transfer endpoint (Amplify static hosting cannot run Vercel /api functions).
--
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Call (POST):
--   https://arnxvnkednpzyzyfculx.supabase.co/rest/v1/rpc/rental_pending_transfer
-- Headers:
--   apikey: <VITE_SUPABASE_ANON_KEY>
--   Authorization: Bearer <VITE_SUPABASE_ANON_KEY>
--   Content-Type: application/json
-- Body:
--   { "p_ev91_rider_id": "12345", "p_api_key": "ev91-rental-pending-2026", "p_history": false }
--
-- Or GET:
--   /rest/v1/rpc/rental_pending_transfer?p_ev91_rider_id=12345&p_api_key=ev91-rental-pending-2026

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
  pay_rec record;
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

  if not exists (
    select 1
    from public.rental_pending_data r
    where nullif(trim(r.ev91_rider_id), '') = ev91
  ) then
    return jsonb_build_object(
      'success', false,
      'ev91_rider_id', ev91,
      'message', 'No rental pending data found for this EV91 Rider ID'
    );
  end if;

  select nullif(trim(r.rider_id), '')
  into latest_rider_id
  from public.rental_pending_data r
  where nullif(trim(r.ev91_rider_id), '') = ev91
  order by r.created_at desc nulls last, r.id desc
  limit 1;

  if latest_rider_id is not null
     and to_regclass('public.rider_payment_data') is not null then
    for pay_rec in
      select p.damage, p.traffic
      from public.rider_payment_data p
      where nullif(trim(p.rider_id), '') = latest_rider_id
      order by p.id desc
      limit 50
    loop
      if damage_amt is null and pay_rec.damage is not null then
        damage_amt := pay_rec.damage;
      end if;
      if traffic_amt is null and pay_rec.traffic is not null then
        traffic_amt := pay_rec.traffic;
      end if;
      exit when damage_amt is not null and traffic_amt is not null;
    end loop;
  end if;

  if coalesce(p_history, false) then
    for row_rec in
      select r.*
      from public.rental_pending_data r
      where nullif(trim(r.ev91_rider_id), '') = ev91
      order by r.created_at desc nulls last, r.id desc
      limit 500
    loop
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
      history_arr := history_arr || jsonb_build_array(mapped);
    end loop;

    return jsonb_build_object(
      'success', true,
      'ev91_rider_id', ev91,
      'count', jsonb_array_length(history_arr),
      'data', history_arr
    );
  end if;

  select r.*
  into row_rec
  from public.rental_pending_data r
  where nullif(trim(r.ev91_rider_id), '') = ev91
  order by r.created_at desc nulls last, r.id desc
  limit 1;

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

-- Localhost-style param names (ev91_rider_id, api_key, history) for Amplify / browser GET
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
