/**
 * Aging rental pending transfer API by EV91 Rider ID.
 *
 * 1) rental_pending_data (if present)
 * 2) else EV91 Overall Vehicle Status → latest Deployed row → aging from deploy date
 *
 * Response fields:
 *   city, month, rider_id, contact_no, rider_name, client_name, ev91_rider_id,
 *   week_start_date, week_end_date, vehicle_number, actual_pending_for_week, aging_days,
 *   per_order_amount, "order DD/MM/YYYY"…, total_order, earning
 * Multi-client riders also get `by_client` (latest row per client) + `count`.
 * Optional filters: client_name / rider_id (or p_client_name / p_rider_id).
 *
 * Post-week orders: (week_end + 1) → yesterday IST from order_upload_data (worker_code = rider_id).
 * earning = total_order × per_order_amount (Full Data commercial rates).
 *
 * Local:
 *   http://localhost:5173/api/rental-pending?ev91_rider_id=CHE-26-R001711&api_key=ev91-rental-pending-2026
 *   …&client_name=BB   or   …&rider_id=1019322
 */
import { getSupabase } from './lib/supabaseServer.js'

/** Client per-order ₹ — keep in sync with src/lib/fullDataCommercialRates.js */
const PER_ORDER_RATE_BY_KEY = {
  amazon: 40,
  'bb now': 47,
  bb: 47,
  bigbasket: 47,
  'big basket': 47,
  blinkit: 53,
  docpharma: 140,
  'doc pharma': 140,
  'flipkart minutes': 49,
  'flipkart-minutes': 49,
  fkm: 49,
  'flipkart-lma': 18,
  'fkm-lma': 18,
  inamo: 65,
  instamart: 49,
  swiggy: 49,
  'swiggy instamart': 49,
  kpn: 63,
  'kwik myntra': 82,
  'kwik nykaa': 80,
  'kwik purple': 47,
  licious: 56,
  'rapido ownly': 90,
  rsm: 64,
  zepto: 43,
}

function getClientPerOrderRate(clientName) {
  const key = String(clientName || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+/g, ' ')
  if (!key) return 0
  if (PER_ORDER_RATE_BY_KEY[key] != null) return PER_ORDER_RATE_BY_KEY[key]
  if (key.startsWith('kwik')) return PER_ORDER_RATE_BY_KEY[key] ?? 47
  return 0
}

const DEFAULT_API_KEY = 'ev91-rental-pending-2026'

const RENTAL_COLS =
  'id,month,deployed_date,db_current_status,vehicle_status,current_status,client_name,contact_no,rider_name,ev91_rider_id,rider_id,vehicle_number,city,week_start_date,week_end_date,rent_per_week,source_name,deficit_amount_week_22,wk_23_ev_rent,total_rent_amount,payout_deduction_week_23,total_sd_amount,pending_amount,manual_payment_collection,actual_pending_for_week_after_sd,payment_collected_date,inactive_days,eff_inff,current_week_orders,remarks,created_at'

function getExpectedApiKey() {
  return (
    process.env.RENTAL_PENDING_API_KEY ||
    process.env.VITE_RENTAL_PENDING_API_KEY ||
    DEFAULT_API_KEY
  )
    .toString()
    .trim()
}

function getQuery(req) {
  if (req?.query && typeof req.query === 'object' && Object.keys(req.query).length) {
    return req.query
  }
  try {
    // Vite/Connect mount strips the path; prefer originalUrl so ?api_key= stays intact
    const rawUrl = req?.originalUrl || req?.url || '/'
    const url = new URL(rawUrl, 'http://localhost')
    return Object.fromEntries(url.searchParams.entries())
  } catch {
    return {}
  }
}

function getHeader(req, name) {
  const lower = name.toLowerCase()
  if (typeof req?.headers?.get === 'function') {
    return req.headers.get(name) || req.headers.get(lower) || ''
  }
  const headers = req?.headers || {}
  return headers[lower] || headers[name] || ''
}

function extractApiKey(req, query) {
  const fromHeader = getHeader(req, 'x-api-key')
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim()

  const auth = getHeader(req, 'authorization')
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim()
  }

  const fromQuery =
    query?.api_key || query?.apiKey || query?.['x-api-key'] || query?.key
  if (fromQuery != null && String(fromQuery).trim()) return String(fromQuery).trim()
  return ''
}

function unauthorizedBody() {
  return {
    success: false,
    message: 'Unauthorized. Provide a valid x-api-key.',
    hint: `Browser test: /api/rental-pending?ev91_rider_id=YOUR_ID&api_key=${DEFAULT_API_KEY}`,
  }
}

function isAuthorized(req, query) {
  const provided = extractApiKey(req, query)
  return Boolean(provided) && provided === getExpectedApiKey()
}

function sendNode(res, status, body) {
  if (typeof res?.status === 'function' && typeof res?.json === 'function') {
    res.setHeader?.('Access-Control-Allow-Origin', '*')
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader?.('Access-Control-Allow-Headers', 'Accept, Content-Type, x-api-key')
    res.setHeader?.('Cache-Control', 'no-store')
    return res.status(status).json(body)
  }
  res.statusCode = status
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  res.setHeader?.('Access-Control-Allow-Origin', '*')
  res.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader?.('Access-Control-Allow-Headers', 'Accept, Content-Type, x-api-key')
  res.setHeader?.('Cache-Control', 'no-store')
  res.end?.(JSON.stringify(body))
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, x-api-key',
    'Cache-Control': 'no-store',
  }
}

function parseWeekEndDate(raw) {
  if (raw === 0 || raw === '0') return null
  const t = (raw ?? '').toString().trim()
  if (!t) return null

  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/)
  if (m) {
    let year = Number(m[3])
    if (m[3].length === 2) year += year >= 70 ? 1900 : 2000
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])))
    if (!Number.isNaN(d.getTime())) return d
  }

  m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    if (!Number.isNaN(d.getTime())) return d
  }

  const parsed = Date.parse(t)
  return Number.isFinite(parsed) ? new Date(parsed) : null
}

function getIstParts(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
  }
}

export function rentalPendingAgingDays(weekEndRaw, now = new Date()) {
  const weekEnd = parseWeekEndDate(weekEndRaw)
  if (!weekEnd) return null

  const ist = getIstParts(now)
  const todayUtc = Date.UTC(ist.year, ist.month, ist.day)
  const weekUtc = Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth(), weekEnd.getUTCDate())
  let calendarDays = Math.round((todayUtc - weekUtc) / 86400000)
  if (calendarDays < 0) return 0
  if (ist.hour < 12) return Math.max(calendarDays - 1, 0)
  return calendarDays
}

function numOrZero(value) {
  if (value == null || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function textOrZero(value) {
  if (value === 0 || value === '0') return 0
  const t = (value ?? '').toString().trim()
  return t || 0
}

/** Format any known date string as DD/MM/YYYY; missing → 0 */
function formatDdMmYyyy(raw) {
  if (raw === 0 || raw === '0' || raw == null || raw === '') return 0
  const d = parseWeekEndDate(raw)
  if (!d || Number.isNaN(d.getTime())) {
    const t = String(raw).trim()
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      const parts = t.split('/')
      return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`
    }
    return 0
  }
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getUTCFullYear())
  return `${dd}/${mm}/${yyyy}`
}

/**
 * Fixed public payload — always these keys; missing values → 0
 * Order enrichment fields are merged later via enrichAgingPayloadWithOrders.
 */
function normalizeAgingPayload(partial = {}, ev91RiderId = '') {
  const weekEndRaw = partial.week_end_date === 0 ? 0 : partial.week_end_date ?? partial.deployed_date ?? ''
  const weekStartRaw = partial.week_start_date === 0 ? 0 : partial.week_start_date ?? ''
  const aging =
    partial.aging_days != null && partial.aging_days !== ''
      ? numOrZero(partial.aging_days)
      : rentalPendingAgingDays(weekEndRaw) ?? 0

  return {
    city: textOrZero(partial.city),
    month: textOrZero(partial.month),
    rider_id: textOrZero(partial.rider_id),
    aging_days: aging,
    contact_no: textOrZero(partial.contact_no),
    rider_name: textOrZero(partial.rider_name),
    client_name: textOrZero(partial.client_name),
    ev91_rider_id: textOrZero(partial.ev91_rider_id || ev91RiderId),
    week_end_date: formatDdMmYyyy(weekEndRaw),
    vehicle_number: textOrZero(partial.vehicle_number),
    week_start_date: formatDdMmYyyy(weekStartRaw),
    actual_pending_for_week: numOrZero(partial.actual_pending_for_week),
  }
}

function ymdUtc(date) {
  if (!date || Number.isNaN(date.getTime())) return ''
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function addUtcDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

function formatOrderKey(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(date.getUTCFullYear())
  return `order ${dd}/${mm}/${yyyy}`
}

async function fetchOrdersByDayForRider(riderId, rangeStart, rangeEnd) {
  const rider = String(riderId || '').trim()
  if (!rider || !rangeStart || !rangeEnd) return new Map()

  const supabase = getSupabase()
  const from = ymdUtc(rangeStart)
  const to = ymdUtc(rangeEnd)
  const { data, error } = await supabase
    .from('order_upload_data')
    .select('date_record,delivered,worker_code')
    .eq('worker_code', rider)
    .gte('date_record', from)
    .lte('date_record', to)
    .limit(5000)

  if (error) throw error

  const byDay = new Map()
  for (const row of data || []) {
    const d = parseWeekEndDate(row.date_record)
    if (!d) continue
    const key = ymdUtc(d)
    byDay.set(key, (byDay.get(key) || 0) + numOrZero(row.delivered))
  }
  return byDay
}

/**
 * Attach per_order_amount, day-wise "order DD/MM/YYYY", total_order, earning.
 * Range: day after week_end → yesterday (IST).
 */
async function enrichAgingPayloadWithOrders(payload) {
  const base = { ...(payload || {}) }
  const clientName = base.client_name === 0 ? '' : base.client_name
  const riderId = base.rider_id === 0 ? '' : base.rider_id
  const rate = getClientPerOrderRate(clientName) ?? 0
  base.per_order_amount = numOrZero(rate)

  const weekEnd = parseWeekEndDate(base.week_end_date)
  if (!weekEnd || !riderId) {
    base.total_order = 0
    base.earning = 0
    return base
  }

  const ist = getIstParts()
  const yesterday = new Date(Date.UTC(ist.year, ist.month, ist.day - 1))
  const rangeStart = addUtcDays(weekEnd, 1)
  if (rangeStart.getTime() > yesterday.getTime()) {
    base.total_order = 0
    base.earning = 0
    return base
  }

  let byDay = new Map()
  try {
    byDay = await fetchOrdersByDayForRider(riderId, rangeStart, yesterday)
  } catch (err) {
    console.warn('[api/rental-pending] order enrich failed:', err?.message || err)
  }

  let total = 0
  for (let d = new Date(rangeStart.getTime()); d.getTime() <= yesterday.getTime(); d = addUtcDays(d, 1)) {
    const qty = numOrZero(byDay.get(ymdUtc(d)))
    total += qty
    base[formatOrderKey(d)] = qty
  }
  base.total_order = total
  base.earning = total * numOrZero(rate)
  return base
}

async function enrichLookupBody(body) {
  if (!body || body.success === false || !body.data) return body
  if (Array.isArray(body.data)) {
    body.data = await Promise.all(body.data.map((row) => enrichAgingPayloadWithOrders(row)))
    body.count = body.data.length
  } else {
    body.data = await enrichAgingPayloadWithOrders(body.data)
  }
  return body
}

function mapRentalPublic(row) {
  if (!row) return null
  return normalizeAgingPayload({
    city: row.city,
    month: row.month,
    rider_id: row.rider_id,
    contact_no: row.contact_no,
    rider_name: row.rider_name,
    client_name: row.client_name,
    ev91_rider_id: row.ev91_rider_id,
    week_start_date: row.week_start_date,
    week_end_date: row.week_end_date,
    vehicle_number: row.vehicle_number,
    actual_pending_for_week: row.actual_pending_for_week_after_sd,
  })
}

function isDeployedStatus(value) {
  return /^deployed$/i.test(String(value || '').trim())
}

function mapOverallDeployedPublic(row, ev91RiderId) {
  const statusDate =
    parseWeekEndDate(row?.statusDate) || (Date.parse(row?.statusDate) ? new Date(row.statusDate) : null)
  const deployDate = statusDate
    ? new Date(Date.UTC(statusDate.getUTCFullYear(), statusDate.getUTCMonth(), statusDate.getUTCDate()))
    : null
  const deployKey = deployDate ? formatDdMmYyyy(deployDate) : row?.statusDate

  // Identity + aging from Overall Status; remaining fields → 0
  return normalizeAgingPayload(
    {
      city: row.cityName || row.city,
      month: 0,
      rider_id: row.clientId,
      contact_no: row.riderContact || row.phoneNumber,
      rider_name: row.riderName,
      client_name: row.clientName,
      ev91_rider_id: row.ev91RiderId || ev91RiderId,
      week_start_date: 0,
      week_end_date: 0,
      vehicle_number: 0,
      actual_pending_for_week: 0,
      aging_days: rentalPendingAgingDays(deployKey) ?? 0,
    },
    ev91RiderId
  )
}

function pickLatestDeployedOverallRow(rows, ev91RiderId) {
  const id = String(ev91RiderId || '').trim().toLowerCase()
  const deployed = (rows || []).filter((r) => {
    if (!isDeployedStatus(r.vehicleStatus)) return false
    const rid = String(r.ev91RiderId || '').trim().toLowerCase()
    return !id || rid === id
  })
  if (!deployed.length) return null

  deployed.sort((a, b) => {
    const ta = Date.parse(a.statusDate) || 0
    const tb = Date.parse(b.statusDate) || 0
    return tb - ta
  })
  return deployed[0]
}

async function fetchEv91OverallForRider(ev91RiderId) {
  const key =
    process.env.EV91_MIS_API_KEY ||
    process.env.VITE_EV91_MIS_API_KEY ||
    'ev91-mis-public-2026'
  const base = 'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/overall-status'
  const params = new URLSearchParams({
    limit: '50',
    offset: '0',
    search: String(ev91RiderId || '').trim(),
  })
  const upstream = await fetch(`${base}?${params}`, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
    cache: 'no-store',
  })
  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || !body || body.success === false) {
    throw new Error(body?.message || `EV91 overall-status HTTP ${upstream.status}`)
  }
  return body.data || body.rows || []
}

async function lookupOverallDeployedFallback(ev91RiderId) {
  const rows = await fetchEv91OverallForRider(ev91RiderId)
  const latestDeployed = pickLatestDeployedOverallRow(rows, ev91RiderId)
  if (!latestDeployed) {
    return {
      status: 404,
      body: {
        success: false,
        ev91_rider_id: ev91RiderId,
        message: 'No_Data',
      },
    }
  }

  return {
    status: 200,
    body: await enrichLookupBody({
      success: true,
      ev91_rider_id: ev91RiderId,
      data: mapOverallDeployedPublic(latestDeployed, ev91RiderId),
    }),
  }
}

function preferRentalRow(a, b) {
  const aWeek = parseWeekEndDate(a?.week_end_date)?.getTime() || 0
  const bWeek = parseWeekEndDate(b?.week_end_date)?.getTime() || 0
  if (aWeek !== bWeek) return aWeek > bWeek ? a : b
  const aCreated = Date.parse(a?.created_at || '') || 0
  const bCreated = Date.parse(b?.created_at || '') || 0
  if (aCreated !== bCreated) return aCreated > bCreated ? a : b
  return (a?.id ?? 0) >= (b?.id ?? 0) ? a : b
}

function sortRentalRowsNewestFirst(rows) {
  return [...(rows || [])].sort((a, b) => (preferRentalRow(a, b) === a ? -1 : 1))
}

/** Latest upload (id desc) per client_name. */
function latestRentalRowPerClient(rows) {
  const byClient = new Map()
  for (const row of sortRentalRowsByIdDesc(rows)) {
    const key = String(row?.client_name || '')
      .trim()
      .toLowerCase() || '_unknown'
    if (!byClient.has(key)) byClient.set(key, row)
  }
  return [...byClient.values()]
}

/** Keep RPC money/order fields after normalize (do not recompute from one client). */
function mergeRpcAgingPayload(row, ev91RiderId) {
  const base = normalizeAgingPayload(row, ev91RiderId)
  if (!row || typeof row !== 'object') return base
  base.actual_pending_for_week = numOrZero(
    row.actual_pending_for_week ?? base.actual_pending_for_week
  )
  if (row.earning != null && row.earning !== '') base.earning = numOrZero(row.earning)
  if (row.total_order != null && row.total_order !== '') base.total_order = numOrZero(row.total_order)
  if (row.per_order_amount != null && row.per_order_amount !== '') {
    base.per_order_amount = numOrZero(row.per_order_amount)
  }
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('order ')) base[key] = numOrZero(value)
  }
  return base
}

/**
 * Multi-client rollup for `data`.
 * Keeps primary actual_pending_for_week (does NOT sum clients).
 * Sums earning + total_order + day-wise orders only.
 */
function aggregateMultiClientPayload(primary, byClientRows = []) {
  const rows = byClientRows.length ? byClientRows : primary ? [primary] : []
  if (!rows.length) return primary || normalizeAgingPayload({})
  if (rows.length === 1) return { ...(primary || rows[0]) }

  const base = { ...(primary || rows[0] || {}) }
  let sumEarning = 0
  let sumOrders = 0
  const orderTotals = new Map()

  for (const row of rows) {
    sumEarning += numOrZero(row.earning)
    sumOrders += numOrZero(row.total_order)

    for (const [key, value] of Object.entries(row || {})) {
      if (!key.startsWith('order ')) continue
      orderTotals.set(key, (orderTotals.get(key) || 0) + numOrZero(value))
    }
  }

  for (const key of Object.keys(base)) {
    if (key.startsWith('order ')) delete base[key]
  }
  for (const [key, qty] of orderTotals) {
    base[key] = qty
  }

  base.earning = sumEarning
  base.total_order = sumOrders
  return base
}

/** Latest upload id first (matches original production primary pick). */
function sortRentalRowsByIdDesc(rows) {
  return [...(rows || [])].sort((a, b) => (b?.id ?? 0) - (a?.id ?? 0))
}

function filterRentalRowsByClient(rows, clientName, riderId) {
  const client = String(clientName || '').trim().toLowerCase()
  const rider = String(riderId || '').trim()
  return (rows || []).filter((row) => {
    if (client && String(row.client_name || '').trim().toLowerCase() !== client) return false
    if (rider && String(row.rider_id || '').trim() !== rider) return false
    return true
  })
}

async function fetchRentalRowsByEv91(ev91RiderId) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('rental_pending_data')
    .select(RENTAL_COLS)
    .eq('ev91_rider_id', ev91RiderId)
    .order('id', { ascending: false })
    .limit(500)

  if (error) throw error
  return data || []
}

async function handleLookup(query) {
  const ev91RiderId = String(query.ev91_rider_id || query.ev91RiderId || '').trim()
  if (!ev91RiderId) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Missing required query parameter: ev91_rider_id',
      },
    }
  }

  const history =
    query.history === '1' ||
    query.history === 'true' ||
    String(query.history || '').toLowerCase() === 'yes'

  const clientFilter = String(
    query.client_name || query.clientName || query.p_client_name || ''
  ).trim()
  const riderFilter = String(
    query.rider_id || query.riderId || query.p_rider_id || ''
  ).trim()

  // Prefer production RPC when available
  try {
    const supabase = getSupabase()
    const rpcArgs = {
      p_ev91_rider_id: ev91RiderId,
      p_api_key: getExpectedApiKey(),
      p_history: history,
    }
    const { data, error } = await supabase.rpc('rental_pending_transfer', rpcArgs)
    if (!error && data && typeof data === 'object') {
      const body = data
      if (body.success === false) {
        const msg = String(body.message || '')
        if (/unauthoriz/i.test(msg)) return { status: 401, body }
        if (/missing required/i.test(msg)) return { status: 400, body }
        // Not found in rental pending → try Overall Status Deployed fallback
        return lookupOverallDeployedFallback(ev91RiderId)
      }
      // Normalize to fixed contract (DD/MM/YYYY dates, missing → 0), then attach orders
      if (history && Array.isArray(body.data)) {
        body.data = body.data.map((row) => normalizeAgingPayload(row, ev91RiderId))
        body.count = body.data.length
        return { status: 200, body: await enrichLookupBody(body) }
      }

      if (Array.isArray(body.by_client) && body.by_client.length) {
        const clients = await Promise.all(
          body.by_client
            .map((row) => normalizeAgingPayload(row, ev91RiderId))
            .map((row) => enrichAgingPayloadWithOrders(row))
        )
        // Prefer SQL `data` (primary by id + pending not summed); else build from clients
        let data
        if (body.data && !Array.isArray(body.data)) {
          data = mergeRpcAgingPayload(body.data, ev91RiderId)
          // Re-apply earning/order sum from clients; keep pending from SQL primary
          if (clients.length > 1 && !clientFilter && !riderFilter) {
            const pending = data.actual_pending_for_week
            data = aggregateMultiClientPayload(data, clients)
            data.actual_pending_for_week = pending
          }
        } else {
          const primaryRow = sortRentalRowsByIdDesc(
            await fetchRentalRowsByEv91(ev91RiderId)
          )[0]
          const primaryPayload =
            clients.find(
              (c) =>
                String(c.client_name || '').toLowerCase() ===
                String(primaryRow?.client_name || '').toLowerCase()
            ) || clients[0]
          data =
            clients.length > 1 && !clientFilter && !riderFilter
              ? aggregateMultiClientPayload(primaryPayload, clients)
              : primaryPayload
        }
        return {
          status: 200,
          body: {
            success: true,
            ev91_rider_id: ev91RiderId,
            data,
            by_client: clients,
          },
        }
      }

      if (body.data && !Array.isArray(body.data)) {
        // Simple production shape: normalize + attach orders/earning
        const data = await enrichAgingPayloadWithOrders(
          mergeRpcAgingPayload(body.data, ev91RiderId)
        )
        return {
          status: 200,
          body: {
            success: true,
            ev91_rider_id: ev91RiderId,
            data,
          },
        }
      }
      return { status: 200, body }
    }
    if (error && !/could not find|does not exist|schema cache|function.*rental_pending_transfer/i.test(error.message || '')) {
      throw error
    }
  } catch (rpcErr) {
    if (!/could not find|does not exist|schema cache|function.*rental_pending_transfer/i.test(rpcErr?.message || '')) {
      console.warn('[api/rental-pending] RPC fallback:', rpcErr?.message || rpcErr)
    }
  }

  let rows = sortRentalRowsNewestFirst(await fetchRentalRowsByEv91(ev91RiderId))
  rows = filterRentalRowsByClient(rows, clientFilter, riderFilter)
  if (!rows.length) {
    return lookupOverallDeployedFallback(ev91RiderId)
  }

  if (history) {
    return {
      status: 200,
      body: await enrichLookupBody({
        success: true,
        ev91_rider_id: ev91RiderId,
        count: rows.length,
        data: rows.map((row) => mapRentalPublic(row)),
      }),
    }
  }

  const perClient = latestRentalRowPerClient(rows)
  const enrichedClients = await Promise.all(
    perClient.map((row) => enrichAgingPayloadWithOrders(mapRentalPublic(row)))
  )
  const primaryRow = sortRentalRowsByIdDesc(rows)[0]
  const primaryPayload =
    enrichedClients.find(
      (c) =>
        String(c.client_name || '').toLowerCase() ===
        String(primaryRow?.client_name || '').toLowerCase()
    ) || enrichedClients[0]
  const multi = enrichedClients.length > 1 && !clientFilter && !riderFilter
  return {
    status: 200,
    body: {
      success: true,
      ev91_rider_id: ev91RiderId,
      data: multi
        ? aggregateMultiClientPayload(primaryPayload, enrichedClients)
        : primaryPayload,
      by_client: enrichedClients,
    },
  }
}

export default async function handler(req, res) {
  const isFetchApi =
    (typeof Request !== 'undefined' && req instanceof Request) ||
    (req && !res && typeof req?.headers?.get === 'function')

  if (isFetchApi) {
    const request = req
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (request.method && request.method !== 'GET') {
      return Response.json(
        { success: false, message: 'Method not allowed' },
        { status: 405, headers: { ...corsHeaders(), Allow: 'GET' } }
      )
    }

    const query = Object.fromEntries(new URL(request.url).searchParams.entries())
    if (!isAuthorized(request, query)) {
      return Response.json(unauthorizedBody(), { status: 401, headers: corsHeaders() })
    }

    try {
      const { status, body } = await handleLookup(query)
      return Response.json(body, { status, headers: corsHeaders() })
    } catch (err) {
      console.error('[api/rental-pending]', err)
      return Response.json(
        { success: false, message: err?.message || 'Failed to load rental pending data' },
        { status: 500, headers: corsHeaders() }
      )
    }
  }

  if (req?.method === 'OPTIONS') {
    res.setHeader?.('Access-Control-Allow-Origin', '*')
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader?.('Access-Control-Allow-Headers', 'Accept, Content-Type, x-api-key')
    return res.status?.(204).end?.() ?? ((res.statusCode = 204), res.end?.())
  }

  if (req?.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET')
    return sendNode(res, 405, { success: false, message: 'Method not allowed' })
  }

  const query = getQuery(req)
  if (!isAuthorized(req, query)) {
    return sendNode(res, 401, unauthorizedBody())
  }

  try {
    const { status, body } = await handleLookup(query)
    return sendNode(res, status, body)
  } catch (err) {
    console.error('[api/rental-pending]', err)
    return sendNode(res, 500, {
      success: false,
      message: err?.message || 'Failed to load rental pending data',
    })
  }
}
