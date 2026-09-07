/**
 * Aging rental pending transfer API by EV91 Rider ID.
 *
 * 1) rental_pending_data (if present)
 * 2) else EV91 Overall Vehicle Status → latest Deployed row → aging from deploy date
 *
 * Response fields:
 *   city, month, rider_id, contact_no, rider_name, client_name, ev91_rider_id,
 *   week_start_date, week_end_date, vehicle_number, actual_pending_for_week, aging_days, source
 *
 * aging_days (IST): before 12:00 → calendar-1, at/after 12:00 → calendar
 *   ex deploy/week_end 02-09-2026, today 07-09-2026 → 4 before noon, 5 after noon
 *
 * Local:
 *   http://localhost:5173/api/rental-pending?ev91_rider_id=CHE-26-R001711&api_key=ev91-rental-pending-2026
 */
import { getSupabase } from './lib/supabaseServer.js'

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
        message:
          'No rental pending data, and no Deployed status found in EV91 Overall Vehicle Status for this EV91 Rider ID',
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      ev91_rider_id: ev91RiderId,
      data: mapOverallDeployedPublic(latestDeployed, ev91RiderId),
    },
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

  // Prefer production RPC when available
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('rental_pending_transfer', {
      p_ev91_rider_id: ev91RiderId,
      p_api_key: getExpectedApiKey(),
      p_history: history,
    })
    if (!error && data && typeof data === 'object') {
      const body = data
      if (body.success === false) {
        const msg = String(body.message || '')
        if (/unauthoriz/i.test(msg)) return { status: 401, body }
        if (/missing required/i.test(msg)) return { status: 400, body }
        // Not found in rental pending → try Overall Status Deployed fallback
        return lookupOverallDeployedFallback(ev91RiderId)
      }
      // Normalize to fixed contract (DD/MM/YYYY dates, missing → 0)
      if (Array.isArray(body.data)) {
        body.data = body.data.map((row) => normalizeAgingPayload(row, ev91RiderId))
        body.count = body.data.length
      } else if (body.data) {
        body.data = normalizeAgingPayload(body.data, ev91RiderId)
      }
      return { status: 200, body }
    }
    if (error && !/could not find|does not exist|schema cache/i.test(error.message || '')) {
      throw error
    }
  } catch (rpcErr) {
    if (!/could not find|does not exist|schema cache/i.test(rpcErr?.message || '')) {
      console.warn('[api/rental-pending] RPC fallback:', rpcErr?.message || rpcErr)
    }
  }

  const rows = sortRentalRowsNewestFirst(await fetchRentalRowsByEv91(ev91RiderId))
  if (!rows.length) {
    return lookupOverallDeployedFallback(ev91RiderId)
  }

  if (history) {
    return {
      status: 200,
      body: {
        success: true,
        ev91_rider_id: ev91RiderId,
        count: rows.length,
        data: rows.map((row) => mapRentalPublic(row)),
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      ev91_rider_id: ev91RiderId,
      data: mapRentalPublic(rows[0]),
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
