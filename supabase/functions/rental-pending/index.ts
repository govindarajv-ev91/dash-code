/**
 * Supabase Edge Function — production GET API matching localhost:
 *   /api/rental-pending?ev91_rider_id=...&api_key=ev91-rental-pending-2026
 *
 * Deploy:
 *   npx supabase functions deploy rental-pending --no-verify-jwt
 *
 * Amplify rewrite (amplify-redirects.json) proxies:
 *   /api/rental-pending → this function
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const DEFAULT_API_KEY = 'ev91-rental-pending-2026'

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
    url.searchParams.get('x-api-key') ||
    url.searchParams.get('key') ||
    ''
  ).trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
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

  const ev91 = (url.searchParams.get('ev91_rider_id') || url.searchParams.get('ev91RiderId') || '').trim()
  if (!ev91) {
    return json(400, {
      success: false,
      message: 'Missing required query parameter: ev91_rider_id',
    })
  }

  const historyRaw = (url.searchParams.get('history') || '').trim().toLowerCase()
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
    return json(500, { success: false, message: error.message || 'RPC failed' })
  }

  const body = data && typeof data === 'object' ? data : { success: false, message: 'Empty response' }
  if (body.success === false) {
    const msg = String(body.message || '')
    const status = /unauthoriz/i.test(msg) ? 401 : /missing required/i.test(msg) ? 400 : 404
    return json(status, body)
  }
  return json(200, body)
})
