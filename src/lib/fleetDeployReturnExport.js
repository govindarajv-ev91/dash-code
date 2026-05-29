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
  if (t === 'deployee') return 'Deployee'
  if (t === 'return') return 'Return'
  return null
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
 * Sort Deployee/Return events chronologically. Same calendar day: Return before
 * Deployee so a return closes the previous cycle before a new deploy starts.
 */
function sortDeployReturnTimeline(txs) {
  return [...txs].sort((a, b) => {
    const diff = a.Date.getTime() - b.Date.getTime()
    if (diff !== 0) return diff
    if (a.Vehicle_Status === 'Return' && b.Vehicle_Status === 'Deployee') return -1
    if (a.Vehicle_Status === 'Deployee' && b.Vehicle_Status === 'Return') return 1
    return (a._order ?? 0) - (b._order ?? 0)
  })
}

/** Close older open deploys when a new deploy starts (missing Return rows in data). */
function closeOpenDeploysAt(openDeploys, paired, returnDate) {
  while (openDeploys.length > 0) {
    const deploy = openDeploys.pop()
    paired.push({ deploy, returnDate, status: 'Returned' })
  }
}

/**
 * Walk the timeline: Return closes the latest open Deployee; a new Deployee without
 * a prior Return closes any still-open deploy at the new deploy date.
 */
function pairDeployReturnSequential(timeline) {
  const paired = []
  const openDeploys = []

  for (const event of timeline) {
    if (event.Vehicle_Status === 'Deployee') {
      if (openDeploys.length > 0) {
        closeOpenDeploysAt(openDeploys, paired, event.Date)
      }
      openDeploys.push(event)
      continue
    }
    if (event.Vehicle_Status === 'Return' && openDeploys.length > 0) {
      const deploy = openDeploys.pop()
      paired.push({ deploy, returnDate: event.Date, status: 'Returned' })
    }
  }

  const last = timeline[timeline.length - 1]
  if (last?.Vehicle_Status === 'Return' && openDeploys.length > 0) {
    closeOpenDeploysAt(openDeploys, paired, last.Date)
  }

  return { paired, openDeploys, lastEvent: last }
}

/** One Deployed row per vehicle; status follows the latest Deployee/Return event. */
function finalizeVehicleExportRows(rows, timeline, today) {
  const last = timeline[timeline.length - 1]
  const isCurrentlyDeployed = last?.Vehicle_Status === 'Deployee'

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
    Date: date,
  }
}

/**
 * @param {object[]} fleetRows
 * @param {{ maxRecentDeployReturnPerVehicle?: number | null }} [options]
 *   maxRecentDeployReturnPerVehicle: if set (e.g. 6), only the N most recent
 *   Deployee/Return events per vehicle are considered before emitting deploy rows
 *   (BigQuery-style). Default null = every Deployee row is exported.
 */
export function buildDeployReturnReport(fleetRows, options = {}) {
  const maxRecent = options.maxRecentDeployReturnPerVehicle ?? null

  const transactions = []
  const seenRowIds = new Set()
  let order = 0
  for (const row of fleetRows || []) {
    if (row.id != null) {
      const id = String(row.id)
      if (seenRowIds.has(id)) continue
      seenRowIds.add(id)
    }
    const tx = rowToTransaction(row)
    if (tx) {
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

  let vehiclesToProcess = [...byVehicle.entries()]
  if (maxRecent != null && maxRecent > 0) {
    vehiclesToProcess = vehiclesToProcess.map(([key, txs]) => {
      const sorted = sortDeployReturnTimeline(txs)
      return [key, sorted.slice(-maxRecent)]
    })
  }

  const today = startOfDay(new Date())
  const results = []

  for (const [, vehicleTxs] of vehiclesToProcess) {
    const timeline = sortDeployReturnTimeline(vehicleTxs)
    const { paired, openDeploys } = pairDeployReturnSequential(timeline)
    const vehicleRows = []

    for (const { deploy, returnDate, status } of paired) {
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
        Vehicle_Status: deploy.Vehicle_Status,
        Rider_ID: deploy.Rider_ID,
        Rider_Name: deploy.Rider_Name,
        Rider_Contact_Number: deploy.Rider_Contact_Number,
        CLIENT_NAME: deploy.CLIENT_NAME,
        Hub_Location: deploy.Hub_Location,
        Category: deploy.Category,
        Deployee_date: formatIsoDate(deploy.Date),
        Return_date: formatIsoDate(today),
        number_of_days_with_rider: daysBetween(deploy.Date, today),
        vehicle_current_status: 'Deployed',
        _sortDeploy: deploy.Date.getTime(),
      })
    }

    results.push(...finalizeVehicleExportRows(vehicleRows, timeline, today))
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
