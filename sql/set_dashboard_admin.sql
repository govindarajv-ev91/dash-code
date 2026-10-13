-- Run after creating admin@ev91riderz.com in Supabase Authentication > Users.
-- Assign the requested password there; do not store passwords in public tables.
do $$
declare admin_id uuid;
begin
  select id into admin_id from auth.users
    where lower(email) = 'admin@ev91riderz.com' and email_confirmed_at is not null;
  if admin_id is null then
    raise exception 'Create and confirm admin@ev91riderz.com in Authentication > Users first, or run npm run setup:admin.';
  end if;
  insert into public.dashboard_users (id, email, display_name, role)
  values (admin_id, 'admin@ev91riderz.com', 'EV91 Administrator', 'admin')
  on conflict (id) do update set role = 'admin';
end;
$$;
