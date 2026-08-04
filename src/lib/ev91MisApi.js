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

const EV91_MIS_UPSTREAM =
  'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'

function getEv91MisApiKey() {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EV91_MIS_API_KEY) ||
    'ev91-mis-public-2026'
  )
}

/**
 * Optional absolute proxy (rare). Example: VITE_EV91_MIS_PROXY_URL=https://xxx/api/ev91-mis
 */
function getEv91MisProxyBase() {
  const configured =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_EV91_MIS_PROXY_URL
  if (configured && String(configured).trim()) {
    return String(configured).trim().replace(/\/$/, '')
  }
  return ''
}

function isNetworkFetchError(err) {
  const msg = String(err?.message || err || '')
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
}

async function readEv91Response(res) {
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('application/json')) {
    throw new Error(`EV91 API returned non-JSON (HTTP ${res.status})`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.success === false) {
    throw new Error(body?.message || `EV91 API error (HTTP ${res.status})`)
  }
  return parseEv91MisBody(body, res.status)
}

/** Local Vite middleware: /api/ev91-mis?endpoint=… */
async function fetchEv91MisViaLocalProxy(endpoint, params = {}) {
  const qs = buildEv91MisQuery(params)
  qs.set('endpoint', endpoint)
  const res = await fetch(`/api/ev91-mis?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 404) throw new Error('Local EV91 proxy not found')
  return readEv91Response(res)
}

/**
 * AWS Amplify reverse-proxy path (same-origin — no CORS).
 * Send x-api-key here; Amplify should forward it to EV91.
 * Rewrite must be above SPA, and SPA target must be /index.html
 * (see amplify-redirects.json).
 */
async function fetchEv91MisViaAmplifyRewrite(endpoint, params = {}) {
  const qs = buildEv91MisQuery(params)
  const key = getEv91MisApiKey()
  const res = await fetch(`/api/ev91/${endpoint}?${qs.toString()}`, {
    headers: {
      Accept: 'application/json',
      'x-api-key': key,
    },
    cache: 'no-store',
  })
  if (res.status === 404) throw new Error('Amplify EV91 rewrite not configured')
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('application/json')) {
    throw new Error('Amplify EV91 rewrite not configured (SPA rule catching /api)')
  }
  return readEv91Response(res)
}

/**
 * Direct browser → EV91 upstream.
 * Avoid on Amplify when possible — upstream can 500 when Origin is *.amplifyapp.com.
 */
async function fetchEv91MisDirect(endpoint, params = {}) {
  const key = getEv91MisApiKey()
  const qs = buildEv91MisQuery(params)
  const url = `${EV91_MIS_UPSTREAM}/${endpoint}?${qs.toString()}`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-api-key': key,
      },
      cache: 'no-store',
    })
    return await readEv91Response(res)
  } catch (err) {
    if (!isNetworkFetchError(err)) throw err
  }

  const qs2 = buildEv91MisQuery(params)
  qs2.set('api_key', key)
  qs2.set('apiKey', key)
  qs2.set('x-api-key', key)
  const res2 = await fetch(`${EV91_MIS_UPSTREAM}/${endpoint}?${qs2.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  return readEv91Response(res2)
}

/**
 * Fetch EV91 MIS rider-vehicle analytics.
 * - Local: Vite `/api/ev91-mis` proxy
 * - Amplify: `/api/ev91/:endpoint` rewrite + x-api-key (same-origin)
 * - Fallback: direct upstream
 */
export async function fetchEv91MisData(endpoint, params = {}) {
  if (!EV91_MIS_ENDPOINTS[endpoint]) {
    throw new Error(`Unknown EV91 endpoint: ${endpoint}`)
  }

  const absoluteProxy = getEv91MisProxyBase()
  if (absoluteProxy) {
    const qs = buildEv91MisQuery(params)
    qs.set('endpoint', endpoint)
    const res = await fetch(`${absoluteProxy}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    return readEv91Response(res)
  }

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    try {
      return await fetchEv91MisViaLocalProxy(endpoint, params)
    } catch (err) {
      console.warn('[EV91] local proxy unavailable:', err?.message || err)
    }
  }

  // Prefer Amplify same-origin rewrite (works on main.*.amplifyapp.com)
  try {
    return await fetchEv91MisViaAmplifyRewrite(endpoint, params)
  } catch (err) {
    console.warn('[EV91] Amplify rewrite path failed:', err?.message || err)
  }

  return fetchEv91MisDirect(endpoint, params)
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
