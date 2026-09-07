-- Aging rental pending transfer API (slim fields + days from week_end → today).
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Aging rule (Asia/Kolkata):
--   calendar_days = today_date - week_end_date
--   before 12:00 → aging_days = calendar_days - 1
--   at/after 12:00 → aging_days = calendar_days
-- Example: week_end 30-08-2026, today 07-09-2026 → before noon = 7, after noon = 8
--
-- POST (recommended):
--   https://arnxvnkednpzyzyfculx.supabase.co/rest/v1/rpc/rental_pending_transfer
--   Body: {"p_ev91_rider_id":"BLR-26-R000039","p_api_key":"ev91-rental-pending-2026","p_history":false}

create or replace function public.parse_rental_week_date(raw text)
returns date
language plpgsql
immutable
as $$
declare
  t text := nullif(trim(coalesce(raw, '')), '');
  d date;
begin
  if t is null then
    return null;
  end if;

  begin
    if t ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{2}$' then
      return to_date(replace(t, '/', '-'), 'DD-MM-YY');
    end if;
    if t ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then
      return to_date(replace(t, '/', '-'), 'DD-MM-YYYY');
    end if;
    if t ~ '^\d{4}[-/]\d{1,2}[-/]\d{1,2}' then
      return to_date(substring(replace(t, '/', '-'), 1, 10), 'YYYY-MM-DD');
    end if;
  exception
    when others then
      null;
  end;

  begin
    return t::date;
  exception
    when others then
      return null;
  end;
end;
$$;

create or replace function public.rental_pending_aging_days(week_end_raw text, as_of timestamptz default clock_timestamp())
returns integer
language plpgsql
stable
as $$
declare
  week_end date := public.parse_rental_week_date(week_end_raw);
  ist_ts timestamp := (as_of at time zone 'Asia/Kolkata');
  today_ist date := ist_ts::date;
  hour_ist integer := extract(hour from ist_ts)::integer;
  calendar_days integer;
begin
  if week_end is null then
    return null;
  end if;

  calendar_days := (today_ist - week_end);
  if calendar_days < 0 then
    return 0;
  end if;

  if hour_ist < 12 then
    return greatest(calendar_days - 1, 0);
  end if;

  return calendar_days;
end;
$$;

create or replace function public.format_rental_date_ddmmyyyy(raw text)
returns text
language plpgsql
immutable
as $$
declare
  d date := public.parse_rental_week_date(raw);
begin
  if d is null then
    return null;
  end if;
  return to_char(d, 'DD/MM/YYYY');
end;
$$;

create or replace function public.map_rental_pending_aging_fields(
  p_city text,
  p_month text,
  p_rider_id text,
  p_contact_no text,
  p_rider_name text,
  p_client_name text,
  p_ev91_rider_id text,
  p_week_start_date text,
  p_week_end_date text,
  p_vehicle_number text,
  p_actual_pending numeric
)
returns jsonb
language plpgsql
stable
as $$
declare
  week_end_fmt text := public.format_rental_date_ddmmyyyy(p_week_end_date);
  week_start_fmt text := public.format_rental_date_ddmmyyyy(p_week_start_date);
  aging integer := public.rental_pending_aging_days(p_week_end_date);
  v_city text := nullif(trim(p_city), '');
  v_month text := nullif(trim(p_month), '');
  v_rider_id text := nullif(trim(p_rider_id), '');
  v_contact text := nullif(trim(p_contact_no), '');
  v_name text := nullif(trim(p_rider_name), '');
  v_client text := nullif(trim(p_client_name), '');
  v_ev91 text := nullif(trim(p_ev91_rider_id), '');
  v_vehicle text := nullif(trim(p_vehicle_number), '');
begin
  return jsonb_build_object(
    'city', case when v_city is null then to_jsonb(0) else to_jsonb(v_city) end,
    'month', case when v_month is null then to_jsonb(0) else to_jsonb(v_month) end,
    'rider_id', case when v_rider_id is null then to_jsonb(0) else to_jsonb(v_rider_id) end,
    'aging_days', to_jsonb(coalesce(aging, 0)),
    'contact_no', case when v_contact is null then to_jsonb(0) else to_jsonb(v_contact) end,
    'rider_name', case when v_name is null then to_jsonb(0) else to_jsonb(v_name) end,
    'client_name', case when v_client is null then to_jsonb(0) else to_jsonb(v_client) end,
    'ev91_rider_id', case when v_ev91 is null then to_jsonb(0) else to_jsonb(v_ev91) end,
    'week_end_date', case when week_end_fmt is null then to_jsonb(0) else to_jsonb(week_end_fmt) end,
    'vehicle_number', case when v_vehicle is null then to_jsonb(0) else to_jsonb(v_vehicle) end,
    'week_start_date', case when week_start_fmt is null then to_jsonb(0) else to_jsonb(week_start_fmt) end,
    'actual_pending_for_week', to_jsonb(coalesce(p_actual_pending, 0))
  );
end;
$$;

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

  select r.*
  into row_rec
  from public.rental_pending_data r
  where r.ev91_rider_id = ev91
  order by r.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'ev91_rider_id', ev91,
      'message', 'No rental pending data found for this EV91 Rider ID'
    );
  end if;

  if coalesce(p_history, false) then
    select coalesce(
      jsonb_agg(
        public.map_rental_pending_aging_fields(
          r.city,
          r.month,
          r.rider_id,
          r.contact_no,
          r.rider_name,
          r.client_name,
          r.ev91_rider_id,
          r.week_start_date,
          r.week_end_date,
          r.vehicle_number,
          r.actual_pending_for_week_after_sd
        )
        order by r.id desc
      ),
      '[]'::jsonb
    )
    into history_arr
    from public.rental_pending_data r
    where r.ev91_rider_id = ev91;

    return jsonb_build_object(
      'success', true,
      'ev91_rider_id', ev91,
      'count', jsonb_array_length(history_arr),
      'data', history_arr
    );
  end if;

  mapped := public.map_rental_pending_aging_fields(
    row_rec.city,
    row_rec.month,
    row_rec.rider_id,
    row_rec.contact_no,
    row_rec.rider_name,
    row_rec.client_name,
    row_rec.ev91_rider_id,
    row_rec.week_start_date,
    row_rec.week_end_date,
    row_rec.vehicle_number,
    row_rec.actual_pending_for_week_after_sd
  );

  return jsonb_build_object(
    'success', true,
    'ev91_rider_id', ev91,
    'data', mapped
  );
end;
$$;

grant execute on function public.parse_rental_week_date(text) to anon, authenticated;
grant execute on function public.rental_pending_aging_days(text, timestamptz) to anon, authenticated;
grant execute on function public.format_rental_date_ddmmyyyy(text) to anon, authenticated;
grant execute on function public.map_rental_pending_aging_fields(text, text, text, text, text, text, text, text, text, text, numeric) to anon, authenticated;
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
