-- Run once in Supabase SQL Editor. Safe to rerun; no payment data is changed.
-- City-scoped indexed reads for the scheduled mailer's raw payment calculations.
create index if not exists rider_payment_mail_city_period_id_idx
  on public.rider_payment_data
  (lower(regexp_replace(btrim(city), '[_\s-]+', ' ', 'g')), period_start, id);
create index if not exists rider_payment_mail_city_month_id_idx
  on public.rider_payment_data
  (lower(regexp_replace(btrim(city), '[_\s-]+', ' ', 'g')), month, id);

create or replace function public.client_period_mail_payment_page(
  p_city_keys text[], p_from text default null, p_to text default null,
  p_month text default null, p_after_period text default null,
  p_after_id bigint default null, p_limit integer default 500
)
returns setof public.rider_payment_data
language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce(array_length(p_city_keys, 1), 0) = 0 then
    raise exception 'City filter is required';
  end if;
  if p_month is not null then
    return query select r.* from public.rider_payment_data r
      where lower(regexp_replace(btrim(r.city), '[_\s-]+', ' ', 'g')) = any(p_city_keys)
        and r.month = p_month and (p_after_id is null or r.id > p_after_id)
      order by r.id limit greatest(1, least(coalesce(p_limit, 500), 1000));
  else
    if p_from is null or p_to is null then raise exception 'Date range is required'; end if;
    return query select r.* from public.rider_payment_data r
      where lower(regexp_replace(btrim(r.city), '[_\s-]+', ' ', 'g')) = any(p_city_keys)
        and r.period_start >= coalesce(p_after_period, p_from)
        and r.period_start >= p_from and r.period_start <= p_to
        and (p_after_period is null or (r.period_start, r.id) > (p_after_period, coalesce(p_after_id, 0)))
      order by r.period_start, r.id limit greatest(1, least(coalesce(p_limit, 500), 1000));
  end if;
end;
$$;
revoke all on function public.client_period_mail_payment_page(text[], text, text, text, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.client_period_mail_payment_page(text[], text, text, text, text, bigint, integer) to service_role;
analyze public.rider_payment_data;
notify pgrst, 'reload schema';
