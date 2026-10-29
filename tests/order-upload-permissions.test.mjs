import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const readSql = (name) => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8')
const [setup, authSetup, readRepair, repair] = await Promise.all([
  readSql('create_order_upload_table.sql'), readSql('create_dashboard_auth.sql'),
  readSql('fix_dashboard_signed_in_reads.sql'), readSql('fix_order_upload_permissions.sql'),
])
const performanceRepair = await readSql('fix_order_upload_production_timeout.sql')
const memberId = '00000000-0000-0000-0000-000000000001'
const outsiderId = '00000000-0000-0000-0000-000000000002'

async function database(t) {
  const db = await PGlite.create()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
      is_anonymous boolean default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `)
  await db.exec(authSetup)
  await db.query('insert into auth.users (id, email) values ($1, $2)', [memberId, 'staff@example.test'])
  await db.exec(setup)
  // Reproduce the existing Supabase table grants; policies are from real setup.
  await db.exec(`
    grant select, insert, update, delete on public.order_upload_data to anon;
    grant select, insert, update on public.order_upload_data to authenticated;
    grant usage on sequence public.order_upload_data_id_seq to anon;
  `)
  return db
}

async function asRole(db, role, userId, query) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.exec(`set role ${role}`)
  try { return await db.query(query) } finally { await db.exec('reset role') }
}

function upsert(city = 'Chennai', delivered = 5, type = 'daily') {
  // Matches saveOrderUploadRows: the same four-column conflict target and an
  // UPDATE path even when the uploaded row already exists.
  return `insert into public.order_upload_data
    (worker_code,date_record,client,delivered,city,type1,month)
    values ('R001','2026-10-29','Client',${delivered},'${city}','${type}','Oct-2026')
    on conflict (worker_code,date_record,client,delivered)
    do update set city = excluded.city, type1 = excluded.type1`
}

test('reproduces signed-in RLS failure and repairs new and repeated uploads without changing orders', async (t) => {
  const db = await database(t)
  await asRole(db, 'anon', null, upsert())
  await db.exec(readRepair)
  await assert.rejects(asRole(db, 'authenticated', memberId, upsert()), { code: '42501' })
  const before = (await db.query('select * from public.order_upload_data')).rows
  await db.exec(repair)
  await db.exec(repair)
  assert.deepEqual((await db.query('select * from public.order_upload_data')).rows, before)
  await asRole(db, 'authenticated', memberId, upsert('Chennai', 5, 'corrected'))
  await asRole(db, 'authenticated', memberId, upsert('Chennai', 8))
  assert.deepEqual((await asRole(db, 'authenticated', memberId,
    'select delivered::integer, type1 from public.order_upload_data order by delivered')).rows,
  [{ delivered: 5, type1: 'corrected' }, { delivered: 8, type1: 'daily' }])
  assert.equal((await db.query("select has_sequence_privilege('authenticated', 'public.order_upload_data_id_seq', 'USAGE') as allowed")).rows[0].allowed, true)
})

test('unregistered sessions stay blocked; anonymous policies, delete access, and account roles remain unchanged', async (t) => {
  const db = await database(t)
  const anonPolicies = "select * from pg_policies where tablename = 'order_upload_data' and 'anon' = any(roles) order by policyname"
  const before = (await db.query(anonPolicies)).rows
  await db.exec(repair)
  assert.deepEqual((await db.query(anonPolicies)).rows, before)
  for (const userId of [outsiderId, null]) {
    await assert.rejects(asRole(db, 'authenticated', userId, upsert()), { code: '42501' })
    assert.deepEqual((await asRole(db, 'authenticated', userId, 'select id from public.order_upload_data')).rows, [])
  }
  await assert.rejects(asRole(db, 'authenticated', memberId, 'delete from public.order_upload_data'), { code: '42501' })
  await asRole(db, 'anon', null, upsert())
  assert.equal((await db.query('select role from public.dashboard_users')).rows[0].role, 'user')
  assert.equal((await db.query('select login_enabled from public.dashboard_settings')).rows[0].login_enabled, true)
})

test('retains source row filters, UPDATE check fallback, and restrictive policies on rerun', async (t) => {
  const db = await database(t)
  await db.exec(`
    drop policy "Allow anon read order_upload_data" on public.order_upload_data;
    drop policy "Allow anon insert order_upload_data" on public.order_upload_data;
    drop policy "Allow anon update order_upload_data" on public.order_upload_data;
    create policy city_read on public.order_upload_data for select to anon using (city = 'Chennai');
    create policy city_insert on public.order_upload_data for insert to anon with check (city = 'Chennai');
    create policy city_update on public.order_upload_data for update to anon using (city = 'Chennai');
    create policy nonnegative on public.order_upload_data as restrictive for all to anon
      using (delivered >= 0) with check (delivered >= 0);
    insert into public.order_upload_data (worker_code,date_record,client,delivered,city)
      values ('OTHER','2026-10-29','Client',5,'Delhi');
  `)
  await db.exec(repair)
  await asRole(db, 'authenticated', memberId, upsert())
  await assert.rejects(asRole(db, 'authenticated', memberId, upsert('Delhi')), { code: '42501' })
  await assert.rejects(asRole(db, 'authenticated', memberId, upsert('Chennai', -1)), { code: '42501' })
  assert.equal((await asRole(db, 'authenticated', memberId, 'select id from public.order_upload_data')).rows.length, 1)
  await db.exec("alter policy city_insert on public.order_upload_data with check (city = 'Chennai' and delivered < 10)")
  await db.exec(repair)
  await assert.rejects(asRole(db, 'authenticated', memberId, upsert('Chennai', 10)), { code: '42501' })
  // FOR ALL is split into only the three upload operations, never DELETE.
  assert.equal((await db.query("select count(*)::integer as n from pg_policies where policyname like 'order_upload_member_%' and cmd in ('ALL', 'DELETE')")).rows[0].n, 0)
})

test('indexed month lookup includes old months, ignores blanks, and respects caller row security', async (t) => {
  const db = await database(t)
  await db.exec(`
    insert into public.order_upload_data (worker_code, date_record, client, delivered, city, month)
    select 'R' || n, '2026-10-29', 'Client', 5, 'Chennai', 'Oct-2026'
    from generate_series(1, 2000) n;
    insert into public.order_upload_data (worker_code, date_record, month, city) values
      ('OLD', '2020-01-01', 'Jan-2020', 'Chennai'),
      ('HIDDEN', '2026-09-01', 'Sep-2026', 'Delhi'),
      ('EMPTY', '2026-10-29', '', 'Chennai'),
      ('SPACE', '2026-10-29', '   ', 'Chennai'),
      ('NULL', '2026-10-29', null, 'Chennai');
    create policy city_filter on public.order_upload_data as restrictive for select to anon
      using (city = 'Chennai');
  `)
  await db.exec(repair)
  await db.exec(performanceRepair)
  await db.exec(performanceRepair)
  const lookup = 'select month from public.distinct_order_upload_months() order by month'
  const expected = [{ month: 'Jan-2020' }, { month: 'Oct-2026' }]
  assert.deepEqual((await asRole(db, 'anon', null, lookup)).rows, expected)
  assert.deepEqual((await asRole(db, 'authenticated', memberId, lookup)).rows, expected)
  assert.deepEqual((await asRole(db, 'authenticated', outsiderId, lookup)).rows, [])
  assert.deepEqual((await db.query(lookup)).rows, [...expected, { month: 'Sep-2026' }])
})
