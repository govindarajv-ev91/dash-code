import {
  getCachedApiRows,
  rowsToRiderPerformanceCsv,
  SHEETS_PAGE_SIZE,
} from './lib/riderPerformanceFeed.js'

const CACHE_SECONDS = 300
const BASE_URL = 'https://dash-code-rose.vercel.app'

/**
 * Google Sheets IMPORTDATA (after deploy):
 *   =IMPORTDATA("https://dash-code-rose.vercel.app/feeds/rider-performance-1.csv")
 *
 * Recommended (JSON works reliably — use Apps Script):
 *   scripts/google-sheets-rider-performance.gs
 */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const format = (req.query?.format || 'csv').toString().toLowerCase()
  const pageParam = req.query?.page
  const pageSizeParam = req.query?.pageSize
  const googleMode = req.query?.google === '1' || req.query?.sheets === '1'
  const metaOnly = req.query?.meta === '1'

  const forceRebuild = req.query?.rebuild === '1'

  try {
    const { rows: allRows, fromCache, updatedAt } = await getCachedApiRows(new Date(), { forceRebuild })
    const page = pageParam != null ? Number(pageParam) : 1
    const pageSize = pageSizeParam != null ? Number(pageSizeParam) : SHEETS_PAGE_SIZE
    const includeHeader = req.query?.header !== '0'
    const preview = rowsToRiderPerformanceCsv(allRows, { page: 1, pageSize })

    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`)
    res.setHeader('X-Cache-Hit', fromCache ? 'true' : 'false')

    if (format === 'json') {
      if (metaOnly) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.status(200).json({
          updatedAt: updatedAt || new Date().toISOString(),
          total: allRows.length,
          pageSize: preview.pageSize,
          totalPages: preview.totalPages,
          fromCache,
          importDataFormulas: Array.from({ length: preview.totalPages }, (_, i) => {
            const p = i + 1
            const header = p > 1 ? '&header=0' : ''
            return `=IMPORTDATA("${BASE_URL}/api/rider-performance-csv?google=1&page=${p}${header}")`
          }),
        })
      }

      const paged = rowsToRiderPerformanceCsv(allRows, { page, pageSize })

      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(200).json({
        updatedAt: updatedAt || new Date().toISOString(),
        total: allRows.length,
        page: paged.page,
        pageSize: paged.pageSize,
        totalPages: paged.totalPages,
        fromCache,
        columns: ['ID', 'In-active Days', 'Eff/inff', 'Current week orders'],
        rows: paged.rows,
      })
    }

    if (format === 'tsv' || googleMode) {
      const tsv = rowsToRiderPerformanceCsv(allRows, {
        page,
        pageSize,
        includeHeader,
        google: true,
      })
      res.setHeader('Content-Type', tsv.mimeType)
      res.setHeader('X-Total-Rows', String(tsv.total))
      res.setHeader('X-Total-Pages', String(tsv.totalPages))
      res.setHeader('X-Page', String(tsv.page))
      return res.status(200).send(tsv.body)
    }

    const csv = rowsToRiderPerformanceCsv(allRows, { page, pageSize, includeHeader })
    res.setHeader('Content-Type', csv.mimeType)
    res.setHeader('X-Total-Rows', String(csv.total))
    res.setHeader('X-Total-Pages', String(csv.totalPages))
    res.setHeader('X-Page', String(csv.page))
    return res.status(200).send(csv.body)
  } catch (err) {
    console.error('[api/rider-performance-csv]', err)
    return res.status(500).json({
      error: err?.message || 'Failed to build rider performance feed',
    })
  }
}

export const config = {
  maxDuration: 60,
}
