-- Repair Rider Payment Upload after enabling dashboard sign-in.
-- Run as the project owner in Supabase SQL Editor after the payment table and
-- dashboard auth setup. Safe to rerun; no payment rows are changed.
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
  if to_regclass('public.rider_payment_data') is null then
    raise exception 'Run sql/create_rider_payment_tables.sql first.';
  end if;
  if to_regclass('public.dashboard_users') is null then
    raise exception 'Run sql/create_dashboard_auth.sql first.';
  end if;

  alter table public.rider_payment_data enable row level security;

  -- Refresh only policies owned by this repair, including removed source rules.
  for old_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'rider_payment_data'
      and roles = array['authenticated']::name[]
      and left(policyname, length('rider_payment_member_')) = 'rider_payment_member_'
  loop
    execute format('drop policy %I on public.rider_payment_data', old_policy.policyname);
  end loop;

  -- The page uses ON CONFLICT DO NOTHING RETURNING id: INSERT and SELECT
  -- are sufficient. Existing rows are never updated by this upload.
  foreach operation in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('anon', 'public.rider_payment_data', operation) then
      raise exception 'Existing anonymous % table privilege is missing on rider_payment_data. Review table grants before applying this repair.', operation;
    end if;
    execute format('grant %s on public.rider_payment_data to authenticated', operation);

    for source_policy in
      select policyname, permissive, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'rider_payment_data'
        and cmd in (operation, 'ALL')
        and 'anon' = any(roles)
        and not ('authenticated' = any(roles) or 'public' = any(roles))
    loop
      if operation = 'SELECT' then
        policy_clauses := format(' using ((%s) and %s)',
          coalesce(source_policy.qual, 'true'), member_check);
      else
        -- FOR ALL falls back to USING when WITH CHECK is omitted.
        policy_clauses := format(' with check ((%s) and %s)',
          coalesce(source_policy.with_check, source_policy.qual, 'true'), member_check);
      end if;
      execute format(
        'create policy %I on public.rider_payment_data as %s for %s to authenticated %s',
        'rider_payment_member_' || lower(operation) || '_' || md5(source_policy.policyname),
        source_policy.permissive, operation, policy_clauses
      );
    end loop;
  end loop;

  id_sequence := pg_get_serial_sequence('public.rider_payment_data', 'id');
  if id_sequence is not null then
    execute format('grant usage on sequence %s to authenticated', id_sequence);
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
