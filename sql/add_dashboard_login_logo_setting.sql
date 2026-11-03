-- Run once in Supabase SQL Editor.
-- Adds an optional FleetPro full-logo switch to the sidebar.
-- Default is off.

begin;

alter table public.dashboard_settings
  add column if not exists login_logo_enabled boolean not null default false;

update public.dashboard_settings
set login_logo_enabled = false
where id = true and login_logo_enabled is null;

create or replace function public.dashboard_login_logo_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select login_logo_enabled from public.dashboard_settings where id = true),
    false
  );
$$;

revoke all on function public.dashboard_login_logo_enabled() from public;
grant execute on function public.dashboard_login_logo_enabled() to anon, authenticated;

create or replace function public.set_dashboard_login_logo_enabled(p_enabled boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare saved_enabled boolean;
begin
  if not exists (
    select 1 from public.dashboard_users
    where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Logo enabled must be true or false.' using errcode = '22004';
  end if;
  update public.dashboard_settings
  set login_logo_enabled = p_enabled, updated_at = now(), updated_by = (select auth.uid())
  where id = true
  returning login_logo_enabled into saved_enabled;
  if not found then
    raise exception 'Dashboard settings are missing. Run the dashboard setup SQL.';
  end if;
  return saved_enabled;
end;
$$;

revoke all on function public.set_dashboard_login_logo_enabled(boolean) from public, anon, authenticated;
grant execute on function public.set_dashboard_login_logo_enabled(boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
