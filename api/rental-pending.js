/**
 * Public transfer API for rental pending (and related amounts) by EV91 Rider ID.
 *
 * Hosting: this dashboard is on AWS Amplify (not Vercel):
 *   https://main.d2y6lleakorn3s.amplifyapp.com/
 *
 * Production transfer (Amplify is static — use Supabase RPC):
 *   POST https://arnxvnkednpzyzyfculx.supabase.co/rest/v1/rpc/rental_pending_transfer
 *   Body: { "p_ev91_rider_id": "12345", "p_api_key": "ev91-rental-pending-2026", "p_history": false }
 *   Run sql/create_rental_pending_transfer_rpc.sql once in Supabase.
 *
 * Local Vite:
 *   GET /api/rental-pending?ev91_rider_id=12345
 *   Header: x-api-key: ev91-rental-pending-2026
 *
 * Auth: RENTAL_PENDING_API_KEY (default: ev91-rental-pending-2026).
 * Optional: ?history=1 returns all weeks for that EV91 ID.
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
}

function getQuery(req) {
  if (req?.query && typeof req.query === 'object' && Object.keys(req.query).length) {
    return req.query
  }
  try {
    const rawUrl = req?.url || '/'
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
  const fromQuery = query?.api_key || query?.apiKey || query?.['x-api-key']
  if (fromQuery != null && String(fromQuery).trim()) return String(fromQuery).trim()
  return ''
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

function numOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseWeekEndMs(row) {
  const raw = (row?.week_end_date ?? '').toString().trim()
  if (!raw) return 0
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

function preferRentalRow(a, b) {
  const aWeek = parseWeekEndMs(a)
  const bWeek = parseWeekEndMs(b)
  if (aWeek !== bWeek) return aWeek > bWeek ? a : b
  const aCreated = Date.parse(a?.created_at || '') || 0
  const bCreated = Date.parse(b?.created_at || '') || 0
  if (aCreated !== bCreated) return aCreated > bCreated ? a : b
  return (a?.id ?? 0) >= (b?.id ?? 0) ? a : b
}

function sortRentalRowsNewestFirst(rows) {
  return [...(rows || [])].sort((a, b) => {
    const preferred = preferRentalRow(a, b)
    return preferred === a ? -1 : 1
  })
}

function mapRentalPublic(row, damageTraffic = {}) {
  if (!row) return null
  return {
    ev91_rider_id: (row.ev91_rider_id ?? '').toString().trim() || null,
    rider_id: (row.rider_id ?? '').toString().trim() || null,
    rider_name: (row.rider_name ?? '').toString().trim() || null,
    city: (row.city ?? '').toString().trim() || null,
    client_name: (row.client_name ?? '').toString().trim() || null,
    month: (row.month ?? '').toString().trim() || null,
    week_start_date: (row.week_start_date ?? '').toString().trim() || null,
    week_end_date: (row.week_end_date ?? '').toString().trim() || null,
    actual_pending_for_week: numOrNull(row.actual_pending_for_week_after_sd),
    total_rent_amount: numOrNull(row.total_rent_amount),
    total_sd_amount: numOrNull(row.total_sd_amount),
    pending_amount: numOrNull(row.pending_amount),
    manual_collection: numOrNull(row.manual_payment_collection),
    payout_deductions: numOrNull(row.payout_deduction_week_23),
    rent_per_week: numOrNull(row.rent_per_week),
    current_status: (row.current_status ?? '').toString().trim() || null,
    db_current_status: (row.db_current_status ?? '').toString().trim() || null,
    vehicle_status: (row.vehicle_status ?? '').toString().trim() || null,
    vehicle_number: (row.vehicle_number ?? '').toString().trim() || null,
    contact_no: (row.contact_no ?? '').toString().trim() || null,
    source_name: (row.source_name ?? '').toString().trim() || null,
    inactive_days: numOrNull(row.inactive_days),
    current_week_orders: numOrNull(row.current_week_orders),
    // Future-ready: from rider_payment_data when available; otherwise null
    damage_amount: damageTraffic.damage_amount ?? null,
    traffic_challan_amount: damageTraffic.traffic_challan_amount ?? null,
  }
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

async function fetchDamageTrafficByRiderId(riderId) {
  const id = (riderId ?? '').toString().trim()
  if (!id) return { damage_amount: null, traffic_challan_amount: null }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('rider_payment_data')
    .select('id,rider_id,damage,traffic,created_at')
    .eq('rider_id', id)
    .order('id', { ascending: false })
    .limit(50)

  if (error) {
    // Table may be missing in some envs — keep transfer working for rental pending
    console.warn('[api/rental-pending] rider_payment_data lookup failed:', error.message || error)
    return { damage_amount: null, traffic_challan_amount: null }
  }

  let damage_amount = null
  let traffic_challan_amount = null
  for (const row of data || []) {
    if (damage_amount == null && row.damage != null && row.damage !== '') {
      damage_amount = numOrNull(row.damage)
    }
    if (traffic_challan_amount == null && row.traffic != null && row.traffic !== '') {
      traffic_challan_amount = numOrNull(row.traffic)
    }
    if (damage_amount != null && traffic_challan_amount != null) break
  }

  return { damage_amount, traffic_challan_amount }
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

  // Prefer production RPC when available (same contract as Amplify / other web apps)
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
        const status = /unauthoriz/i.test(msg) ? 401 : /missing required/i.test(msg) ? 400 : 404
        return { status, body }
      }
      return { status: 200, body }
    }
    if (error && !/could not find|does not exist|schema cache/i.test(error.message || '')) {
      throw error
    }
  } catch (rpcErr) {
    // Fall through to direct table lookup if RPC not installed yet
    if (!/could not find|does not exist|schema cache/i.test(rpcErr?.message || '')) {
      console.warn('[api/rental-pending] RPC fallback:', rpcErr?.message || rpcErr)
    }
  }

  const rows = sortRentalRowsNewestFirst(await fetchRentalRowsByEv91(ev91RiderId))
  if (!rows.length) {
    return {
      status: 404,
      body: {
        success: false,
        ev91_rider_id: ev91RiderId,
        message: 'No rental pending data found for this EV91 Rider ID',
      },
    }
  }

  const latest = rows[0]
  const damageTraffic = await fetchDamageTrafficByRiderId(latest.rider_id)

  if (history) {
    return {
      status: 200,
      body: {
        success: true,
        ev91_rider_id: ev91RiderId,
        count: rows.length,
        data: rows.map((row) => mapRentalPublic(row, damageTraffic)),
      },
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      ev91_rider_id: ev91RiderId,
      data: mapRentalPublic(latest, damageTraffic),
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
    const provided = extractApiKey(request, query)
    if (!provided || provided !== getExpectedApiKey()) {
      return Response.json(
        { success: false, message: 'Unauthorized. Provide a valid x-api-key.' },
        { status: 401, headers: corsHeaders() }
      )
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
  const provided = extractApiKey(req, query)
  if (!provided || provided !== getExpectedApiKey()) {
    return sendNode(res, 401, {
      success: false,
      message: 'Unauthorized. Provide a valid x-api-key.',
    })
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
