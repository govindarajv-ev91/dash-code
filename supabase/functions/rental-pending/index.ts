/**
 * Supabase Edge Function — aging rental pending API (+ Overall Status Deployed fallback).
 *
 * Deploy:
 *   npx supabase functions deploy rental-pending --no-verify-jwt
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const DEFAULT_API_KEY = 'ev91-rental-pending-2026'
const EV91_KEY = Deno.env.get('EV91_MIS_API_KEY') || 'ev91-mis-public-2026'
const EV91_OVERALL =
  'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/overall-status'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type, x-api-key, Authorization, apikey',
  'Cache-Control': 'no-store',
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function extractApiKey(req, url) {
  const header = req.headers.get('x-api-key')
  if (header && header.trim()) return header.trim()
  const auth = req.headers.get('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return (
    url.searchParams.get('api_key') ||
    url.searchParams.get('apiKey') ||
    url.searchParams.get('p_api_key') ||
    url.searchParams.get('x-api-key') ||
    url.searchParams.get('key') ||
    ''
  ).trim()
}

function parseWeekEndDate(raw) {
  const t = (raw ?? '').toString().trim()
  if (!t) return null
  let m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/)
  if (m) {
    let year = Number(m[3])
    if (m[3].length === 2) year += year >= 70 ? 1900 : 2000
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])))
  }
  m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
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

function rentalPendingAgingDays(weekEndRaw, now = new Date()) {
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

function formatDdMmYy(date) {
  if (!date || Number.isNaN(date.getTime())) return null
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(date.getUTCFullYear()).slice(-2)
  return `${dd}-${mm}-${yy}`
}

function formatMonthLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return null
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`
}

function mapOverallDeployedPublic(row, ev91RiderId) {
  const statusDate = parseWeekEndDate(row?.statusDate)
  const deployDate = statusDate
    ? new Date(Date.UTC(statusDate.getUTCFullYear(), statusDate.getUTCMonth(), statusDate.getUTCDate()))
    : null
  const weekEnd = formatDdMmYy(deployDate)
  return {
    city: (row.cityName || '').toString().trim() || null,
    month: formatMonthLabel(deployDate),
    rider_id: (row.clientId || '').toString().trim() || null,
    contact_no: (row.riderContact || '').toString().trim() || null,
    rider_name: (row.riderName || '').toString().trim() || null,
    client_name: (row.clientName || '').toString().trim() || null,
    ev91_rider_id: (row.ev91RiderId || ev91RiderId || '').toString().trim() || null,
    week_start_date: null,
    week_end_date: weekEnd,
    vehicle_number: (row.vehicleNumber || '').toString().trim() || null,
    actual_pending_for_week: null,
    aging_days: rentalPendingAgingDays(weekEnd || row?.statusDate),
    source: 'overall_status_deployed',
    vehicle_status: 'Deployed',
    deployed_date: weekEnd,
  }
}

async function lookupOverallDeployedFallback(ev91RiderId) {
  const params = new URLSearchParams({ limit: '50', offset: '0', search: ev91RiderId })
  const upstream = await fetch(`${EV91_OVERALL}?${params}`, {
    headers: { 'x-api-key': EV91_KEY, Accept: 'application/json' },
  })
  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || !body || body.success === false) {
    return {
      status: 502,
      body: { success: false, message: body?.message || 'Failed to reach EV91 Overall Status' },
    }
  }

  const id = ev91RiderId.toLowerCase()
  const deployed = (body.data || []).filter(
    (r) =>
      /^deployed$/i.test(String(r.vehicleStatus || '').trim()) &&
      String(r.ev91RiderId || '').trim().toLowerCase() === id
  )
  deployed.sort((a, b) => (Date.parse(b.statusDate) || 0) - (Date.parse(a.statusDate) || 0))
  const latest = deployed[0]
  if (!latest) {
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
      data: mapOverallDeployedPublic(latest, ev91RiderId),
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'GET') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  const url = new URL(req.url)
  const expected = (Deno.env.get('RENTAL_PENDING_API_KEY') || DEFAULT_API_KEY).trim()
  const provided = extractApiKey(req, url)
  if (!provided || provided !== expected) {
    return json(401, {
      success: false,
      message: 'Unauthorized. Provide a valid x-api-key.',
      hint: `/api/rental-pending?ev91_rider_id=YOUR_ID&api_key=${DEFAULT_API_KEY}`,
    })
  }

  const ev91 = (
    url.searchParams.get('ev91_rider_id') ||
    url.searchParams.get('ev91RiderId') ||
    url.searchParams.get('p_ev91_rider_id') ||
    ''
  ).trim()
  if (!ev91) {
    return json(400, { success: false, message: 'Missing required query parameter: ev91_rider_id' })
  }

  const historyRaw = (url.searchParams.get('history') || url.searchParams.get('p_history') || '')
    .trim()
    .toLowerCase()
  const history = historyRaw === '1' || historyRaw === 'true' || historyRaw === 'yes'

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL')
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_ANON_KEY') ||
    Deno.env.get('VITE_SUPABASE_ANON_KEY')

  if (!supabaseUrl || !serviceKey) {
    return json(500, { success: false, message: 'Server misconfigured (Supabase env missing)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const { data, error } = await supabase.rpc('rental_pending_transfer', {
    p_ev91_rider_id: ev91,
    p_api_key: expected,
    p_history: history,
  })

  if (error) {
    // If RPC missing, still try overall fallback
    if (!/could not find|does not exist|schema cache/i.test(error.message || '')) {
      return json(500, { success: false, message: error.message || 'RPC failed' })
    }
  } else if (data && typeof data === 'object') {
    if (data.success === false) {
      const msg = String(data.message || '')
      if (/unauthoriz/i.test(msg)) return json(401, data)
      if (/missing required/i.test(msg)) return json(400, data)
      const fallback = await lookupOverallDeployedFallback(ev91)
      return json(fallback.status, fallback.body)
    }
    if (data?.data && !Array.isArray(data.data) && !data.data.source) {
      data.data.source = 'rental_pending'
    }
    return json(200, data)
  }

  const fallback = await lookupOverallDeployedFallback(ev91)
  return json(fallback.status, fallback.body)
})
