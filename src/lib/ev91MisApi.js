export const EV91_MIS_ENDPOINTS = {
  'current-status': {
    id: 'current-status',
    title: 'Current Vehicle Status',
    description: 'Latest rider–vehicle assignment status from EV91 DB',
    columns: [
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
    ],
    statusKey: 'currentStatus',
    dateKey: 'lastStatusDate',
    cityKey: 'city',
  },
  'overall-status': {
    id: 'overall-status',
    title: 'Overall Vehicle Status',
    description: 'Overall vehicle status history with SD amount',
    columns: [
      { key: 'cityName', label: 'City' },
      { key: 'vehicleNumber', label: 'Vehicle No.' },
      { key: 'ev91RiderId', label: 'EV91 Rider ID' },
      { key: 'riderName', label: 'Rider Name' },
      { key: 'riderContact', label: 'Contact' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientName', label: 'Client' },
      { key: 'vehicleStatus', label: 'Status' },
      { key: 'sdAmount', label: 'SD Amount' },
      { key: 'aging', label: 'Aging' },
      { key: 'statusDate', label: 'Status Date' },
      { key: 'sourceName', label: 'Source' },
    ],
    statusKey: 'vehicleStatus',
    dateKey: 'statusDate',
    cityKey: 'cityName',
  },
  'client-mapping-history': {
    id: 'client-mapping-history',
    title: 'Client Mapping History',
    description: 'Rider ↔ client ID mapping history',
    columns: [
      { key: 'city', label: 'City' },
      { key: 'ev91RiderId', label: 'EV91 Rider ID' },
      { key: 'clientId', label: 'Client ID' },
      { key: 'phoneNumber', label: 'Phone' },
      { key: 'source', label: 'Source' },
      { key: 'lastUpdated', label: 'Last Updated' },
    ],
    statusKey: null,
    dateKey: 'lastUpdated',
    cityKey: 'city',
  },
}

/** Known cities from EV91 MIS (shared across all 3 endpoints). */
export const EV91_CITIES = [
  'Belagavi',
  'Bengaluru',
  'Chennai',
  'Delhi',
  'Hyderabad',
  'Mumbai',
  'Mysuru',
]

const EV91_MIS_UPSTREAM =
  'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'

function getEv91MisApiKey() {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EV91_MIS_API_KEY) ||
    'ev91-mis-public-2026'
  )
}

function buildEv91MisQuery(params = {}) {
  const qs = new URLSearchParams()
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  if (params.search) qs.set('search', params.search)
  if (params.city) qs.set('city', params.city)
  if (params.status) qs.set('status', params.status)
  return qs
}

function parseEv91MisBody(body, httpStatus) {
  if (!body || body.success === false) {
    throw new Error(body?.message || `EV91 API error (HTTP ${httpStatus || 'unknown'})`)
  }
  return {
    data: Array.isArray(body.data) ? body.data : [],
    pagination: body.pagination || {},
    summary: body.summary || {},
  }
}

/**
 * Call EV91 MIS upstream directly (CORS allows *). Used in production when
 * `/api/ev91-mis` serverless proxy is missing (HTTP 404).
 */
async function fetchEv91MisDirect(endpoint, params = {}) {
  const qs = buildEv91MisQuery(params)
  const url = `${EV91_MIS_UPSTREAM}/${endpoint}?${qs.toString()}`
  const res = await fetch(url, {
    headers: {
      'x-api-key': getEv91MisApiKey(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => ({
    success: false,
    message: `Upstream returned HTTP ${res.status}`,
  }))
  if (!res.ok) {
    throw new Error(body?.message || `EV91 API error (HTTP ${res.status})`)
  }
  return parseEv91MisBody(body, res.status)
}

/**
 * Fetch EV91 MIS rider-vehicle analytics.
 * Tries local `/api/ev91-mis` proxy first (dev / Vercel), then falls back to
 * direct upstream so production still works when the proxy route 404s.
 */
export async function fetchEv91MisData(endpoint, params = {}) {
  if (!EV91_MIS_ENDPOINTS[endpoint]) {
    throw new Error(`Unknown EV91 endpoint: ${endpoint}`)
  }

  const qs = buildEv91MisQuery(params)
  qs.set('endpoint', endpoint)

  // Prefer proxy when available (keeps key server-side)
  try {
    const res = await fetch(`/api/ev91-mis?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    // Missing serverless function / wrong host → use upstream
    if (res.status === 404) {
      return fetchEv91MisDirect(endpoint, params)
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('application/json')) {
      return fetchEv91MisDirect(endpoint, params)
    }

    const body = await res.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return fetchEv91MisDirect(endpoint, params)
    }

    if (!res.ok || body.success === false) {
      // Proxy reached but upstream failed — don't mask real API errors
      throw new Error(body?.message || `EV91 API error (HTTP ${res.status})`)
    }

    return parseEv91MisBody(body, res.status)
  } catch (err) {
    // Network / proxy crash → try direct once
    if (err?.message && String(err.message).includes('EV91 API error')) throw err
    try {
      return await fetchEv91MisDirect(endpoint, params)
    } catch (directErr) {
      throw directErr?.message ? directErr : err
    }
  }
}

/**
 * Fetch all pages for the current filters (used for date filtering + export).
 * Caches unfiltered full pulls briefly so Summary / Lookup / refresh don't re-download.
 */
const EV91_ALL_CACHE = new Map()
const EV91_ALL_CACHE_TTL_MS = 5 * 60 * 1000

function ev91AllCacheKey(endpoint, params) {
  return `${endpoint}|${JSON.stringify(params || {})}`
}

export async function fetchAllEv91MisData(endpoint, params = {}, pageSize = 1000) {
  const key = ev91AllCacheKey(endpoint, params)
  const cached = EV91_ALL_CACHE.get(key)
  if (cached && Date.now() - cached.at < EV91_ALL_CACHE_TTL_MS) {
    return cached.value
  }

  const all = []
  let offset = 0
  let summary = {}
  let pagination = {}

  for (let i = 0; i < 50; i++) {
    const result = await fetchEv91MisData(endpoint, {
      ...params,
      limit: pageSize,
      offset,
    })
    all.push(...result.data)
    summary = result.summary || summary
    pagination = result.pagination || {}
    if (!result.pagination?.hasMore || !result.data.length) break
    offset += pageSize
  }

  const value = {
    data: all,
    summary,
    pagination: { ...pagination, total: all.length, hasMore: false },
  }
  EV91_ALL_CACHE.set(key, { at: Date.now(), value })
  return value
}

/** Drop cached full pulls (e.g. after explicit Refresh). */
export function clearEv91AllCache(endpoint = null) {
  if (!endpoint) {
    EV91_ALL_CACHE.clear()
    return
  }
  for (const key of [...EV91_ALL_CACHE.keys()]) {
    if (key.startsWith(`${endpoint}|`)) EV91_ALL_CACHE.delete(key)
  }
}

export function rowDateKey(row, dateKey) {
  const raw = row?.[dateKey]
  if (!raw) return ''
  const s = String(raw)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function filterRowsByDateRange(rows, dateKey, from, to) {
  if (!from && !to) return rows || []
  return (rows || []).filter((row) => {
    const d = rowDateKey(row, dateKey)
    if (!d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

export function summarizeOverallRows(rows = []) {
  let deployed = 0
  let returned = 0
  let clientSwap = 0
  for (const row of rows) {
    const s = String(row.vehicleStatus || '').toLowerCase()
    if (s.includes('deploy')) deployed++
    else if (s.includes('return')) returned++
    else if (s.includes('swap')) clientSwap++
  }
  return {
    total: rows.length,
    deployed,
    returned,
    clientSwap,
  }
}

/**
 * Web-app cutover: from this date Overview Deployed/Returned use EV91 Overall Status API.
 * Before this date, fleet master (Deployee / Return) counts are used.
 */
export const EV91_WEBAPP_CUTOVER_DATE = '2026-07-28'

/** Day before API cutover (yyyy-MM-dd). */
export const EV91_FLEET_DATA_UNTIL_DATE = '2026-07-27'

/**
 * Count Deployed / Returned events in Overall Status for a date range.
 * Dedupes vehicle + status date + kind (matches City/Client Summary style).
 */
export function countOverallDeployReturnInRange(
  rows = [],
  { startDate = '', endDate = '' } = {}
) {
  const seen = new Set()
  let deployed = 0
  let returned = 0

  for (const row of rows || []) {
    const dKey = rowDateKey(row, 'statusDate')
    if (!dKey) continue
    if (startDate && dKey < startDate) continue
    if (endDate && dKey > endDate) continue

    const s = String(row.vehicleStatus || '').toLowerCase()
    let kind = ''
    if (s.includes('deploy')) kind = 'deployed'
    else if (s.includes('return')) kind = 'returned'
    else continue

    const vehicle = (row.vehicleNumber || '').toString().trim().toUpperCase() || 'UNKNOWN'
    const riderId =
      (row.clientId || row.clientRiderId || row.ev91RiderId || '').toString().trim() || ''
    const uniqueKey = `${vehicle}|${dKey}|${kind}|${riderId}`
    if (seen.has(uniqueKey)) continue
    seen.add(uniqueKey)

    if (kind === 'deployed') deployed++
    else returned++
  }

  return { deployed, returned, total: deployed + returned }
}

/** Normalize Current Vehicle Status → Deployed / Returned / Not yet to deploy. */
export function normalizeCurrentVehicleStatus(status) {
  const s = String(status || '')
    .trim()
    .toLowerCase()
  if (!s) return ''
  if (s.includes('return')) return 'Returned'
  if (
    s.includes('yet') ||
    s.includes('not yet') ||
    (s.includes('not') && s.includes('deploy')) ||
    s.includes('pending')
  ) {
    return 'Not yet to deploy'
  }
  if (s.includes('deploy')) return 'Deployed'
  return ''
}

/** Count current-status rows (or API summary) into the three overview buckets. */
export function summarizeCurrentStatusRows(rows = [], apiSummary = null) {
  const apiHasCounts =
    apiSummary != null &&
    (apiSummary.deployed != null ||
      apiSummary.returned != null ||
      apiSummary.yetNotDeployed != null)

  if (apiHasCounts) {
    return {
      total: Number(apiSummary?.total) || (rows?.length ?? 0),
      deployed: Number(apiSummary.deployed) || 0,
      returned: Number(apiSummary.returned) || 0,
      yetNotDeployed: Number(apiSummary.yetNotDeployed) || 0,
    }
  }

  let deployed = 0
  let returned = 0
  let yetNotDeployed = 0
  for (const row of rows || []) {
    const label = normalizeCurrentVehicleStatus(row.currentStatus)
    if (label === 'Deployed') deployed++
    else if (label === 'Returned') returned++
    else if (label === 'Not yet to deploy') yetNotDeployed++
  }
  return {
    total: (rows || []).length,
    deployed,
    returned,
    yetNotDeployed,
  }
}

/** Pie-ready series for General Overview Vehicle Status Distribution. */
export function currentStatusDistributionSeries(summary) {
  return [
    { name: 'Deployed', value: Number(summary?.deployed) || 0, color: '#4ade80' },
    { name: 'Returned', value: Number(summary?.returned) || 0, color: '#f59e0b' },
    {
      name: 'Not yet to deploy',
      value: Number(summary?.yetNotDeployed) || 0,
      color: '#94a3b8',
    },
  ].filter((d) => d.value > 0)
}

export function formatEv91Cell(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      }
    } catch {
      /* keep raw */
    }
  }
  return String(value)
}

export function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('deploy')) return 'ev91-badge-deployed'
  if (s.includes('return')) return 'ev91-badge-returned'
  if (s.includes('swap')) return 'ev91-badge-swap'
  if (s.includes('yet') || s.includes('not')) return 'ev91-badge-pending'
  return 'ev91-badge-default'
}

export function rowsToExportSheet(rows, columns) {
  return (rows || []).map((row) => {
    const out = {}
    for (const col of columns) {
      const raw = row[col.key]
      out[col.label] =
        raw == null || raw === ''
          ? ''
          : typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw)
            ? formatEv91Cell(raw)
            : raw
    }
    return out
  })
}
