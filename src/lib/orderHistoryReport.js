import { toMetricDateKey } from './mergeRiderMetrics'
import { normalizeRiderIdKey } from './riderPerformanceReport'

function text(value) {
  return (value ?? '').toString().trim()
}

function deliveredValue(row) {
  if (row?.delivered == null || row.delivered === '') return 0
  const n = Number(row.delivered)
  return Number.isFinite(n) ? n : 0
}

function isEvType(type1) {
  const t = text(type1).toUpperCase()
  if (!t) return false
  if (t.includes('NON')) return false
  return t.includes('EV')
}

/** Normalize order_upload_data rows for history browsing. */
export function buildOrderHistoryRows(uploadRows = []) {
  return (uploadRows || [])
    .map((row) => {
      const workerCode = text(row.worker_code)
      const dateKey = toMetricDateKey(row.date_record) || text(row.date_record)
      if (!workerCode && !dateKey) return null
      const type1 = text(row.type1)
      const delivered = deliveredValue(row)
      return {
        id: row.id,
        workerCode,
        workerKey: normalizeRiderIdKey(workerCode),
        dateKey,
        dateDisplay: dateKey || text(row.date_record) || '—',
        client: text(row.client) || '—',
        city: text(row.city) || '—',
        type1: type1 || '—',
        isEv: isEvType(type1),
        delivered,
        month: text(row.month) || '',
        createdAt: row.created_at || null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const d = (b.dateKey || '').localeCompare(a.dateKey || '')
      if (d !== 0) return d
      return (a.workerCode || '').localeCompare(b.workerCode || '')
    })
}

export function filterOrderHistory(
  rows,
  { search = '', cities = [], clients = [], months = [], type1 = '', dateFrom = '', dateTo = '' } = {}
) {
  const q = text(search).toLowerCase()
  const citySet = cities?.length ? new Set(cities) : null
  const clientSet = clients?.length ? new Set(clients) : null
  const monthSet = months?.length ? new Set(months) : null
  const typeFilter = text(type1).toUpperCase()

  return (rows || []).filter((row) => {
    if (citySet && !citySet.has(row.city)) return false
    if (clientSet && !clientSet.has(row.client)) return false
    if (monthSet && !monthSet.has(row.month)) return false
    if (dateFrom && row.dateKey && row.dateKey < dateFrom) return false
    if (dateTo && row.dateKey && row.dateKey > dateTo) return false

    if (typeFilter === 'EV' && !row.isEv) return false
    if (typeFilter === 'NON-EV' && row.isEv) return false

    if (q) {
      const hay = `${row.workerCode} ${row.client} ${row.city} ${row.type1} ${row.dateDisplay} ${row.month}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function summarizeOrderHistory(rows, groupKey) {
  const map = new Map()
  for (const row of rows || []) {
    const name = row[groupKey] || 'Unknown'
    if (!map.has(name)) {
      map.set(name, { name, rows: 0, riders: new Set(), orders: 0, evOrders: 0, nonEvOrders: 0 })
    }
    const g = map.get(name)
    g.rows += 1
    g.orders += row.delivered || 0
    if (row.isEv) g.evOrders += row.delivered || 0
    else g.nonEvOrders += row.delivered || 0
    if (row.workerKey) g.riders.add(row.workerKey)
  }

  return [...map.values()]
    .map((g) => ({
      name: g.name,
      rows: g.rows,
      riders: g.riders.size,
      orders: g.orders,
      evOrders: g.evOrders,
      nonEvOrders: g.nonEvOrders,
    }))
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name))
}

export function summarizeOrderHistoryTotals(rows = []) {
  let orders = 0
  let evOrders = 0
  let nonEvOrders = 0
  const riders = new Set()
  const dates = new Set()

  for (const row of rows) {
    orders += row.delivered || 0
    if (row.isEv) evOrders += row.delivered || 0
    else nonEvOrders += row.delivered || 0
    if (row.workerKey) riders.add(row.workerKey)
    if (row.dateKey) dates.add(row.dateKey)
  }

  return {
    rows: rows.length,
    orders,
    evOrders,
    nonEvOrders,
    riders: riders.size,
    dates: dates.size,
  }
}
