const BASE = 'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'

/** App endpoint id → upstream path under BASE (when different from the id). */
const UPSTREAM_PATH_BY_ENDPOINT = {
  'rider-details': 'mis-public-api/rider-details',
}

const ALLOWED_ENDPOINTS = new Set([
  'current-status',
  'overall-status',
  'client-mapping-history',
  'rider-details',
])

function resolveUpstreamPath(endpoint) {
  return UPSTREAM_PATH_BY_ENDPOINT[endpoint] || endpoint
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

function getApiKey() {
  return (
    process.env.EV91_MIS_API_KEY ||
    process.env.VITE_EV91_MIS_API_KEY ||
    'ev91-mis-public-2026'
  )
}

async function fetchUpstream(endpoint, query) {
  const params = new URLSearchParams()
  for (const key of ['limit', 'offset', 'search', 'city', 'status']) {
    const value = query[key]
    if (value != null && String(value).trim() !== '') {
      params.set(key, String(value).trim())
    }
  }

  const path = resolveUpstreamPath(endpoint)
  const upstreamUrl = `${BASE}/${path}?${params.toString()}`
  const upstream = await fetch(upstreamUrl, {
    headers: {
      'x-api-key': getApiKey(),
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  const body = await upstream.json().catch(() => ({
    success: false,
    message: `Upstream returned HTTP ${upstream.status}`,
  }))

  return { status: upstream.status, body }
}

function sendNode(res, status, body) {
  if (typeof res?.status === 'function' && typeof res?.json === 'function') {
    res.setHeader?.('Access-Control-Allow-Origin', '*')
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store')
    return res.status(status).json(body)
  }
  // Fallback plain Node response
  res.statusCode = status
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  res.setHeader?.('Access-Control-Allow-Origin', '*')
  res.end?.(JSON.stringify(body))
}

/**
 * Vercel / Vite serverless proxy for EV91 MIS.
 * Supports classic (req, res) and Fetch API (Request → Response) runtimes.
 */
export default async function handler(req, res) {
  // Web Fetch API style (some Vercel runtimes pass a single Request)
  const isFetchApi = typeof Request !== 'undefined' && req instanceof Request
  if (isFetchApi || (req && !res && typeof req?.headers?.get === 'function')) {
    const request = req
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Accept, Content-Type',
        },
      })
    }
    if (request.method && request.method !== 'GET') {
      return Response.json(
        { success: false, message: 'Method not allowed' },
        { status: 405, headers: { Allow: 'GET', 'Access-Control-Allow-Origin': '*' } }
      )
    }

    const query = Object.fromEntries(new URL(request.url).searchParams.entries())
    const endpoint = String(query.endpoint || '').trim()
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return Response.json(
        {
          success: false,
          message:
            'Invalid endpoint. Use current-status, overall-status, client-mapping-history, or rider-details.',
        },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }

    try {
      const { status, body } = await fetchUpstream(endpoint, query)
      return Response.json(body, {
        status,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    } catch (err) {
      return Response.json(
        { success: false, message: err?.message || 'Failed to reach EV91 MIS API' },
        { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }
      )
    }
  }

  // Classic Node.js serverless (req, res) — Vite middleware + older Vercel
  if (req?.method === 'OPTIONS') {
    res.setHeader?.('Access-Control-Allow-Origin', '*')
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader?.('Access-Control-Allow-Headers', 'Accept, Content-Type')
    return res.status?.(204).end?.() ?? ((res.statusCode = 204), res.end?.())
  }

  if (req?.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET')
    return sendNode(res, 405, { success: false, message: 'Method not allowed' })
  }

  const query = getQuery(req)
  const endpoint = String(query.endpoint || '').trim()

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return sendNode(res, 400, {
      success: false,
      message:
        'Invalid endpoint. Use current-status, overall-status, client-mapping-history, or rider-details.',
    })
  }

  try {
    const { status, body } = await fetchUpstream(endpoint, query)
    return sendNode(res, status, body)
  } catch (err) {
    return sendNode(res, 502, {
      success: false,
      message: err?.message || 'Failed to reach EV91 MIS API',
    })
  }
}
