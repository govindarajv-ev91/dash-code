import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/dashboard-overview',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'overview-test-environment', enforce: 'pre',
    resolveId(source) {
      if (['overview-test-api', 'overview-test-charts', 'overview-test-motion'].includes(source)) return `\0${source}`
    },
    load(id) {
      if (id === '\0overview-test-api') return `
        export const fetchAllEv91MisData = async () => ({ data: [] });
        export const summarizeCurrentStatusRows = () => ({});
        export const currentStatusDistributionSeries = () => [];
        export const countOverallDeployReturnInRange = () => ({ deployed: 0, returned: 0 });
        export const fetchEv91OverallStatusAll = async () => ({ data: [] });
        export const fetchRiderPaymentsForRevenue = async () => [];
        export const fetchIotDataInRange = async () => [];
      `
      // jsdom has no layout. Supply dimensions while using the real Recharts
      // axes and lines, so a disconnected axis still fails these render tests.
      if (id === '\0overview-test-charts') return `
        import React from 'react';
        import { Line, Bar } from 'recharts';
        export * from 'recharts';
        export function ResponsiveContainer({ children }) {
          const elements = React.Children.map(children.props.children, child =>
            child?.type === Line || child?.type === Bar
              ? React.cloneElement(child, { isAnimationActive: false }) : child);
          return React.cloneElement(children, { width: 900, height: 300 }, elements);
        }
      `
      if (id === '\0overview-test-motion') return `
        import React from 'react';
        export const motion = { div: ({ initial, animate, ...props }) => React.createElement('div', props) };
      `
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return "export const supabase = { from() { throw new Error('Unexpected overview database request') } }"
      }
      if (!id.replaceAll('\\', '/').endsWith('/src/Dashboard.jsx')) return
      return code.replace("from 'recharts'", "from 'overview-test-charts'")
        .replace("from 'framer-motion'", "from 'overview-test-motion'")
        .replace(/from '\.\/lib\/(ev91MisApi|ev91EvLookup|riderPaymentDb|iotDataDb)'/g, "from 'overview-test-api'")
    },
  }],
})
const { buildClientPeriodLineSeries } = await server.ssrLoadModule('/src/lib/paymentHistoryReport.js')
const { mergeRiderMetricSources } = await server.ssrLoadModule('/src/lib/mergeRiderMetrics.js')
const { default: Dashboard } = await server.ssrLoadModule('/src/Dashboard.jsx')
const { default: RiderAttritionTooltip } = await server.ssrLoadModule('/src/components/RiderAttritionTooltip.jsx')
after(async () => {
  await server.close()
  dom.window.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event',
    'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[name]
})

const order = (date, rider, delivered, overrides = {}) => ({
  date_record: date, worker_code: rider, delivered, client: 'Alpha', city: 'Chennai',
  type1: 'EV', _data_source: 'order_upload', ...overrides,
})

test('the default trend includes exactly nine calendar months, including the first day', () => {
  const rows = Array.from({ length: 11 }, (_, index) =>
    order(`2026-${String(index + 1).padStart(2, '0')}-01`, `r${index}`, 10))
  rows.push(order('2026-11-20', 'latest', 5))
  const report = buildClientPeriodLineSeries(rows)
  assert.equal(report.series.length, 9)
  assert.equal(report.series[0].period, 'Mar 2026')
  assert.equal(report.series.at(-1).period, 'Nov 2026')
  assert.equal(report.totals.orders, 95)
})

test('client and city selections preserve the common nine-month window and available options', () => {
  const rows = [
    order('2026-01-01', 'old', 100),
    order('2026-02-01', 'r1', 10),
    order('2026-10-13', 'r2', 20, { client: 'Beta', city: 'Bengaluru' }),
  ]
  const report = buildClientPeriodLineSeries(rows, { client: 'Alpha', city: 'Chennai' })
  assert.deepEqual(report.series.map((point) => point.period), ['Feb 2026'])
  assert.equal(report.totals.orders, 10)
  const empty = buildClientPeriodLineSeries(rows, { client: 'Alpha', city: 'Bengaluru' })
  assert.deepEqual(empty.series, [])
  assert.deepEqual(empty.clients, [{ name: 'Alpha' }, { name: 'Beta' }])
  assert.deepEqual(empty.cities, [{ name: 'Bengaluru' }, { name: 'Chennai' }])
})

test('daily riders use preceding days at the range boundary without including their orders', () => {
  const rows = [
    order('2026-10-06', 'too-old', 100),
    order('2026-10-07', 'r1', 5),
    order('2026-10-08', 'r2', 6, { type1: 'NON-EV' }),
    order('2026-10-09', 'zero-orders', 0),
    order('2026-10-10', 'r1', 10),
    order('2026-10-11', 'r3', 20),
    order('2026-10-12', 'outside', 200),
  ]
  const report = buildClientPeriodLineSeries(rows, { dateFrom: '2026-10-10', dateTo: '2026-10-11', period: 'daily' })
  assert.deepEqual(report.series.map(({ orders, riders, evRiders, nonEvRiders }) =>
    ({ orders, riders, evRiders, nonEvRiders })), [
    { orders: 10, riders: 2, evRiders: 1, nonEvRiders: 1 },
    { orders: 20, riders: 3, evRiders: 2, nonEvRiders: 1 },
  ])
  assert.deepEqual(report.totals, { orders: 30, riders: 3 })
})

test('monthly and weekly totals deduplicate riders and accept legacy upload dates', () => {
  const rows = [
    order('12/10/2026', ' r1 ', 10),
    order('13-10-2026', 'R1', 20),
    order('2026-10-14', 'r2', 5, { type1: 'NON-EV' }),
    order('2026-10-15', 'inactive', 0),
    order('invalid', 'invalid-date', 999),
  ]
  for (const period of ['monthly', 'weekly']) {
    const report = buildClientPeriodLineSeries(rows, { period })
    assert.equal(report.series.length, 1)
    assert.deepEqual(report.totals, { orders: 35, riders: 3 })
    assert.equal(report.series[0].evOrders, 30)
    assert.equal(report.series[0].nonEvOrders, 5)
    assert.equal(report.series[0].evRiders, 2)
    assert.equal(report.series[0].nonEvRiders, 1)
  }
})

test('monthly unique riders include the 201 zero-order riders while daily counts remain active riders', () => {
  const rows = Array.from({ length: 3807 }, (_, index) =>
    order('2026-09-30', `r${index}`, index < 3606 ? 1 : 0))
  rows.push(order('2026-09-15', 'R0', 0), order('2026-09-30', 'r0', 5))
  const monthly = buildClientPeriodLineSeries(rows, { period: 'monthly' })
  assert.equal(monthly.series[0].riders, 3807)
  assert.equal(monthly.totals.riders, 3807)
  const daily = buildClientPeriodLineSeries(rows, { period: 'daily' })
  assert.equal(daily.series.at(-1).riders, 3606)
  assert.equal(daily.totals.riders, 3606)
  assert.equal(monthly.totals.orders, daily.totals.orders)
})

test('a rider counts once in each month even when they have only zero-order uploads', () => {
  const rows = [
    order('2026-09-01', 'r1', 0), order('2026-09-30', 'R1', 0),
    order('2026-10-01', 'r1', 0), order('2026-10-02', 'r2', 0),
  ]
  const report = buildClientPeriodLineSeries(rows)
  assert.deepEqual(report.series.map(({ period, riders }) => ({ period, riders })), [
    { period: 'Sep 2026', riders: 1 }, { period: 'Oct 2026', riders: 2 },
  ])
  assert.equal(report.totals.riders, 2, 'the overall total deduplicates across months')
})

test('daily context also crosses the default nine-month boundary and year boundary', () => {
  const report = buildClientPeriodLineSeries([
    order('2025-12-30', 'r1', 100),
    order('2026-01-01', 'r2', 10),
    order('2026-09-13', 'r3', 20),
  ], { period: 'daily' })
  assert.equal(report.series[0].period, '01 Jan')
  assert.equal(report.series[0].riders, 2)
  assert.equal(report.totals.orders, 30)
})

function mount(t) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const errors = []
  const root = createRoot(container, { onUncaughtError: (error) => errors.push(error) })
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  return { container, root, errors }
}
function card(container, title) {
  return [...container.querySelectorAll('h3,h4')].find((heading) => heading.textContent.startsWith(title)).parentElement
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
  }
  assert.ok(predicate(), 'Chart did not render its data')
}

test('Orders Performance renders visible points for a single uploaded day', async (t) => {
  const { container, root, errors } = mount(t)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [
    order('2026-10-13', 'r1', 10), order('2026-10-13', 'r2', 20, { type1: 'NON-EV' }),
    order('2026-10-13', 'mirror', 9999, { _data_source: 'rider_metrics' }),
  ] })))
  const orders = card(container, 'Orders Performance')
  await waitFor(() => orders.querySelectorAll('.recharts-line-dots .recharts-dot').length === 3)
  assert.ok([...container.querySelectorAll('.stat-card')].some((stat) => stat.textContent.includes('Total Orders30')))
  assert.deepEqual(errors, [])
})

test('both overview charts include ISO uploads after the 4 May format change', async (t) => {
  const { container, root, errors } = mount(t)
  const riderData = mergeRiderMetricSources([], [
    order('04-05-2026', 'r1', 10),
    order('2026-05-05', 'r2', 20, { type1: 'NON-EV' }),
    order('2026-06-01', 'r3', 30),
  ])
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData })))
  const orders = card(container, 'Orders Performance')
  const trend = card(container, 'Client-wise · Last 9 months').closest('.glass')
  await waitFor(() => orders.querySelectorAll('.recharts-line-curve').length === 3 &&
    trend.querySelectorAll('.recharts-line-curve').length === 3)
  assert.match(orders.textContent, /2026-05-05/)
  assert.match(orders.textContent, /2026-06-01/)
  assert.match(trend.textContent, /May 2026/)
  assert.match(trend.textContent, /Jun 2026/)
  assert.ok([...container.querySelectorAll('.stat-card')].some((stat) => stat.textContent.includes('Total Orders60')))
  assert.deepEqual(errors, [])
})

test('the client trend renders real EV, Non-EV and Total lines and updates its filters', async (t) => {
  const { container, root, errors } = mount(t)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [
    order('2026-09-01', 'r1', 10), order('2026-10-01', 'r2', 20, { type1: 'NON-EV' }),
    order('2026-09-02', 'r3', 30, { client: 'Beta', city: 'Bengaluru' }),
  ] })))
  const trend = card(container, 'Client-wise · Last 9 months').closest('.glass')
  await waitFor(() => trend.querySelectorAll('.recharts-line-curve').length === 3)
  const metric = trend.querySelector('input[value="orders"]')
  await act(async () => metric.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  assert.equal(metric.checked, true)
  assert.match(trend.textContent, /Orders 60/)
  const [client, city] = trend.querySelectorAll('select')
  await act(async () => { client.value = 'Alpha'; client.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(trend.textContent, /Orders 30/)
  await act(async () => { city.value = 'Bengaluru'; city.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(trend.textContent, /No Order Upload data available for the selected filters/)
  assert.equal(client.value, 'Alpha')
  assert.equal(city.value, 'Bengaluru')
  await act(async () => { city.value = 'All'; city.dispatchEvent(new Event('change', { bubbles: true })) })
  await waitFor(() => trend.querySelectorAll('.recharts-line-curve').length === 3)
  assert.deepEqual(errors, [])
})

test('empty Orders Performance shows a useful message instead of an empty chart', async (t) => {
  const { container, root, errors } = mount(t)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [] })))
  assert.match(card(container, 'Orders Performance').textContent, /No orders available for the selected dates/)
  assert.deepEqual(errors, [])
})

test('Rider Attrition renders EV, Non-EV and Total lines with independent client, city and period controls', async (t) => {
  const { container, root, errors } = mount(t)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [
    order('2026-09-29', 'r1', 10),
    order('2026-09-30', 'r2', 10, { type1: 'NON-EV', client: 'Beta', city: 'Bengaluru' }),
    order('2026-10-01', 'returned-rider', 10),
    order('2026-10-06', 'returned-rider', 10, { type1: 'NON-EV', client: 'Beta', city: 'Bengaluru' }),
    order('2026-10-06', 'coverage', 0),
    order('2026-10-01', 'mirror', 9999, { _data_source: 'rider_metrics' }),
  ] })))
  const chart = container.querySelector('[aria-label="Rider attrition chart"]')
  assert.match(chart.textContent, /Rider Attrition · Last 9 months/)
  assert.match(chart.textContent, /previous calendar month/)
  assert.match(chart.textContent, /EV 1 · Non-EV 1 · Total 2/)
  await waitFor(() => chart.querySelectorAll('.recharts-line-curve').length === 3)
  const [client, city] = chart.querySelectorAll('select')
  await act(async () => { client.value = 'Alpha'; client.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(chart.textContent, /EV 1 · Non-EV 0 · Total 1/)
  assert.equal(container.querySelector('input[name="upload-chart-period"][value="monthly"]').checked, true)
  for (const period of ['weekly', 'daily']) {
    const radio = chart.querySelector(`input[value="${period}"]`)
    await act(async () => radio.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    assert.equal(radio.checked, true)
    assert.match(chart.textContent, period === 'weekly' ? /previous calendar week/ : /no later return to work/)
    await waitFor(() => chart.querySelectorAll('.recharts-line-curve').length === 3)
  }
  assert.match(chart.textContent, /Oct 2026/)
  await act(async () => { city.value = 'Bengaluru'; city.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(chart.textContent, /No rider activity available for the selected filters/)
  assert.equal(chart.querySelector('button').disabled, true)
  assert.equal(client.value, 'Alpha')
  assert.equal(city.value, 'Bengaluru')
  await act(async () => { client.value = 'Beta'; client.dispatchEvent(new Event('change', { bubbles: true })) })
  assert.match(chart.textContent, /EV 0 · Non-EV 1 · Total 1/)
  const exportButton = chart.querySelector('button')
  assert.match(exportButton.textContent, /Export Details/)
  assert.equal(exportButton.disabled, false)
  let downloadedBlob, filename
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const originalClick = dom.window.HTMLAnchorElement.prototype.click
  URL.createObjectURL = (blob) => { downloadedBlob = blob; return 'blob:attrition-export' }
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { filename = this.download }
  t.after(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    dom.window.HTMLAnchorElement.prototype.click = originalClick
  })
  await act(async () => exportButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await waitFor(() => filename)
  assert.match(filename, /Rider_Attrition_Details_daily_Beta_Bengaluru.*\.xlsx$/)
  const workbook = XLSX.read(await downloadedBlob.arrayBuffer(), { type: 'array' })
  const details = XLSX.utils.sheet_to_json(workbook.Sheets['Rider Details'])
  assert.equal(details.length, 1)
  assert.equal(details[0]['Rider ID'], 'r2')
  assert.equal(details[0]['Work Started Date'], '2026-09-30')
  assert.equal(details[0]['Attrition Date'], '2026-10-04')
  assert.equal(details[0]['EV / Non-EV'], 'Non-EV')
  assert.deepEqual(errors, [])
})

test('Rider Attrition handles empty data and rider-metrics fallback', async (t) => {
  const { container, root, errors } = mount(t)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [] })))
  assert.match(container.querySelector('[aria-label="Rider attrition chart"]').textContent, /No rider activity available/)
  assert.equal(container.querySelector('[aria-label="Rider attrition chart"] button').disabled, true)
  await act(async () => root.render(createElement(Dashboard, { loading: false, riderData: [
    order('2026-09-30', 'r1', 1, { _data_source: 'rider_metrics' }),
    order('2026-10-05', 'coverage', 0, { _data_source: 'rider_metrics' }),
  ] })))
  const chart = container.querySelector('[aria-label="Rider attrition chart"]')
  assert.match(chart.textContent, /Rider metrics/)
  assert.match(chart.textContent, /EV 1 · Non-EV 0 · Total 1/)
  await waitFor(() => chart.querySelectorAll('.recharts-line-curve').length === 3)
  assert.deepEqual(errors, [])
})

test('attrition hover content shows counts with bracketed percentages and their base', async (t) => {
  const { container, root, errors } = mount(t)
  const point = {
    ev: 20, nonEv: 5, total: 25,
    evRiderBase: 200, nonEvRiderBase: 50, totalRiderBase: 250,
    evAttritionPercent: 10, nonEvAttritionPercent: 10, totalAttritionPercent: 10,
    basePeriod: 'Aug 2026', periodStatus: 'In progress',
  }
  const payload = [['ev', 'EV'], ['nonEv', 'Non-EV'], ['total', 'Total']].map(([dataKey, name]) => ({
    dataKey, name, value: point[dataKey], color: '#38bdf8', payload: point,
  }))
  await act(async () => root.render(createElement(RiderAttritionTooltip, { active: true, payload, label: 'Sep 2026' })))
  assert.match(container.textContent, /Sep 2026 · In progress/)
  assert.match(container.textContent, /EV: 20 \(10\.00%\)/)
  assert.match(container.textContent, /Non-EV: 5 \(10\.00%\)/)
  assert.match(container.textContent, /Total: 25 \(10\.00%\)/)
  assert.match(container.textContent, /Base: Aug 2026 working riders/)
  point.nonEvAttritionPercent = null
  point.nonEv = 0
  payload[1].value = 0
  await act(async () => root.render(createElement(RiderAttritionTooltip, { active: true, payload, label: 'Sep 2026' })))
  assert.match(container.textContent, /Non-EV: 0 \(N\/A\)/)
  await act(async () => root.render(createElement(RiderAttritionTooltip, { active: false, payload, label: 'Sep 2026' })))
  assert.equal(container.textContent, '')
  assert.deepEqual(errors, [])
})
