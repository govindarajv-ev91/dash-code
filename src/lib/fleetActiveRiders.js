import {
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  endOfISOWeek,
  startOfDay,
  endOfDay,
  subDays,
} from 'date-fns'
import { dedupeCanonicalCities, normalizeCityKey, normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { getCurrentlyDeployedAssignments, normalizeRiderIdKey } from './riderPerformanceReport'
import { parseFleetDate } from './fleetDeployReturnExport'

const ACTIVE_METRIC_LOOKBACK_DAYS = 30

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

/** Keys for riders who currently have a fleet vehicle (as of date). */
export function buildDeployedRiderKeySet(assignments) {
  const keys = new Set()
  for (const a of assignments || []) {
    const idKey = normalizeRiderIdKey(a.riderId)
    if (idKey) keys.add(`id:${idKey}`)
    const phone = normalizePhone(a.mobile)
    if (phone) keys.add(`phone:${phone}`)
  }
  return keys
}

export function riderHasVehicleMatch(deployedKeys, { riderId, mobile }) {
  const idKey = normalizeRiderIdKey(riderId)
  if (idKey && deployedKeys.has(`id:${idKey}`)) return true
  const phone = normalizePhone(mobile)
  if (phone && deployedKeys.has(`phone:${phone}`)) return true
  return false
}

/**
 * EV = rider is matched to a fleet vehicle (open deploy).
 * NON-EV = active in rider_metrics but no open vehicle match.
 */
export function inferActiveRiderFleetType(hasVehicleMatch) {
  return hasVehicleMatch ? 'EV' : 'NON-EV'
}

function buildRiderLatestByWorkerAsOf(riderData, asOfDate) {
  const asOf = endOfDay(asOfDate)
  const byWorker = new Map()

  for (const r of riderData || []) {
    const date = parseFleetDate(r.date_record)
    if (!date || date > asOf) continue

    const workerKey = normalizeRiderIdKey(r.worker_code)
    if (!workerKey) continue

    const prev = byWorker.get(workerKey)
    if (!prev || date > prev.date) {
      byWorker.set(workerKey, { row: r, date })
    }
  }

  return byWorker
}

export function formatIsoWeekKey(date) {
  if (!date) return ''
  const y = getISOWeekYear(date)
  const w = getISOWeek(date)
  return `${y}-W${String(w).padStart(2, '0')}`
}

export function parseIsoWeekKey(key) {
  const m = (key || '').match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const week = parseInt(m[2], 10)
  const jan4 = new Date(year, 0, 4)
  const start = startOfISOWeek(jan4)
  start.setDate(start.getDate() + (week - 1) * 7)
  return { start: startOfISOWeek(start), end: endOfISOWeek(start) }
}

export function buildActiveRiderRows(fleetRows, riderData, asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  const activeCutoff = subDays(asOf, ACTIVE_METRIC_LOOKBACK_DAYS)
  const assignments = getCurrentlyDeployedAssignments(fleetRows, asOfDate)
  const deployedKeys = buildDeployedRiderKeySet(assignments)

  const rows = []

  for (const a of assignments) {
    const city = normalizeSummaryCity(a.city) || 'Unknown'
    const client = normalizeSummaryClient(a.client) || 'Unknown'

    rows.push({
      riderId: a.riderId || '',
      riderName: a.riderName || '',
      mobile: a.mobile || '',
      vehicleNumber: a.vehicleNumber || '',
      city,
      client,
      hub: a.hub || '',
      source: a.source || '',
      category: a.category || '',
      fleetType: 'EV',
      hasVehicleMatch: true,
      deployDate: a.deployDate,
      deployDateDisplay: format(a.deployDate, 'dd/MM/yyyy'),
      deployWeek: formatIsoWeekKey(a.deployDate),
      deployMonth: format(a.deployDate, 'MMMM yyyy'),
      allotmentDays: a.allotmentDays ?? 0,
    })
  }

  const latestByWorker = buildRiderLatestByWorkerAsOf(riderData, asOfDate)

  for (const [, { row, date }] of latestByWorker) {
    if (date < activeCutoff) continue

    const riderId = (row.worker_code || '').toString().trim()
    const mobile = (row.mob_number || '').toString().trim()

    if (riderHasVehicleMatch(deployedKeys, { riderId, mobile })) continue

    const city = normalizeSummaryCity(row.city) || 'Unknown'
    const client = normalizeSummaryClient(row.client) || 'Unknown'
    const daysSince = Math.max(0, Math.floor((asOf - date) / (86400000)))

    rows.push({
      riderId,
      riderName: (row.rider_name || row.worker_name || '').toString().trim(),
      mobile,
      vehicleNumber: '',
      city,
      client,
      hub: (row.hub_name || '').toString().trim(),
      source: (row.source || '').toString().trim(),
      category: (row.type1 || '').toString().trim(),
      fleetType: 'NON-EV',
      hasVehicleMatch: false,
      deployDate: date,
      deployDateDisplay: format(date, 'dd/MM/yyyy'),
      deployWeek: formatIsoWeekKey(date),
      deployMonth: format(date, 'MMMM yyyy'),
      allotmentDays: daysSince,
    })
  }

  rows.sort((a, b) => {
    if (a.hasVehicleMatch !== b.hasVehicleMatch) return a.hasVehicleMatch ? -1 : 1
    return (b.deployDate?.getTime() || 0) - (a.deployDate?.getTime() || 0)
  })

  return rows
}

export function buildActiveRiderFilterOptions(rows) {
  const citySet = new Set()
  const clientSet = new Set()
  const weekSet = new Set()

  for (const row of rows || []) {
    citySet.add(row.city)
    clientSet.add(row.client)
    if (row.deployWeek) weekSet.add(row.deployWeek)
  }

  const weeks = [...weekSet].sort((a, b) => b.localeCompare(a)).slice(0, 104)

  return {
    cities: dedupeCanonicalCities([...citySet]),
    clients: [...clientSet].sort((a, b) => a.localeCompare(b)),
    weeks,
  }
}

export function filterActiveRiderRows(
  rows,
  {
    city = 'All',
    client = 'All',
    fleetType = 'All',
    deployWeek = 'All',
    deployDateFrom = '',
    deployDateTo = '',
    search = '',
  } = {}
) {
  const q = search.trim().toLowerCase()
  const from = deployDateFrom ? startOfDay(new Date(deployDateFrom)) : null
  const to = deployDateTo ? endOfDay(new Date(deployDateTo)) : null
  const cityKey = city !== 'All' ? normalizeCityKey(city) : null

  if (
    !q &&
    city === 'All' &&
    client === 'All' &&
    fleetType === 'All' &&
    deployWeek === 'All' &&
    !from &&
    !to
  ) {
    return rows || []
  }

  return (rows || []).filter((row) => {
    if (cityKey && normalizeCityKey(row.city) !== cityKey) return false
    if (client !== 'All' && row.client !== client) return false
    if (fleetType !== 'All' && row.fleetType !== fleetType) return false
    if (deployWeek !== 'All' && row.deployWeek !== deployWeek) return false
    if (from && row.deployDate < from) return false
    if (to && row.deployDate > to) return false

    if (q) {
      const hay = [
        row.riderId,
        row.riderName,
        row.mobile,
        row.vehicleNumber,
        row.city,
        row.client,
        row.source,
        row.hub,
        row.fleetType,
      ]
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }

    return true
  })
}

export function summarizeActiveRiders(rows) {
  let ev = 0
  let nonEv = 0
  for (const row of rows || []) {
    if (row.fleetType === 'NON-EV') nonEv++
    else ev++
  }
  return { total: rows.length, ev, nonEv }
}

export function activeRidersToCsv(rows) {
  const escapeCsv = (val) => {
    const str = (val ?? '').toString()
    return `"${str.replace(/"/g, '""')}"`
  }

  const headers = [
    'Rider ID',
    'Rider Name',
    'Mobile',
    'Vehicle No.',
    'City',
    'Client',
    'Source',
    'Hub',
    'Fleet Type',
    'Vehicle Match',
    'Deploy / Last Active',
    'Deploy Week',
    'Days',
  ]

  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.riderId,
        row.riderName,
        row.mobile,
        row.vehicleNumber,
        row.city,
        row.client,
        row.source,
        row.hub,
        row.fleetType,
        row.hasVehicleMatch ? 'Yes' : 'No',
        row.deployDateDisplay,
        row.deployWeek,
        row.allotmentDays,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }
  return lines.join('\n')
}
