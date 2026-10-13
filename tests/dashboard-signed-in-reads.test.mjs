import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../sql/fix_dashboard_signed_in_reads.sql', import.meta.url), 'utf8')
const authMigration = await readFile(new URL('../sql/create_dashboard_auth.sql', import.meta.url), 'utf8')
const staffId = '00000000-0000-0000-0000-000000000001'
const adminId = '00000000-0000-0000-0000-000000000002'
const unknownId = '00000000-0000-0000-0000-000000000003'

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
  await db.exec(authMigration)
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)',
    [staffId, 'staff@example.test', adminId, 'admin@example.test'])
  await db.query("update public.dashboard_users set role = 'admin' where id = $1", [adminId])
  return db
}

async function asRole(db, role, userId, sql) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ''])
  await db.exec(`set role ${role}`)
  try { return await db.query(sql) } finally { await db.exec('reset role') }
}

async function dataTable(db, name, policy = 'for select to anon using (true)') {
  await db.exec(`
    create table public.${name} (id integer primary key, delivered integer, city text);
    insert into public.${name} values (1, 100, 'Chennai'), (2, 200, 'Delhi');
    alter table public.${name} enable row level security;
    grant select on public.${name} to anon;
    create policy original_read on public.${name} ${policy};
  `)
}

test('anon-only reads reproduce zero orders; migration restores staff/admin reads across dashboard tables', async (t) => {
  const db = await database(t)
  const tables = ['rider_metrics', 'order_upload_data', 'fleet_data', 'new_fleet_data',
    'weekly_performance', 'rider_kyc', 'rider_onboarding', 'vehicle_inventory',
    'rider_payment_data', 'manual_collation_data', 'rental_pending_data', 'iot_data',
    'client_targets', 'vehicle_master', 'vehicle_service_log', 'ev91_sd_data']
  for (const table of tables) await dataTable(db, table)
  await db.exec('grant select on public.order_upload_data to authenticated')
  const totals = 'select coalesce(sum(delivered), 0)::integer as orders from public.order_upload_data'
  assert.equal((await asRole(db, 'anon', null, totals)).rows[0].orders, 300)
  assert.equal((await asRole(db, 'authenticated', staffId, totals)).rows[0].orders, 0)
  await db.exec(migration)
  for (const id of [staffId, adminId]) {
    assert.equal((await asRole(db, 'authenticated', id, totals)).rows[0].orders, 300)
    for (const table of tables) {
      assert.equal((await asRole(db, 'authenticated', id, `select * from public.${table}`)).rows.length, 2)
    }
  }
  assert.equal((await asRole(db, 'authenticated', unknownId, totals)).rows[0].orders, 0)
  assert.equal((await asRole(db, 'authenticated', null, totals)).rows[0].orders, 0)
  assert.equal((await asRole(db, 'anon', null, totals)).rows[0].orders, 300)
  await db.exec('update public.dashboard_settings set login_enabled = false where id = true')
  assert.equal((await asRole(db, 'authenticated', staffId, totals)).rows[0].orders, 300)
  await db.exec('update public.dashboard_settings set login_enabled = true where id = true')
  assert.equal((await asRole(db, 'authenticated', staffId, totals)).rows[0].orders, 300)
})

test('row filters, restrictive policies, and reruns preserve the intended visible rows', async (t) => {
  const db = await database(t)
  await dataTable(db, 'rider_metrics', "for select to anon using (city = 'Chennai')")
  await dataTable(db, 'order_upload_data', 'for all to anon using (true) with check (true)')
  await db.exec(`
    create policy nonnegative on public.order_upload_data as restrictive
      for select to anon using (delivered >= 0);
  `)
  await db.exec("insert into public.order_upload_data values (3, -5, 'Chennai')")
  await db.exec(migration)
  const read = (name) => `select id from public.${name} order by id`
  assert.deepEqual((await asRole(db, 'authenticated', staffId, read('rider_metrics'))).rows, [{ id: 1 }])
  assert.deepEqual((await asRole(db, 'authenticated', staffId, read('order_upload_data'))).rows, [{ id: 1 }, { id: 2 }])
  await db.exec(migration)
  const policies = await db.query("select * from pg_policies where policyname like 'dashboard_member_read_%'")
  assert.equal(policies.rows.length, 3)
  await db.exec('drop policy original_read on public.order_upload_data; create policy original_read on public.order_upload_data for select to anon using (id = 1)')
  await db.exec(migration)
  assert.deepEqual((await asRole(db, 'authenticated', staffId, read('order_upload_data'))).rows, [{ id: 1 }])
  await db.exec('drop policy original_read on public.rider_metrics')
  await db.exec(migration)
  assert.deepEqual((await asRole(db, 'authenticated', staffId, read('rider_metrics'))).rows, [])
})

test('fix leaves writes, private tables, account roles/settings, and existing policies unchanged', async (t) => {
  const db = await database(t)
  await dataTable(db, 'order_upload_data', 'for all to anon using (true) with check (true)')
  // Supabase often grants authenticated table privileges by default; RLS must
  // still reject writes rather than cloning an anon FOR ALL policy as FOR ALL.
  await db.exec('grant insert, update, delete on public.order_upload_data to authenticated')
  await dataTable(db, 'fleet_data', 'for select to anon, authenticated using (true)')
  await db.exec('create policy staff_filter on public.fleet_data as restrictive for select to authenticated using (id = 1)')
  await db.exec('create table public.rider_kyc (id integer); create table public.unrelated_private (id integer)')
  const before = await db.query("select * from pg_policies where policyname not like 'dashboard_member_read_%' order by tablename, policyname")
  await db.exec(migration)
  const after = await db.query("select * from pg_policies where policyname not like 'dashboard_member_read_%' order by tablename, policyname")
  assert.deepEqual(after.rows, before.rows)
  await assert.rejects(asRole(db, 'authenticated', staffId, "insert into public.order_upload_data values (9, 1, 'Chennai')"), { code: '42501' })
  assert.equal((await asRole(db, 'authenticated', staffId, 'delete from public.order_upload_data')).affectedRows, 0)
  assert.equal((await asRole(db, 'authenticated', staffId, 'update public.order_upload_data set delivered = 0')).affectedRows, 0)
  assert.deepEqual((await asRole(db, 'authenticated', staffId, 'select id from public.fleet_data')).rows, [{ id: 1 }])
  for (const table of ['rider_kyc', 'unrelated_private', 'dashboard_settings']) {
    await assert.rejects(asRole(db, 'authenticated', staffId, `select * from public.${table}`), { code: '42501' })
  }
  const profile = await asRole(db, 'authenticated', staffId, 'select id, role from public.dashboard_users')
  assert.deepEqual(profile.rows, [{ id: staffId, role: 'user' }])
  assert.equal((await db.query('select login_enabled from public.dashboard_settings')).rows[0].login_enabled, true)
})
