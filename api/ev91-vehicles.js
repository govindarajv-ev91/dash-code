const VEHICLES_URL = 'https://dashboard.ev91riderz.com/api/v1/vehicles'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100

function getQuery(req) {
  if (req?.query && typeof req.query === 'object' && Object.keys(req.query).length) {
    return req.query
  }
  try {
    return Object.fromEntries(new URL(req?.url || '/', 'http://localhost').searchParams.entries())
  } catch {
    return {}
  }
}

function getPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT))
  return { page, limit }
}

async function fetchVehicles(query) {
  const { page, limit } = getPagination(query)
  const url = new URL(VEHICLES_URL)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', String(limit))
  const search = String(query.search || '').trim()
  if (search) url.searchParams.set('search', search)

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.success === false) {
    throw new Error(body?.message || `EV91 vehicles API returned HTTP ${response.status}`)
  }
  return { status: response.status, body }
}

function sendNode(res, status, body) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8')
  res.setHeader?.('Cache-Control', 'no-store')
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body)
  }
  res.statusCode = status
  res.end?.(JSON.stringify(body))
}

export default async function handler(req, res) {
  const isFetchApi = typeof Request !== 'undefined' && req instanceof Request
  if (isFetchApi || (req && !res && typeof req?.headers?.get === 'function')) {
    if (req.method !== 'GET') {
      return Response.json({ success: false, message: 'Method not allowed' }, {
        status: 405,
        headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
      })
    }
    try {
      const { status, body } = await fetchVehicles(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
    } catch (err) {
      return Response.json(
        { success: false, message: err?.message || 'Failed to reach EV91 vehicles API' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      )
    }
  }

  if (req?.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET')
    return sendNode(res, 405, { success: false, message: 'Method not allowed' })
  }

  try {
    const { status, body } = await fetchVehicles(getQuery(req))
    return sendNode(res, status, body)
  } catch (err) {
    return sendNode(res, 502, {
      success: false,
      message: err?.message || 'Failed to reach EV91 vehicles API',
    })
  }
}
