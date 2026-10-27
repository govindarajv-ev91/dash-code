-- Run in Supabase SQL Editor as the project owner if Add source, Edit,
-- Remove or Active/Inactive fails with a database permissions error.
-- Safe to rerun: repairs access only; preserves all sources and history.
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

-- Check the administrator role independently of profile-table read policies.
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
grant select on public.source_master to anon, authenticated;
grant insert, update, delete on public.source_master to authenticated;

-- INSERT also needs access to the ID sequence on tables using serial IDs.
-- Resolve its actual name so existing tables with renamed sequences work too.
do $$
declare id_sequence text;
begin
  id_sequence := pg_get_serial_sequence('public.source_master', 'id');
  if id_sequence is not null then
    execute format('grant usage on sequence %s to authenticated', id_sequence);
  end if;
end;
$$;

drop policy if exists source_master_read on public.source_master;
create policy source_master_read on public.source_master
  for select to anon, authenticated using (true);

drop policy if exists source_master_admin_insert on public.source_master;
create policy source_master_admin_insert on public.source_master
  for insert to authenticated with check ((select public.source_master_is_admin()));

drop policy if exists source_master_admin_update on public.source_master;
create policy source_master_admin_update on public.source_master
  for update to authenticated using ((select public.source_master_is_admin()))
  with check ((select public.source_master_is_admin()));

drop policy if exists source_master_admin_delete on public.source_master;
create policy source_master_admin_delete on public.source_master
  for delete to authenticated using ((select public.source_master_is_admin()));

notify pgrst, 'reload schema';
commit;

-- Refresh Source List and retry while signed in as a dashboard administrator.
-- This does not promote accounts or give ordinary users permission to write rows.
