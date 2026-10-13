-- Run in the Supabase SQL Editor as the project owner. Safe to rerun.
-- Passwords remain in Supabase Auth, never in these public tables.
begin;

create table if not exists public.dashboard_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_settings (
  id boolean primary key default true check (id = true),
  login_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.dashboard_settings (id, login_enabled) values (true, true)
on conflict (id) do nothing;

alter table public.dashboard_users enable row level security;
alter table public.dashboard_settings enable row level security;
revoke all on public.dashboard_users from public, anon, authenticated;
revoke all on public.dashboard_settings from public, anon, authenticated;
grant select on public.dashboard_users to authenticated;
grant all on public.dashboard_users, public.dashboard_settings to service_role;

drop policy if exists dashboard_user_self_read on public.dashboard_users;
create policy dashboard_user_self_read on public.dashboard_users
  for select to authenticated using ((select auth.uid()) = id);
-- Neither admins nor ordinary users can change roles/settings directly.
-- The Edge Function handles accounts; the admin-only RPC handles the login setting.

create or replace function public.dashboard_login_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select login_enabled from public.dashboard_settings where id = true), true);
$$;
revoke all on function public.dashboard_login_enabled() from public;
grant execute on function public.dashboard_login_enabled() to anon, authenticated;

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

create or replace function public.sync_dashboard_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is not null and coalesce(new.is_anonymous, false) = false then
    insert into public.dashboard_users (id, email, display_name, role)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'user')
    on conflict (id) do update set email = excluded.email;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_dashboard_auth_user() from public, anon, authenticated;
drop trigger if exists sync_dashboard_auth_user on auth.users;
create trigger sync_dashboard_auth_user
  after insert or update of email on auth.users
  for each row execute function public.sync_dashboard_auth_user();

-- Backfill existing email accounts. No email address is automatically trusted
-- as an admin; use the owner-only bootstrap script to create/promote the admin.
insert into public.dashboard_users (id, email, display_name)
select id, email, coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users where email is not null and coalesce(is_anonymous, false) = false
on conflict (id) do update set email = excluded.email;

commit;

-- Next: npm run setup:admin (see docs/login-setup.md).
