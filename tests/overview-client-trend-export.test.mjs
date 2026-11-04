import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'

const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/overview-client-trend-export',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const { buildOverviewClientTrendWorkbook } = await server.ssrLoadModule('/src/lib/overviewClientTrendExcelExport.js')
const { buildClientPeriodLineSeries } = await server.ssrLoadModule('/src/lib/paymentHistoryReport.js')
after(() => server.close())

const order = (date, rider, delivered, overrides = {}) => ({
  id: `ou-${rider}`, date_record: date, worker_code: rider, delivered,
  client: 'Alpha', city: 'Chennai', type1: 'EV', ...overrides,
})
const read = (workbook, name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' })
const settings = (workbook) => Object.fromEntries(read(workbook, 'Filters and Totals').map((row) => [row.Setting, row.Value]))
const reopened = (rows, options) => XLSX.read(XLSX.write(buildOverviewClientTrendWorkbook(rows, options), {
  type: 'buffer', bookType: 'xlsx', compression: true,
}), { type: 'buffer' })

function assertTypeTotals(workbook) {
  const summary = read(workbook, 'Chart Summary')
  const analysis = read(workbook, 'City Client Type')
  for (const point of summary) {
    assert.equal(point['EV Riders'] + point['Non-EV Riders'], point['Total Riders'])
    assert.equal(point['EV Orders'] + point['Non-EV Orders'], point['Total Orders'])
    for (const [type, riderColumn, orderColumn] of [
      ['Total', 'Total Riders', 'Total Orders'], ['EV', 'EV Riders', 'EV Orders'], ['Non-EV', 'Non-EV Riders', 'Non-EV Orders'],
    ]) {
      const groups = analysis.filter((row) => row['Period Start'] === point['Period Start'] && row.Type === type)
      assert.equal(groups.reduce((sum, row) => sum + row['Rider Count'], 0), point[riderColumn])
      assert.equal(groups.reduce((sum, row) => sum + row.Orders, 0), point[orderColumn])
    }
  }
  for (const [sheet, countColumn, orderColumn] of [
    ['City Client Type', 'Rider Count', 'Orders'], ['Lifetime Ranking', 'Lifetime Unique Riders', 'Lifetime Orders'],
  ]) {
    const rows = read(workbook, sheet)
    for (const total of rows.filter((row) => row.Type === 'Total')) {
      const parts = rows.filter((row) => row.Type !== 'Total' && row.City === total.City
        && row.Client === total.Client && row['Period Start'] === total['Period Start'])
      assert.equal(parts.reduce((sum, row) => sum + row[countColumn], 0), total[countColumn],
        `${sheet}: ${total['Period Start'] || 'lifetime'} ${total.City}/${total.Client} riders`)
      assert.equal(parts.reduce((sum, row) => sum + row[orderColumn], 0), total[orderColumn],
        `${sheet}: ${total['Period Start'] || 'lifetime'} ${total.City}/${total.Client} orders`)
    }
  }
}

test('monthly export keeps all nine months, text IDs, zero-order records and unique overall riders', () => {
  const rows = Array.from({ length: 11 }, (_, index) => order(`2026-${String(index + 1).padStart(2, '0')}-01`, '00123', 10))
  rows.push(order('2026-11-20', '00009', 0, { type1: 'NON-EV' }))
  rows.push(order('invalid', 'bad-date', 9999))
  const before = structuredClone(rows)
  const workbook = reopened(rows)
  assert.deepEqual(workbook.SheetNames, ['Chart Summary', 'City Client Type', 'Lifetime Ranking', 'Raw Data', 'Filters and Totals'])
  const raw = read(workbook, 'Raw Data')
  const summary = read(workbook, 'Chart Summary')
  assert.equal(raw.length, 10)
  assert.equal(raw[0].Date, '2026-03-01')
  assert.equal(raw[0]['Rider ID'], '00123')
  assert.equal(workbook.Sheets['Raw Data'].C2.t, 's')
  assert.equal(workbook.Sheets['Raw Data'].I2.t, 'n')
  assert.equal(raw.at(-1).Orders, 0)
  assert.equal(summary.length, 9)
  assert.equal(summary.at(-1)['Total Riders'], 2)
  assert.equal(summary.at(-1)['Non-EV Riders'], 1)
  assert.equal(summary.reduce((sum, row) => sum + row['Total Orders'], 0), 90)
  assert.equal(raw.reduce((sum, row) => sum + row.Orders, 0), 90)
  assert.equal(settings(workbook)['Total Riders'], 2, 'not the sum of monthly riders')
  assert.equal(settings(workbook)['From Date'], '2026-03-01')
  assert.deepEqual(rows, before)
  assert.equal(buildClientPeriodLineSeries(rows).exportData, undefined, 'normal chart does not retain export details')
})

test('weekly export respects clipped date ranges, client and city aliases, and both metrics', () => {
  const rows = [
    order('2026-10-11', 'outside-before', 999),
    order('13/10/2026', 'r1', 10, { city: 'Bangalore' }),
    order('2026-10-14', 'R1', 20, { city: 'Bengaluru' }),
    order('2026-10-19', 'r2', 0, { city: 'Bangalore', type1: 'NON-EV' }),
    order('2026-10-20', 'outside-after', 999, { city: 'Bengaluru' }),
    order('2026-10-14', 'wrong-city', 999),
    order('2026-10-14', 'wrong-client', 999, { city: 'Bengaluru', client: 'Beta' }),
  ]
  const options = { client: 'Alpha', city: 'Bengaluru', period: 'weekly', metric: 'orders', dateFrom: '2026-10-13', dateTo: '2026-10-19' }
  const workbook = reopened(rows, options)
  const raw = read(workbook, 'Raw Data')
  assert.deepEqual(raw.map((row) => row['Rider ID']), ['r1', 'R1', 'r2'])
  assert.equal(raw[0].City, 'Bangalore')
  assert.equal(raw[0]['Chart City'], 'Bengaluru')
  const summary = read(workbook, 'Chart Summary')
  assert.deepEqual(summary.map((row) => row['Period Start']), ['2026-10-12', '2026-10-19'])
  assert.deepEqual(summary.map((row) => row['Total Riders']), [1, 1])
  assert.deepEqual(summary.map((row) => row['Total Orders']), [30, 0])
  assert.equal(settings(workbook)['Selected Chart Metric'], 'Order count')
  assert.equal(settings(workbook)['Total Riders'], 2)
})

test('daily export separates preceding context orders while exactly explaining four-day rider counts', () => {
  const rows = [
    order('2026-10-06', 'too-old', 999), order('2026-10-07', 'r1', 5),
    order('2026-10-08', 'r2', 6, { type1: 'NON-EV' }),
    order('2026-10-09', 'zero-orders', 0), order('2026-10-10', 'r1', 10),
    order('2026-10-11', 'r3', 20), order('2026-10-12', 'too-new', 999),
  ]
  const options = { period: 'daily', dateFrom: '2026-10-10', dateTo: '2026-10-11' }
  const workbook = reopened(rows, options)
  const raw = read(workbook, 'Raw Data')
  const context = read(workbook, 'Daily Rider Context')
  assert.deepEqual(raw.map((row) => row['Rider ID']), ['r1', 'r3'])
  assert.deepEqual(context.map((row) => row['Rider ID']), ['r1', 'r2', 'zero-orders'])
  assert.equal(settings(workbook)['Total Orders'], 30)
  assert.equal(settings(workbook)['Total Riders'], 3)
  const summary = read(workbook, 'Chart Summary')
  assert.deepEqual(summary.map((row) => row['Total Riders']), [2, 3])
  assert.deepEqual(summary.map((row) => row['Non-EV Riders']), [1, 1])
  assert.equal(raw.reduce((sum, row) => sum + row.Orders, 0), 30)
  assert.equal(context.reduce((sum, row) => sum + row.Orders, 0), 11)
  const chart = buildClientPeriodLineSeries(rows, options)
  for (const [index, point] of chart.series.entries()) {
    assert.equal(summary[index]['Total Orders'], point.orders)
    assert.equal(summary[index]['Total Riders'], point.riders)
  }
})

test('exports more than a fetch page and worksheet chunk without truncation', () => {
  const rows = Array.from({ length: 12003 }, (_, index) => order('2026-10-01', String(index).padStart(8, '0'), 1))
  const workbook = reopened(rows)
  const raw = read(workbook, 'Raw Data')
  assert.equal(raw.length, rows.length)
  assert.equal(raw.at(-1)['Rider ID'], '00012002')
  assert.equal(new Set(raw.map((row) => row['Rider ID'])).size, rows.length)
  assert.equal(read(workbook, 'Chart Summary')[0]['Total Orders'], rows.length)
  assert.equal(read(workbook, 'Chart Summary')[0]['Total Riders'], rows.length)
  assert.equal(read(workbook, 'City Client Type').find((row) => row.Type === 'Total')['Rider Count'], rows.length)
  assert.equal(read(workbook, 'Lifetime Ranking').find((row) => row.Type === 'Total')['Lifetime Unique Riders'], rows.length)
})

test('empty filter combinations produce headers and explicit zero totals', () => {
  for (const rows of [[], [order('2026-10-01', '00123', 10)]]) {
    const workbook = reopened(rows, { client: 'Missing' })
    assert.deepEqual(read(workbook, 'Raw Data'), [])
    assert.deepEqual(read(workbook, 'Chart Summary'), [])
    assert.deepEqual(read(workbook, 'City Client Type'), [])
    assert.deepEqual(read(workbook, 'Lifetime Ranking'), [])
    assert.equal(settings(workbook)['Total Orders'], 0)
    assert.equal(settings(workbook)['Total Riders'], 0)
  }
})

test('city/client/type period rows reconcile orders and deduplicate riders across EV types', () => {
  const rows = [
    order('2026-10-12', 'r1', 10, { city: 'Bangalore' }),
    order('2026-10-13', ' R1 ', 20, { city: 'Bengaluru', type1: 'NON-EV' }),
    order('2026-10-14', 'r2', 0, { city: 'Bangalore' }),
    order('2026-10-14', 'r3', 5, { client: 'Beta' }),
    order('2026-10-19', 'r1', 8, { city: 'Bengaluru' }),
  ]
  for (const period of ['monthly', 'weekly']) {
    const workbook = reopened(rows, { period })
    assertTypeTotals(workbook)
    const analysis = read(workbook, 'City Client Type')
    const summary = read(workbook, 'Chart Summary')
    for (const point of summary) {
      for (const [type, column] of [['Total', 'Total Orders'], ['EV', 'EV Orders'], ['Non-EV', 'Non-EV Orders']]) {
        assert.equal(analysis.filter((row) => row['Period Start'] === point['Period Start'] && row.Type === type)
          .reduce((sum, row) => sum + row.Orders, 0), point[column])
      }
    }
    const alpha = analysis.filter((row) => row.Client === 'Alpha')
    assert.ok(alpha.every((row) => row.City === 'Bengaluru'))
    assert.equal(alpha[0]['Rider Count'], 2)
    assert.equal(alpha.find((row) => row.Type === 'EV')['Rider Count'], period === 'monthly' ? 2 : 1)
    assert.equal(alpha.find((row) => row.Type === 'Non-EV')['Rider Count'], period === 'monthly' ? 0 : 1)
    assert.equal(alpha[0]['Records in Period'], period === 'monthly' ? 4 : 3)
  }
})

test('daily city/client rows include rolling activity with no current records and do not duplicate prior orders', () => {
  const rows = [
    order('2026-10-07', 'r1', 5), order('2026-10-09', 'zero', 0),
    order('2026-10-08', 'r2', 6, { city: 'Bengaluru', client: 'Beta', type1: 'NON-EV' }),
    order('2026-10-10', 'r1', 10),
    order('2026-10-11', 'R1', 20, { city: 'Bengaluru', client: 'Beta' }),
    order('2026-10-11', 'zero-2', 0, { city: 'Bengaluru', client: 'Beta', type1: 'NON-EV' }),
  ]
  const workbook = reopened(rows, { period: 'daily', dateFrom: '2026-10-10', dateTo: '2026-10-11' })
  assertTypeTotals(workbook)
  const analysis = read(workbook, 'City Client Type')
  const betaFirst = analysis.find((row) => row['Period Start'] === '2026-10-10' && row.Client === 'Beta' && row.Type === 'Non-EV')
  assert.equal(betaFirst['Rider Count'], 1)
  assert.equal(betaFirst.Orders, 0)
  assert.equal(betaFirst['Records in Period'], 0)
  const latest = analysis.filter((row) => row['Period Start'] === '2026-10-11' && row.Type === 'Total')
  const alpha = latest.find((row) => row.Client === 'Alpha')
  const beta = latest.find((row) => row.Client === 'Beta')
  assert.equal(alpha['Rider Count'], 0)
  assert.equal(beta['Rider Count'], 2)
  assert.equal(beta['Rider Rank High'], 1)
  assert.equal(alpha['Rider Rank Low'], 1)
  assert.equal(read(workbook, 'Chart Summary').at(-1)['Total Riders'], 2, 'a rider across clients is still unique in the chart total')
  for (const summary of read(workbook, 'Chart Summary')) {
    assert.equal(analysis.filter((row) => row['Period Start'] === summary['Period Start'] && row.Type === 'Total')
      .reduce((sum, row) => sum + row.Orders, 0), summary['Total Orders'])
  }
  assert.equal(analysis.find((row) => row['Period Start'] === '2026-10-11' && row.Client === 'Beta' && row.Type === 'Non-EV')['Rider Count'], 1)
})

test('lifetime includes history outside chart dates while keeping client/city filters and unique rider totals', () => {
  const rows = [
    order('2025-11-01', '00123', 40), order('2026-01-01', '00123', 10),
    order('2026-10-01', '00123', 0),
    order('2026-10-01', '00999', 20, { city: 'Bengaluru' }),
    order('2025-10-01', 'other-client', 9999, { client: 'Beta' }),
  ]
  for (const dates of [{}, { dateFrom: '2026-10-01', dateTo: '2026-10-01' }]) {
    const workbook = reopened(rows, { ...dates, client: 'Alpha', city: 'Chennai' })
    assert.equal(read(workbook, 'Raw Data').length, 1)
    const lifetime = read(workbook, 'Lifetime Ranking')
    assert.equal(lifetime.length, 2, 'only Total and observed EV for this city/client')
    const total = lifetime.find((row) => row.Type === 'Total')
    assert.equal(total['Lifetime Unique Riders'], 1)
    assert.equal(total['Lifetime Orders'], 50)
    assert.equal(total['First Record Date'], '2025-11-01')
    assert.equal(total['Last Record Date'], '2026-10-01')
    assert.equal(total['Periods in Analysis'], 3, 'missing months do not manufacture zero activity')
    assert.equal(total['Peak Orders'], 40)
    assert.equal(total['Peak Order Period Start'], '2025-11-01')
    assert.equal(total['Lowest Orders'], 0)
    assert.equal(total['Lowest Order Period Start'], '2026-10-01')
    assert.equal(settings(workbook)['Lifetime From Date'], '2025-11-01')
    assert.equal(settings(workbook)['Lifetime Through Date'], '2026-10-01')
  }
})

test('top and bottom ranks compare within type, preserve ties, and keep recorded zero results', () => {
  const rows = [
    order('2026-10-01', 'a1', 10, { client: 'Alpha' }),
    order('2026-10-01', 'b1', 10, { client: 'Beta' }),
    order('2026-10-01', 'c1', 0, { client: 'Gamma' }),
    order('2026-10-01', 'n1', 100, { client: 'Non-EV Only', type1: 'NON-EV' }),
  ]
  const workbook = reopened(rows, { period: 'daily' })
  for (const name of ['City Client Type', 'Lifetime Ranking']) {
    const ev = read(workbook, name).filter((row) => row.Type === 'EV')
    const alpha = ev.find((row) => row.Client === 'Alpha')
    const beta = ev.find((row) => row.Client === 'Beta')
    const gamma = ev.find((row) => row.Client === 'Gamma')
    assert.equal(alpha['Order Rank High'], 1)
    assert.equal(beta['Order Rank High'], 1)
    assert.equal(gamma['Order Rank High'], 2)
    assert.equal(gamma['Order Rank Low'], 1)
    assert.equal(alpha['Order Rank Low'], 2)
    assert.equal(ev.length, 3)
    if (name === 'City Client Type') {
      assert.equal(gamma['Rider Count'], 0)
      assert.equal(gamma['Rider Rank Low'], 1)
    } else assert.ok(ev.every((row) => row['Rider Rank High'] === 1), 'lifetime unique riders include zero-order records')
  }
})

test('lifetime peaks and lows use the chosen period and deterministic earliest dates for ties', () => {
  const rows = [
    order('2026-10-12', 'r1', 5), order('2026-10-13', 'r2', 5), order('2026-10-14', 'r2', 0),
    order('2026-11-02', 'r1', 10),
  ]
  for (const period of ['daily', 'weekly', 'monthly']) {
    const workbook = reopened([...rows].reverse(), { period, dateFrom: '2026-11-02', dateTo: '2026-11-02' })
    const total = read(workbook, 'Lifetime Ranking').find((row) => row.Type === 'Total')
    assert.equal(total['Lifetime Unique Riders'], 2)
    assert.equal(total['Lifetime Orders'], 20)
    assert.equal(total['Peak Rider Count'], 2)
    assert.equal(total['Peak Rider Period Start'], period === 'daily' ? '2026-10-13' : period === 'weekly' ? '2026-10-12' : '2026-10-01')
    assert.equal(total['Lowest Rider Count'], 1)
    assert.equal(total['Lowest Rider Period Start'], period === 'daily' ? '2026-10-12' : period === 'weekly' ? '2026-11-02' : '2026-11-01')
    assert.equal(total['Peak Orders'], 10)
    assert.equal(total['Peak Order Period Start'], period === 'daily' ? '2026-11-02' : period === 'weekly' ? '2026-10-12' : '2026-10-01')
    assert.equal(total['Lowest Orders'], period === 'daily' ? 0 : 10)
    assert.equal(total['Lowest Order Period Start'], period === 'daily' ? '2026-10-14' : period === 'weekly' ? '2026-10-12' : '2026-10-01')
  }
})

const julyTypeChanges = () => [
  order('2026-07-14', 'expired', 40),
  order('2026-07-15', 'switch', 2),
  order('2026-07-16', 'stable-non', 4, { type1: 'NON-EV' }),
  order('2026-07-16', 'mover', 5),
  order('2026-07-17', ' SWITCH ', 6, { type1: 'NON-EV' }),
  order('2026-07-18', 'mover', 7, { client: 'Beta', city: 'Bengaluru', type1: 'NON-EV' }),
  order('2026-07-18', 'same-day-tie', 8),
  order('2026-07-18', 'same-day-tie', 8, { type1: 'NON-EV' }),
  order('2026-07-18', 'larger-record', 9, { type1: 'NON-EV' }),
  order('2026-07-18', 'larger-record', 1),
  order('2026-07-18', 'zero-only', 0),
  order('2026-07-18', '', 3),
  order('2026-07-19', 'switch', 99),
]

test('18 July EV and Non-EV splits equal Total after type changes and moves within four active days', () => {
  const rows = julyTypeChanges()
  const options = { period: 'daily', dateFrom: '2026-07-18', dateTo: '2026-07-18' }
  const workbook = reopened(rows, options)
  assertTypeTotals(workbook)
  const [point] = read(workbook, 'Chart Summary')
  assert.deepEqual([point['EV Riders'], point['Non-EV Riders'], point['Total Riders']], [1, 4, 5])
  assert.deepEqual([point['EV Orders'], point['Non-EV Orders'], point['Total Orders']], [12, 24, 36])
  assert.equal(settings(workbook)['Total Riders'], 5)
  assert.equal(settings(workbook)['Total Orders'], 36)
  const grouped = read(workbook, 'City Client Type')
  assert.deepEqual(grouped.filter((row) => row.Client === 'Alpha').map((row) => [row.Type, row['Rider Count']]),
    [['Total', 4], ['EV', 1], ['Non-EV', 3]])
  assert.deepEqual(grouped.filter((row) => row.Client === 'Beta').map((row) => [row.Type, row['Rider Count']]),
    [['Total', 1], ['Non-EV', 1]])
  const raw = read(workbook, 'Raw Data')
  assert.equal(raw.reduce((sum, row) => sum + row.Orders, 0), 36)
  const context = read(workbook, 'Daily Rider Context')
  assert.equal(context.length, 4, 'July 14 is outside the four-day active window and July 19 is in the future')
  assert.equal(context.reduce((sum, row) => sum + row.Orders, 0), 17)
  assert.deepEqual(raw.filter((row) => row['Rider ID'] === 'same-day-tie').map((row) => row['EV / Non-EV']), ['EV', 'Non-EV'],
    'rider assignment must not rewrite the source order classifications')
  const chart = buildClientPeriodLineSeries(rows, options).series[0]
  assert.deepEqual([chart.evRiders, chart.nonEvRiders, chart.riders], [1, 4, 5])
})

test('type assignment stays consistent across daily, weekly, monthly and lifetime counts, regardless of input order', () => {
  const rows = julyTypeChanges()
  for (const period of ['daily', 'weekly', 'monthly']) {
    const options = { period, dateFrom: '2026-07-15', dateTo: '2026-07-18' }
    const workbook = reopened(rows, options)
    const reversed = reopened([...rows].reverse(), options)
    assertTypeTotals(workbook)
    assertTypeTotals(reversed)
    for (const name of ['Chart Summary', 'City Client Type', 'Lifetime Ranking']) {
      assert.deepEqual(read(reversed, name), read(workbook, name), `${period}: ${name} ignores source ordering`)
    }
    const point = read(workbook, 'Chart Summary').at(-1)
    assert.deepEqual([point['EV Riders'], point['Non-EV Riders'], point['Total Riders']],
      period === 'daily' ? [1, 4, 5] : [2, 4, 6], 'weekly/monthly retain riders with zero-order records')
    const lifetime = read(workbook, 'Lifetime Ranking')
    const sum = (type) => lifetime.filter((row) => row.Type === type).reduce((total, row) => total + row['Lifetime Unique Riders'], 0)
    assert.deepEqual([sum('EV'), sum('Non-EV'), sum('Total')], [4, 3, 7],
      'lifetime uses latest loaded history, including July 19, and counts each rider once')
  }
})

test('city/client filters are applied before choosing a rider type and selected dates cannot use future records', () => {
  const rows = julyTypeChanges()
  const options = { period: 'daily', dateFrom: '2026-07-18', dateTo: '2026-07-18' }
  const alpha = reopened(rows, { ...options, client: 'Alpha', city: 'Chennai' })
  assertTypeTotals(alpha)
  const [alphaPoint] = read(alpha, 'Chart Summary')
  assert.deepEqual([alphaPoint['EV Riders'], alphaPoint['Non-EV Riders'], alphaPoint['Total Riders']], [2, 3, 5],
    'mover is still EV in the selected Alpha activity; switch remains Non-EV until July 19')
  assert.equal(alphaPoint['Total Orders'], 29)
  const beta = reopened(rows, { ...options, client: 'Beta', city: 'Bengaluru' })
  assertTypeTotals(beta)
  const [betaPoint] = read(beta, 'Chart Summary')
  assert.deepEqual([betaPoint['EV Riders'], betaPoint['Non-EV Riders'], betaPoint['Total Riders']], [0, 1, 1])
  assert.equal(betaPoint['Total Orders'], 7)
})

test('same-day city/client ties keep a single group and type while retaining orders in their original groups', () => {
  const rows = [
    order('2026-07-18', 'city-tie', 10, { city: 'Chennai', type1: 'NON-EV' }),
    order('2026-07-18', 'city-tie', 10, { city: 'Bengaluru' }),
    order('2026-07-18', 'client-tie', 20, { client: 'Beta' }),
    order('2026-07-18', 'client-tie', 20, { client: 'Alpha', type1: 'NON-EV' }),
  ]
  for (const period of ['daily', 'weekly', 'monthly']) {
    const workbook = reopened(rows, { period })
    assertTypeTotals(workbook)
    const grouped = read(workbook, 'City Client Type')
    const count = (city, client, type) => grouped.find((row) => row.City === city && row.Client === client && row.Type === type)?.['Rider Count'] || 0
    assert.equal(count('Bengaluru', 'Alpha', 'EV'), 1)
    assert.equal(count('Chennai', 'Alpha', 'Non-EV'), 1)
    assert.equal(count('Chennai', 'Beta', 'Total'), 0)
    assert.equal(grouped.find((row) => row.City === 'Chennai' && row.Client === 'Beta' && row.Type === 'EV').Orders, 20)
    const reversed = reopened([...rows].reverse(), { period })
    assert.deepEqual(read(reversed, 'City Client Type'), grouped)
  }
})
