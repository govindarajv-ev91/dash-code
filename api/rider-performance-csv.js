import {
  loadRiderPerformanceReportRows,
  pickRiderPerformanceApiRows,
  rowsToRiderPerformanceCsv,
} from './lib/riderPerformanceFeed.js'

const CACHE_SECONDS = 300

/**
 * Public CSV feed for Google Sheets:
 *   =IMPORTDATA("https://YOUR_DOMAIN/api/rider-performance-csv")
 *
 * JSON (optional):
 *   /api/rider-performance-csv?format=json
 */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const format = (req.query?.format || 'csv').toString().toLowerCase()

  try {
    const reportRows = await loadRiderPerformanceReportRows(new Date())
    const payload = pickRiderPerformanceApiRows(reportRows)

    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`)

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(200).json({
        updatedAt: new Date().toISOString(),
        count: payload.length,
        columns: ['ID', 'In-active Days', 'Eff/inff', 'Current week orders'],
        rows: payload,
      })
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    return res.status(200).send(rowsToRiderPerformanceCsv(reportRows))
  } catch (err) {
    console.error('[api/rider-performance-csv]', err)
    return res.status(500).json({
      error: err?.message || 'Failed to build rider performance feed',
    })
  }
}
