const FLEET_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcqousIenx7wOzlCIB6rw0zSXnfiwmWyXPcTzYoDX5E9PryySAoMLMjiWNdlVg8vYWUIX3iqM4VG0D/pub?gid=721267187&single=true&output=csv'

const CACHE_SECONDS = 300

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const upstream = await fetch(FLEET_SHEET_CSV_URL, {
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
    console.error('[api/fleet-sheet-csv]', err)
    return res.status(500).json({
      error: err?.message || 'Failed to fetch fleet Google Sheet',
    })
  }
}
