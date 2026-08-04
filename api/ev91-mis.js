const BASE = 'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics'

const ALLOWED_ENDPOINTS = new Set([
  'current-status',
  'overall-status',
  'client-mapping-history',
])

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    return Object.fromEntries(url.searchParams.entries())
  } catch {
    return {}
  }
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET')
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  const query = getQuery(req)
  const endpoint = String(query.endpoint || '').trim()

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid endpoint. Use current-status, overall-status, or client-mapping-history.',
    })
  }

  const params = new URLSearchParams()
  for (const key of ['limit', 'offset', 'search', 'city', 'status']) {
    const value = query[key]
    if (value != null && String(value).trim() !== '') {
      params.set(key, String(value).trim())
    }
  }

  const apiKey =
    process.env.EV91_MIS_API_KEY ||
    process.env.VITE_EV91_MIS_API_KEY ||
    'ev91-mis-public-2026'

  const upstreamUrl = `${BASE}/${endpoint}?${params.toString()}`

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    const body = await upstream.json().catch(() => ({
      success: false,
      message: `Upstream returned HTTP ${upstream.status}`,
    }))

    return res.status(upstream.status).json(body)
  } catch (err) {
    return res.status(502).json({
      success: false,
      message: err?.message || 'Failed to reach EV91 MIS API',
    })
  }
}
