import * as XLSX from 'xlsx'

const DETAIL_HEADERS = ['Date', 'Worker Code', 'EV91 ID', 'Rider Name', 'V Number', 'Source Name', 'Client', 'City', 'Deployment Date', 'Included in D-1 count']

export function buildOverviewEvZeroOrderWorkbook(report, { cityFilter = 'All', clientFilter = [] } = {}) {
  const details = report.getDetails()
  const workbook = XLSX.utils.book_new()
  const summary = XLSX.utils.json_to_sheet(report.series.map((point) => ({ Date: point.date, 'D-1 0 order rider count': point.count })), { header: ['Date', 'D-1 0 order rider count'] })
  summary['!cols'] = [{ wch: 16 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(workbook, summary, 'Daily Summary')
  const limit = 1048575
  for (let start = 0; start < Math.max(details.length, 1); start += limit) {
    const sheet = XLSX.utils.json_to_sheet(details.slice(start, start + limit), { header: DETAIL_HEADERS })
    sheet['!cols'] = DETAIL_HEADERS.map(() => ({ wch: 24 }))
    sheet['!autofilter'] = { ref: sheet['!ref'] }
    XLSX.utils.book_append_sheet(workbook, sheet, start ? `Rider Details ${Math.floor(start / limit) + 1}` : 'Rider Details')
  }
  const filters = XLSX.utils.aoa_to_sheet([
    ['Setting', 'Value'], ['City', cityFilter], ['Clients', clientFilter.length ? clientFilter.join(', ') : 'All'],
    ['From', report.series[0]?.date || ''], ['Through', report.series.at(-1)?.date || ''],
    ['Rule', 'No orders in the four-day window; excludes deployments on the report date and preceding three days.'],
    ['Details', 'Only riders included in the graph. A rider appears once per qualifying day; daily detail rows match the daily count.'],
    ['Client names', 'Aliases are grouped, including BB / BB Now / Bigbasket and Blinkit / Blinket.'],
  ])
  filters['!cols'] = [{ wch: 20 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(workbook, filters, 'Filters and Rules')
  return workbook
}

export function downloadOverviewEvZeroOrderExcel(report, filters) {
  const workbook = buildOverviewEvZeroOrderWorkbook(report, filters)
  XLSX.writeFile(workbook, `EV-zero-order-riders_${report.series[0]?.date || 'empty'}_${report.series.at(-1)?.date || 'empty'}.xlsx`)
}
