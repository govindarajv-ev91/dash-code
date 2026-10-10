import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/ev91-onboarding-pending',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
})
after(() => server.close())
const { buildEv91OnboardingPendingRows, rowsToOnboardingExport } =
  await server.ssrLoadModule('/src/lib/ev91OnboardingPending.js')

const order = (workerCode, overrides = {}) => ({
  worker_code: workerCode, worker_name: 'Order Name', mob_number: '9000000001',
  city: 'Chennai', client: 'Client A', delivered: 12, date_record: '2026-10-09',
  ...overrides,
})

test('unmapped riders display onboarding name and phone while retaining their mapping status and order totals', () => {
  const orders = [order('FE963117'), order('FE963117', { delivered: 8 })]
  const report = buildEv91OnboardingPendingRows(orders, [], [{
    rider_id_details: 'FE963117', rider_name: ' Onboarded Rider ', rider_mobile_number: ' 9876543210 ',
    source_name: ' Referral Team ',
  }])
  const expected = buildEv91OnboardingPendingRows(orders, [])
  assert.equal(report.rows.length, 1)
  assert.equal(report.rows[0].totalOrders, 20)
  for (const row of report.rows) {
    assert.equal(row.workerName, 'Onboarded Rider')
    assert.equal(row.mobile, '9876543210')
    assert.equal(row.sourceName, 'Referral Team')
    assert.equal(row.status, 'Not in Client Mapping')
    assert.equal(row.ev91RiderId, '')
  }
  assert.deepEqual(report.summary, expected.summary)
  assert.deepEqual(report.rows.map((row) => row.totalOrders), expected.rows.map((row) => row.totalOrders))
  const exported = rowsToOnboardingExport(report.rows)
  assert.equal(exported[0]['Rider Name'], 'Onboarded Rider')
  assert.equal(exported[0].Phone, '9876543210')
  assert.equal(exported[0]['Source Name'], 'Referral Team')
  assert.equal(exported[0].Status, 'Not in Client Mapping')
})

test('all existing onboarding ID fields can match order Client IDs', () => {
  for (const field of ['rider_id_details', 'rider_id', 'worker_code', 'client_rider_id', 'merge']) {
    const { rows } = buildEv91OnboardingPendingRows([order('963117')], [], [{
      [field]: field === 'merge' ? 'voiceFE963117' : 'FE963117',
      rider_name: 'Rider from onboarding', phone: '9876543210',
    }])
    assert.equal(rows[0].workerName, 'Rider from onboarding', field)
    assert.equal(rows[0].mobile, '9876543210', field)
  }
  const { rows } = buildEv91OnboardingPendingRows([order('CHN61-R0196')], [], [{
    rider_id: 'chn61_r0196', rider_name: 'Normalized ID', mobile: '9876543210',
  }])
  assert.equal(rows[0].workerName, 'Normalized ID')
})

test('mapped riders and mappings missing an EV91 ID retain their existing contact details', () => {
  for (const ev91RiderId of ['EV91-123', '']) {
    const mappings = [{ clientId: 'FE963117', ev91RiderId, phoneNumber: '9111111111' }]
    const orders = [order('FE963117')]
    assert.deepEqual(buildEv91OnboardingPendingRows(orders, mappings, [{
      rider_id_details: 'FE963117', rider_name: 'Onboarding Name', rider_mobile_number: '9876543210',
    }]), buildEv91OnboardingPendingRows(orders, mappings))
  }
})

test('missing onboarding values fall back independently and placeholder values are ignored', () => {
  const { rows } = buildEv91OnboardingPendingRows([order('FE963117')], [], [{
    rider_id: 'FE963117', rider_name: 'N/A', rider_mobile_number: 'null', mobile: '9876543210',
  }])
  assert.equal(rows[0].workerName, 'Order Name')
  assert.equal(rows[0].mobile, '9876543210')
  const nameOnly = buildEv91OnboardingPendingRows([order('FE963117')], [], [{
    worker_code: '963117', rider_name: 'Onboarding Name', rider_mobile_number: '—',
  }])
  assert.equal(nameOnly.rows[0].workerName, 'Onboarding Name')
  assert.equal(nameOnly.rows[0].mobile, '9000000001')
})

test('unmatched riders retain order details and are never matched only by name', () => {
  const orders = [order('FE963117')]
  const onboarding = [{ rider_id: 'FE111111', rider_name: 'Order Name', rider_mobile_number: '9876543210' }]
  assert.deepEqual(buildEv91OnboardingPendingRows(orders, [], onboarding), buildEv91OnboardingPendingRows(orders, []))
  assert.deepEqual(buildEv91OnboardingPendingRows([], [], onboarding).rows, [])
})

test('duplicate onboarding entries can fill missing contact fields without dropping good values', () => {
  const { rows } = buildEv91OnboardingPendingRows([order('FE963117')], [], [
    { rider_id: 'FE963117', rider_name: 'Onboarding Name' },
    { rider_id: 'FE963117', rider_name: 'N/A', rider_mobile_number: '9876543210' },
  ])
  assert.equal(rows[0].workerName, 'Onboarding Name')
  assert.equal(rows[0].mobile, '9876543210')
})

test('onboarding source is displayed even when the onboarding record has no name or phone', () => {
  const { rows } = buildEv91OnboardingPendingRows([order('963117')], [], [{
    rider_id_details: 'FE963117', source_name: ' Source Only ',
  }])
  assert.equal(rows[0].sourceName, 'Source Only')
  assert.equal(rows[0].workerName, 'Order Name')
  assert.equal(rows[0].mobile, '9000000001')
  assert.equal(rows[0].status, 'Not in Client Mapping')
})

test('mapped riders display the mapping source and missing sources stay blank', () => {
  for (const ev91RiderId of ['EV91-123', '']) {
    const { rows } = buildEv91OnboardingPendingRows([order('FE963117')], [{
      clientId: 'FE963117', ev91RiderId, source: 'Mapping Source',
    }], [{ rider_id: 'FE963117', source_name: 'Onboarding Source' }])
    assert.equal(rows[0].sourceName, 'Mapping Source')
  }
  for (const sourceName of ['', 'N/A', 'null', 'Unknown', '—']) {
    const { rows } = buildEv91OnboardingPendingRows([order('FE963117')], [], [{
      rider_id_details: 'FE963117', source_name: sourceName,
    }])
    assert.equal(rows[0].sourceName, '')
    assert.equal(rowsToOnboardingExport(rows)[0]['Source Name'], '')
  }
})
