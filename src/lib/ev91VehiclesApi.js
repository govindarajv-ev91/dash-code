const PAGE_SIZE = 100
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_PAGES = 200
let cachedVehicles = null
let cachedAt = 0
let vehiclesInflight = null

export async function fetchEv91VehiclePage(params) {
  const response = await fetch(`/api/ev91-vehicles?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      'Production is returning the dashboard page instead of vehicle data. Add the /api/ev91-vehicles rewrite in Amplify Hosting and place it above the SPA fallback rule.'
    )
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success || !Array.isArray(body.vehicles)) {
    throw new Error(body?.message || `Failed to load EV91 vehicles (HTTP ${response.status})`)
  }
  return body
}

async function loadAllVehicles() {
  const fetchPage = (page) => fetchEv91VehiclePage(new URLSearchParams({
    page: String(page), limit: String(PAGE_SIZE),
  }))
  const first = await fetchPage(1)
  const vehicles = [...first.vehicles]
  const totalPages = Number(first.pagination?.totalPages)
  if (Number.isInteger(totalPages) && totalPages >= 1) {
    if (totalPages > MAX_PAGES) throw new Error('EV91 vehicle inventory exceeds the lookup page limit.')
    // Four requests at a time keeps large inventories quick without flooding the API.
    for (let page = 2; page <= totalPages; page += 4) {
      const pages = await Promise.all(Array.from(
        { length: Math.min(4, totalPages - page + 1) }, (_, offset) => fetchPage(page + offset)
      ))
      for (const body of pages) {
        if (!body.vehicles.length) throw new Error('EV91 returned an incomplete vehicle inventory. Choose the file again to retry.')
        vehicles.push(...body.vehicles)
      }
    }
  } else {
    let body = first
    let page = 1
    while (body.pagination?.hasNextPage) {
      if (++page > MAX_PAGES) throw new Error('EV91 vehicle inventory exceeds the lookup page limit.')
      body = await fetchPage(page)
      if (!body.vehicles.length) throw new Error('EV91 returned an incomplete vehicle inventory. Choose the file again to retry.')
      vehicles.push(...body.vehicles)
    }
  }
  if (!vehicles.length) throw new Error('EV91 Vehicles returned no vehicles. Choose the file again to retry.')
  const total = Number(first.pagination?.totalItems ?? first.meta?.totalRecords)
  if (Number.isFinite(total) && total > vehicles.length) {
    throw new Error('EV91 returned an incomplete vehicle inventory. Choose the file again to retry.')
  }
  return vehicles
}

export async function fetchAllEv91Vehicles({ force = false } = {}) {
  if (vehiclesInflight) return vehiclesInflight
  if (!force && cachedVehicles && Date.now() - cachedAt < CACHE_TTL_MS) return cachedVehicles
  vehiclesInflight = loadAllVehicles().then((vehicles) => {
    cachedVehicles = vehicles
    cachedAt = Date.now()
    return vehicles
  }).finally(() => { vehiclesInflight = null })
  return vehiclesInflight
}
