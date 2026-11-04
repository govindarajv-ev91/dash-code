import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/overview-ev-zero-order',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
after(() => server.close())
const { buildOverviewEvZeroOrderSeries } = await server.ssrLoadModule('/src/lib/overviewEvZeroOrder.js')
const { buildOverviewEvZeroOrderReport, collectOverviewEvZeroOrderFilterOptions } = await server.ssrLoadModule('/src/lib/overviewEvZeroOrder.js')
const { buildOverviewEvZeroOrderWorkbook } = await server.ssrLoadModule('/src/lib/overviewEvZeroOrderExcelExport.js')
const XLSX = await import('xlsx')
const { buildFullDataMonthBaseAsync, fillZeroOrderIntoBaseAsync, materializeFullDataReport } =
  await server.ssrLoadModule('/src/lib/fullDataMonthReport.js')

test('daily overview matches Full Data across grace, prior-month orders, returns and live D-1', async () => {
  const overallRows = [
    { vehicleNumber: 'TN01', clientId: 'R1', statusDate: '2026-09-01', vehicleStatus: 'Deployed', clientName: 'Blinkit' },
    { vehicleNumber: 'TN02', clientId: 'R2', statusDate: '2026-09-30', vehicleStatus: 'Deployed', clientName: 'Amazon' },
    { vehicleNumber: 'TN03', clientId: 'R3', statusDate: '2026-09-01', vehicleStatus: 'Deployed', clientName: 'Zomato' },
    { vehicleNumber: 'TN01', clientId: 'R1', statusDate: '2026-10-05', vehicleStatus: 'Returned', clientName: 'Blinkit' },
  ].map((row) => ({ city: 'Chennai', ...row }))
  const currentRows = [{ vehicleNumber: 'TN02', clientRiderId: 'R2', currentStatus: 'Deployed',
    clientName: 'Amazon', city: 'Chennai', lastStatusDate: '2026-09-30' }]
  const orderRows = [{ worker_code: 'R1', date_record: '2026-09-30', delivered: 3 }]
  const asOfDate = new Date(2026, 9, 7)
  const series = await buildOverviewEvZeroOrderSeries({ overallRows, currentRows, orderRows,
    dateFrom: '2026-10-01', dateTo: '2026-10-09', asOfDate })
  const base = await buildFullDataMonthBaseAsync({ monthLabel: 'Oct-2026', overallRows, currentRows, orderRows })
  await fillZeroOrderIntoBaseAsync(base, { asOfDate })
  const fullData = materializeFullDataReport(base)
  assert.equal(series.length, 6, 'today and future days are excluded')
  for (const point of series) assert.equal(point.count, fullData.byDate[point.date].d1ZeroOrderRiderCount)
  assert.deepEqual(series.map((point) => point.count), [0, 0, 0, 2, 1, 1])
})

test('default shows 30 completed days and invalid/future ranges are empty', async () => {
  const asOfDate = new Date(2026, 9, 7)
  const series = await buildOverviewEvZeroOrderSeries({ asOfDate })
  assert.equal(series.length, 30)
  assert.equal(series.at(-1).date, '2026-10-06')
  assert.ok(series.every((point) => point.count === 0))
  assert.deepEqual(await buildOverviewEvZeroOrderSeries({ dateFrom: '2026-10-08', asOfDate }), [])
  assert.deepEqual(await buildOverviewEvZeroOrderSeries({ asOfDate, shouldCancel: () => true }), [])
})

test('city and multiple client selections combine without changing zero-order eligibility', async () => {
  const overallRows = [
    ['TN01', 'R1', 'Chennai', 'Blinkit'],
    ['TN02', 'R2', 'Chennai', 'Amazon'],
    ['TN03', 'R3', 'Bengaluru', 'Blinkit'],
    ['TN04', 'R4', 'Chennai', 'Zepto'],
  ].map(([vehicleNumber, clientId, city, clientName]) => ({
    vehicleNumber, clientId, city, clientName, statusDate: '2026-09-01', vehicleStatus: 'Deployed',
  }))
  const build = async (filters) => (await buildOverviewEvZeroOrderSeries({
    overallRows, dateFrom: '2026-10-01', dateTo: '2026-10-02',
    asOfDate: new Date(2026, 9, 7), ...filters,
  })).map((point) => point.count)
  assert.deepEqual(await build({}), [4, 4])
  assert.deepEqual(await build({ cityFilter: 'Chennai' }), [3, 3])
  assert.deepEqual(await build({ clientFilter: ['Blinkit'] }), [2, 2])
  assert.deepEqual(await build({ clientFilter: ['Blinkit', 'Amazon'] }), [3, 3])
  assert.deepEqual(await build({ cityFilter: 'Chennai', clientFilter: ['Blinkit', 'Amazon'] }), [2, 2])
  assert.deepEqual(await build({ cityFilter: 'Bengaluru', clientFilter: ['Amazon'] }), [0, 0])
  assert.deepEqual(await build({ clientFilter: [] }), [4, 4])
})

test('client aliases collapse and filtered export details reconcile each daily graph count', async () => {
  const overallRows = ['BB', 'BB Now', 'Bigbasket', 'Blinket', 'blinket', 'Blinkit', 'OTHER', 'other']
    .map((clientName, index) => ({ clientName, city: index === 2 ? 'Bengaluru' : 'Chennai',
      vehicleNumber: `TN${index}`, clientId: `R${index}`, riderName: `Rider ${index}`,
      statusDate: '2026-09-01', vehicleStatus: 'Deployed' }))
  const options = collectOverviewEvZeroOrderFilterOptions([], overallRows, [])
  assert.deepEqual(options.clients, ['BB', 'Blinkit', 'Other'])
  const report = await buildOverviewEvZeroOrderReport({ overallRows,
    dateFrom: '2026-10-01', dateTo: '2026-10-02', asOfDate: new Date(2026, 9, 7),
    cityFilter: 'Chennai', clientFilter: ['BB', 'Blinkit'],
  })
  assert.deepEqual(report.series.map((point) => point.count), [5, 5])
  const workbook = buildOverviewEvZeroOrderWorkbook(report, { cityFilter: 'Chennai', clientFilter: ['BB', 'Blinkit'] })
  const saved = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
  const details = XLSX.utils.sheet_to_json(saved.Sheets['Rider Details'])
  const summary = XLSX.utils.sheet_to_json(saved.Sheets['Daily Summary'])
  assert.equal(details.length, 10)
  assert.ok(details.every((row) => row.City === 'Chennai' && ['BB', 'Blinkit'].includes(row.Client)))
  for (const day of summary) assert.equal(details.filter((row) => row.Date === day.Date).length, day['D-1 0 order rider count'])
  assert.deepEqual(new Set(details.map((row) => row['Worker Code'])), new Set(['R0', 'R1', 'R3', 'R4', 'R5']))
})
