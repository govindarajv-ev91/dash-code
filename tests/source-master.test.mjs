import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { buildSourceMasterIndex, isListedSource } from '../src/lib/sourceMaster.js'

const migration = await readFile(new URL('../sql/create_source_master.sql', import.meta.url), 'utf8')
const statusRepair = await readFile(new URL('../sql/fix_source_master_status_permissions.sql', import.meta.url), 'utf8')

test('city aliases, casing and pasted whitespace match, with inactive/unknown sources excluded', () => {
  const index = buildSourceMasterIndex([
    { city: 'Bangalore', source_name: 'Roqibul hashan_ BLR _FR', is_active: true },
    { city: 'Mysore', source_name: 'Venkatesh - FR_Mysuru', is_active: true },
    { city: 'Bangalore', source_name: 'Inactive', is_active: false },
  ])
  assert.ok(isListedSource(index, 'Bengaluru', ' Roqibul   hashan_ BLR   _FR '))
  assert.ok(isListedSource(index, 'Mysuru', 'VENKATESH-FR_MYSURU'))
  assert.equal(isListedSource(index, 'Delhi', 'Venkatesh - FR_Mysuru'), false)
  for (const source of ['Inactive', 'Unlisted', '', 'Unknown']) {
    assert.equal(isListedSource(index, 'Bangalore', source), false)
  }
  assert.equal(isListedSource(buildSourceMasterIndex([]), 'Bangalore', 'Anything'), false)
})

test('authenticated admins can add, edit, deactivate and remove; staff and visitors cannot mutate', async (t) => {
  const db = await PGlite.create()
  t.after(() => db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;`)
  const authSql = await readFile(new URL('../sql/create_dashboard_auth.sql', import.meta.url), 'utf8')
  await db.exec(authSql)
  const admin = '00000000-0000-0000-0000-000000000001'
  const staff = '00000000-0000-0000-0000-000000000002'
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [admin, 'admin@example.test', staff, 'staff@example.test'])
  await db.query("update public.dashboard_users set role = 'admin' where id = $1", [admin])
  await db.exec(migration)
  await db.exec(migration)
  for (const id of [staff, '00000000-0000-0000-0000-000000000003']) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
    await db.exec('set role authenticated')
    assert.equal((await db.query('select * from public.source_master')).rows.length, 41)
    await assert.rejects(db.exec("insert into public.source_master (city, source_name) values ('Delhi', 'Denied')"), /row-level security/)
    assert.equal((await db.query('update public.source_master set is_active = false returning id')).rows.length, 0)
    assert.equal((await db.query('delete from public.source_master returning id')).rows.length, 0)
    await db.exec('reset role')
  }
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin])
  await db.exec('set role authenticated')
  const added = (await db.query("insert into public.source_master (city, source_name) values ('Delhi', 'New team') returning id")).rows[0].id
  assert.equal((await db.query("update public.source_master set source_name = 'Edited team', is_active = false where id = $1 returning *", [added])).rows[0].is_active, false)
  assert.equal((await db.query('delete from public.source_master where id = $1 returning id', [added])).rows.length, 1)
  // Reproduce a project still using the original read-only table grants.
  await db.exec('reset role; revoke update on public.source_master from authenticated; set role authenticated')
  await assert.rejects(db.exec('update public.source_master set is_active = false where id = 1'), /permission denied/)
  await db.exec('reset role')
  await db.exec(statusRepair)
  await db.exec(statusRepair)
  await db.exec('set role authenticated')
  assert.equal((await db.query('update public.source_master set is_active = false where id = 1 returning is_active')).rows[0].is_active, false)
  // Reproduce the old update policy returning zero rows when a profile read
  // policy hides the admin record, even though the account remains an admin.
  await db.exec(`reset role;
    drop policy dashboard_user_self_read on public.dashboard_users;
    drop policy source_master_admin_update on public.source_master;
    create policy source_master_admin_update on public.source_master
      for update to authenticated using (exists (
        select 1 from public.dashboard_users where id = (select auth.uid()) and role = 'admin'
      ));
    set role authenticated;`)
  assert.equal((await db.query('update public.source_master set is_active = true where id = 1 returning id')).rows.length, 0)
  await db.exec('reset role')
  await db.exec(statusRepair)
  await db.exec('set role authenticated')
  assert.equal((await db.query('update public.source_master set is_active = true where id = 1 returning is_active')).rows[0].is_active, true)
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [staff])
  await db.exec('set role authenticated')
  assert.equal((await db.query('update public.source_master set is_active = false where id = 1 returning id')).rows.length, 0)
  await db.exec('reset role; set role anon')
  await assert.rejects(db.exec('delete from public.source_master'), /permission denied/)
  await db.exec('reset role')
})

test('migration seeds 41 sources once and preserves maintenance; browser roles can only read', async (t) => {
  const db = await PGlite.create()
  t.after(() => db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(migration)
  const rows = (await db.query('select * from public.source_master')).rows
  assert.equal(rows.length, 41)
  const index = buildSourceMasterIndex(rows)
  assert.equal(index.size, 41)
  assert.ok(isListedSource(index, 'Hyderabad', 'Sudhakar(santosh)_FR_Hyd_AP   & TS'))
  await db.exec(`update public.source_master set is_active = false where id = 1;
    delete from public.source_master where id = 2;
    insert into public.source_master (city, source_name) values ('Chennai', 'New source');`)
  await db.exec(migration)
  assert.equal((await db.query('select count(*)::int as n from public.source_master')).rows[0].n, 41)
  assert.equal((await db.query('select is_active from public.source_master where id = 1')).rows[0].is_active, false)
  assert.equal((await db.query('select * from public.source_master where id = 2')).rows.length, 0)
  await assert.rejects(db.query("insert into public.source_master (city, source_name) values ('Chennai', ' NEW   SOURCE ')"), /duplicate key/)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    assert.equal((await db.query('select * from public.source_master')).rows.length, 41)
    await assert.rejects(db.exec('delete from public.source_master'), /permission denied/)
    await assert.rejects(db.exec('update public.source_master set is_active = false'), /permission denied/)
    await assert.rejects(db.exec("insert into public.source_master (city, source_name) values ('Delhi', 'No')"), /permission denied/)
    await db.exec('reset role')
  }
})
