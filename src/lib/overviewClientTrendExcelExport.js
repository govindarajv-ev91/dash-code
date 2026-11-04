import * as XLSX from 'xlsx'
import { buildClientPeriodLineSeries } from './paymentHistoryReport.js'
import { buildOverviewClientTrendAnalysis } from './overviewClientTrendAnalysis.js'

const RAW_HEADERS = [
  'Record ID', 'Date', 'Rider ID', 'Client', 'City', 'Type 1', 'Type 2', 'Month', 'Orders',
  'Chart Client', 'Chart City', 'Rider Matching Key', 'EV / Non-EV',
]

function appendTableSheets(workbook, rows, { name, headers, widths, values }) {
  // Excel allows 1,048,576 rows including the header. Split rather than truncate.
  const limit = 1048575
  for (let start = 0; start < Math.max(rows.length, 1); start += limit) {
    const sheet = XLSX.utils.aoa_to_sheet([headers])
    const end = Math.min(start + limit, rows.length)
    for (let offset = start; offset < end; offset += 5000) {
      XLSX.utils.sheet_add_aoa(sheet, rows.slice(offset, Math.min(offset + 5000, end)).map(values), { origin: -1 })
    }
    sheet['!cols'] = widths.map((wch) => ({ wch }))
    sheet['!autofilter'] = { ref: sheet['!ref'] }
    XLSX.utils.book_append_sheet(workbook, sheet, start ? `${name} ${Math.floor(start / limit) + 1}` : name)
  }
}

function appendRawSheets(workbook, rows, name) {
  appendTableSheets(workbook, rows, {
    name, headers: RAW_HEADERS, widths: [24, 14, 22, 24, 22, 16, 16, 16, 14, 24, 22, 24, 16],
    values: (row) => [
      String(row.source.id ?? ''), row.date, String(row.source.worker_code ?? ''),
      String(row.source.client ?? ''), String(row.source.city ?? ''),
      String(row.source.type1 ?? ''), String(row.source.type2 ?? ''), String(row.source.month ?? ''), row.orders,
      row.clientName, row.cityName, row.rider, row.isEv ? 'EV' : 'Non-EV',
    ],
  })
}

export function buildOverviewClientTrendWorkbook(rows, options = {}) {
  const { client = 'All', city = 'All', period = 'monthly', metric = 'riders' } = options
  const report = buildClientPeriodLineSeries(rows, { ...options, includeDetails: true })
  const { details, contextDetails, dateFrom, dateTo, contextFrom, latestDate } = report.exportData
  const workbook = XLSX.utils.book_new()
  const summary = XLSX.utils.aoa_to_sheet([
    ['Period Start', 'Period', 'EV Riders', 'Non-EV Riders', 'Total Riders', 'EV Orders', 'Non-EV Orders', 'Total Orders'],
    ...report.series.map((row) => [
      row.periodKey.length === 7 ? `${row.periodKey}-01` : row.periodKey, row.period,
      row.evRiders, row.nonEvRiders, row.riders, row.evOrders, row.nonEvOrders, row.orders,
    ]),
  ])
  summary['!cols'] = [16, 26, 16, 18, 18, 16, 18, 18].map((wch) => ({ wch }))
  summary['!autofilter'] = { ref: summary['!ref'] }
  XLSX.utils.book_append_sheet(workbook, summary, 'Chart Summary')
  const analysis = buildOverviewClientTrendAnalysis(report, { period, metric })
  const labels = new Map(report.series.map((row) => [row.periodKey.length === 7 ? `${row.periodKey}-01` : row.periodKey, row.period]))
  appendTableSheets(workbook, analysis.selected, {
    name: 'City Client Type',
    headers: ['Period Start', 'Period', 'City', 'Client', 'Type', 'Rider Count', 'Orders',
      'Rider Rank High', 'Rider Rank Low', 'Order Rank High', 'Order Rank Low', 'Records in Period'],
    widths: [16, 26, 24, 24, 16, 18, 18, 20, 20, 20, 20, 22],
    values: (row) => [row.periodStart, labels.get(row.periodStart), row.cityName, row.clientName, row.type,
      row.riders, row.orders, row.riderRankHigh, row.riderRankLow, row.orderRankHigh, row.orderRankLow, row.records],
  })
  appendTableSheets(workbook, analysis.lifetime, {
    name: 'Lifetime Ranking',
    headers: ['City', 'Client', 'Type', 'First Record Date', 'Last Record Date', 'Periods in Analysis',
      'Lifetime Unique Riders', 'Lifetime Orders', 'Rider Rank High', 'Rider Rank Low', 'Order Rank High', 'Order Rank Low',
      'Peak Rider Count', 'Peak Rider Period Start', 'Lowest Rider Count', 'Lowest Rider Period Start',
      'Peak Orders', 'Peak Order Period Start', 'Lowest Orders', 'Lowest Order Period Start'],
    widths: [24, 24, 16, 20, 20, 22, 24, 20, 20, 20, 20, 20, 20, 26, 22, 28, 20, 26, 20, 28],
    values: (row) => [row.cityName, row.clientName, row.type, row.firstDate, row.lastDate, row.periodCount,
      row.uniqueRiders, row.orders, row.riderRankHigh, row.riderRankLow, row.orderRankHigh, row.orderRankLow,
      row.peakRiders, row.peakRidersDate, row.lowestRiders, row.lowestRidersDate,
      row.peakOrders, row.peakOrdersDate, row.lowestOrders, row.lowestOrdersDate],
  })
  appendRawSheets(workbook, details, 'Raw Data')
  if (contextDetails.length) appendRawSheets(workbook, contextDetails, 'Daily Rider Context')

  const filters = XLSX.utils.aoa_to_sheet([
    ['Setting', 'Value'], ['Client', client], ['City', city], ['Period', period],
    ['Selected Chart Metric', metric === 'orders' ? 'Order count' : 'Rider count'],
    ['From Date', dateFrom], ['Through Date', dateTo], ['Latest Loaded Date', latestDate],
    ['Source', 'Order Upload records used by the chart'],
    ['Raw Data Rows', details.length], ['Daily Context Rows', contextDetails.length],
    ['Total Orders', report.totals.orders], ['Total Riders', report.totals.riders],
    ['Summary', 'Both rider counts and order counts are included, regardless of the selected chart metric.'],
    ['City Client Type', 'One row per selected period, city, client and type. Each rider is assigned once to one city/client and either EV or Non-EV using the same record as their Total assignment. EV plus Non-EV equals Total within each city/client and across the chart.'],
    ['Ranks', 'Rank High 1 is highest; Rank Low 1 is lowest. Equal values share a rank without gaps. City/client combinations are compared within the same type (and same period for City Client Type), using the selected client/city filters.'],
    ['Lifetime Scope', 'All loaded Order Upload history for the selected client and city, ignoring chart date filters and the default nine-month window. Raw Data and Chart Summary still use the selected date range.'],
    ['Lifetime From Date', analysis.historyDates.from], ['Lifetime Through Date', analysis.historyDates.to],
    ['Lifetime Period', period],
    ['Lifetime Counts', 'Lifetime Unique Riders assigns each rider once across all loaded dates to their latest city/client and type, including zero-order records. EV plus Non-EV equals Total within each city/client. Lifetime Orders sums all orders in their original city/client/type.'],
    ['Peak and Lowest', 'Highest and lowest period counts within each city/client/type across loaded history, using the selected Monthly/Weekly/Daily period. The earliest period start is shown when values tie.'],
    ['Missing Activity', 'Missing periods or city/client/type combinations are not assumed to have zero activity. Recorded zeros are included. Daily rolling activity can create a row with zero Records in Period when the rider worked in the preceding three days.'],
    ['Adding Rider Counts', 'Within a period, sum city/client Rider Counts for one Type to match that chart series. EV and Non-EV partition Total. Total rows repeat the combined EV and Non-EV counts and orders; exclude Total when summing both types.'],
    ['Rider Counts', period === 'daily'
      ? 'Distinct riders with positive orders on the chart date or the preceding three days. Total Riders is the latest displayed day, not the sum of daily counts.'
      : 'Distinct riders per calendar month or Monday-Sunday week, including zero-order records. Total Riders counts each rider once across the selected date range, not once per period. Date filters clip the first and last periods.'],
    ['Rider Assignment', 'Use the latest eligible record within the selected filters and period (daily: positive orders in the trailing four days). On the same date, prefer the record with more orders, then city and client alphabetically, then EV if otherwise tied. The selected record determines both city/client and rider type.'],
    ['EV / Non-EV', 'Each rider counts in exactly one type using their assigned record and the same type1/type2 classification as the chart. Orders retain the type of each original record, including when a rider changes type.'],
    ['Raw Data', 'One row per loaded order record used by this chart, after its source selection and duplicate handling. IDs are text; Orders are numeric. Chart Client, Chart City and Rider Matching Key show the normalized values. EV / Non-EV is the original record type; Rider Assignment determines unique rider counts.'],
    ...(period === 'daily' ? [
      ['Context From', contextFrom],
      ['Daily Rider Context', 'Records from the three days before From Date are kept separately to explain rolling active riders. Their orders are excluded from Raw Data and Total Orders.'],
    ] : []),
  ])
  filters['!cols'] = [{ wch: 26 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(workbook, filters, 'Filters and Totals')
  return workbook
}

export function downloadOverviewClientTrendExcel(rows, options = {}) {
  const workbook = buildOverviewClientTrendWorkbook(rows, options)
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true })
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  try {
    link.href = url
    const suffix = [options.period || 'monthly', options.client || 'All', options.city || 'All',
      options.dateFrom || 'Last_9_months', options.dateTo || 'Latest']
      .map((value) => String(value).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 50)).join('_')
    link.download = `Client_Wise_${suffix}.xlsx`
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
