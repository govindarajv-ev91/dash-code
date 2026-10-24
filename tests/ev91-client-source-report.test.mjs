import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildClientSourceReport, clientPeriodRiderKey } from '../src/lib/ev91ClientSourceReport.js'

const options = (periods, overrides = {}) => ({
  periods,
  matches: () => true,
  sourceForRow: (row) => row.source_name || 'Unknown',
  periodForRow: (row) => row.period_label,
  ...overrides,
})
const payment = (source, period, rider, payout, overrides = {}) => ({
  source_name: source, period_label: period, rider_key: rider, gross_payout: payout, ...overrides,
})

test('source revenue includes every payment while counting each rider once per period', () => {
  const report = buildClientSourceReport([
    payment('Alpha', 'Week 40', 'rider-1', 1000),
    payment('Alpha', 'Week 40', 'rider-1', '₹250.50'),
    payment('Alpha', 'Week 41', 'rider-1', '1,200'),
    payment('Beta', 'Week 41', 'rider-2', 600),
    payment('Beta', 'Week 41', 'rider-3', 100),
  ], options(['Week 40', 'Week 41']))
  assert.deepEqual(report.riderRows.map((row) => row.source), ['Beta', 'Alpha'])
  assert.deepEqual(report.revenueRows, [
    { source: 'Alpha', values: { 'Week 40': 1250.5, 'Week 41': 1200 } },
    { source: 'Beta', values: { 'Week 41': 700 } },
  ])
  assert.equal(report.riderRows.find((row) => row.source === 'Alpha').values['Week 40'], 1)
  assert.deepEqual(report.revenueTotals, { 'Week 40': 1250.5, 'Week 41': 1900 })
})

test('source revenue sorts by the last visible period, with missing values treated as zero', () => {
  const report = buildClientSourceReport([
    payment('Older', 'Week 40', 'rider-1', 10000),
    payment('Zebra', 'Week 41', 'rider-2', 50),
    payment('Alpha', 'Week 41', 'rider-3', 50),
    payment('Correction', 'Week 41', 'rider-4', -10),
  ], options(['Week 40', 'Week 41']))
  assert.deepEqual(report.revenueRows.map((row) => row.source), ['Alpha', 'Zebra', 'Older', 'Correction'])
  assert.deepEqual(report.revenueTotals, { 'Week 40': 10000, 'Week 41': 90 })
})

test('monthly source totals respect the selected rows and resolved onboarding sources', () => {
  const report = buildClientSourceReport([
    payment('Uploaded source', 'Sep 2026', 'rider-1', 100, { client_name: 'Client A' }),
    payment('Uploaded source', 'Oct 2026', 'rider-1', 200, { client_name: 'Client A' }),
    payment('Uploaded source', 'Oct 2026', 'rider-2', 10000, { client_name: 'Client B' }),
  ], options(['Sep 2026', 'Oct 2026'], {
    matches: (row) => row.client_name === 'Client A',
    sourceForRow: () => 'Onboarding source',
  }))
  assert.deepEqual(report.revenueRows, [{ source: 'Onboarding source', values: { 'Sep 2026': 100, 'Oct 2026': 200 } }])
  assert.deepEqual(report.revenueTotals, { 'Sep 2026': 100, 'Oct 2026': 200 })
  assert.deepEqual(report.riderRows[0].values, { 'Sep 2026': 1, 'Oct 2026': 1 })
})

test('missing sources and invalid payouts never produce NaN totals', () => {
  const report = buildClientSourceReport([
    payment('', 'Week 41', 'rider-1', null),
    payment('', 'Week 41', 'rider-2', 'invalid'),
    payment('', 'Week 41', 'rider-3', Infinity),
  ], options(['Week 41']))
  assert.deepEqual(report.revenueRows, [{ source: 'Unknown', values: { 'Week 41': 0 } }])
  assert.equal(report.riderRows[0].values['Week 41'], 3)
  assert.equal(report.revenueTotals['Week 41'], 0)
  assert.deepEqual(buildClientSourceReport([], options([])), {
    riderRows: [], revenueRows: [], revenueTotals: {},
  })
})

test('monthly sources count a rider once across weeks and clients while preserving all revenue', () => {
  const rows = [
    payment('Alpha', 'Week 40', 'Client A|Week 40|001', 100, { rider_id: '001', client_name: 'Client A', month: 'Oct 2026' }),
    payment('Alpha', 'Week 41', 'Client A|Week 41|001', 200, { rider_id: '001', client_name: 'Client A', month: 'Oct 2026' }),
    payment('Alpha', 'Week 41', 'Client A|Week 41|001', 50, { rider_id: '001', client_name: 'Client A', month: 'Oct 2026' }),
    payment('Alpha', 'Week 41', 'Client B|Week 41|001', 300, { rider_id: '001', client_name: 'Client B', month: 'Oct 2026' }),
    payment('Alpha', 'Week 41', 'Client A|Week 41|002', 400, { rider_id: '002', client_name: 'Client A', month: 'Oct 2026' }),
    payment('Alpha', 'Week 45', 'Client A|Week 45|001', 500, { rider_id: '001', client_name: 'Client A', month: 'Nov 2026' }),
    payment('Beta', 'Week 41', 'Client A|Week 41|001', 600, { rider_id: '001', client_name: 'Client A', month: 'Oct 2026' }),
  ]
  const settings = options(['Oct 2026', 'Nov 2026'], { mode: 'monthly', periodForRow: (row) => row.month })
  const monthly = buildClientSourceReport(rows, settings)
  assert.deepEqual(monthly.riderRows, [
    { source: 'Alpha', values: { 'Oct 2026': 2, 'Nov 2026': 1 } },
    { source: 'Beta', values: { 'Oct 2026': 1 } },
  ])
  assert.deepEqual(monthly.revenueTotals, { 'Oct 2026': 1650, 'Nov 2026': 500 })
  const filtered = buildClientSourceReport(rows, { ...settings, matches: (row) => row.client_name === 'Client B' })
  assert.deepEqual(filtered.riderRows, [{ source: 'Alpha', values: { 'Oct 2026': 1 } }])
  const weekly = buildClientSourceReport(rows.slice(0, 5), options(['Week 40', 'Week 41']))
  assert.deepEqual(weekly.riderRows[0].values, { 'Week 40': 1, 'Week 41': 3 })
})

test('monthly identities preserve leading zeros and recover legacy IDs without using payment weeks', () => {
  assert.equal(clientPeriodRiderKey({ rider_id: ' a1 ', rider_key: 'Client|Week 40|a1' }, 'monthly'),
    clientPeriodRiderKey({ rider_id: 'A1', rider_key: 'Client|Week 41|A1' }, 'monthly'))
  assert.notEqual(clientPeriodRiderKey({ rider_id: '001' }, 'monthly'), clientPeriodRiderKey({ rider_id: '1' }, 'monthly'))
  assert.equal(clientPeriodRiderKey({ rider_key: 'Client A|Week 40|001' }, 'monthly'),
    clientPeriodRiderKey({ rider_key: 'Client B|Week 41|001' }, 'monthly'))
  assert.equal(clientPeriodRiderKey({ rider_name: 'Same Name', client_name: 'A' }, 'monthly'),
    clientPeriodRiderKey({ rider_name: ' same   name ', client_name: 'A' }, 'monthly'))
  assert.notEqual(clientPeriodRiderKey({ rider_id: '001', rider_name: 'Same Name' }, 'monthly'),
    clientPeriodRiderKey({ rider_id: '002', rider_name: 'Same Name' }, 'monthly'))
  assert.notEqual(clientPeriodRiderKey({ id: 1 }, 'monthly'), clientPeriodRiderKey({ id: 2 }, 'monthly'))
})
