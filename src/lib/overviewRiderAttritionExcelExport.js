import * as XLSX from 'xlsx'

const DETAIL_HEADERS = [
  'Period', 'Rider ID', 'Rider Name', 'Client', 'City', 'EV / Non-EV',
  'Work Started Date', 'Last Working Date', 'Attrition Date', 'Inactive Days at Attrition', 'Next Working Date',
  'Previous Period', 'Comparison From', 'Comparison Through', 'Period Status',
]

export function buildOverviewAttritionWorkbook(report, { client = 'All', city = 'All', period = report.period || 'monthly', source = 'Order Upload data' } = {}) {
  const workbook = XLSX.utils.book_new()
  const details = XLSX.utils.aoa_to_sheet([
    DETAIL_HEADERS,
    ...report.details.map((row) => [
      row.period, row.workerCode, row.workerName, row.client, row.city, row.type,
      row.workStartedDate, row.lastWorkingDate, row.attritionDate, row.inactiveDays, row.nextWorkingDate,
      row.previousPeriod, row.comparisonFrom, row.comparisonThrough, row.periodStatus,
    ]),
  ])
  details['!cols'] = [24, 20, 24, 24, 20, 16, 22, 22, 20, 26, 24, 24, 22, 22, 20].map((wch) => ({ wch }))
  details['!autofilter'] = { ref: details['!ref'] }
  XLSX.utils.book_append_sheet(workbook, details, 'Rider Details')

  const baseTotals = report.series.reduce((sum, row) => {
    for (const type of ['ev', 'nonEv', 'total']) sum[type] += row[`${type}RiderBase`]
    return sum
  }, { ev: 0, nonEv: 0, total: 0 })
  const summary = XLSX.utils.aoa_to_sheet([
    ['Period', 'EV', 'Non-EV', 'Total', 'Base Period', 'EV Base Riders', 'Non-EV Base Riders', 'Total Base Riders', 'EV Attrition %', 'Non-EV Attrition %', 'Total Attrition %'],
    ...report.series.map((row) => [row.period, row.ev, row.nonEv, row.total, row.basePeriod, row.evRiderBase, row.nonEvRiderBase, row.totalRiderBase,
      row.evAttritionPercent == null ? null : row.evAttritionPercent / 100,
      row.nonEvAttritionPercent == null ? null : row.nonEvAttritionPercent / 100,
      row.totalAttritionPercent == null ? null : row.totalAttritionPercent / 100]),
    ['Total', report.totals.ev, report.totals.nonEv, report.totals.total, 'Sum of period bases', baseTotals.ev, baseTotals.nonEv, baseTotals.total,
      baseTotals.ev ? report.totals.ev / baseTotals.ev : null, baseTotals.nonEv ? report.totals.nonEv / baseTotals.nonEv : null,
      baseTotals.total ? report.totals.total / baseTotals.total : null],
  ])
  for (let row = 1; row <= report.series.length + 1; row += 1) {
    for (let column = 8; column <= 10; column += 1) {
      const cell = summary[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell) cell.z = '0.00%'
    }
  }
  summary['!cols'] = [24, 14, 14, 14, 24, 20, 22, 22, 20, 22, 22].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(workbook, summary, 'Chart Summary')

  const filters = XLSX.utils.aoa_to_sheet([
    ['Setting', 'Value'], ['Client', client], ['City', city], ['Period', period],
    ['From Date', report.dateFrom], ['Data Through', report.asOfDate], ['Source', source],
    ['Activity Checked Through', report.returnCheckThrough],
    ['Rule', report.rule],
    ['Percentage Rule', report.percentageRule],
    ['Percentage Scope', 'EV and Non-EV use their own working rider base. All bases use the same Client and City filters and count each rider once. Blank percentages mean no base riders.'],
    ['Total Percentage', 'Sum of attrition counts ÷ sum of period rider bases × 100, not an average of the percentages.'],
    ['Counting', report.period === 'daily' ? 'Each rider counts once at the four-day threshold after their final working date. Earlier absences followed by a return are excluded.' : 'Each rider counts once per comparison period when they worked in the previous period and did not work anywhere in this period.'],
    ['Scope', 'Client, city and EV type come from the last working activity.'],
    ['Work Started Date', 'Earliest date with positive delivered orders for the rider in the full loaded source history, before date, client or city filters.'],
    ['Next Working Date', report.period === 'daily' ? 'Always blank for daily attrition. Any later work in loaded history excludes the earlier absence.' : 'Work within the comparison period excludes attrition. A return in a later period does not erase a missed month or week.'],
    ['Calendar Periods', 'Months use calendar months; weeks use Monday–Sunday. Date filters select the displayed periods; activity is checked across each full period in loaded history.'],
    ['In Progress', 'The latest month/week is evaluated only through the latest loaded date. Its provisional attrition can change as more work is loaded.'],
    ['Attrition Date', report.period === 'daily' ? 'Fourth consecutive day without work.' : 'Comparison Through date. This is the period end for completed months/weeks and latest loaded date for an in-progress period.'],
  ])
  filters['!cols'] = [{ wch: 24 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(workbook, filters, 'Filters and Rule')
  return workbook
}

export function downloadOverviewAttritionExcel(report, options) {
  const workbook = buildOverviewAttritionWorkbook(report, options)
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  try {
    link.href = url
    const suffix = [options.period, options.client, options.city, report.dateFrom, report.asOfDate]
      .map((value) => String(value).replace(/[^a-zA-Z0-9_-]+/g, '_')).join('_')
    link.download = `Rider_Attrition_Details_${suffix}.xlsx`
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
