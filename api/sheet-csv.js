const CACHE_SECONDS = 300

function isAllowedGoogleSheetUrl(value) {
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'docs.google.com' &&
      parsed.pathname.includes('/spreadsheets/')
    )
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const sheetUrl = req.query?.url
  if (!sheetUrl || !isAllowedGoogleSheetUrl(sheetUrl)) {
    return res.status(400).json({ error: 'Missing or invalid Google Sheet URL' })
  }

  try {
    const upstream = await fetch(sheetUrl, {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'FleetProDashboard/1.0',
      },
      cache: 'no-store',
    })

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Google Sheet returned HTTP ${upstream.status}`,
      })
    }

    const text = await upstream.text()
    const trimmed = text.trim()

    if (
      trimmed.length < 10 ||
      trimmed.slice(0, 200).toLowerCase().startsWith('<!doctype') ||
      trimmed.slice(0, 200).toLowerCase().startsWith('<html')
    ) {
      return res.status(502).json({ error: 'Invalid CSV payload from Google Sheet' })
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Cache-Control', `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`)
    return res.status(200).send(text)
  } catch (err) {
    console.error('[api/sheet-csv]', err)
    return res.status(500).json({
      error: err?.message || 'Failed to fetch Google Sheet',
    })
  }
}
