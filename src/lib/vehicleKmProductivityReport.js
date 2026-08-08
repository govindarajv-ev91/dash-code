import { format, parseISO, startOfDay, eachDayOfInterval } from 'date-fns'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import { rowDateKey } from './ev91MisApi'
import { buildVehicleDayKmIndex, sumVehicleKmInRange } from './serviceScheduleReport'
import {
  buildEv91OverallIntervalIndexes,
  mergeCurrentStatusIntoIndexes,
  findEv91RiderForVehicleOnDate,
} from './ev91EvLookup'

export const KM_PRODUCTIVITY_BUCKETS = [
  { key: 'b0_30', label: '0 TO 30 KM', min: 0, max: 30 },
  { key: 'b31_50', label: '31 TO 50 KM', min: 31, max: 50 },
  { key: 'b51_70', label: '51 TO 70 KM', min: 51, max: 70 },
  { key: 'b71_100', label: '71 TO 100 KM', min: 71, max: 100 },
  { key: 'b101_120', label: '101 TO 120 KM', min: 101, max: 120 },
  { key: 'b121_plus', label: '121 KM +', min: 121, max: Infinity },
]

export function kmToBucketKey(km) {
  const raw = Number(km)
  // Negatives / NaN → 0; fractional KM use floor so 70.37 maps to 51–70, not a gap → 121+.
  const n = !Number.isFinite(raw) || raw < 0 ? 0 : Math.floor(raw)
  for (const b of KM_PRODUCTIVITY_BUCKETS) {
    if (n >= b.min && n <= b.max) return b.key
  }
  return 'b121_plus'
}

export function kmBucketLabel(km) {
  const key = kmToBucketKey(km)
  return KM_PRODUCTIVITY_BUCKETS.find((b) => b.key === key)?.label || '121 KM +'
}

function emptyBucketCounts() {
  const o = { total: 0 }
  for (const b of KM_PRODUCTIVITY_BUCKETS) o[b.key] = 0
  return o
}

function toDateKey(date) {
  if (!date) return ''
  try {
    return format(startOfDay(date), 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

/**
 * EV91 deploy interval covers [from, to) (return day not deployed).
 * True if that coverage overlaps inclusive [rangeFrom, rangeTo].
 */
function deployIntervalOverlapsRange(interval, rangeFrom, rangeTo) {
  if (!interval?.from || !rangeFrom || !rangeTo) return false
  const from = toDateKey(interval.from)
  const to = interval.to ? toDateKey(interval.to) : null
  if (!from) return false
  if (from > rangeTo) return false
  if (to != null && to <= rangeFrom) return false
  return true
}

/** Return day falls inside [rangeFrom, rangeTo]. */
function returnFallsInRange(interval, rangeFrom, rangeTo) {
  if (!interval?.to || !rangeFrom || !rangeTo) return false
  const to = toDateKey(interval.to)
  return Boolean(to && to >= rangeFrom && to <= rangeTo)
}

function pickCity(...values) {
  for (const v of values) {
    const city = normalizeSummaryCity(v)
    if (city) return city
  }
  return 'Unknown'
}

function pickClient(...values) {
  for (const v of values) {
    const client = normalizeSummaryClient(v) || (v ?? '').toString().trim()
    if (client) return client
  }
  return 'Unknown'
}

function emptyResult(kind, fromKey, toKey) {
  return {
    kind,
    startDate: fromKey,
    endDate: toKey,
    groupBy: 'city',
    rows: [],
    cities: [],
    totals: emptyBucketCounts(),
    vehicleCount: 0,
    withKmCount: 0,
  }
}

/**
 * Collect unique vehicles for Deployed or Return in range, with city/client/KM.
 * @returns {Map<string, object> | null}
 */
function collectKmProductivityVehicles(
  overallRows = [],
  iotRows = [],
  { startDate = '', endDate = '', kind = 'deployed', currentRows = [] } = {}
) {
  const fromKey = (startDate || '').toString().trim()
  const toKey = (endDate || '').toString().trim()
  if (!fromKey || !toKey || fromKey > toKey) return null

  let fromDate
  let toDate
  try {
    fromDate = startOfDay(parseISO(fromKey))
    toDate = startOfDay(parseISO(toKey))
  } catch {
    return null
  }

  const indexes = buildEv91OverallIntervalIndexes(overallRows || [])
  mergeCurrentStatusIntoIndexes(indexes, currentRows || [])
  const { vehicleIntervals } = indexes
  const dayKmIndex = buildVehicleDayKmIndex(iotRows)

  /** @type {Map<string, { vehicleNumber: string, city: string, client: string, km: number, statusDate?: string }>} */
  const byVehicle = new Map()

  if (kind === 'returned') {
    for (const [vKey, intervals] of vehicleIntervals || []) {
      for (const iv of intervals || []) {
        if (!returnFallsInRange(iv, fromKey, toKey)) continue
        const prev = byVehicle.get(vKey)
        const returnKey = toDateKey(iv.to)
        if (prev && prev.statusDate && prev.statusDate >= returnKey) continue
        byVehicle.set(vKey, {
          vehicleNumber: iv.vehicleNumber || vKey,
          city: pickCity(iv.city),
          client: pickClient(iv.clientName),
          statusDate: returnKey,
          km: 0,
        })
      }
    }

    for (const row of overallRows || []) {
      const dKey = rowDateKey(row, 'statusDate')
      if (!dKey || dKey < fromKey || dKey > toKey) continue
      const s = String(row.vehicleStatus || '').toLowerCase()
      if (!s.includes('return')) continue
      const vehicleNumber = (row.vehicleNumber || '').toString().trim()
      const vKey = vehiclePartitionKey(vehicleNumber)
      if (!vKey) continue
      const prev = byVehicle.get(vKey)
      if (prev && prev.statusDate && prev.statusDate >= dKey) continue
      byVehicle.set(vKey, {
        vehicleNumber,
        city: pickCity(row.cityName, row.city, prev?.city),
        client: pickClient(row.clientName, prev?.client),
        statusDate: dKey,
        km: 0,
      })
    }
  } else {
    for (const [vKey, intervals] of vehicleIntervals || []) {
      let best = null
      for (const iv of intervals || []) {
        if (!deployIntervalOverlapsRange(iv, fromKey, toKey)) continue
        if (!best || iv.from > best.from) best = iv
      }
      if (!best) continue
      byVehicle.set(vKey, {
        vehicleNumber: best.vehicleNumber || vKey,
        city: pickCity(best.city),
        client: pickClient(best.clientName),
        km: 0,
      })
    }

    try {
      const days = eachDayOfInterval({ start: fromDate, end: toDate })
      for (const [vKey] of dayKmIndex || []) {
        if (byVehicle.has(vKey)) continue
        for (const day of days) {
          const hit = findEv91RiderForVehicleOnDate(vehicleIntervals, vKey, day)
          if (!hit) continue
          byVehicle.set(vKey, {
            vehicleNumber: hit.vehicleNumber || vKey,
            city: pickCity(hit.city),
            client: pickClient(hit.clientName),
            km: 0,
          })
          break
        }
      }
    } catch {
      // ignore invalid interval
    }
  }

  for (const [vKey, row] of byVehicle) {
    row.km = sumVehicleKmInRange(dayKmIndex, row.vehicleNumber || vKey, fromDate, toDate)
  }

  return { byVehicle, fromKey, toKey, fromDate, toDate }
}

/**
 * Deployed: every vehicle whose EV91 deploy interval overlaps the date range.
 * Returned: every vehicle whose Return date falls in the range.
 * KM = IoT sum in the same range.
 * groupBy: 'city' | 'client'
 */
export function buildVehicleKmProductivityTable(
  overallRows = [],
  iotRows = [],
  { startDate = '', endDate = '', kind = 'deployed', currentRows = [], groupBy = 'city' } = {}
) {
  const fromKey = (startDate || '').toString().trim()
  const toKey = (endDate || '').toString().trim()
  const collected = collectKmProductivityVehicles(overallRows, iotRows, {
    startDate,
    endDate,
    kind,
    currentRows,
  })
  if (!collected) return emptyResult(kind, fromKey, toKey)

  const { byVehicle } = collected
  const byGroup = new Map()
  let withKmCount = 0
  const useClient = groupBy === 'client'

  for (const row of byVehicle.values()) {
    if ((row.km || 0) > 0) withKmCount += 1
    const bucketKey = kmToBucketKey(row.km)
    const name = useClient ? row.client || 'Unknown' : row.city || 'Unknown'
    if (!byGroup.has(name)) byGroup.set(name, emptyBucketCounts())
    const bucket = byGroup.get(name)
    bucket[bucketKey] += 1
    bucket.total += 1
  }

  const rows = [...byGroup.entries()]
    .map(([name, counts]) => ({
      name,
      city: name,
      client: name,
      ...counts,
    }))
    .sort((a, b) => {
      const byTotal = (b.total || 0) - (a.total || 0)
      if (byTotal !== 0) return byTotal
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

  const totals = emptyBucketCounts()
  for (const row of rows) {
    for (const b of KM_PRODUCTIVITY_BUCKETS) {
      totals[b.key] += row[b.key]
    }
    totals.total += row.total
  }

  return {
    kind,
    startDate: fromKey,
    endDate: toKey,
    groupBy: useClient ? 'client' : 'city',
    rows,
    /** @deprecated use rows — kept for older callers */
    cities: rows,
    totals,
    vehicleCount: byVehicle.size,
    withKmCount,
  }
}

/**
 * Vehicle-level detail rows for both Deployed and Return (City + Client on each row).
 */
export function buildVehicleKmProductivityDetailRows(
  overallRows = [],
  iotRows = [],
  { startDate = '', endDate = '', currentRows = [] } = {}
) {
  const kinds = [
    { kind: 'deployed', typeLabel: 'Deployed' },
    { kind: 'returned', typeLabel: 'Return' },
  ]
  const details = []

  for (const { kind, typeLabel } of kinds) {
    const collected = collectKmProductivityVehicles(overallRows, iotRows, {
      startDate,
      endDate,
      kind,
      currentRows,
    })
    if (!collected) continue

    const { byVehicle, fromKey, toKey } = collected
    const sorted = [...byVehicle.values()].sort((a, b) => {
      const byKm = (b.km || 0) - (a.km || 0)
      if (byKm !== 0) return byKm
      return String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), undefined, {
        sensitivity: 'base',
      })
    })

    for (const row of sorted) {
      details.push({
        type: typeLabel,
        vehicleNumber: row.vehicleNumber || '',
        city: row.city || 'Unknown',
        client: row.client || 'Unknown',
        km: Math.round((Number(row.km) || 0) * 100) / 100,
        kmBucket: kmBucketLabel(row.km),
        returnDate: kind === 'returned' ? row.statusDate || '' : '',
        rangeFrom: fromKey,
        rangeTo: toKey,
      })
    }
  }

  return details
}

function escapeCsv(val) {
  return `"${String(val ?? '').replace(/"/g, '""')}"`
}

export function vehicleKmProductivityDetailsToCsv(rows = []) {
  const headers = [
    'Type',
    'Vehicle Number',
    'City',
    'Client',
    'KM',
    'KM Bucket',
    'Return Date',
    'Range From',
    'Range To',
  ]
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.type,
        row.vehicleNumber,
        row.city,
        row.client,
        row.km,
        row.kmBucket,
        row.returnDate,
        row.rangeFrom,
        row.rangeTo,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }
  return lines.join('\n')
}

export function downloadVehicleKmProductivityDetails(
  overallRows = [],
  iotRows = [],
  { startDate = '', endDate = '', currentRows = [] } = {}
) {
  const details = buildVehicleKmProductivityDetailRows(overallRows, iotRows, {
    startDate,
    endDate,
    currentRows,
  })
  const csv = vehicleKmProductivityDetailsToCsv(details)
  const from = (startDate || 'start').toString().trim() || 'start'
  const to = (endDate || 'end').toString().trim() || 'end'
  const filename = `vehicle_km_productivity_details_${from}_to_${to}.csv`
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return details.length
}

export function buildKmProductivityDatePresets(asOf = new Date()) {
  const today = startOfDay(asOf)
  const y = new Date(today)
  y.setDate(y.getDate() - 1)

  const last7From = new Date(today)
  last7From.setDate(last7From.getDate() - 6)

  const thisMonthFrom = new Date(today.getFullYear(), today.getMonth(), 1)

  const lastMonthFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthTo = new Date(today.getFullYear(), today.getMonth(), 0)

  const fmt = (d) => format(d, 'yyyy-MM-dd')

  return {
    yesterday: { from: fmt(y), to: fmt(y), label: 'Yesterday' },
    last7: { from: fmt(last7From), to: fmt(today), label: 'Last 7 Days' },
    thisMonth: { from: fmt(thisMonthFrom), to: fmt(today), label: 'This Month' },
    lastMonth: { from: fmt(lastMonthFrom), to: fmt(lastMonthTo), label: 'Last Month' },
  }
}
