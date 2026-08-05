import { fetchAllRows } from './lib/supabaseServer.js'
import { fillEv91CurrentStatusSourceFromOnboarding } from '../src/lib/onboardingSourceLookup.js'

const CACHE_SECONDS = 300
const BASE_URL = 'https://dash-code-rose.vercel.app'
const EV91_BASE =
  'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'

const COLUMNS = [
  { key: 'city', label: 'City' },
  { key: 'vehicleNumber', label: 'Vehicle No.' },
  { key: 'ev91RiderId', label: 'EV91 Rider ID' },
  { key: 'clientRiderId', label: 'Client Rider ID' },
  { key: 'riderName', label: 'Rider Name' },
  { key: 'riderContact', label: 'Contact' },
  { key: 'currentStatus', label: 'Status' },
  { key: 'operationalStatus', label: 'Operational' },
  { key: 'clientName', label: 'Client' },
  { key: 'aging', label: 'Aging' },
  { key: 'lastStatusDate', label: 'Last Status' },
  { key: 'source', label: 'Source' },
]

const ONBOARDING_COLS =
  'id,rider_id_details,source_name,rider_mobile_number,merge,rider_name,email_address'

let memoryCache = { at: 0, rows: null }

function getApiKey() {
  return (
    process.env.EV91_MIS_API_KEY ||
    process.env.VITE_EV91_MIS_API_KEY ||
    'ev91-mis-public-2026'
  )
}

async function fetchAllCurrentStatusDeployed() {
  const all = []
  let offset = 0
  const limit = 1000
  for (let i = 0; i < 50; i++) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      status: 'Deployed',
    })
    const url = `${EV91_BASE}/current-status?${params.toString()}`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-api-key': getApiKey(),
      },
      cache: 'no-store',
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body || body.success === false) {
      throw new Error(body?.message || `EV91 current-status HTTP ${res.status}`)
    }
    const batch = Array.isArray(body.data) ? body.data : []
    all.push(...batch)
    offset += batch.length
    if (!batch.length || !body.pagination?.hasMore) break
  }
  // Safety: keep only Deployed even if upstream ignores status filter
  return all.filter((row) =>
    String(row.currentStatus || '')
      .toLowerCase()
      .includes('deploy')
  )
}

function formatCell(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** "2026-08-05T12:00:00.000Z" → "2026-08-05" */
function dateOnly(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return s
}

function rowsToSheetObjects(rows) {
  return (rows || []).map((row) => {
    const out = {}
    for (const col of COLUMNS) {
      const raw = row[col.key]
      out[col.label] =
        col.key === 'lastStatusDate' ? dateOnly(raw) : formatCell(raw)
    }
    return out
  })
}

async function buildEnrichedRows({ force = false } = {}) {
  const now = Date.now()
  if (
    !force &&
    memoryCache.rows &&
    now - memoryCache.at < CACHE_SECONDS * 1000
  ) {
    return { rows: memoryCache.rows, fromCache: true, updatedAt: new Date(memoryCache.at).toISOString() }
  }

  const [currentRows, onboardingRows] = await Promise.all([
    fetchAllCurrentStatusDeployed(),
    fetchAllRows('rider_onboarding', ONBOARDING_COLS, 'id', 1000).catch(() => []),
  ])

  const enriched = fillEv91CurrentStatusSourceFromOnboarding(currentRows, onboardingRows)
  const sheetRows = rowsToSheetObjects(enriched)
  memoryCache = { at: now, rows: sheetRows }
  return { rows: sheetRows, fromCache: false, updatedAt: new Date(now).toISOString() }
}

/**
 * Google Sheets feed for EV91 Current Vehicle Status — Deployed only
 * (Source filled from onboarding when API returns "-" / blank).
 *
 * JSON (Apps Script):
 *   https://dash-code-rose.vercel.app/api/ev91-current-status-csv?format=json
 *
 * See scripts/google-sheets-ev91-current-status.gs
 */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const format = (req.query?.format || 'json').toString().toLowerCase()
  const force = req.query?.rebuild === '1'

  try {
    const { rows, fromCache, updatedAt } = await buildEnrichedRows({ force })
    const columns = COLUMNS.map((c) => c.label)

    res.setHeader(
      'Cache-Control',
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`
    )
    res.setHeader('X-Cache-Hit', fromCache ? 'true' : 'false')

    if (format === 'csv' || format === 'tsv') {
      const sep = format === 'tsv' ? '\t' : ','
      const escape = (v) => {
        const s = v == null ? '' : String(v)
        if (sep === ',') return `"${s.replace(/"/g, '""')}"`
        return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
      }
      const lines = [columns.map(escape).join(sep)]
      for (const row of rows) {
        lines.push(columns.map((c) => escape(row[c])).join(sep))
      }
      res.setHeader(
        'Content-Type',
        format === 'tsv'
          ? 'text/tab-separated-values; charset=utf-8'
          : 'text/csv; charset=utf-8'
      )
      return res.status(200).send(lines.join('\n'))
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).json({
      updatedAt,
      total: rows.length,
      fromCache,
      columns,
      rows,
      sheetUrlHint: `${BASE_URL}/api/ev91-current-status-csv?format=json`,
    })
  } catch (err) {
    console.error('ev91-current-status-csv failed:', err)
    return res.status(500).json({
      error: err?.message || 'Failed to build Current Vehicle Status feed',
    })
  }
}
