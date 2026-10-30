import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const readSql = (name) => readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8')
const [setup, authSetup, readRepair, repair] = await Promise.all([
  readSql('create_rider_payment_tables.sql'), readSql('create_dashboard_auth.sql'),
  readSql('fix_dashboard_signed_in_reads.sql'), readSql('fix_rider_payment_permissions.sql'),
])
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
  // Reproduce Supabase grants separately from the real setup's RLS policies.
  await db.exec(`
    grant select, insert, update, delete on public.rider_payment_data to anon, authenticated;
    grant usage on sequence public.rider_payment_data_id_seq to anon;
  `)
  return db
}

async function asRole(db, userId, query, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.exec(`set role ${role}`)
  try { return await db.query(query) } finally { await db.exec('reset role') }
}

function upload(riderId = 'R001', city = 'Chennai', orders = 5) {
  // Matches saveRiderPaymentRows({ replace: false }): ignore duplicates + select id.
  return `insert into public.rider_payment_data
    (client_name, week, month, rider_id, rider_name, city, orders, gross_payout, final_net_payout)
    values ('Client', 'Week 1', 'Oct-26', '${riderId}', 'Rider', '${city}', ${orders}, 100, 90)
    on conflict (upload_dedupe_key) do nothing returning id`
}

test('reproduces signed-in upload rejection after read repair; fixes inserts and duplicate retries without changing data', async (t) => {
  const db = await database(t)
  await asRole(db, null, upload(), 'anon')
  await db.exec(readRepair)
  await assert.rejects(asRole(db, memberId, upload('R002')), { code: '42501' })
  const before = (await db.query('select * from public.rider_payment_data')).rows
  await db.exec(repair)
  await db.exec(repair)
  assert.deepEqual((await db.query('select * from public.rider_payment_data')).rows, before)
  assert.equal((await asRole(db, memberId, upload('R002'))).rows.length, 1)
  assert.deepEqual((await asRole(db, memberId, upload('R002'))).rows, [])
  assert.equal((await asRole(db, memberId, 'select id from public.rider_payment_data')).rows.length, 2)
  assert.equal((await db.query("select has_sequence_privilege('authenticated', 'public.rider_payment_data_id_seq', 'USAGE') as allowed")).rows[0].allowed, true)
})

test('keeps RLS, anonymous policies, and direct update/delete restrictions; rejects unregistered sessions', async (t) => {
  const db = await database(t)
  const anonPolicies = "select * from pg_policies where tablename = 'rider_payment_data' and 'anon' = any(roles) order by policyname"
  const before = (await db.query(anonPolicies)).rows
  await db.exec(repair)
  assert.deepEqual((await db.query(anonPolicies)).rows, before)
  for (const userId of [outsiderId, null]) {
    await assert.rejects(asRole(db, userId, upload()), { code: '42501' })
    assert.deepEqual((await asRole(db, userId, 'select id from public.rider_payment_data')).rows, [])
  }
  await asRole(db, memberId, upload())
  assert.equal((await asRole(db, memberId, 'delete from public.rider_payment_data returning id')).rows.length, 0)
  assert.equal((await asRole(db, memberId, "update public.rider_payment_data set city = 'Delhi' returning id")).rows.length, 0)
  assert.equal((await db.query('select count(*)::integer as n from public.rider_payment_data')).rows[0].n, 1)
  assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.rider_payment_data'::regclass")).rows[0].relrowsecurity, true)
  await asRole(db, null, upload('R003'), 'anon')
})

test('preserves filtered and restrictive source policies, WITH CHECK fallback, and policy removal on rerun', async (t) => {
  const db = await database(t)
  await db.exec(`
    drop policy "Allow anon read rider_payment_data" on public.rider_payment_data;
    drop policy "Allow anon insert rider_payment_data" on public.rider_payment_data;
    create policy city_access on public.rider_payment_data for all to anon using (city = 'Chennai');
    create policy nonnegative on public.rider_payment_data as restrictive for all to anon
      using (orders >= 0) with check (orders >= 0);
  `)
  await db.exec(repair)
  await asRole(db, memberId, upload())
  await assert.rejects(asRole(db, memberId, upload('R002', 'Delhi')), { code: '42501' })
  await assert.rejects(asRole(db, memberId, upload('R003', 'Chennai', -1)), { code: '42501' })
  await db.exec("alter policy city_access on public.rider_payment_data using (city = 'Chennai' and orders < 10)")
  await db.exec(repair)
  await assert.rejects(asRole(db, memberId, upload('R004', 'Chennai', 10)), { code: '42501' })
  await db.exec('drop policy city_access on public.rider_payment_data')
  await db.exec(repair)
  await assert.rejects(asRole(db, memberId, upload('R005')), { code: '42501' })
  assert.equal((await db.query("select count(*)::integer as n from pg_policies where policyname like 'rider_payment_member_%' and cmd in ('ALL', 'UPDATE', 'DELETE')")).rows[0].n, 0)
})
