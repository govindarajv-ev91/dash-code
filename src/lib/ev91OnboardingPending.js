import { selectOverviewOrderRows, toMetricDateKey } from './mergeRiderMetrics'
import { normalizeRiderIdKey, riderIdLookupKeys } from './riderPerformanceReport'
import { fetchAllEv91MisData, formatEv91Cell } from './ev91MisApi'

/**
 * Build lookup index from Client Mapping History by Client ID (with aliases).
 * Prefer mapping rows that have an EV91 Rider ID and the newest lastUpdated.
 */
export function buildClientMappingIndex(mappingRows = []) {
  const byClientId = new Map()

  for (const row of mappingRows || []) {
    const clientId = (row.clientId || '').toString().trim()
    if (!clientId) continue

    const mapped = {
      clientId,
      ev91RiderId: (row.ev91RiderId || '').toString().trim(),
      city: (row.city || '').toString().trim(),
      phoneNumber: (row.phoneNumber || '').toString().trim(),
      source: (row.source || '').toString().trim(),
      lastUpdated: row.lastUpdated || '',
    }

    for (const alias of riderIdLookupKeys(clientId)) {
      const prev = byClientId.get(alias)
      if (!prev) {
        byClientId.set(alias, mapped)
        continue
      }
      const prevHasEv91 = !!prev.ev91RiderId
      const nextHasEv91 = !!mapped.ev91RiderId
      if (nextHasEv91 && !prevHasEv91) {
        byClientId.set(alias, mapped)
        continue
      }
      if (prevHasEv91 && !nextHasEv91) continue
      const prevTs = Date.parse(prev.lastUpdated) || 0
      const nextTs = Date.parse(mapped.lastUpdated) || 0
      if (nextTs >= prevTs) byClientId.set(alias, mapped)
    }
  }

  return byClientId
}

export function lookupClientMapping(index, clientId) {
  if (!index || !clientId) return null
  for (const alias of riderIdLookupKeys(clientId)) {
    const hit = index.get(alias)
    if (hit) return hit
  }
  return null
}

/**
 * Unique riders from order upload data (worker_code = Client ID side).
 */
export function buildUniqueOrderRiders(orderRows = []) {
  const byRider = new Map()

  for (const row of orderRows || []) {
    const clientId = (row.worker_code || '').toString().trim()
    if (!clientId) continue

    const key = normalizeRiderIdKey(clientId) || clientId
    const delivered = parseInt(row.delivered, 10) || 0
    const dateKey = toMetricDateKey(row.date_record)
    const city = (row.city || '').toString().trim()
    const client = (row.client || '').toString().trim()
    const name = (row.worker_name || '').toString().trim()
    const mobile = (row.mob_number || '').toString().trim()

    if (!byRider.has(key)) {
      byRider.set(key, {
        clientId,
        workerName: name,
        city,
        client,
        mobile,
        totalOrders: 0,
        orderDays: 0,
        lastOrderDate: '',
        firstOrderDate: '',
      })
    }

    const agg = byRider.get(key)
    agg.totalOrders += delivered
    if (dateKey) {
      agg.orderDays += 1
      if (!agg.lastOrderDate || dateKey > agg.lastOrderDate) agg.lastOrderDate = dateKey
      if (!agg.firstOrderDate || dateKey < agg.firstOrderDate) agg.firstOrderDate = dateKey
    }
    if (!agg.workerName && name) agg.workerName = name
    if (!agg.city && city) agg.city = city
    if (!agg.client && client) agg.client = client
    if (!agg.mobile && mobile) agg.mobile = mobile
    // Keep a representative raw clientId (prefer longer / FE-prefixed)
    if (clientId.length > agg.clientId.length) agg.clientId = clientId
    if (/^FE/i.test(clientId) && !/^FE/i.test(agg.clientId)) agg.clientId = clientId
  }

  return [...byRider.values()].sort((a, b) =>
    (b.lastOrderDate || '').localeCompare(a.lastOrderDate || '')
  )
}

/**
 * Match unique order Client IDs against Client Mapping History.
 * Returns all riders with status:
 * - Mapped with EV91 ID
 * - Missing EV91 ID (in mapping but blank)
 * - Not in Client Mapping
 */
export function buildEv91OnboardingPendingRows(orderRows, mappingRows) {
  const uniqueRiders = buildUniqueOrderRiders(orderRows)
  const mappingIndex = buildClientMappingIndex(mappingRows)

  const allRows = []

  for (const rider of uniqueRiders) {
    const mapping = lookupClientMapping(mappingIndex, rider.clientId)
    const ev91RiderId = mapping?.ev91RiderId || ''

    let status = 'Not in Client Mapping'
    if (ev91RiderId) status = 'Mapped with EV91 ID'
    else if (mapping) status = 'Missing EV91 ID'

    allRows.push({
      clientId: rider.clientId,
      workerName: rider.workerName || '—',
      city: rider.city || mapping?.city || '—',
      client: rider.client || '—',
      mobile: rider.mobile || mapping?.phoneNumber || '—',
      totalOrders: rider.totalOrders,
      orderDays: rider.orderDays,
      lastOrderDate: rider.lastOrderDate || '—',
      firstOrderDate: rider.firstOrderDate || '—',
      status,
      ev91RiderId: ev91RiderId || '',
      mappingCity: mapping?.city || '',
      mappingPhone: mapping?.phoneNumber || '',
      mappingSource: mapping?.source || '',
      mappingLastUpdated: mapping?.lastUpdated || '',
    })
  }

  const mappedWithEv91 = allRows.filter((r) => r.status === 'Mapped with EV91 ID').length
  const notInMapping = allRows.filter((r) => r.status === 'Not in Client Mapping').length
  const missingEv91Id = allRows.filter((r) => r.status === 'Missing EV91 ID').length

  return {
    rows: allRows.sort((a, b) => {
      // Pending first, then mapped; within group by orders desc
      const rank = (s) =>
        s === 'Not in Client Mapping' ? 0 : s === 'Missing EV91 ID' ? 1 : 2
      const d = rank(a.status) - rank(b.status)
      if (d !== 0) return d
      return (b.totalOrders || 0) - (a.totalOrders || 0)
    }),
    summary: {
      uniqueOrderRiders: uniqueRiders.length,
      mappedWithEv91,
      pendingCount: notInMapping + missingEv91Id,
      notInMapping,
      missingEv91Id,
    },
  }
}

export async function fetchEv91ClientMappingAll() {
  return fetchAllEv91MisData('client-mapping-history')
}

export const EV91_ONBOARDING_PENDING_COLUMNS = [
  { key: 'clientId', label: 'Client ID (Order)' },
  { key: 'ev91RiderId', label: 'EV91 Rider ID' },
  { key: 'status', label: 'Status' },
  { key: 'workerName', label: 'Rider Name' },
  { key: 'city', label: 'City' },
  { key: 'client', label: 'Client' },
  { key: 'mobile', label: 'Phone' },
  { key: 'totalOrders', label: 'Total Orders' },
  { key: 'orderDays', label: 'Order Days' },
  { key: 'lastOrderDate', label: 'Last Order Date' },
  { key: 'firstOrderDate', label: 'First Order Date' },
  { key: 'mappingCity', label: 'Mapping City' },
  { key: 'mappingPhone', label: 'Mapping Phone' },
  { key: 'mappingSource', label: 'Mapping Source' },
  { key: 'mappingLastUpdated', label: 'Mapping Updated' },
]

export function rowsToOnboardingExport(rows) {
  return (rows || []).map((row) => {
    const out = {}
    for (const col of EV91_ONBOARDING_PENDING_COLUMNS) {
      const raw = row[col.key]
      if (col.key === 'mappingLastUpdated') {
        out[col.label] = raw ? formatEv91Cell(raw) : ''
      } else if (raw == null || raw === '') {
        out[col.label] = col.key === 'ev91RiderId' ? '' : ''
      } else {
        out[col.label] = raw
      }
    }
    return out
  })
}

/** Re-export helper used by the page. */
export { selectOverviewOrderRows }
