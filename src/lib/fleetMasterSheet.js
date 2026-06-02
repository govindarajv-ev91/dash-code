import { format, startOfDay, endOfDay } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { normalizeSummaryClient } from './clientSummaryClients'
import {
  dedupeCanonicalCities,
  normalizeCityKey,
  normalizeSummaryCity,
  resolveRiderCity,
  riderCityMatchesFilter,
} from './citySummaryAliases'
import { normalizeRiderIdKey } from './riderPerformanceReport'

export { normalizeCityKey, normalizeSummaryCity }

/** Master sheet columns (Google Sheets FILTER / ARRAYFORMULA equivalent). */
export const MASTER_SHEET_HEADERS = [
  'City - Locations',
  'Date',
  'Vehicle number',
  'Vehicle Status',
  'Rider ID',
  'Rider Name',
  'Rider Contact Number',
  'CLIENT NAME',
  'Hub Location',
  'Category',
  'Month',
]

export function normalizeDeployReturnStatus(value) {
  const t = (value ?? '').toString().trim().toLowerCase()
  if (t === 'deployee') return 'Deployee'
  if (t === 'return') return 'Return'
  return null
}

export function normalizeClientKey(value) {
  return (value ?? '').toString().trim() || 'Unknown'
}

function deriveMonth(date, rowMonth) {
  if (rowMonth != null && String(rowMonth).trim()) return String(rowMonth).trim()
  if (!date) return ''
  return format(date, 'MMMM yyyy')
}

/** Build master rows: Deployee + Return only, with uppercased fields per sheet formula. */
export function buildMasterSheetRows(fleetRows) {
  const rows = []
  for (const row of fleetRows || []) {
    const status = normalizeDeployReturnStatus(row.vehicle_status)
    if (!status) continue

    const date = parseFleetDate(row.date_record)
    if (!date) continue

    rows.push({
      city: normalizeSummaryCity(row.city_locations || row.city),
      date,
      dateDisplay: row.date_record,
      vehicleNumber: (row.vehicle_number || '').toString().trim().toUpperCase(),
      vehicleStatus: status,
      riderId: (row.rider_id || '').toString().trim(),
      riderName: (row.rider_name || '').toString().trim(),
      riderContact: (row.rider_contact_number || '').toString().trim().toUpperCase(),
      client: normalizeSummaryClient(row.client_name),
      hub: (row.hub_location || '').toString().trim(),
      category: (row.category || '').toString().trim().toUpperCase(),
      month: deriveMonth(date, row.month),
    })
  }
  return rows
}

export function filterMasterSheetRows(masterRows, { city, startDate, endDate }) {
  const start = startOfDay(new Date(startDate))
  const end = endOfDay(new Date(endDate))
  const cityKey = city && city !== 'All' ? normalizeCityKey(city) : null

  return masterRows.filter((row) => {
    if (row.date < start || row.date > end) return false
    if (cityKey && normalizeCityKey(row.city) !== cityKey) return false
    return true
  })
}

export function masterRowToCsvRecord(row) {
  return {
    'City - Locations': row.city,
    Date: row.dateDisplay,
    'Vehicle number': row.vehicleNumber,
    'Vehicle Status': row.vehicleStatus,
    'Rider ID': row.riderId,
    'Rider Name': row.riderName,
    'Rider Contact Number': row.riderContact,
    'CLIENT NAME': row.client,
    'Hub Location': row.hub,
    Category: row.category,
    Month: row.month,
  }
}

export function isIcRiderRow(r) {
  if (String(r.fl ?? '').trim() !== '1') return false
  const type1 = (r.type1 || '').toString().trim().toUpperCase().replace(/\s+/g, '-')
  return type1 === 'NON-EV'
}

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function riderIdentityKey(workerOrRiderId, phone) {
  const id = normalizeRiderIdKey(workerOrRiderId)
  if (id) return `id:${id}`
  const p = normalizePhone(phone)
  if (p) return `phone:${p}`
  return ''
}

export function buildRiderMetricDateIndex(riderData) {
  const byWorkerDate = new Map()
  const byPhoneDate = new Map()

  for (const r of riderData || []) {
    const date = parseFleetDate(r.date_record)
    if (!date) continue
    const dateKey = format(date, 'yyyy-MM-dd')
    const workerKey = normalizeRiderIdKey(r.worker_code)
    if (workerKey) byWorkerDate.set(`${workerKey}|${dateKey}`, r)
    const phone = normalizePhone(r.mob_number)
    if (phone) byPhoneDate.set(`${phone}|${dateKey}`, r)
  }

  return { byWorkerDate, byPhoneDate }
}

/** Exact worker/phone + deploy date only (fast path for active-rider lists). */
export function lookupRiderMetricExact(row, index) {
  const dateKey = format(row.date, 'yyyy-MM-dd')
  const riderKey = normalizeRiderIdKey(row.riderId)

  if (riderKey) {
    const exact = index.byWorkerDate.get(`${riderKey}|${dateKey}`)
    if (exact) return exact
  }

  const phone = normalizePhone(row.riderContact)
  if (phone) {
    const byPhone = index.byPhoneDate.get(`${phone}|${dateKey}`)
    if (byPhone) return byPhone
  }

  return null
}

/** Fleet Deployee row counts as EV unless rider_metrics on that deploy date is fl=1 NON-EV. */
export function isEvFleetDeployeeRow(row, riderIndex) {
  const metric = lookupRiderMetricExact(
    { date: row.date, riderId: row.riderId, riderContact: row.riderContact },
    riderIndex
  )
  if (!metric) return true
  return !isIcRiderRow(metric)
}

/**
 * Client-wise summary for a city + date range.
 * EV = deduped fleet Deployee rows (not IC on deploy date).
 * IC = unique IC riders (fl=1, NON-EV) in week without a fleet Deployee in range.
 * Total Deployed = Ev Deployed + IC Deployed.
 */
export function buildClientWiseSummary(filteredMasterRows, riderData, { city, startDate, endDate }) {
  const start = startOfDay(new Date(startDate))
  const end = endOfDay(new Date(endDate))
  const filterCity = city && city !== 'All' ? city : null
  const riderIndex = buildRiderMetricDateIndex(riderData)

  const clientStats = new Map()
  const seenFleetEvents = new Set()
  const fleetDeployedRiderKeys = new Set()
  const icRidersByClient = new Map()

  const ensure = (client) => {
    if (!clientStats.has(client)) {
      clientStats.set(client, { returnCount: 0, icDeployed: 0, evDeployed: 0 })
    }
    return clientStats.get(client)
  }

  for (const row of filteredMasterRows) {
    const dateKey = format(row.date, 'yyyy-MM-dd')
    const eventKey = [
      dateKey,
      row.vehicleStatus || '',
      (row.vehicleNumber || '').toUpperCase(),
      normalizeRiderIdKey(row.riderId),
      normalizeSummaryClient(row.client),
    ].join('|')
    if (seenFleetEvents.has(eventKey)) continue
    seenFleetEvents.add(eventKey)

    const stats = ensure(row.client)
    if (row.vehicleStatus === 'Deployee') {
      const riderKey = riderIdentityKey(row.riderId, row.riderContact)
      if (riderKey) fleetDeployedRiderKeys.add(riderKey)
      if (isEvFleetDeployeeRow(row, riderIndex)) stats.evDeployed++
    } else if (row.vehicleStatus === 'Return') {
      stats.returnCount++
    }
  }

  for (const r of riderData || []) {
    if (!isIcRiderRow(r)) continue

    const rDate = parseFleetDate(r.date_record)
    if (!rDate || rDate < start || rDate > end) continue
    if (filterCity && !riderCityMatchesFilter(filterCity, r)) continue

    const riderKey = riderIdentityKey(r.worker_code, r.mob_number)
    if (!riderKey || fleetDeployedRiderKeys.has(riderKey)) continue

    const client = normalizeSummaryClient(r.client)
    if (!icRidersByClient.has(client)) icRidersByClient.set(client, new Set())
    icRidersByClient.get(client).add(riderKey)
  }

  for (const [client, riderSet] of icRidersByClient) {
    ensure(client).icDeployed = riderSet.size
  }

  const clients = [...clientStats.keys()].sort((a, b) => a.localeCompare(b))
  const rows = clients.map((client) => {
    const s = clientStats.get(client)
    const totalDeployed = s.evDeployed + s.icDeployed
    return {
      client,
      totalDeployed,
      evDeployed: s.evDeployed,
      icDeployed: s.icDeployed,
      returnCount: s.returnCount,
      netAddon: totalDeployed - s.returnCount,
    }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      totalDeployed: acc.totalDeployed + r.totalDeployed,
      evDeployed: acc.evDeployed + r.evDeployed,
      icDeployed: acc.icDeployed + r.icDeployed,
      returnCount: acc.returnCount + r.returnCount,
      netAddon: acc.netAddon + r.netAddon,
    }),
    { totalDeployed: 0, evDeployed: 0, icDeployed: 0, returnCount: 0, netAddon: 0 }
  )

  return { clients: rows, totals }
}

export function getCitiesFromMasterRows(masterRows) {
  return dedupeCanonicalCities(masterRows.map((row) => row.city))
}

export const SUMMARY_METRICS = [
  { key: 'totalDeployed', label: 'Total Deployed', rowClass: 'fsr-metric-deployed' },
  { key: 'evDeployed', label: 'Ev Deployed', rowClass: 'fsr-metric-ev' },
  { key: 'icDeployed', label: 'IC Deployed', rowClass: 'fsr-metric-ic' },
  { key: 'returnCount', label: 'Return', rowClass: 'fsr-metric-return' },
  { key: 'netAddon', label: 'Net add on', rowClass: 'fsr-metric-net' },
]
