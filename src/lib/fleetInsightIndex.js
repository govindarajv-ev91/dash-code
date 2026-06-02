import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { extractFleetSource, normalizeRiderIdKey } from './riderPerformanceReport'
import { FLEET_FORM_SOURCE } from './fleetDataConfig'

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function normalizeName(value) {
  return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeFleetStatus(value) {
  const status = (value ?? '').toString().trim().toLowerCase()
  if (status === 'deployee') return 'Deployee'
  if (status === 'return') return 'Return'
  return (value ?? '').toString().trim()
}

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
