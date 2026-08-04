/**
 * Deploy/return export: one output row per Deployee event.
 * Duplicate Vehiclenumbers and multiple deploy cycles are all included.
 */

export const DEPLOY_RETURN_EXPORT_HEADERS = [
  'city_name',
  'Vehiclenumber',
  'Vehicle_Status',
  'Rider_ID',
  'Rider_Name',
  'Rider_Contact_Number',
  'CLIENT_NAME',
  'Hub_Location',
  'Category',
  'Deployee_date',
  'Return_date',
  'number_of_days_with_rider',
  'vehicle_current_status',
]

export function parseFleetDate(dateStr) {
  if (dateStr == null || dateStr === '') return null
  let s = dateStr.toString().trim()
  if (!s) return null

  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date((parseFloat(s) - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) return startOfDay(d)
  }

  // DD/MM/YYYY with optional time
  const datePart = s.split(/\s+/)[0]
  const slash = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (slash) {
    const day = parseInt(slash[1], 10)
    const month = parseInt(slash[2], 10) - 1
    let year = parseInt(slash[3], 10)
    if (year < 100) year += 2000
    const d = new Date(year, month, day)
    if (!isNaN(d.getTime())) return startOfDay(d)
  }

  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10))
    if (!isNaN(d.getTime())) return startOfDay(d)
  }

  const parsed = new Date(s)
  return isNaN(parsed.getTime()) ? null : startOfDay(parsed)
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Trim for display/export. */
export function normalizeVehicleNumber(value) {
  return (value ?? '').toString().trim()
}

/** Case-insensitive key so typos like DL4SdX8338 vs DL4SDX8338 still pair. */
export function vehiclePartitionKey(value) {
  return normalizeVehicleNumber(value).toUpperCase()
}

export function normalizeDeployReturnStatus(value) {
  const t = (value ?? '').toString().trim().toLowerCase()
  if (t === 'deployee' || t === 'deployed' || t === 'deploy') return 'Deployee'
  if (t.includes('deploy') && !t.includes('return')) return 'Deployee'
  if (t.includes('client') && t.includes('swap')) return 'Client-Swap'
  if (t === 'return' || t === 'returned') return 'Return'
  if (t.includes('return')) return 'Return'
  return null
}

/** Alias used across fleet dashboards — returns raw value when not deploy/return. */
export function normalizeFleetStatus(value) {
  const normalized = normalizeDeployReturnStatus(value)
  if (normalized) return normalized
  return (value ?? '').toString().trim()
}

function formatIsoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

/**
 * Sort Deployee/Return/Client-Swap chronologically.
 * Same calendar day: Return → Deployee → Client-Swap.
 */
function sortDeployReturnTimeline(txs) {
  const rank = (status) => {
    if (status === 'Return') return 0
    if (status === 'Deployee') return 1
    if (status === 'Client-Swap') return 2
    return 3
  }
  return [...txs].sort((a, b) => {
    const diff = a.Date.getTime() - b.Date.getTime()
    if (diff !== 0) return diff
    const byStatus = rank(a.Vehicle_Status) - rank(b.Vehicle_Status)
    if (byStatus !== 0) return byStatus
    return (a._order ?? 0) - (b._order ?? 0)
  })
}

/**
 * Walk the timeline: Return closes the latest open Deployee; a new Deployee without
 * a prior Return closes any still-open deploy at the new deploy date.
 * Client-Swap is ignored for pairing (bike stays out; does not start a new cycle).
 */
function pairDeployReturnSequential(timeline) {
  const paired = []
  const openDeploys = []

  for (const event of timeline) {
    if (event.Vehicle_Status === 'Client-Swap') continue
    if (event.Vehicle_Status === 'Deployee') {
      if (openDeploys.length > 0) {
        closeOpenDeploysAt(openDeploys, paired, event.Date, event)
      }
      openDeploys.push(event)
      continue
    }
    if (event.Vehicle_Status === 'Return' && openDeploys.length > 0) {
      const deploy = openDeploys.pop()
      paired.push({ deploy, returnDate: event.Date, status: 'Returned', returnEvent: event })
    }
  }

  const last = timeline[timeline.length - 1]
  if (last?.Vehicle_Status === 'Return' && openDeploys.length > 0) {
    closeOpenDeploysAt(openDeploys, paired, last.Date, last)
  }

  return { paired, openDeploys, lastEvent: last }
}

/** Close older open deploys when a new deploy starts (missing Return rows in data). */
function closeOpenDeploysAt(openDeploys, paired, returnDate, returnEvent = null) {
  while (openDeploys.length > 0) {
    const deploy = openDeploys.pop()
    paired.push({ deploy, returnDate, status: 'Returned', returnEvent })
  }
}

function resolveCycleDataSource(deploy, returnEvent) {
  const deploySrc = (deploy?._dataSource || 'Fleet').toString()
  const returnSrc = (returnEvent?._dataSource || '').toString()
  if (returnSrc && returnSrc !== deploySrc) return 'Cutover'
  return deploySrc === 'EV91 API' ? 'EV91 API' : 'Fleet'
}

/** One Deployed row per vehicle; status follows the latest Deployee/Return/Client-Swap. */
function finalizeVehicleExportRows(rows, timeline, today) {
  const last = timeline[timeline.length - 1]
  const isCurrentlyDeployed =
    last?.Vehicle_Status === 'Deployee' || last?.Vehicle_Status === 'Client-Swap'

  const deployedRows = rows.filter((r) => r.vehicle_current_status === 'Deployed')

  if (!isCurrentlyDeployed) {
    for (const row of deployedRows) {
      row.vehicle_current_status = 'Returned'
    }
    return rows
  }

  if (deployedRows.length <= 1) return rows

  deployedRows.sort((a, b) => b._sortDeploy - a._sortDeploy)
  const keep = deployedRows[0]
  for (const row of deployedRows.slice(1)) {
    row.vehicle_current_status = 'Returned'
    const endDate = parseFleetDate(keep.Deployee_date) || today
    row.Return_date = formatIsoDate(endDate)
    row.number_of_days_with_rider = daysBetween(
      parseFleetDate(row.Deployee_date) || endDate,
      endDate
    )
  }

  return rows
}

function rowToTransaction(row) {
  const date = parseFleetDate(row.date_record)
  if (!date) return null

  const vehicle = normalizeVehicleNumber(row.vehicle_number)
  if (!vehicle) return null

  const status = normalizeDeployReturnStatus(row.vehicle_status)
  if (!status) return null

  return {
    city_name: (row.city_locations || row.city || '').toString().trim(),
    Vehiclenumber: vehicle,
    _vehicleKey: vehiclePartitionKey(vehicle),
    Vehicle_Status: status,
    Rider_ID: (row.rider_id || '').toString().trim(),
    Rider_Name: (row.rider_name || '').toString().trim(),
    Rider_Contact_Number: (row.rider_contact_number || '').toString().trim(),
    CLIENT_NAME: (row.client_name || '').toString().trim(),
    Hub_Location: (row.hub_location || '').toString().trim(),
    Category: (row.category || '').toString().trim(),
    EV91_PublicRiderId: (row.ev91_rider_id || row.ev91RiderId || '').toString().trim(),
    _dataSource: (row._data_source || row.data_source || 'Fleet').toString().trim() || 'Fleet',
    Date: date,
  }
}

function formatIsoDateKey(d) {
  return formatIsoDate(d)
}

/**
 * Map EV91 Overall Status Deployed/Returned rows into fleet-shaped rows
 * so they can run through the same BigQuery Deploy/Return pairing.
 */
export function mapEv91OverallToFleetDeployReturnRows(overallRows = []) {
  const out = []
  for (const row of overallRows || []) {
    const s = String(row.vehicleStatus || '').toLowerCase()
    let vehicle_status = ''
    if (s.includes('deploy')) vehicle_status = 'Deployee'
    else if (s.includes('client') && s.includes('swap')) vehicle_status = 'Client-Swap'
    else if (s.includes('return')) vehicle_status = 'Return'
    else continue

    const dateRaw = row.statusDate
    const date = parseFleetDate(dateRaw)
    if (!date) continue

    const vehicle_number = normalizeVehicleNumber(row.vehicleNumber)
    if (!vehicle_number) continue

    const dateKey = formatIsoDateKey(date)
    const riderId = (row.clientId || row.clientRiderId || '').toString().trim()
    const ev91Id = (row.ev91RiderId || '').toString().trim()

    out.push({
      id: `ev91-${vehiclePartitionKey(vehicle_number)}-${dateKey}-${vehicle_status}-${riderId}-${ev91Id}`,
      date_record: dateKey,
      vehicle_number,
      vehicle_status,
      rider_id: riderId,
      rider_name: (row.riderName || '').toString().trim(),
      rider_contact_number: (row.riderContact || '').toString().trim(),
      client_name: (row.clientName || '').toString().trim(),
      city_locations: (row.cityName || row.city || '').toString().trim(),
      hub_location: '',
      category: '',
      ev91_rider_id: ev91Id,
      _data_source: 'EV91 API',
    })
  }
  return out
}

function deployCycleMergeKey(row) {
  const vehicle = vehiclePartitionKey(row?.Vehiclenumber)
  const client = (row?.CLIENT_NAME || '').toString().trim().toUpperCase()
  const deploy = (row?.Deployee_date || '').toString().slice(0, 10)
  const rider = (row?.Rider_ID || '').toString().trim().toUpperCase()
  return `${vehicle}|${client}|${deploy}|${rider}`
}

function pickNonEmpty(...values) {
  for (const v of values) {
    const s = (v ?? '').toString().trim()
    if (s) return s
  }
  return ''
}

/** Same vehicle + date + status + rider from Fleet & API → keep one event. */
function dedupeSourceEvents(rows = []) {
  const bySoft = new Map()

  for (const row of rows || []) {
    const status = normalizeDeployReturnStatus(row.vehicle_status)
    const d = parseFleetDate(row.date_record)
    const vehicle = normalizeVehicleNumber(row.vehicle_number)
    if (!status || !d || !vehicle) continue

    const softKey = [
      vehiclePartitionKey(vehicle),
      formatIsoDateKey(d),
      status,
      (row.rider_id || '').toString().trim().toUpperCase(),
    ].join('|')

    const prev = bySoft.get(softKey)
    if (!prev) {
      bySoft.set(softKey, row)
      continue
    }

    const prevSrc = (prev._data_source || '').toString()
    const nextSrc = (row._data_source || '').toString()
    // Prefer Fleet for Deployee (hub/category); prefer API for Return
    let keep = prev
    if (status === 'Return' && nextSrc === 'EV91 API') keep = row
    else if (status === 'Deployee' && nextSrc === 'Fleet') keep = row
    else if (status === 'Deployee' && prevSrc !== 'Fleet' && nextSrc === 'Fleet') keep = row
    else if (status === 'Return' && prevSrc !== 'EV91 API' && nextSrc === 'EV91 API') keep = row

    const other = keep === prev ? row : prev
    bySoft.set(softKey, {
      ...keep,
      rider_name: pickNonEmpty(keep.rider_name, other.rider_name),
      rider_contact_number: pickNonEmpty(keep.rider_contact_number, other.rider_contact_number),
      client_name: pickNonEmpty(keep.client_name, other.client_name),
      city_locations: pickNonEmpty(keep.city_locations, keep.city, other.city_locations, other.city),
      hub_location: pickNonEmpty(keep.hub_location, other.hub_location),
      category: pickNonEmpty(keep.category, other.category),
      ev91_rider_id: pickNonEmpty(keep.ev91_rider_id, other.ev91_rider_id),
    })
  }

  return [...bySoft.values()]
}

/**
 * Drop EV91 API "Deployed" on a day that already has a Return — but NEVER remove a
 * vehicle's last Deployee (that made ~77 bikes disappear from BigQuery Data).
 */
function dropStaleSameDayApiDeploys(rows = []) {
  const list = rows || []
  const returnDays = new Set()
  const deployCountByVehicle = new Map()

  for (const row of list) {
    const status = normalizeDeployReturnStatus(row.vehicle_status)
    const d = parseFleetDate(row.date_record)
    const vehicle = normalizeVehicleNumber(row.vehicle_number)
    if (!status || !d || !vehicle) continue
    const vKey = vehiclePartitionKey(vehicle)
    if (status === 'Return') {
      returnDays.add(`${vKey}|${formatIsoDateKey(d)}`)
    }
    if (status === 'Deployee') {
      deployCountByVehicle.set(vKey, (deployCountByVehicle.get(vKey) || 0) + 1)
    }
  }
  if (!returnDays.size) return list

  return list.filter((row) => {
    const status = normalizeDeployReturnStatus(row.vehicle_status)
    if (status !== 'Deployee') return true
    const src = (row._data_source || row.data_source || '').toString()
    if (src !== 'EV91 API') return true
    const d = parseFleetDate(row.date_record)
    const vehicle = normalizeVehicleNumber(row.vehicle_number)
    if (!d || !vehicle) return true
    const vKey = vehiclePartitionKey(vehicle)
    if (!returnDays.has(`${vKey}|${formatIsoDateKey(d)}`)) return true
    // Keep if this is the only Deployee left for the vehicle
    if ((deployCountByVehicle.get(vKey) || 0) <= 1) return true
    deployCountByVehicle.set(vKey, (deployCountByVehicle.get(vKey) || 1) - 1)
    return false
  })
}

/**
 * Same agent + vehicle + client + deploy date → one merged cycle.
 * Prefers a real Return (API/fleet) over an open Deployed/today placeholder.
 */
export function mergeDuplicateDeployCycles(rows = []) {
  const todayKey = formatIsoDate(startOfDay(new Date()))
  const byKey = new Map()

  for (const row of rows || []) {
    if (!row?.Vehiclenumber || !row?.Deployee_date) {
      const fallback = `__orphan__${byKey.size}|${row?.Rider_ID || ''}|${row?.Deployee_date || ''}`
      byKey.set(fallback, { ...row })
      continue
    }

    const key = deployCycleMergeKey(row)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...row })
      continue
    }

    const prevOpen = isOpenDeployCycle(prev, todayKey)
    const nextOpen = isOpenDeployCycle(row, todayKey)

    let status = prev.vehicle_current_status
    let returnDate = prev.Return_date

    if (prevOpen && !nextOpen) {
      status = 'Returned'
      returnDate = row.Return_date
    } else if (!prevOpen && nextOpen) {
      status = 'Returned'
      returnDate = prev.Return_date
    } else if (!prevOpen && !nextOpen) {
      status = 'Returned'
      returnDate =
        String(prev.Return_date) <= String(row.Return_date) ? prev.Return_date : row.Return_date
    } else {
      status = 'Deployed'
      returnDate = todayKey
    }

    const deployDate = prev.Deployee_date || row.Deployee_date
    const deployParsed = parseFleetDate(deployDate)
    const returnParsed = parseFleetDate(returnDate) || startOfDay(new Date())
    const days =
      deployParsed && returnParsed ? daysBetween(deployParsed, returnParsed) : row.number_of_days_with_rider

    const sources = new Set(
      [prev.Data_Source, row.Data_Source].map((s) => (s || '').toString().trim()).filter(Boolean)
    )
    let dataSource = 'Fleet'
    if (sources.has('Cutover') || sources.size > 1) dataSource = 'Cutover'
    else if (sources.has('EV91 API')) dataSource = 'EV91 API'
    else if (sources.has('Fleet')) dataSource = 'Fleet'

    byKey.set(key, {
      ...prev,
      city_name: pickNonEmpty(prev.city_name, row.city_name),
      Vehiclenumber: pickNonEmpty(prev.Vehiclenumber, row.Vehiclenumber),
      Vehicle_Status: pickNonEmpty(prev.Vehicle_Status, row.Vehicle_Status) || 'Deployee',
      Rider_ID: pickNonEmpty(prev.Rider_ID, row.Rider_ID),
      Rider_Name: pickNonEmpty(prev.Rider_Name, row.Rider_Name),
      Rider_Contact_Number: pickNonEmpty(prev.Rider_Contact_Number, row.Rider_Contact_Number),
      CLIENT_NAME: pickNonEmpty(prev.CLIENT_NAME, row.CLIENT_NAME),
      Hub_Location: pickNonEmpty(prev.Hub_Location, row.Hub_Location),
      Category: pickNonEmpty(prev.Category, row.Category),
      EV91_PublicRiderId: pickNonEmpty(prev.EV91_PublicRiderId, row.EV91_PublicRiderId),
      Data_Source: dataSource,
      Deployee_date: deployDate,
      Return_date: returnDate,
      number_of_days_with_rider: days,
      vehicle_current_status: status,
    })
  }

  const merged = [...byKey.values()]
  merged.sort((a, b) => {
    const byVehicle = (a.Vehiclenumber || '').localeCompare(b.Vehiclenumber || '', undefined, {
      numeric: true,
    })
    if (byVehicle !== 0) return byVehicle
    return String(b.Deployee_date || '').localeCompare(String(a.Deployee_date || ''))
  })
  return merged
}

/**
 * Latest Deployee/Return per vehicle across Fleet + EV91 API (both count).
 * Later date wins. Same calendar day: Deployee beats Return (redeploy after return).
 */
function buildLatestVehicleStatusIndex(sourceRows = []) {
  const latestByVehicle = new Map()
  let order = 0

  for (const row of sourceRows || []) {
    const status = normalizeDeployReturnStatus(row.vehicle_status)
    const date = parseFleetDate(row.date_record)
    const vehicle = normalizeVehicleNumber(row.vehicle_number)
    if (!status || !date || !vehicle) continue

    const vKey = vehiclePartitionKey(vehicle)
    const candidate = {
      status,
      date,
      source: (row._data_source || row.data_source || '').toString().trim() || 'Fleet',
      order: order++,
    }
    const prev = latestByVehicle.get(vKey)
    if (!prev) {
      latestByVehicle.set(vKey, candidate)
      continue
    }

    const prevTs = prev.date.getTime()
    const nextTs = candidate.date.getTime()
    if (nextTs > prevTs) {
      latestByVehicle.set(vKey, candidate)
      continue
    }
    if (nextTs < prevTs) continue

    // Same day: Deployee after Return ⇒ still out
    if (candidate.status === 'Deployee' && prev.status !== 'Deployee') {
      latestByVehicle.set(vKey, candidate)
      continue
    }
    if (prev.status === 'Deployee' && candidate.status !== 'Deployee') continue

    if (candidate.order >= prev.order) latestByVehicle.set(vKey, candidate)
  }

  return latestByVehicle
}

function isOpenDeployCycle(row, todayKey) {
  return (
    row?.vehicle_current_status === 'Deployed' ||
    !row?.Return_date ||
    (row.Return_date === todayKey && row.vehicle_current_status !== 'Returned')
  )
}

/**
 * Optional post-pass: only close an open cycle when the latest event is Return.
 * Does NOT reopen Returned cycles — timeline pairing + finalize already own that.
 * (Reopening here previously undercounted Deployed badly.)
 */
export function reconcileDeployReturnCurrentStatus(cycles = [], sourceRows = []) {
  if (!cycles?.length) return cycles || []
  const latestByVehicle = buildLatestVehicleStatusIndex(sourceRows)
  if (!latestByVehicle.size) return cycles

  const today = startOfDay(new Date())
  const todayKey = formatIsoDate(today)
  const byVehicle = new Map()

  for (const row of cycles) {
    const vKey = vehiclePartitionKey(row.Vehiclenumber)
    if (!vKey) continue
    if (!byVehicle.has(vKey)) byVehicle.set(vKey, [])
    byVehicle.get(vKey).push(row)
  }

  for (const [vKey, rows] of byVehicle) {
    const latest = latestByVehicle.get(vKey)
    if (!latest || latest.status !== 'Return') continue

    rows.sort((a, b) => String(b.Deployee_date || '').localeCompare(String(a.Deployee_date || '')))
    const newest = rows[0]
    if (!newest) continue

    const retKey = formatIsoDate(latest.date)
    const dep = parseFleetDate(newest.Deployee_date) || latest.date
    if (isOpenDeployCycle(newest, todayKey) && latest.date.getTime() >= (dep?.getTime?.() || 0)) {
      newest.vehicle_current_status = 'Returned'
      newest.Return_date = retKey
      newest.number_of_days_with_rider = daysBetween(dep, latest.date)
    }

    for (const row of rows.slice(1)) {
      if (row.vehicle_current_status !== 'Deployed') continue
      const end = parseFleetDate(newest.Deployee_date) || latest.date
      const start = parseFleetDate(row.Deployee_date) || end
      row.vehicle_current_status = 'Returned'
      row.Return_date = formatIsoDate(end)
      row.number_of_days_with_rider = daysBetween(start, end)
    }
  }

  return cycles
}

/**
 * Build Deploy/Return report from Fleet + EV91 Overall.
 *
 * Both modes interleave events into one timeline per vehicle, then BigQuery-pair.
 * - cutover: fleet ≤ fleetUntilDate + API ≥ cutoverDate
 * - all: full fleet + full API (duplicate same-day events collapsed first)
 *
 * Finally merge same vehicle/client/rider/deploy cycles.
 * Current Status follows the interleaved timeline (last Deployee/Return).
 */
export function buildMergedDeployReturnReport(fleetRows = [], overallRows = [], options = {}) {
  const {
    maxRecentDeployReturnPerVehicle = 6,
    cutoverDate = '2026-07-28',
    fleetUntilDate = '2026-07-27',
    mode = 'all',
  } = options

  let fleetInput = (fleetRows || []).map((row) => ({
    ...row,
    _data_source: 'Fleet',
  }))

  let apiInput = mapEv91OverallToFleetDeployReturnRows(overallRows)

  if (mode === 'cutover') {
    fleetInput = fleetInput.filter((row) => {
      const d = parseFleetDate(row.date_record)
      if (!d) return false
      return formatIsoDateKey(d) <= fleetUntilDate
    })
    apiInput = apiInput.filter((row) => {
      const key = (row.date_record || '').toString().slice(0, 10)
      return key >= cutoverDate
    })
  }

  const combined = dropStaleSameDayApiDeploys(dedupeSourceEvents([...fleetInput, ...apiInput]))
  const paired = buildDeployReturnReport(combined, { maxRecentDeployReturnPerVehicle })
  // Current Status comes from full-timeline pairing + finalize (last event).
  // Do not run reconcile reopen/close — it undercounted Deployed across the fleet.
  return mergeDuplicateDeployCycles(paired)
}

/**
 * @param {object[]} fleetRows
 * @param {{ maxRecentDeployReturnPerVehicle?: number | null }} [options]
 *   maxRecentDeployReturnPerVehicle: if set (e.g. 6), keep the N most recent
 *   deploy cycles per vehicle after pairing the full timeline. Slicing events
 *   before pairing used to drop the opening Deployee (vehicle vanished) when
 *   the last N events were mostly Returns.
 */
export function buildDeployReturnReport(fleetRows, options = {}) {
  const maxRecent = options.maxRecentDeployReturnPerVehicle ?? null

  const transactions = []
  const seenRowIds = new Set()
  let order = 0
  for (const row of fleetRows || []) {
    const tx = rowToTransaction(row)
    if (tx) {
      // Namespace ids by source — fleet_data and new_fleet_data both use numeric ids
      if (row.id != null) {
        const id = `${tx._dataSource || 'Fleet'}:${String(row.id)}`
        if (seenRowIds.has(id)) continue
        seenRowIds.add(id)
      }
      tx._order = order++
      transactions.push(tx)
    }
  }

  const byVehicle = new Map()
  for (const tx of transactions) {
    const key = tx._vehicleKey
    if (!byVehicle.has(key)) byVehicle.set(key, [])
    byVehicle.get(key).push(tx)
  }

  const today = startOfDay(new Date())
  const results = []

  for (const [, vehicleTxs] of byVehicle.entries()) {
    // Pair on the full timeline so Deployee that opens a recent cycle is never dropped
    const timeline = sortDeployReturnTimeline(vehicleTxs)
    const { paired, openDeploys } = pairDeployReturnSequential(timeline)
    const last = timeline[timeline.length - 1]

    // Client-Swap-only (or Deployed last with no open cycle): still show the vehicle
    if (
      openDeploys.length === 0 &&
      (last?.Vehicle_Status === 'Client-Swap' || last?.Vehicle_Status === 'Deployee')
    ) {
      const seed =
        [...timeline].reverse().find((e) => e.Vehicle_Status === 'Deployee') ||
        [...timeline].reverse().find((e) => e.Vehicle_Status === 'Client-Swap')
      if (seed) openDeploys.push(seed)
    }

    let vehicleRows = []

    for (const { deploy, returnDate, status, returnEvent } of paired) {
      vehicleRows.push({
        city_name: deploy.city_name,
        Vehiclenumber: deploy.Vehiclenumber,
        Vehicle_Status: deploy.Vehicle_Status,
        Rider_ID: deploy.Rider_ID,
        Rider_Name: deploy.Rider_Name,
        Rider_Contact_Number: deploy.Rider_Contact_Number,
        CLIENT_NAME: deploy.CLIENT_NAME,
        Hub_Location: deploy.Hub_Location,
        Category: deploy.Category,
        EV91_PublicRiderId:
          deploy.EV91_PublicRiderId || returnEvent?.EV91_PublicRiderId || '',
        Data_Source: resolveCycleDataSource(deploy, returnEvent),
        Deployee_date: formatIsoDate(deploy.Date),
        Return_date: formatIsoDate(returnDate),
        number_of_days_with_rider: daysBetween(deploy.Date, returnDate),
        vehicle_current_status: status,
        _sortDeploy: deploy.Date.getTime(),
      })
    }

    for (const deploy of openDeploys) {
      vehicleRows.push({
        city_name: deploy.city_name,
        Vehiclenumber: deploy.Vehiclenumber,
        Vehicle_Status:
          deploy.Vehicle_Status === 'Client-Swap' ? 'Deployee' : deploy.Vehicle_Status,
        Rider_ID: deploy.Rider_ID,
        Rider_Name: deploy.Rider_Name,
        Rider_Contact_Number: deploy.Rider_Contact_Number,
        CLIENT_NAME: deploy.CLIENT_NAME,
        Hub_Location: deploy.Hub_Location,
        Category: deploy.Category,
        EV91_PublicRiderId: deploy.EV91_PublicRiderId || '',
        Data_Source: deploy._dataSource || 'Fleet',
        Deployee_date: formatIsoDate(deploy.Date),
        Return_date: formatIsoDate(today),
        number_of_days_with_rider: daysBetween(deploy.Date, today),
        vehicle_current_status: 'Deployed',
        _sortDeploy: deploy.Date.getTime(),
      })
    }

    vehicleRows = finalizeVehicleExportRows(vehicleRows, timeline, today)

    // Keep last N cycles (by deploy date), not last N raw events
    if (maxRecent != null && maxRecent > 0 && vehicleRows.length > maxRecent) {
      vehicleRows.sort((a, b) => a._sortDeploy - b._sortDeploy)
      vehicleRows = vehicleRows.slice(-maxRecent)
    }

    results.push(...vehicleRows)
  }

  results.sort((a, b) => {
    const byVehicleCmp = a.Vehiclenumber.localeCompare(b.Vehiclenumber, undefined, { numeric: true })
    if (byVehicleCmp !== 0) return byVehicleCmp
    return b._sortDeploy - a._sortDeploy
  })

  return results.map(({ _sortDeploy, ...row }) => row)
}

export function rowsToCsv(rows, headers = DEPLOY_RETURN_EXPORT_HEADERS) {
  const escape = (v) => {
    const s = v == null ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  return lines.join('\n')
}

/**
 * Align BigQuery Deploy/Return Current Status with EV91 Current Vehicle Status.
 * - Deployed in current-status → ensure vehicle is visible as Deployed (reopen or add row)
 * - Returned in current-status → close open Deployed cycle
 * This covers bikes that exist in API current-status even when Fleet/Overall pairing
 * left them Returned or missing.
 */
export function applyEv91CurrentStatusToDeployReturn(cycles = [], currentRows = []) {
  if (!currentRows?.length) return cycles || []

  const today = startOfDay(new Date())
  const todayKey = formatIsoDate(today)
  const byVehicle = new Map()

  for (const row of cycles || []) {
    const vKey = vehiclePartitionKey(row.Vehiclenumber)
    if (!vKey) continue
    if (!byVehicle.has(vKey)) byVehicle.set(vKey, [])
    byVehicle.get(vKey).push(row)
  }

  const currentByVehicle = new Map()
  for (const row of currentRows || []) {
    const vKey = vehiclePartitionKey(row.vehicleNumber)
    if (!vKey) continue
    const statusRaw = String(row.currentStatus || '').toLowerCase()
    let status = ''
    if (statusRaw.includes('deploy')) status = 'Deployed'
    else if (statusRaw.includes('return')) status = 'Returned'
    else continue

    const date =
      parseFleetDate(row.lastStatusDate) ||
      parseFleetDate(String(row.lastStatusDate || '').slice(0, 10)) ||
      today

    currentByVehicle.set(vKey, {
      status,
      date,
      city: (row.city || row.cityName || '').toString().trim(),
      riderId: (row.clientRiderId || row.clientId || '').toString().trim(),
      riderName: (row.riderName || '').toString().trim(),
      contact: (row.riderContact || '').toString().trim(),
      client: (row.clientName || '').toString().trim(),
      ev91Id: (row.ev91RiderId || '').toString().trim(),
      vehicle: normalizeVehicleNumber(row.vehicleNumber),
    })
  }

  const out = [...(cycles || [])]

  for (const [vKey, current] of currentByVehicle) {
    const rows = byVehicle.get(vKey) || []
    rows.sort((a, b) => String(b.Deployee_date || '').localeCompare(String(a.Deployee_date || '')))
    const newest = rows[0]

    if (current.status === 'Deployed') {
      if (newest) {
        if (newest.vehicle_current_status !== 'Deployed') {
          const dep = parseFleetDate(newest.Deployee_date) || current.date || today
          newest.vehicle_current_status = 'Deployed'
          newest.Return_date = todayKey
          newest.number_of_days_with_rider = daysBetween(dep, today)
          if (!newest.Data_Source || newest.Data_Source === 'Fleet') {
            newest.Data_Source = 'Cutover'
          }
        }
        // ensure only one Deployed row for this vehicle
        for (const row of rows.slice(1)) {
          if (row.vehicle_current_status !== 'Deployed') continue
          const end = parseFleetDate(newest.Deployee_date) || today
          const start = parseFleetDate(row.Deployee_date) || end
          row.vehicle_current_status = 'Returned'
          row.Return_date = formatIsoDate(end)
          row.number_of_days_with_rider = daysBetween(start, end)
        }
      } else {
        // Vehicle only in API current-status — still show it
        const dep = current.date || today
        out.push({
          city_name: current.city,
          Vehiclenumber: current.vehicle,
          Vehicle_Status: 'Deployee',
          Rider_ID: current.riderId,
          Rider_Name: current.riderName,
          Rider_Contact_Number: current.contact,
          CLIENT_NAME: current.client,
          Hub_Location: '',
          Category: '',
          EV91_PublicRiderId: current.ev91Id,
          Data_Source: 'EV91 API',
          Deployee_date: formatIsoDate(dep),
          Return_date: todayKey,
          number_of_days_with_rider: daysBetween(dep, today),
          vehicle_current_status: 'Deployed',
        })
      }
      continue
    }

    if (current.status === 'Returned' && newest && isOpenDeployCycle(newest, todayKey)) {
      const dep = parseFleetDate(newest.Deployee_date) || current.date
      newest.vehicle_current_status = 'Returned'
      newest.Return_date = formatIsoDate(current.date)
      newest.number_of_days_with_rider = daysBetween(dep, current.date)
      if (newest.Data_Source === 'Fleet') newest.Data_Source = 'Cutover'
    }
  }

  return out
}

export function downloadDeployReturnCsv(fleetRows, filenamePrefix = 'fleet_deploy_return') {
  const rows = buildDeployReturnReport(fleetRows)
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  return rows.length
}
