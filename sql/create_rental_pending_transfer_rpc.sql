-- Aging rental pending transfer API
-- + post-week orders, per_order_amount, total_order, earning
-- Run in Supabase SQL Editor (safe to re-run).
--
-- Aging rule (Asia/Kolkata):
--   calendar_days = today_date - week_end_date
--   before 12:00 → aging_days = calendar_days - 1
--   at/after 12:00 → aging_days = calendar_days
--
-- Orders: (week_end + 1) → yesterday IST from order_upload_data
-- earning = total_order × per_order_amount
--
-- POST:
--   Body: {"p_ev91_rider_id":"BLR-26-R000039","p_api_key":"ev91-rental-pending-2026","p_history":false}

-- Remove conflicting overloads first
drop function if exists public.rental_pending(text, text, text);
drop function if exists public.rental_pending_transfer(text, text, boolean);
drop function if exists public.rental_pending_transfer(text, text, boolean, text, text);

create or replace function public.parse_rental_week_date(raw text)
returns date
language plpgsql
immutable
as $$
declare
  t text := nullif(trim(coalesce(raw, '')), '');
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

-- Client per-order ₹ (Full Data rates; includes FK-LMA / FKM-LMA → Flipkart-LMA)
create or replace function public.rental_pending_client_per_order_rate(p_client text)
returns numeric
language plpgsql
immutable
as $$
declare
  k text := lower(trim(regexp_replace(coalesce(p_client, ''), '[-_\s]+', ' ', 'g')));
begin
  if k = '' then
    return 0;
  end if;

  if k in ('amazon') then return 40; end if;
  if k in ('bb now', 'bb', 'bigbasket', 'big basket') then return 47; end if;
  if k in ('blinkit') then return 53; end if;
  if k in ('docpharma', 'doc pharma') then return 140; end if;
  if k in ('flipkart minutes', 'fkm') then return 49; end if;
  if k in ('flipkart lma', 'fkm lma', 'fk lma') then return 18; end if;
  if k ~ '(fk|fkm|flipkart).*lma' then return 18; end if;
  if k in ('inamo') then return 65; end if;
  if k in ('instamart', 'swiggy', 'swiggy instamart') then return 49; end if;
  if k in ('kpn') then return 63; end if;
  if k in ('kwik myntra') then return 82; end if;
  if k in ('kwik nykaa') then return 80; end if;
  if k in ('kwik purple') then return 47; end if;
  if k like 'kwik%' then return 47; end if;
  if k in ('licious') then return 56; end if;
  if k in ('rapido ownly') then return 90; end if;
  if k in ('rsm') then return 64; end if;
  if k in ('zepto') then return 43; end if;

  return 0;
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

-- Day-wise orders after week_end → yesterday + per_order_amount + earning
create or replace function public.enrich_rental_pending_with_post_week_orders(
  p_mapped jsonb,
  p_rider_id text,
  p_client_name text,
  p_week_end_raw text,
  p_as_of timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
set statement_timeout = '12s'
as $$
declare
  out_json jsonb := coalesce(p_mapped, '{}'::jsonb);
  week_end date := public.parse_rental_week_date(p_week_end_raw);
  ist_today date := (p_as_of at time zone 'Asia/Kolkata')::date;
  range_start date;
  range_end date;
  d date;
  rider text := nullif(trim(coalesce(p_rider_id, '')), '');
  rate numeric := public.rental_pending_client_per_order_rate(p_client_name);
  day_orders numeric;
  total_orders numeric := 0;
  orders_by_day jsonb := '{}'::jsonb;
  from_ymd text;
  to_ymd text;
begin
  out_json := out_json || jsonb_build_object('per_order_amount', coalesce(rate, 0));

  if week_end is null or rider is null then
    return out_json || jsonb_build_object('total_order', 0, 'earning', 0);
  end if;

  range_start := week_end + 1;
  range_end := ist_today - 1;

  if range_end - range_start > 45 then
    range_start := range_end - 45;
  end if;

  if range_start > range_end then
    return out_json || jsonb_build_object('total_order', 0, 'earning', 0);
  end if;

  from_ymd := to_char(range_start, 'YYYY-MM-DD');
  to_ymd := to_char(range_end, 'YYYY-MM-DD');

  select coalesce(jsonb_object_agg(o.date_record, o.qty), '{}'::jsonb)
  into orders_by_day
  from (
    select
      o.date_record,
      sum(coalesce(o.delivered, 0)::numeric) as qty
    from public.order_upload_data o
    where o.worker_code = rider
      and o.date_record >= from_ymd
      and o.date_record <= to_ymd
    group by o.date_record
  ) o;

  d := range_start;
  while d <= range_end loop
    day_orders := coalesce((orders_by_day ->> to_char(d, 'YYYY-MM-DD'))::numeric, 0);
    total_orders := total_orders + day_orders;
    out_json := out_json || jsonb_build_object(
      'order ' || to_char(d, 'DD/MM/YYYY'),
      day_orders
    );
    d := d + 1;
  end loop;

  out_json := out_json || jsonb_build_object(
    'total_order', total_orders,
    'earning', total_orders * coalesce(rate, 0)
  );

  return out_json;
exception
  when others then
    return out_json || jsonb_build_object('total_order', 0, 'earning', 0);
end;
$$;

create index if not exists order_upload_data_worker_date_idx
  on public.order_upload_data (worker_code, date_record);

create or replace function public.rental_pending_transfer(
  p_ev91_rider_id text,
  p_api_key text,
  p_history boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '15s'
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
      'message', 'No_Data'
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

  mapped := public.enrich_rental_pending_with_post_week_orders(
    public.map_rental_pending_aging_fields(
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
    ),
    row_rec.rider_id,
    row_rec.client_name,
    row_rec.week_end_date
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
grant execute on function public.rental_pending_client_per_order_rate(text) to anon, authenticated;
grant execute on function public.map_rental_pending_aging_fields(text, text, text, text, text, text, text, text, text, text, numeric) to anon, authenticated;
grant execute on function public.enrich_rental_pending_with_post_week_orders(jsonb, text, text, text, timestamptz) to anon, authenticated;
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
