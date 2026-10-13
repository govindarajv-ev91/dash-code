-- Run once in Supabase SQL Editor after create_dashboard_auth.sql.
-- Only a signed-in user with a stored admin role can change the setting.
create or replace function public.set_dashboard_login_enabled(p_enabled boolean)
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
    raise exception 'Login enabled must be true or false.' using errcode = '22004';
  end if;
  update public.dashboard_settings
  set login_enabled = p_enabled, updated_at = now(), updated_by = (select auth.uid())
  where id = true
  returning login_enabled into saved_enabled;
  if not found then
    raise exception 'Dashboard settings are missing. Run the dashboard setup SQL.';
  end if;
  return saved_enabled;
end;
$$;
revoke all on function public.set_dashboard_login_enabled(boolean) from public, anon, authenticated;
grant execute on function public.set_dashboard_login_enabled(boolean) to authenticated;
