import { format, parseISO, startOfDay, subDays } from 'date-fns'
import { getZeroOrderWindowDates, normalizeRiderIdKey, parseMetricDate, riderIdLookupKeys } from './riderPerformanceReport'
import { ev91CurrentStatusToAssignments, mergeEv91RiderDetailsIntoAssignments } from './ev91RiderPerformance'
import { vehiclePartitionKey } from './fleetDeployReturnExport'

function phoneKey(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : digits.length >= 6 ? digits : ''
}
const nameKey = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

function createIndex({ fromKey = '', toKey = '' } = {}) {
  return { byWorker: new Map(), byMobile: new Map(), byName: new Map(), dateCache: new Map(), fromKey, toKey }
}
function addDay(index, key, dateKey, delivered) {
  if (!key) return
  if (!index.has(key)) index.set(key, new Map())
  // Preserve bucket existence for ID/phone/name precedence even outside the
  // report window, without retaining years of daily order history.
  if (!dateKey) return
  const days = index.get(key)
  days.set(dateKey, (days.get(dateKey) || 0) + delivered)
}
function addOrder(index, row) {
  const worker = String(row.worker_code ?? '').trim()
  if (!worker) return
  if (!index.dateCache.has(row.date_record)) {
    const date = parseMetricDate(row.date_record)
    index.dateCache.set(row.date_record, date ? format(date, 'yyyy-MM-dd') : '')
  }
  const parsedKey = index.dateCache.get(row.date_record)
  if (!parsedKey) return
  const dateKey = (index.fromKey && parsedKey < index.fromKey) || (index.toKey && parsedKey > index.toKey) ? '' : parsedKey
  // Match buildRiderMetricsIndex, including per-row integer order counts.
  const delivered = parseInt(row.delivered, 10) || 0
  for (const key of riderIdLookupKeys(worker)) addDay(index.byWorker, key, dateKey, delivered)
  addDay(index.byMobile, phoneKey(row.mob_number), dateKey, delivered)
  addDay(index.byName, nameKey(row.worker_name), dateKey, delivered)
}

export function buildFullDataZeroOrderIndex(rows = [], range = {}) {
  const index = createIndex(range)
  for (const row of rows) addOrder(index, row)
  index.dateCache.clear()
  return index
}

export async function buildFullDataZeroOrderIndexAsync(rows = [], shouldCancel = () => false, range = {}) {
  const index = createIndex(range)
  for (let i = 0; i < rows.length; i++) {
    if (i % 1000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (shouldCancel()) return null
    }
    addOrder(index, rows[i])
  }
  index.dateCache.clear()
  return index
}

function resolveDays(assignment, index) {
  // Same ID -> phone -> name precedence as resolveRiderMetricRecords.
  for (const id of [assignment.riderId, assignment.clientRiderId, assignment.ev91RiderId]) {
    for (const key of riderIdLookupKeys(id)) {
      if (index.byWorker.has(key)) return index.byWorker.get(key)
    }
  }
  const phone = phoneKey(assignment.mobile)
  if (phone && index.byMobile.has(phone)) return index.byMobile.get(phone)
  return index.byName.get(nameKey(assignment.riderName))
}

export function fullDataZeroOrderWindowKeys(endDateKey) {
  return getZeroOrderWindowDates(parseISO(endDateKey)).map((date) => format(date, 'yyyy-MM-dd'))
}

export function fullDataAssignmentHasZeroOrders(assignment, index, windowKeys) {
  const days = resolveDays(assignment, index)
  return windowKeys.every((key) => (days?.get(key) || 0) <= 0)
}

/** New deployments need the report date and the preceding three days as grace. */
export function fullDataAssignmentPastDeploymentGrace(assignment, windowStartKey) {
  const deployKey = assignment.deploymentDateKey ?? assignment.fromKey ?? ''
  // An unknown deployment date cannot establish that a rider is newly deployed.
  return !deployKey || deployKey < windowStartKey
}

function currentAssignmentKey(row) {
  return [vehiclePartitionKey(row.vehicleNumber), normalizeRiderIdKey(row.clientRiderId), normalizeRiderIdKey(row.ev91RiderId)].join('|')
}

function currentDeploymentDateKey(row, asOfDate) {
  if (row.lastStatusDate) {
    const date = new Date(row.lastStatusDate)
    if (!Number.isNaN(date.getTime())) return format(startOfDay(date), 'yyyy-MM-dd')
  }
  const aging = Number(row.aging)
  if (row.aging != null && String(row.aging).trim() && Number.isFinite(aging) && aging >= 0) {
    return format(subDays(startOfDay(asOfDate), Math.trunc(aging)), 'yyyy-MM-dd')
  }
  return ''
}

function riderKey(assignment) {
  if (assignment.ev91RiderId) return `ev91:${normalizeRiderIdKey(assignment.ev91RiderId)}`
  const id = assignment.clientRiderId || assignment.riderId
  if (id) {
    const aliases = [...riderIdLookupKeys(id)]
    return `client:${aliases.find((key) => /^\d+$/.test(key)) || normalizeRiderIdKey(id)}`
  }
  const vehicle = vehiclePartitionKey(assignment.vehicleNumber)
  return vehicle ? `vehicle:${vehicle}` : ''
}

export function selectFullDataZeroOrderAssignments(intervals = [], currentRows = null, dateKey, asOfDate = new Date(), riderDetailsById = null) {
  const yesterday = format(subDays(startOfDay(asOfDate), 1), 'yyyy-MM-dd')
  let candidates
  if (dateKey === yesterday && currentRows != null) {
    // D-1 uses the same live deployed population as EV91 Rider Performance.
    const deploymentDates = new Map(currentRows.map((row) => [currentAssignmentKey(row), currentDeploymentDateKey(row, asOfDate)]))
    const assignments = ev91CurrentStatusToAssignments(currentRows, asOfDate).map((assignment) => ({
      ...assignment,
      deploymentDateKey: deploymentDates.get(currentAssignmentKey(assignment)) || '',
    }))
    return mergeEv91RiderDetailsIntoAssignments(assignments, riderDetailsById)
  } else {
    const byVehicle = new Map()
    for (const iv of intervals) {
      if (iv.fromKey > dateKey || (iv.toKey != null && iv.toKey <= dateKey)) continue
      const assignment = { ...iv, clientRiderId: iv.clientRiderId || iv.riderId, deployDate: parseISO(iv.fromKey), deploymentDateKey: iv.fromKey }
      const key = iv.vKey || vehiclePartitionKey(iv.vehicleNumber) || riderKey(assignment)
      if (!key) continue
      const previous = byVehicle.get(key)
      if (!previous || iv.fromKey >= previous.fromKey) byVehicle.set(key, assignment)
    }
    candidates = [...byVehicle.values()].sort((a, b) => b.deployDate - a.deployDate)
  }
  const unique = new Map()
  for (const assignment of mergeEv91RiderDetailsIntoAssignments(candidates, riderDetailsById)) {
    const key = riderKey(assignment)
    if (key && !unique.has(key)) unique.set(key, assignment)
  }
  return [...unique.values()]
}
