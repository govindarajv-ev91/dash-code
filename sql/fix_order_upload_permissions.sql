-- Repair Order Upload after enabling dashboard sign-in.
-- Run as the project owner in Supabase SQL Editor, after the order table and
-- dashboard auth setup. Safe to rerun; no order rows or delete policies change.
begin;

do $$
declare
  operation text;
  source_policy record;
  old_policy record;
  policy_clauses text;
  member_check text := '(select exists (
    select 1 from public.dashboard_users as dashboard_member
    where dashboard_member.id = (select auth.uid())
  ))';
  id_sequence text;
begin
  if to_regclass('public.order_upload_data') is null then
    raise exception 'Run sql/create_order_upload_table.sql first.';
  end if;
  if to_regclass('public.dashboard_users') is null then
    raise exception 'Run sql/create_dashboard_auth.sql first.';
  end if;

  alter table public.order_upload_data enable row level security;

  -- Upsert needs SELECT and UPDATE as well as INSERT. Copy only the existing
  -- anonymous operations, retaining row filters and restrictive policies.
  -- Existing authenticated policies remain under the project owner's control.
  for old_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'order_upload_data'
      and roles = array['authenticated']::name[]
      and left(policyname, length('order_upload_member_')) = 'order_upload_member_'
  loop
    execute format('drop policy %I on public.order_upload_data', old_policy.policyname);
  end loop;

  foreach operation in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if not has_table_privilege('anon', 'public.order_upload_data', operation) then
      raise exception 'Existing anonymous % table privilege is missing on order_upload_data. Review table grants before applying this repair.', operation;
    end if;
    execute format('grant %s on public.order_upload_data to authenticated', operation);

    for source_policy in
      select policyname, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'order_upload_data'
        and cmd in (operation, 'ALL')
        and 'anon' = any(roles)
        and not ('authenticated' = any(roles) or 'public' = any(roles))
    loop
      policy_clauses := '';
      if operation in ('SELECT', 'UPDATE') then
        policy_clauses := format(' using ((%s) and %s)',
          coalesce(source_policy.qual, 'true'), member_check);
      end if;
      if operation in ('INSERT', 'UPDATE') then
        -- PostgreSQL falls back to USING when WITH CHECK is omitted.
        policy_clauses := policy_clauses || format(' with check ((%s) and %s)',
          coalesce(source_policy.with_check, source_policy.qual, 'true'), member_check);
      end if;
      execute format(
        'create policy %I on public.order_upload_data as %s for %s to authenticated %s',
        'order_upload_member_' || lower(operation) || '_' || md5(source_policy.policyname),
        source_policy.permissive, operation, policy_clauses
      );
    end loop;
  end loop;

  -- Supports installations with serial IDs as well as identity IDs.
  id_sequence := pg_get_serial_sequence('public.order_upload_data', 'id');
  if id_sequence is not null then
    execute format('grant usage on sequence %s to authenticated', id_sequence);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
