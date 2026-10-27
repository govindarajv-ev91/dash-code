-- Run in Supabase SQL Editor as the project owner if Active/Inactive fails.
-- For Add source, Edit or Remove, use sql/fix_source_master_permissions.sql.
-- Safe to rerun. Changes permissions only; no source or historical data changes.
begin;

do $$
begin
  if to_regclass('public.source_master') is null then
    raise exception 'Run sql/create_source_master.sql first.';
  end if;
  if to_regclass('public.dashboard_users') is null then
    raise exception 'Run sql/create_dashboard_auth.sql first, then rerun this repair.';
  end if;
end;
$$;

-- Check the role as the owner so dashboard_users read policies cannot prevent
-- an otherwise valid administrator from changing source status.
create or replace function public.source_master_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.dashboard_users
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.source_master_is_admin() from public, anon, authenticated;
grant execute on function public.source_master_is_admin() to authenticated;

alter table public.source_master enable row level security;
grant select on public.source_master to authenticated;
grant update (is_active) on public.source_master to authenticated;
drop policy if exists source_master_read on public.source_master;
create policy source_master_read on public.source_master
  for select to anon, authenticated using (true);
drop policy if exists source_master_admin_update on public.source_master;
create policy source_master_admin_update on public.source_master
  for update to authenticated
  using ((select public.source_master_is_admin()))
  with check ((select public.source_master_is_admin()));

notify pgrst, 'reload schema';
commit;

-- Refresh Source List and retry while signed in as a dashboard administrator.
-- This does not promote accounts or give ordinary users write access.
