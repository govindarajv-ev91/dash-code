import { normalizeSummaryCity } from './citySummaryAliases.js'
import { buildRevenueReport, buildRiderReport, comparable, periodInfo, rowMatches } from './clientPeriodTrendReports.js'
import { buildClientSourceReport } from './ev91ClientSourceReport.js'

// Export the displayed metric separately for each city, keeping all cities on one sheet.
export function buildClientPeriodCityExport({ allRows, listedRows, filters, mode, selectedTable, sourceForRow, sourceSearch = '' }) {
  const names = {
    'client-revenue': 'Client Revenue', 'client-riders': 'Client Riders',
    'source-riders': 'Source Riders', 'source-revenue': 'Source Revenue',
  }
  if (!names[selectedTable]) throw new Error('Select one table to export by city.')
  const periods = buildRevenueReport(allRows, filters, mode).periods
  const cityName = (row) => normalizeSummaryCity(row.city) || 'Unknown'
  const cities = [...new Set(allRows.filter((row) => rowMatches(row, filters, mode)).map(cityName))].sort()
  const rows = []
  const totalRowIndices = []
  const isSource = selectedTable.startsWith('source-')
  for (const city of cities) {
    // Filter first so aliases and cities without a name share the same bucket.
    const matches = (row) => cityName(row) === city && rowMatches(row, filters, mode)
    let details
    if (isSource) {
      const report = buildClientSourceReport(listedRows, {
        mode, periods, matches, sourceForRow, periodForRow: (row) => periodInfo(row, mode).label,
      })
      details = (selectedTable === 'source-riders' ? report.riderRows : report.revenueRows)
        .filter((row) => comparable(row.source).includes(comparable(sourceSearch)))
        .map((row) => ({ name: row.source, values: row.values }))
    } else {
      const report = selectedTable === 'client-revenue'
        ? buildRevenueReport(allRows.filter(matches), filters, mode)
        : buildRiderReport(listedRows.filter(matches), filters, mode, periods)
      details = report.rows
    }
    if (!details.length) continue
    const label = isSource ? 'Source' : 'Client'
    const matrixRow = (name, values) => ({
      City: city, [label]: name,
      ...Object.fromEntries(periods.map((period) => [period, values[period] || 0])),
      ...(!isSource ? { Total: periods.reduce((sum, period) => sum + (values[period] || 0), 0) } : {}),
    })
    totalRowIndices.push(rows.length)
    rows.push(matrixRow('Total', Object.fromEntries(periods.map((period) =>
      [period, details.reduce((sum, row) => sum + (row.values[period] || 0), 0)]
    ))))
    rows.push(...details.map((row) => matrixRow(row.name, row.values)))
  }
  return { periods, summarySheets: [{ name: `${mode} ${names[selectedTable]}`, rows, totalRowIndices }] }
}
