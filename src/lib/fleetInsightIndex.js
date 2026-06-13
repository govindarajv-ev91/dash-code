import { format, startOfDay } from 'date-fns'
import { parseFleetDate, vehiclePartitionKey, normalizeFleetStatus } from './fleetDeployReturnExport'
import { extractFleetSource, normalizeRiderIdKey } from './riderPerformanceReport'
import { FLEET_FORM_SOURCE } from './fleetDataConfig'

function sortFleetEvents(a, b) {
  const diff = a.date - b.date
  if (diff !== 0) return diff
  if (a.status === 'Return' && b.status === 'Deployee') return -1
  if (a.status === 'Deployee' && b.status === 'Return') return 1
  return 0
}

function pushAssignmentInterval(map, key, deployEvent, returnDate) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push({
    from: deployEvent.date,
    to: returnDate,
    vehicleNumber: (deployEvent.row.vehicle_number || '').toString().trim(),
    mobile: (deployEvent.row.rider_contact_number || '').toString().trim(),
    riderId: (deployEvent.row.rider_id || '').toString().trim(),
    riderName: (deployEvent.row.rider_name || '').toString().trim(),
    deployDate: deployEvent.date,
  })
}

function pushVehicleInterval(map, vehicleKey, deployEvent, returnDate) {
  if (!vehicleKey) return
  if (!map.has(vehicleKey)) map.set(vehicleKey, [])
  map.get(vehicleKey).push({
    from: deployEvent.date,
    to: returnDate,
    vehicleNumber: (deployEvent.row.vehicle_number || '').toString().trim(),
    riderId: (deployEvent.row.rider_id || '').toString().trim(),
    riderName: (deployEvent.row.rider_name || '').toString().trim(),
    mobile: (deployEvent.row.rider_contact_number || '').toString().trim(),
    deployDate: deployEvent.date,
  })
}

/** Single pass: rider intervals + vehicle intervals for fast EV lookup. */
export function buildFleetIntervalIndexes(preparedFleetRows) {
  const byVehicle = new Map()

  for (const row of preparedFleetRows || []) {
    const status = normalizeFleetStatus(row.vehicle_status)
    if (status !== 'Deployee' && status !== 'Return') continue
    const date = parseFleetDate(row.date_record)
    const vehicleKey = vehiclePartitionKey(row.vehicle_number)
    if (!date || !vehicleKey) continue
    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, [])
    byVehicle.get(vehicleKey).push({ status, date, row })
  }

  const riderAssignments = new Map()
  const vehicleIntervals = new Map()

  for (const [vehicleKey, events] of byVehicle) {
    events.sort(sortFleetEvents)
    let openDeploy = null
    for (const event of events) {
      if (event.status === 'Deployee') {
        openDeploy = event
      } else if (event.status === 'Return' && openDeploy) {
        const idKey = normalizeRiderIdKey(openDeploy.row.rider_id)
        const phone = normalizePhone(openDeploy.row.rider_contact_number)
        pushAssignmentInterval(riderAssignments, idKey, openDeploy, event.date)
        if (phone) pushAssignmentInterval(riderAssignments, `phone:${phone}`, openDeploy, event.date)
        pushVehicleInterval(vehicleIntervals, vehicleKey, openDeploy, event.date)
        openDeploy = null
      }
    }
    if (openDeploy) {
      const idKey = normalizeRiderIdKey(openDeploy.row.rider_id)
      const phone = normalizePhone(openDeploy.row.rider_contact_number)
      pushAssignmentInterval(riderAssignments, idKey, openDeploy, null)
      if (phone) pushAssignmentInterval(riderAssignments, `phone:${phone}`, openDeploy, null)
      pushVehicleInterval(vehicleIntervals, vehicleKey, openDeploy, null)
    }
  }

  return { riderAssignments, vehicleIntervals }
}

/** Rider → deploy intervals (merged fleet, both Database + New Fleet Data). */
export function buildRiderVehicleAssignmentIndex(preparedFleetRows) {
  return buildFleetIntervalIndexes(preparedFleetRows).riderAssignments
}

export function findRiderForVehicleOnDate(vehicleIntervals, vehicleKey, asOfDate) {
  if (!vehicleIntervals || !vehicleKey || !asOfDate) return null
  const intervals = vehicleIntervals.get(vehicleKey)
  if (!intervals?.length) return null

  const asOf = startOfDay(asOfDate).getTime()
  let best = null

  for (const interval of intervals) {
    const from = startOfDay(interval.from).getTime()
    const to = interval.to ? startOfDay(interval.to).getTime() : Number.MAX_SAFE_INTEGER
    if (from <= asOf && to >= asOf) {
      if (!best || interval.from > best.from) best = interval
    }
  }

  return best
}

export function findRiderVehicleOnDate(riderAssignments, identityKeys, asOfDate) {
  if (!riderAssignments || !asOfDate) return null
  const asOf = startOfDay(asOfDate).getTime()
  let best = null

  for (const key of identityKeys) {
    const intervals = riderAssignments.get(key)
    if (!intervals?.length) continue

    for (const interval of intervals) {
      const from = startOfDay(interval.from).getTime()
      const to = interval.to ? startOfDay(interval.to).getTime() : Number.MAX_SAFE_INTEGER
      // Include return day — rider still had the vehicle on the date it was returned.
      if (from <= asOf && to >= asOf) {
        if (!best || interval.from > best.from) best = interval
      }
    }
  }

  return best
}

function fleetRowIdentityKeys(row) {
  const keys = new Set()
  const idKey = normalizeRiderIdKey(row.rider_id)
  if (idKey) keys.add(idKey)
  const digits = (row.rider_id ?? '').toString().replace(/\D/g, '')
  if (digits && digits !== idKey) keys.add(digits)
  const phone = normalizePhone(row.rider_contact_number)
  if (phone.length >= 10) keys.add(`phone:${phone}`)
  return keys
}

/** O(1) exact date + rider → vehicle (deploy/return rows on that day). */
export function buildExactFleetVehicleIndex(preparedFleetRows) {
  const index = new Map()

  for (const row of preparedFleetRows || []) {
    const date = parseFleetDate(row.date_record)
    if (!date) continue
    const status = normalizeFleetStatus(row.vehicle_status)
    if (status !== 'Deployee' && status !== 'Return') continue

    const dateKey = format(startOfDay(date), 'dd/MM/yyyy')
    const vehicle = (row.vehicle_number || '').toString().trim()
    if (!vehicle) continue

    for (const key of fleetRowIdentityKeys(row)) {
      index.set(`${dateKey}|${key}`, vehicle)
    }
  }

  return index
}

export function findVehicleOnExactFleetDate(exactVehicleIndex, identityKeys, asOfDate) {
  if (!exactVehicleIndex || !asOfDate) return ''
  const dateKey = format(startOfDay(asOfDate), 'dd/MM/yyyy')

  for (const key of identityKeys) {
    const vehicle = exactVehicleIndex.get(`${dateKey}|${key}`)
    if (vehicle) return vehicle
  }

  return ''
}

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function normalizeName(value) {
  return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

export { normalizeFleetStatus } from './fleetDeployReturnExport'

/** Same merged fleet rows used on Fleet Data page — dedupe overlapping deploy/return events. */
export function prepareMergedFleetRows(fleetRows) {
  const map = new Map()

  for (const row of fleetRows || []) {
    const date = parseFleetDate(row.date_record)
    const vehicleKey = vehiclePartitionKey(row.vehicle_number)
    const status = normalizeFleetStatus(row.vehicle_status)
    if (!date || !vehicleKey || (status !== 'Deployee' && status !== 'Return')) continue

    const dateKey = date.toISOString().slice(0, 10)
    const dedupeKey = `${vehicleKey}|${dateKey}|${status}|${row.data_source || 'Database'}`
    const normalized = { ...row, vehicle_status: status }

    const existing = map.get(dedupeKey)
    if (!existing || Number(row.id || 0) >= Number(existing.id || 0)) {
      map.set(dedupeKey, normalized)
    }
  }

  return [...map.values()].sort((a, b) => {
    const da = parseFleetDate(a.date_record)?.getTime() || 0
    const db = parseFleetDate(b.date_record)?.getTime() || 0
    return da - db
  })
}

export function buildFleetHistoryIndex(fleetRows) {
  const prepared = prepareMergedFleetRows(fleetRows)
  const byId = new Map()
  const byPhone = new Map()
  const byName = new Map()

  for (const row of prepared) {
    const idKey = normalizeRiderIdKey(row.rider_id)
    if (idKey) {
      if (!byId.has(idKey)) byId.set(idKey, [])
      byId.get(idKey).push(row)
    }

    const phone = normalizePhone(row.rider_contact_number)
    if (phone) {
      if (!byPhone.has(phone)) byPhone.set(phone, [])
      byPhone.get(phone).push(row)
    }

    const name = normalizeName(row.rider_name)
    if (name) {
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push(row)
    }
  }

  for (const bucket of [byId, byPhone, byName]) {
    for (const list of bucket.values()) {
      list.sort((a, b) => {
        const da = parseFleetDate(a.date_record)?.getTime() || 0
        const db = parseFleetDate(b.date_record)?.getTime() || 0
        return da - db
      })
    }
  }

  return { byId, byPhone, byName, prepared }
}

export function resolveFleetHistoryForRider({ workerCode, mobile, name }, index) {
  const { byId, byPhone, byName } = index
  const idKey = normalizeRiderIdKey(workerCode)
  if (idKey && byId.has(idKey)) return byId.get(idKey)

  const phone = normalizePhone(mobile)
  if (phone && byPhone.has(phone)) return byPhone.get(phone)

  const riderName = normalizeName(name)
  if (riderName && byName.has(riderName)) return byName.get(riderName)

  return []
}

export function enrichRiderFromFleetRow(rider, fleetRow) {
  if (!fleetRow) return rider
  return {
    ...rider,
    riderName: rider.riderName === 'N/A' && fleetRow.rider_name ? fleetRow.rider_name : rider.riderName,
    client: rider.client === 'N/A' && fleetRow.client_name ? fleetRow.client_name : rider.client,
    city:
      rider.city === 'N/A' && (fleetRow.city_locations || fleetRow.city)
        ? fleetRow.city_locations || fleetRow.city
        : rider.city,
    sourceName:
      rider.sourceName === 'N/A' && extractFleetSource(fleetRow) ? extractFleetSource(fleetRow) : rider.sourceName,
    fleetDataSource: fleetRow.data_source || rider.fleetDataSource,
  }
}

export function countFleetSources(fleetRows) {
  let legacy = 0
  let form = 0
  for (const row of fleetRows || []) {
    if (row.data_source === FLEET_FORM_SOURCE) form++
    else legacy++
  }
  return { legacy, form, total: (fleetRows || []).length }
}
