-- Optional city-aware summary for Overview. The app falls back to narrow raw
-- payment reads until this function is installed, preserving correct city data.
create or replace function public.rider_payment_revenue_overview_city()
returns table (
  id text,
  month text,
  client_name text,
  city text,
  rider_id text,
  orders numeric,
  gross_payout numeric,
  final_net_payout numeric
)
language sql
stable
security invoker
as $$
  select
    jsonb_build_array(month, client_name, city, rider_id::text)::text as id,
    coalesce(month, '')::text as month,
    coalesce(client_name, '')::text as client_name,
    coalesce(city, '')::text as city,
    coalesce(rider_id::text, '')::text as rider_id,
    coalesce(sum(coalesce(orders, 0)), 0)::numeric as orders,
    coalesce(sum(coalesce(gross_payout, 0)), 0)::numeric as gross_payout,
    coalesce(sum(coalesce(final_net_payout, 0)), 0)::numeric as final_net_payout
  from public.rider_payment_data
  group by month, client_name, city, rider_id
  order by month, client_name, rider_id, id;
$$;

grant execute on function public.rider_payment_revenue_overview_city() to anon, authenticated;
