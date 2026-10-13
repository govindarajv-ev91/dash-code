-- Fix empty database-backed dashboards after enabling sign-in.
-- Run in Supabase SQL Editor as the project owner, after create_dashboard_auth.sql.
-- Safe to rerun. No data, login settings, write policies, or anon policies change.
begin;

do $$
declare
  table_name text;
  source_policy record;
  old_policy record;
begin
  if to_regclass('public.dashboard_users') is null then
    raise exception 'Run sql/create_dashboard_auth.sql first.';
  end if;

  foreach table_name in array array[
    'rider_metrics', 'order_upload_data', 'fleet_data', 'new_fleet_data',
    'weekly_performance', 'rider_kyc', 'rider_onboarding', 'vehicle_inventory',
    'rider_payment_data', 'manual_collation_data', 'rental_pending_data',
    'iot_data', 'client_targets', 'vehicle_master', 'vehicle_service_log',
    'ev91_sd_data'
  ] loop
    -- Some installations do not use every optional table.
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    -- Copy existing table read privileges, never grant access to a private table.
    if not has_table_privilege('anon', format('public.%I', table_name), 'SELECT') then
      continue;
    end if;
    execute format('grant select on table public.%I to authenticated', table_name);

    -- Refresh only policies owned by this migration so reruns also pick up
    -- tightened or removed source policies. Other authenticated policies remain.
    for old_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = table_name and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
        and left(policyname, length('dashboard_member_read_')) = 'dashboard_member_read_'
    loop
      execute format('drop policy %I on public.%I', old_policy.policyname, table_name);
    end loop;

    for source_policy in
      select policyname, permissive, qual from pg_policies
      where schemaname = 'public' and tablename = table_name
        and cmd in ('SELECT', 'ALL')
        and 'anon' = any(roles)
        and not ('authenticated' = any(roles) or 'public' = any(roles))
    loop
      -- Preserve each source row filter and PERMISSIVE/RESTRICTIVE behavior.
      -- The extra membership check permits only registered dashboard accounts.
      -- The SELECT subquery is evaluated once, not once per payment/order row.
      execute format(
        'create policy %I on public.%I as %s for select to authenticated
         using ((%s) and (select exists (
           select 1 from public.dashboard_users as dashboard_member
           where dashboard_member.id = (select auth.uid())
         )))',
        'dashboard_member_read_' || md5(source_policy.policyname),
        table_name, source_policy.permissive, coalesce(source_policy.qual, 'true')
      );
    end loop;
  end loop;
end;
$$;

commit;

-- Refresh General Overview after this completes. All approved accounts can
-- read the same existing dashboard rows; this does not grant upload/delete access.
