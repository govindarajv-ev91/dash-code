-- Optional fast dropdown lookup. Safe to rerun; does not change payment data.
-- SECURITY INVOKER preserves the caller's existing table/RLS access.
-- The dashboard also supports sessions with sign-in disabled (anon role).
begin;
-- Allow index setup to finish without changing the API's timeout settings.
set local statement_timeout = '120s';
create index if not exists rider_payment_week_month_id_idx
  on public.rider_payment_data (week, month, id);

create or replace function public.rider_whatsapp_payment_weeks()
returns table (week text, month text, period_start text)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_week text;
  v_previous_week text := '';
  v_month text;
  v_previous_month text;
begin
  -- Seek directly to each distinct week/month in the existing index.
  -- GROUP BY + MAX scanned every payment row before returning the dropdown.
  loop
    select r.week into v_week
    from public.rider_payment_data r
    where r.week > v_previous_week and btrim(r.week) <> ''
    order by r.week limit 1;
    exit when not found;

    -- Null accounting months are valid and must remain selectable.
    return query select r.week, r.month, r.period_start
      from public.rider_payment_data r
      where r.week = v_week and r.month is null
      order by r.id desc limit 1;

    v_previous_month := null;
    loop
      if v_previous_month is null then
        select r.month into v_month from public.rider_payment_data r
          where r.week = v_week and r.month is not null
          order by r.month limit 1;
      else
        select r.month into v_month from public.rider_payment_data r
          where r.week = v_week and r.month > v_previous_month
          order by r.month limit 1;
      end if;
      exit when not found;

      -- A representative date is sufficient for dropdown sorting; amounts and
      -- all payment records are fetched separately after week selection.
      return query select r.week, r.month, r.period_start
        from public.rider_payment_data r
        where r.week = v_week and r.month = v_month
        order by r.id desc limit 1;
      v_previous_month := v_month;
    end loop;
    v_previous_week := v_week;
  end loop;
end;
$$;

revoke all on function public.rider_whatsapp_payment_weeks() from public;
grant execute on function public.rider_whatsapp_payment_weeks() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
