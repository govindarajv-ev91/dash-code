import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'
import { buildOverviewAttritionWorkbook } from '../src/lib/overviewRiderAttritionExcelExport.js'
import { buildOverviewAttritionPhoneIndex } from '../src/lib/overviewAttritionContacts.js'

const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/overview-rider-attrition',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const { buildOverviewAttritionIndex, buildOverviewAttritionSeries, buildOverviewAttritionExportDetails } = await server.ssrLoadModule('/src/lib/overviewRiderAttrition.js')
after(() => server.close())

const row = (date, worker, delivered = 1, overrides = {}) => ({
  date_record: date, worker_code: worker, delivered, client: 'Alpha', city: 'Chennai', type1: 'EV', ...overrides,
})
const report = (rows, options) => buildOverviewAttritionSeries(buildOverviewAttritionIndex(rows), options)

test('export keeps BB riders and shows the other client matched by phone in every view', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ onboardingRows: [
    { rider_id_details: 'BB-OLD', rider_mobile_number: '+91 93458 89303' },
    { rider_id_details: 'OTHER-NEW', rider_mobile_number: '9345889303' },
  ] })
  for (const period of ['monthly', 'weekly', 'daily']) {
    const rows = [
      row(period === 'monthly' ? '2026-09-30' : period === 'weekly' ? '2026-10-04' : '2026-10-01', 'BB-OLD', 5, { client: 'BB' }),
      row(period === 'daily' ? '2026-10-10' : '2026-10-06', 'OTHER-NEW', 2, { client: 'Zomato', city: 'Bengaluru' }),
      row('2026-10-15', 'coverage', 0),
    ]
    const chart = report(rows, { client: 'BB', city: 'Chennai', period, dateFrom: '2026-10-01' })
    assert.equal(chart.details.length, 1)
    const before = structuredClone(chart)
    const exportDetails = buildOverviewAttritionExportDetails(chart, rows, phoneIndex)
    assert.equal(exportDetails.details.length, 1)
    assert.equal(exportDetails.otherClientCount, 1)
    assert.deepEqual(exportDetails.details[0].otherWorkingClients, ['Zomato'])
    assert.deepEqual(chart, before, 'chart data is unchanged')
    const workbook = buildOverviewAttritionWorkbook(chart, { phoneIndex, exportDetails })
    const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' })
    const exported = XLSX.utils.sheet_to_json(reopened.Sheets['Rider Details'])
    assert.equal(exported.length, 1)
    assert.equal(exported[0].Client, 'BB')
    assert.equal(exported[0]['Other Working Client'], 'Zomato')
    assert.equal(reopened.Sheets['Rider Details'].F2.t, 's')
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets['Chart Summary'])
    assert.equal(summary.at(-1).Total, 1)
    const metadata = Object.fromEntries(XLSX.utils.sheet_to_json(workbook.Sheets['Filters and Rule']).map((row) => [row.Setting, row.Value]))
    assert.equal(metadata['Riders Working for Other Clients'], 1)
    assert.equal(metadata['Exported Rider Details'], 1)
    assert.match(metadata['Chart Summary Scope'], /does not remove riders/)
  }
})

test('export phone check records every other working client once within the comparison period', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ onboardingRows: [
    { rider_id_details: 'BB-OLD', rider_mobile_number: '9345889303' },
  ] })
  const rows = [
    row('2026-09-30', 'BB-OLD', 5, { client: 'BB' }),
    row('2026-10-06', 'OTHER-NEW', 2, { client: 'swiggy', mob_number: '9345889303' }),
    row('2026-10-07', 'OTHER-NEW', 2, { client: 'Swiggy Instamart', mob_number: '9345889303' }),
    row('2026-10-09', 'OTHER-NEW', 2, { client: 'Zomato', mob_number: '9345889303' }),
    row('2026-10-10', 'OTHER-NEW', 0, { client: 'Inactive Client', mob_number: '9345889303' }),
    row('2026-11-01', 'OTHER-NEW', 2, { client: 'Later Client', mob_number: '9345889303' }),
  ]
  for (const activity of [rows, [...rows].reverse()]) {
    const chart = report(activity, { client: 'BB', period: 'monthly', dateFrom: '2026-10-01', dateTo: '2026-10-31' })
    const filtered = buildOverviewAttritionExportDetails(chart, activity, phoneIndex)
    assert.equal(filtered.otherClientCount, 1)
    assert.equal(filtered.details[0].workerCode, 'BB-OLD')
    assert.deepEqual(filtered.details[0].otherWorkingClients, ['Swiggy Instamart', 'Zomato'])
    const workbook = buildOverviewAttritionWorkbook(chart, { phoneIndex, exportDetails: filtered })
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Rider Details'])[0]['Other Working Client'], 'Swiggy Instamart, Zomato')
    assert.equal(chart.details[0].otherWorkingClients, undefined)
  }
})

test('export phone check retains genuinely missed months/weeks despite work outside the comparison period', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ kycRows: [
    { rider_id: 'BB-OLD', rider_mobile_number: '9345889303' },
    { rider_id: 'OTHER-NEW', rider_mobile_number: '9345889303' },
  ] })
  for (const period of ['monthly', 'weekly']) {
    const rows = [
      row(period === 'monthly' ? '2026-09-30' : '2026-10-04', 'BB-OLD', 5, { client: 'BB' }),
      row(period === 'monthly' ? '2026-11-01' : '2026-10-12', 'OTHER-NEW', 2, { client: 'Zomato' }),
    ]
    const chart = report(rows, { client: 'BB', period, dateFrom: '2026-10-01' })
    assert.equal(chart.details.length, 1)
    const exported = buildOverviewAttritionExportDetails(chart, rows, phoneIndex)
    assert.equal(exported.details.length, 1)
    assert.equal(exported.otherClientCount, 0)
    assert.deepEqual(exported.details[0].otherWorkingClients, [])
  }
})

test('export phone check ignores zero/invalid orders, invalid dates, IC mirrors and earlier work', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ fleetRows: [
    { rider_id: 'BB-OLD', rider_contact_number: '9345889303' },
    { rider_id: 'OTHER-NEW', rider_contact_number: '9345889303' },
  ] })
  const rows = [
    row('2026-10-01', 'BB-OLD', 5, { client: 'BB' }),
    row('2026-09-30', 'OTHER-NEW', 5, { client: 'Zomato' }),
    row('2026-10-03', 'OTHER-NEW', 0, { client: 'Zomato' }),
    row('2026-10-04', 'OTHER-NEW', -1, { client: 'Zomato' }),
    row('2026-10-05', 'OTHER-NEW', 'NaN', { client: 'Zomato' }),
    row('31-02-2026', 'OTHER-NEW', 5, { client: 'Zomato' }),
    row('2026-10-06', 'OTHER-NEW', 5, { client: 'Zomato', _ic_only: true }),
    row('2026-10-10', 'coverage', 0),
  ]
  const chart = report(rows, { client: 'BB', period: 'daily' })
  assert.equal(chart.details.length, 1)
  const exported = buildOverviewAttritionExportDetails(chart, rows, phoneIndex)
  assert.equal(exported.details.length, 1)
  assert.equal(exported.otherClientCount, 0)
})

test('export phone check uses working-row phones as fallback and retains unknown or unmatched phones', () => {
  const phoneIndex = buildOverviewAttritionPhoneIndex({ kycRows: [
    { rider_id: 'BB-OLD', rider_mobile_number: '9345889303' },
    { rider_id: 'BB-OTHER', rider_mobile_number: '9000000001' },
  ] })
  const rows = [
    row('2026-09-30', 'BB-OLD', 5, { client: 'BB' }),
    row('2026-09-30', 'BB-OTHER', 5, { client: 'BB' }),
    row('2026-09-30', 'BB-UNKNOWN', 5, { client: 'BB' }),
    row('2026-10-06', 'OTHER-NEW', 2, { client: 'Zomato', mob_number: '+91 93458 89303' }),
    row('2026-10-15', 'coverage', 0),
  ]
  const chart = report(rows, { client: 'BB', period: 'monthly' })
  const filtered = buildOverviewAttritionExportDetails(chart, rows, phoneIndex)
  assert.equal(chart.details.length, 3)
  assert.deepEqual(filtered.details.map((detail) => detail.workerCode).sort(), ['BB-OLD', 'BB-OTHER', 'BB-UNKNOWN'])
  assert.equal(filtered.otherClientCount, 1)
  const workbook = buildOverviewAttritionWorkbook(chart, { phoneIndex, exportDetails: filtered })
  const details = XLSX.utils.sheet_to_json(workbook.Sheets['Rider Details'], { defval: '' })
  assert.equal(details.find((detail) => detail['Rider ID'] === 'BB-OLD')['Other Working Client'], 'Zomato')
  assert.equal(details.find((detail) => detail['Rider ID'] === 'BB-OTHER')['Other Working Client'], '')
  assert.equal(details.find((detail) => detail['Rider ID'] === 'BB-UNKNOWN')['Other Working Client'], '')
})

test('attrition starts exactly four calendar days after last work, even without zero-order rows', () => {
  const rows = [row('2026-10-01', 'r1'), row('2026-10-04', 'coverage', 0)]
  assert.equal(report(rows).totals.total, 0)
  rows.push(row('2026-10-05', 'coverage', 0), row('2026-10-06', 'never-worked', 0))
  const result = report(rows, { period: 'daily', dateFrom: '2026-10-01' })
  assert.deepEqual(result.series.filter((point) => point.total).map(({ date, total }) => ({ date, total })), [
    { date: '2026-10-05', total: 1 },
  ])
  assert.equal(result.totals.total, 1, 'a continued absence must not generate repeated daily attrition')
  assert.equal(result.asOfDate, '2026-10-06')
})

test('returning to work removes earlier absences; only a final ongoing absence counts', () => {
  const result = report([
    row('2026-10-01', 'r1'), row('2026-10-05', 'r1'),
    row('2026-10-10', 'r1'), row('2026-10-15', 'coverage', 0),
  ], { period: 'daily', dateFrom: '2026-10-01' })
  assert.deepEqual(result.series.filter((point) => point.total).map((point) => point.date), ['2026-10-14'])
  assert.equal(result.details[0].lastWorkingDate, '2026-10-10')
  assert.equal(result.details[0].nextWorkingDate, '')
})

test('each period deduplicates riders and keeps EV plus Non-EV equal to Total after type changes', () => {
  const rows = [
    row('2026-10-01', ' r1 ', 10), row('2026-10-01', 'R1', 10),
    row('2026-10-07', 'R1', 10, { type1: 'NON-EV' }),
    row('2026-10-12', 'coverage', 0),
  ]
  const monthly = report(rows)
  assert.equal(monthly.series.length, 9)
  assert.deepEqual(monthly.totals, { ev: 0, nonEv: 0, total: 0 }, 'no previous-month work means no monthly attrition')
  const weekly = report(rows, { period: 'weekly', dateFrom: '2026-10-01' })
  assert.deepEqual(weekly.totals, { ev: 0, nonEv: 1, total: 1 })
  const daily = report(rows, { period: 'daily', dateFrom: '2026-10-01' })
  assert.deepEqual(daily.totals, { ev: 0, nonEv: 1, total: 1 })
  for (const point of [...monthly.series, ...weekly.series, ...daily.series]) assert.equal(point.total, point.ev + point.nonEv)
})

test('monthly attrition counts a missed month even when the rider returns in a later month', () => {
  const result = report([
    row('2026-08-01', 'r1'), row('2026-10-01', 'r1', 1, { client: 'Beta', city: 'Bengaluru', type1: 'NON-EV' }),
    row('2026-11-05', 'coverage', 0),
  ])
  assert.deepEqual(result.series.filter((point) => point.total).map(({ period, ev, nonEv, total }) => ({ period, ev, nonEv, total })), [
    { period: 'Sep 2026', ev: 1, nonEv: 0, total: 1 },
    { period: 'Nov 2026', ev: 0, nonEv: 1, total: 1 },
  ])
  assert.equal(result.totals.total, 2)
  assert.equal(result.details[0].nextWorkingDate, '2026-10-01')
  assert.equal(result.details[0].comparisonThrough, '2026-09-30')
  assert.equal(result.details[1].periodStatus, 'In progress')
})

test('filters cannot mark a rider inactive when they keep working in another client or city', () => {
  const rows = [
    row('2026-10-01', 'r1'),
    row('2026-10-04', 'r1', 1, { client: 'Beta', city: 'Bangalore', type1: 'NON-EV' }),
    row('2026-10-08', 'coverage', 0),
  ]
  assert.equal(report(rows, { client: 'Alpha', period: 'daily' }).totals.total, 0)
  const beta = report(rows, { client: 'Beta', city: 'Bengaluru', period: 'daily' })
  assert.deepEqual(beta.totals, { ev: 0, nonEv: 1, total: 1 })
  const empty = report(rows, { client: 'Alpha', city: 'Bengaluru' })
  assert.equal(empty.series.length, 0)
  assert.deepEqual(empty.clients, [{ name: 'Alpha' }, { name: 'Beta' }])
  assert.deepEqual(empty.cities, [{ name: 'Bengaluru' }, { name: 'Chennai' }])
})

test('historical context crosses the nine-month boundary and caps chart dates to loaded coverage', () => {
  const rows = [
    row('30/12/2025', 'r1'), row('2026-01-10', 'r2'),
    row('2026-09-01', 'coverage', 0), row('invalid', 'bad'),
  ]
  const result = report(rows)
  assert.equal(result.series[0].period, 'Jan 2026')
  assert.equal(result.series.at(-1).period, 'Sep 2026')
  assert.equal(result.series[0].total, 1)
  const selected = report(rows, { dateFrom: '2026-01-03', dateTo: '2026-01-03', period: 'daily' })
  assert.deepEqual(selected.totals, { ev: 1, nonEv: 0, total: 1 })
  assert.equal(selected.series.length, 1)
  assert.equal(report(rows, { dateFrom: '2026-01-01', dateTo: '2026-01-02', period: 'daily' }).totals.total, 0)
  assert.equal(report(rows, { dateFrom: '2026-10-01', dateTo: '2026-10-10' }).series.length, 0)
  assert.equal(report(rows, { dateFrom: '2026-09-01', dateTo: '2026-12-01' }).asOfDate, '2026-09-01')
})

test('legacy dates, aliases, type2 EV and duplicate rows produce stable events without counting invalid riders', () => {
  const rows = [
    row('01-10-2026', 'R1', 10, { client: 'swiggy', city: 'blr', type1: '', type2: 'EV' }),
    row('2026-10-01', ' r1 ', 10, { client: 'swiggy', city: 'blr', type1: '', type2: 'EV' }),
    row('2026-10-06', 'coverage', 0), row('2026-10-01', ''),
    row('2026-10-01', 'negative', -1), row('2026-10-01', 'invalid-number', 'NaN'),
    row('2026-10-01', 'mirror', 10, { _ic_only: true }), row('31-02-2026', 'invalid-date'),
  ]
  const options = { client: 'Swiggy Instamart', city: 'Bengaluru', period: 'daily' }
  assert.deepEqual(report(rows, options).totals, { ev: 1, nonEv: 0, total: 1 })
  assert.deepEqual(report([...rows].reverse(), options), report(rows, options))
  assert.equal(report([]).series.length, 0)
})

test('export details reconcile to every chart point under each period and filter', () => {
  const rows = [
    row('2026-09-30', '00123', 1, { worker_name: 'Rider One' }),
    row('2026-10-05', '00123', 1, { type1: 'NON-EV', worker_name: 'Rider One' }),
    row('2026-10-01', 'r2', 1, { client: 'Beta', city: 'Bengaluru' }),
    row('2026-10-10', 'coverage', 0),
  ]
  for (const period of ['monthly', 'weekly', 'daily']) {
    for (const client of ['All', 'Alpha', 'Beta']) {
      const result = report(rows, { period, client, dateFrom: '2026-10-01', dateTo: '2026-10-10' })
      assert.equal(result.details.length, result.totals.total)
      for (const point of result.series) {
        const details = result.details.filter((detail) => detail.periodDate === point.date)
        assert.equal(details.length, point.total)
        assert.equal(details.filter((detail) => detail.type === 'EV').length, point.ev)
        assert.equal(details.filter((detail) => detail.type === 'Non-EV').length, point.nonEv)
        assert.equal(new Set(details.map((detail) => detail.workerCode.toLowerCase())).size, details.length)
      }
    }
  }
  const daily = report(rows, { period: 'daily', client: 'Alpha', dateFrom: '2026-10-04', dateTo: '2026-10-04' })
  assert.equal(daily.details.length, 0, 'a later known return excludes attrition even beyond the selected cutoff')
  const full = report(rows, { period: 'daily', client: 'Alpha' })
  assert.equal(full.details.length, 1)
  assert.equal(full.details[0].lastWorkingDate, '2026-10-05')
  assert.equal(full.details[0].attritionDate, '2026-10-09')
  assert.equal(full.details[0].inactiveDays, 4)
  assert.equal(full.details[0].nextWorkingDate, '')
})

test('Excel export preserves rider IDs and dates, and includes matching summary and filter metadata', () => {
  const result = report([
    row('2026-10-01', '00123', 1, { worker_name: 'Rider One', type1: 'NON-EV' }),
    row('2026-10-05', 'coverage', 0),
  ], { client: 'Alpha', city: 'Chennai', period: 'daily', dateFrom: '2026-10-05' })
  const workbook = buildOverviewAttritionWorkbook(result, { client: 'Alpha', city: 'Chennai', period: 'daily' })
  const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' })
  assert.deepEqual(reopened.SheetNames, ['Rider Details', 'Chart Summary', 'Filters and Rule'])
  const details = XLSX.utils.sheet_to_json(reopened.Sheets['Rider Details'])
  assert.equal(details.length, 1)
  assert.equal(details[0]['Rider ID'], '00123')
  assert.equal(reopened.Sheets['Rider Details'].B2.t, 's')
  assert.equal(details[0]['Rider Name'], 'Rider One')
  assert.equal(details[0]['Work Started Date'], '2026-10-01')
  assert.equal(details[0]['Last Working Date'], '2026-10-01')
  assert.equal(details[0]['Attrition Date'], '2026-10-05')
  assert.equal(details[0]['Inactive Days at Attrition'], 4)
  const summary = XLSX.utils.sheet_to_json(reopened.Sheets['Chart Summary'])
  assert.equal(summary.at(-1).Total, 1)
  assert.equal(summary.at(-1)['Total Base Riders'], 1)
  assert.equal(summary.at(-1)['Total Attrition %'], 1)
  const filters = Object.fromEntries(XLSX.utils.sheet_to_json(reopened.Sheets['Filters and Rule']).map((row) => [row.Setting, row.Value]))
  assert.equal(filters.Client, 'Alpha')
  assert.equal(filters.City, 'Chennai')
  assert.equal(filters.Period, 'daily')
  assert.equal(filters['From Date'], '2026-10-05')
  assert.equal(filters['Data Through'], '2026-10-05')
  assert.equal(filters['Activity Checked Through'], '2026-10-05')
  assert.match(filters.Rule, /no later return to work/)
})

test('attrition rates use deduplicated, filtered rider bases for Month, Week and Days', () => {
  for (const period of ['monthly', 'weekly', 'daily']) {
    const baseDate = period === 'monthly' ? '2026-09-30' : period === 'weekly' ? '2026-10-04' : '2026-10-01'
    const endDate = period === 'monthly' ? '2026-10-31' : period === 'weekly' ? '2026-10-11' : '2026-10-05'
    const startDate = period === 'monthly' ? '2026-10-01' : '2026-10-05'
    const rows = [
      ...['ev-left', 'ev-stay', 'ev-stay2', 'ev-moved'].map((rider) => row(baseDate, rider)),
      row(baseDate, ' EV-LEFT '),
      ...['ic-left', 'ic-stay'].map((rider) => row(baseDate, rider, 1, { type1: 'NON-EV' })),
      row(baseDate, 'zero-only', 0),
      ...['ev-stay', 'ev-stay2', 'ic-stay'].map((rider) => row('2026-10-05', rider)),
      row('2026-10-05', 'ev-moved', 1, { client: 'Beta', city: 'Bengaluru', type1: 'NON-EV' }),
      row('2026-10-05', 'new-worker'), row(endDate, 'coverage', 0),
    ]
    const result = report(rows, { period, client: 'Alpha', city: 'Chennai', dateFrom: startDate, dateTo: endDate })
    assert.equal(result.series.length, 1)
    const point = result.series[0]
    assert.equal(point.ev, 1)
    assert.equal(point.nonEv, 1)
    assert.equal(point.total, 2)
    assert.equal(point.evRiderBase, 4)
    assert.equal(point.nonEvRiderBase, 2)
    assert.equal(point.totalRiderBase, 6)
    assert.equal(point.evAttritionPercent, 25)
    assert.equal(point.nonEvAttritionPercent, 50)
    assert.ok(Math.abs(point.totalAttritionPercent - 100 / 3) < 1e-10)
    const withoutBase = report(rows, { period, client: 'Beta', city: 'Bengaluru', dateFrom: startDate, dateTo: endDate }).series[0]
    assert.equal(withoutBase.totalRiderBase, 0)
    assert.equal(withoutBase.totalAttritionPercent, null)
    assert.equal(withoutBase.evAttritionPercent, null)
    const workbook = buildOverviewAttritionWorkbook(result)
    const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer', cellNF: true })
    const sheet = reopened.Sheets['Chart Summary']
    assert.equal(sheet.I2.v, 0.25)
    assert.equal(sheet.I2.z, '0.00%')
    assert.equal(sheet.J2.v, 0.5)
    const summary = XLSX.utils.sheet_to_json(sheet)
    assert.equal(summary[0]['Total Base Riders'], 6)
    assert.equal(summary[0]['Base Period'], point.basePeriod)
    assert.ok(Math.abs(summary[0]['Total Attrition %'] - 1 / 3) < 1e-10)
  }
})

test('Work Started Date exports the first positive order date before all filters in every view', () => {
  const rows = [
    row('2026-09-30', '00123', 10, { client: 'Beta', city: 'Bengaluru' }),
    row('2025-01-02', ' 00123 ', 3),
    row('2024-12-01', '00123', 0), row('2024-12-02', '00123', -1),
    row('invalid', '00123', 10),
    row('02/01/2025', '00123', 3),
    row('2026-10-10', 'coverage', 0),
  ]
  for (const period of ['monthly', 'weekly', 'daily']) {
    const options = { period, client: 'Beta', city: 'Bengaluru', dateFrom: '2026-10-01', dateTo: '2026-10-10' }
    const result = report(rows, options)
    assert.equal(result.details.length, 1)
    assert.equal(result.details[0].workStartedDate, '2025-01-02')
    assert.equal(result.details[0].lastWorkingDate, '2026-09-30')
    const workbook = buildOverviewAttritionWorkbook(result, options)
    const reopened = XLSX.read(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }), { type: 'buffer' })
    const details = XLSX.utils.sheet_to_json(reopened.Sheets['Rider Details'])
    assert.equal(details[0]['Work Started Date'], '2025-01-02')
    assert.equal(details[0]['Last Working Date'], '2026-09-30')
    assert.equal(details[0]['Rider ID'], '00123')
    assert.deepEqual(report([...rows].reverse(), options), result)
  }
})

test('rider 100000329378 returning on April 26 is excluded from April 23 attrition and Excel export', () => {
  const rows = [
    row('2026-04-19', '100000329378'),
    row('2026-04-26', '100000329378', 5, { client: 'Beta', city: 'Bengaluru' }),
    row('2026-04-19', 'still-inactive'),
  ]
  for (const period of ['daily']) {
    for (const dateTo of ['2026-04-23', '2026-04-26']) {
      const result = report(rows, { dateFrom: '2026-04-01', dateTo, client: 'Alpha', city: 'Chennai', period })
      assert.equal(result.totals.total, 1)
      assert.deepEqual(result.details.map((detail) => detail.workerCode), ['still-inactive'])
      assert.equal(result.details[0].attritionDate, '2026-04-23')
      assert.equal(result.returnCheckThrough, '2026-04-26')
      const workbook = buildOverviewAttritionWorkbook(result)
      const details = XLSX.utils.sheet_to_json(workbook.Sheets['Rider Details'])
      assert.deepEqual(details.map((detail) => detail['Rider ID']), ['still-inactive'])
      assert.equal(details[0]['Next Working Date'], '')
    }
  }
  const beforeReturn = report(rows.slice(0, 1).concat(rows.slice(2), row('2026-04-23', 'coverage', 0)), { period: 'daily' })
  assert.equal(beforeReturn.totals.total, 2, 'loading the return activity must remove the earlier attrition')
})

test('ongoing zero-order uploads do not count as returning to work', () => {
  const result = report([
    row('2026-04-19', '100000329378'),
    row('2026-04-26', '100000329378', 0),
  ], { period: 'daily' })
  assert.equal(result.totals.total, 1)
  assert.equal(result.details[0].lastWorkingDate, '2026-04-19')
  assert.equal(result.details[0].attritionDate, '2026-04-23')
})

test('monthly attrition is previous-month workers minus all workers in the comparison month', () => {
  const rows = [
    row('2026-09-01', 'ev-left'), row('2026-09-30', 'ev-left'),
    row('2026-09-30', 'non-ev-left', 1, { type1: 'NON-EV' }),
    row('2026-09-01', 'continued'), row('2026-10-31', 'continued'),
    row('2026-09-15', 'moved'), row('2026-10-01', 'moved', 1, { client: 'Beta', city: 'Bengaluru' }),
    row('2026-08-01', 'older-worker'), row('2026-09-15', 'zero-only', 0),
    row('2026-10-10', 'new-worker'), row('2026-10-31', 'coverage', 0),
  ]
  const result = report(rows, { dateFrom: '2026-10-01', dateTo: '2026-10-31', client: 'Alpha', city: 'Chennai' })
  assert.deepEqual(result.totals, { ev: 1, nonEv: 1, total: 2 })
  assert.deepEqual(result.details.map((detail) => detail.workerCode), ['ev-left', 'non-ev-left'])
  assert.equal(result.details[0].previousPeriod, 'Sep 2026')
  assert.equal(result.details[0].attritionDate, '2026-10-31')
  assert.equal(result.details[0].comparisonFrom, '2026-10-01')
  assert.equal(result.details[0].periodStatus, 'Complete')
  assert.match(result.rule, /previous calendar month/)
  // A display range inside October must still check all October work.
  const partialSelection = report(rows, { dateFrom: '2026-10-10', dateTo: '2026-10-15', client: 'Alpha' })
  assert.equal(partialSelection.totals.total, 2)
})

test('weekly attrition compares adjacent Monday–Sunday weeks across months and years', () => {
  const rows = [
    row('2025-12-28', 'too-old'),
    row('2025-12-29', 'ev-left'), row('2026-01-04', 'ev-left'),
    row('2026-01-04', 'non-ev-left', 1, { type1: 'NON-EV' }),
    row('2026-01-04', 'continued'), row('2026-01-11', 'continued'),
    row('2026-01-01', 'moved'), row('2026-01-05', 'moved', 1, { client: 'Beta', city: 'Bangalore' }),
    row('2026-01-05', 'new-worker'), row('2026-01-04', 'zero-only', 0),
    row('2026-01-11', 'coverage', 0),
  ]
  const result = report(rows, { period: 'weekly', dateFrom: '2026-01-05', dateTo: '2026-01-11', client: 'Alpha' })
  assert.deepEqual(result.totals, { ev: 1, nonEv: 1, total: 2 })
  assert.equal(result.series.length, 1)
  assert.deepEqual(result.details.map((detail) => detail.workerCode), ['ev-left', 'non-ev-left'])
  assert.equal(result.details[0].comparisonFrom, '2026-01-05')
  assert.equal(result.details[0].comparisonThrough, '2026-01-11')
  assert.match(result.details[0].previousPeriod, /29 Dec 2025/)
  assert.match(result.rule, /Monday–Sunday/)
})

test('monthly and weekly cohorts do not apply the four-day rule to a new in-progress period', () => {
  const rows = [row('2026-08-31', 'r1'), row('2026-09-01', 'coverage', 0)]
  const monthly = report(rows, { dateFrom: '2026-09-01' })
  assert.equal(monthly.totals.total, 1)
  assert.equal(monthly.details[0].inactiveDays, 1)
  assert.equal(monthly.details[0].periodStatus, 'In progress')
  assert.equal(monthly.details[0].comparisonThrough, '2026-09-01')
  assert.equal(report(rows, { period: 'daily' }).totals.total, 0)
  const weekly = report([row('2026-09-06', 'r1'), row('2026-09-07', 'coverage', 0)], {
    period: 'weekly', dateFrom: '2026-09-07',
  })
  assert.equal(weekly.totals.total, 1)
  assert.equal(weekly.details[0].periodStatus, 'In progress')
})

test('month/week Excel export records comparison periods, dates and provisional status', () => {
  for (const period of ['monthly', 'weekly']) {
    const rows = period === 'monthly'
      ? [row('2026-09-30', '00123'), row('2026-10-14', 'coverage', 0)]
      : [row('2026-10-04', '00123'), row('2026-10-07', 'coverage', 0)]
    const result = report(rows, { period })
    const reopened = XLSX.read(XLSX.write(buildOverviewAttritionWorkbook(result, { period }), {
      bookType: 'xlsx', type: 'buffer',
    }), { type: 'buffer' })
    const details = XLSX.utils.sheet_to_json(reopened.Sheets['Rider Details'])
    assert.equal(details.length, 1)
    assert.equal(details[0]['Rider ID'], '00123')
    assert.equal(details[0]['Period Status'], 'In progress')
    assert.ok(details[0]['Previous Period'])
    assert.equal(details[0]['Comparison Through'], result.returnCheckThrough)
    const filters = Object.fromEntries(XLSX.utils.sheet_to_json(reopened.Sheets['Filters and Rule']).map((row) => [row.Setting, row.Value]))
    assert.equal(filters.Rule, result.rule)
    assert.match(filters.Counting, /previous period/)
  }
})
