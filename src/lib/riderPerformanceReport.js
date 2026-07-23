import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns'
import { parseFleetDate, vehiclePartitionKey, normalizeFleetStatus } from './fleetDeployReturnExport.js'

export const HIDDEN_RIDER_PERFORMANCE_COLUMNS = new Set([
  'Current Week Expected Earnings',
  'Def for current week alone',
])

const BASE_RIDER_PERFORMANCE_HEADERS = [
  'Date',
  'V no',
  'ID',
  'City',
  'Category',
  'Client',
  'Name',
  'mobile no',
  'Hub location',
  'Source',
  'Allotment Days',
  'Current Week Expected Earnings',
  'Def for current week alone',
  'Current week +/-',
  'In-active Days',
  'Eff/inff',
  'Avg Order',
  'D-1 Order',
  'D-2 Order',
  'D-3 Order',
  'D-4 Order',
  'Current week orders',
  'Last week orders',
  'LWD',
  'IAD',
  'Rental Pending Amount',
]

/** @deprecated use getRiderPerformanceHeaders */
export const RIDER_PERFORMANCE_HEADERS = BASE_RIDER_PERFORMANCE_HEADERS

export function buildDayOrderHeader(asOfDate, dayOffset) {
  const d = subDays(startOfDay(asOfDate), dayOffset)
  return `D-${dayOffset} Order (${format(d, 'dd/MM')})`
}

export function buildDayKmHeader(asOfDate, dayOffset) {
  const d = subDays(startOfDay(asOfDate), dayOffset)
  return `D-${dayOffset} KM (${format(d, 'dd/MM')})`
}

export function getRiderPerformanceHeaders(asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  const headers = []

  for (const h of BASE_RIDER_PERFORMANCE_HEADERS) {
    if (HIDDEN_RIDER_PERFORMANCE_COLUMNS.has(h)) continue
    if (h === 'D-1 Order') {
      headers.push(buildDayOrderHeader(asOf, 1))
      continue
    }
    if (h === 'D-2 Order') {
      headers.push(buildDayOrderHeader(asOf, 2))
      continue
    }
    if (h === 'D-3 Order') {
      headers.push(buildDayOrderHeader(asOf, 3))
      continue
    }
    if (h === 'D-4 Order') {
      headers.push(buildDayOrderHeader(asOf, 4))
      continue
    }
    headers.push(h)
  }

  // Last 3 days IoT running distance (D-1 … D-3)
  for (let n = 1; n <= 3; n++) {
    headers.push(buildDayKmHeader(asOf, n))
  }

  return headers
}

const INACTIVE_EXEMPT_CLIENTS = new Set([
  'licious',
  'kwik',
  'rapido',
  'rd',
  'rental_model',
])

const FLEET_SOURCE_FIELDS = [
  'source_name',
  'source_name_vehicle_asset_details',
  'filled_by',
  'keerthana_tc_chenai_tn',
  'source',
]

export function extractFleetSource(row) {
  if (!row) return ''
  for (const key of FLEET_SOURCE_FIELDS) {
    const v = (row[key] ?? '').toString().trim()
    if (v && v.toLowerCase() !== 'null' && v !== 'n/a') return v
  }
  return ''
}

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function normalizeClient(value) {
  return (value ?? '').toString().trim()
}

function normalizeWorkerCode(value) {
  return (value ?? '').toString().trim()
}

/** Treat CHN61_R0196 and CHN61-R0196 as the same rider ID. Excel ids like 899696.0 → 899696. */
export function normalizeRiderIdKey(value) {
  let s = normalizeWorkerCode(value).toUpperCase().replace(/[_\s-]+/g, '-')
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0]
  return s
}

/** Aliases so fleet FE963117 matches order upload 963117 (and reverse). */
export function riderIdLookupKeys(value) {
  const aliases = new Set()
  const raw = (value ?? '').toString().trim()
  if (!raw) return aliases

  const idKey = normalizeRiderIdKey(raw)
  if (idKey) aliases.add(idKey)

  const prefixMatch = idKey.match(/^([A-Z]{2,5})(\d+)$/i)
  if (prefixMatch?.[2]?.length >= 5) {
    aliases.add(prefixMatch[2])
    aliases.add(`${prefixMatch[1]}${prefixMatch[2]}`)
  }

  const embeddedFe = idKey.match(/FE(\d{5,})/i)
  if (embeddedFe) {
    aliases.add(`FE${embeddedFe[1]}`)
    aliases.add(embeddedFe[1])
  }

  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 5) aliases.add(digits)

  return aliases
}

function normalizeName(value) {
  return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildFleetSourceByRider(fleetRows) {
  const byRider = new Map()
  for (const row of fleetRows || []) {
    const riderId = normalizeWorkerCode(row.rider_id)
    const source = extractFleetSource(row)
    if (!riderId || !source) continue
    const date = parseFleetDate(row.date_record) || new Date(0)
    const prev = byRider.get(riderId)
    if (!prev || date >= prev.date) {
      byRider.set(riderId, { source, date })
    }
  }
  return byRider
}

export function parseMetricDate(dateStr) {
  return parseFleetDate(dateStr)
}

export function buildVehicleAllotmentMap(fleetRows, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const byVehicle = new Map()

  for (const row of fleetRows || []) {
    const status = normalizeFleetStatus(row.vehicle_status)
    if (status !== 'Deployee' && status !== 'Return') continue
    const date = parseFleetDate(row.date_record)
    const vehicleKey = vehiclePartitionKey(row.vehicle_number)
    if (!date || !vehicleKey) continue

    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, [])
    byVehicle.get(vehicleKey).push({
      status,
      date,
      row,
    })
  }

  const allotmentByVehicle = new Map()

  for (const [, events] of byVehicle) {
    events.sort((a, b) => {
      const diff = a.date - b.date
      if (diff !== 0) return diff
      if (a.status === 'Return' && b.status === 'Deployee') return -1
      if (a.status === 'Deployee' && b.status === 'Return') return 1
      return 0
    })

    let openDeploy = null
    for (const event of events) {
      if (event.date > asOf) continue
      if (event.status === 'Deployee') {
        openDeploy = event
      } else if (event.status === 'Return' && openDeploy) {
        openDeploy = null
      }
    }

    if (openDeploy) {
      const days = Math.max(0, differenceInCalendarDays(asOf, openDeploy.date))
      allotmentByVehicle.set(vehiclePartitionKey(openDeploy.row.vehicle_number), {
        days,
        deploy: openDeploy.row,
        deployDate: openDeploy.date,
      })
    }
  }

  return allotmentByVehicle
}

/** Latest known contact on or before as-of date (deploy row may omit phone). */
function buildFleetContactEnrichment(fleetRows, asOfDate) {
  const asOf = startOfDay(asOfDate)
  const byRiderId = new Map()
  const byVehicle = new Map()

  for (const row of fleetRows || []) {
    const date = parseFleetDate(row.date_record)
    if (!date || date > asOf) continue
    const phone = normalizePhone(row.rider_contact_number)
    if (!phone) continue

    const idKey = normalizeRiderIdKey(row.rider_id)
    const vKey = vehiclePartitionKey(row.vehicle_number)
    if (idKey) {
      const prev = byRiderId.get(idKey)
      if (!prev || date >= prev.date) byRiderId.set(idKey, { phone, date })
    }
    if (vKey) {
      const prev = byVehicle.get(vKey)
      if (!prev || date >= prev.date) byVehicle.set(vKey, { phone, date })
    }
  }

  return { byRiderId, byVehicle }
}

function enrichAssignmentMobile(assignment, contactLookup) {
  if (normalizePhone(assignment.mobile)) return assignment

  const idKey = normalizeRiderIdKey(assignment.riderId)
  const vKey = vehiclePartitionKey(assignment.vehicleNumber)
  const fromRider = idKey ? contactLookup.byRiderId.get(idKey) : null
  const fromVehicle = vKey ? contactLookup.byVehicle.get(vKey) : null
  const phone = fromRider?.phone || fromVehicle?.phone
  if (!phone) return assignment

  return { ...assignment, mobile: phone }
}

export function getCurrentlyDeployedAssignments(fleetRows, asOfDate) {
  const allotmentMap = buildVehicleAllotmentMap(fleetRows, asOfDate)
  const contactLookup = buildFleetContactEnrichment(fleetRows, asOfDate)
  const assignments = []

  for (const [, { days, deploy, deployDate }] of allotmentMap) {
    const assignment = enrichAssignmentMobile(
      {
        vehicleNumber: (deploy.vehicle_number || '').toString().trim(),
        riderId: normalizeWorkerCode(deploy.rider_id),
        riderName: (deploy.rider_name || '').toString().trim(),
        city: (deploy.city_locations || deploy.city || '').toString().trim(),
        category: (deploy.category || '').toString().trim(),
        client: normalizeClient(deploy.client_name),
        mobile: (deploy.rider_contact_number || '').toString().trim(),
        hub: (deploy.hub_location || '').toString().trim(),
        source: extractFleetSource(deploy),
        deployDate,
        allotmentDays: days,
      },
      contactLookup
    )
    assignments.push(assignment)
  }

  return assignments.sort((a, b) => b.deployDate - a.deployDate)
}

export function buildRiderMetricsIndex(riderRows) {
  const byWorker = new Map()
  const byMobile = new Map()
  const byName = new Map()

  for (const row of riderRows || []) {
    const worker = normalizeWorkerCode(row.worker_code)
    if (!worker) continue
    const date = parseMetricDate(row.date_record)
    if (!date) continue

    const record = {
      date,
      delivered: parseInt(row.delivered, 10) || 0,
      client: normalizeClient(row.client),
      source: (row.source || '').toString().trim(),
      mobile: (row.mob_number || '').toString().trim(),
      hub: (row.hub_name || '').toString().trim(),
      week: (row.week || '').toString().trim(),
      workerCode: worker,
      workerName: normalizeName(row.worker_name),
    }

    for (const workerKey of riderIdLookupKeys(worker)) {
      if (!byWorker.has(workerKey)) byWorker.set(workerKey, [])
      byWorker.get(workerKey).push(record)
    }

    const phone = normalizePhone(record.mobile)
    if (phone) {
      if (!byMobile.has(phone)) byMobile.set(phone, [])
      byMobile.get(phone).push(record)
    }

    if (record.workerName) {
      if (!byName.has(record.workerName)) byName.set(record.workerName, [])
      byName.get(record.workerName).push(record)
    }
  }

  for (const bucket of [byWorker, byMobile, byName]) {
    for (const records of bucket.values()) {
      records.sort((a, b) => a.date - b.date)
    }
  }

  return { byWorker, byMobile, byName }
}

/** Match fleet rider_id to order rows (ID aliases, mobile, or name). */
export function resolveRiderMetricRecords(assignment, metricsIndex) {
  const { byWorker, byMobile, byName } = metricsIndex

  for (const idKey of riderIdLookupKeys(assignment.riderId)) {
    const byId = byWorker.get(idKey)
    if (byId?.length) return mergeRecordsByDate(byId)
  }

  const phone = normalizePhone(assignment.mobile)
  if (phone && byMobile.has(phone)) {
    return mergeRecordsByDate(byMobile.get(phone))
  }

  const name = normalizeName(assignment.riderName)
  if (name && byName.has(name)) {
    return mergeRecordsByDate(byName.get(name))
  }

  return []
}

function mergeRecordsByDate(records) {
  const byDay = new Map()
  for (const rec of records) {
    const key = format(rec.date, 'yyyy-MM-dd')
    if (!byDay.has(key)) {
      byDay.set(key, { ...rec })
    } else {
      byDay.get(key).delivered += rec.delivered
    }
  }
  return [...byDay.values()].sort((a, b) => a.date - b.date)
}

function normalizeClientKey(client) {
  return normalizeClient(client).toLowerCase().replace(/\s+/g, '_')
}

function isInactiveExemptClient(client) {
  return INACTIVE_EXEMPT_CLIENTS.has(normalizeClientKey(client))
}

/**
 * Google Sheets MAP: exempt clients → Active first; else v (IAD) drives status.
 */
export function calcInactiveLabel(client, iad, allotmentDays, lwd) {
  if (isInactiveExemptClient(client)) return 'Active'

  const lwdValue = (lwd ?? '').toString().trim()
  if (!lwdValue) return 'ID/Tag Error'

  const v = Number(iad)
  if (!Number.isFinite(v) || v >= 1000) return 'ID/Tag Error'
  if (v <= 3) return 'Active'
  return `${Math.min(allotmentDays, v)} Days Inactive`
}

export function calcEfficiency(avgOrder) {
  const n = Number(avgOrder) || 0
  if (n >= 19) return 'High frequency'
  if (n >= 13) return 'Mid frequency'
  if (n >= 1) return 'Low frequency'
  return '0 Orders'
}

function sumOrdersInRange(records, from, to) {
  let total = 0
  for (const rec of records) {
    if (rec.date >= from && rec.date <= to) total += rec.delivered
  }
  return total
}

function ordersOnDay(records, day) {
  const key = format(startOfDay(day), 'yyyy-MM-dd')
  let total = 0
  for (const rec of records) {
    if (format(rec.date, 'yyyy-MM-dd') === key) total += rec.delivered
  }
  return total
}

function computeOrderStats(records, _deployDate, asOfDate) {
  const asOf = startOfDay(asOfDate)

  const currentWeekStart = startOfWeek(asOf, { weekStartsOn: 1 })
  const lastWeekStart = subDays(currentWeekStart, 7)
  const lastWeekEnd = endOfWeek(lastWeekStart, { weekStartsOn: 1 })

  const currentWeekOrders = sumOrdersInRange(records, currentWeekStart, asOf)
  const lastWeekOrders = sumOrdersInRange(records, lastWeekStart, lastWeekEnd)

  let lastWorkingDate = null
  for (const rec of records) {
    if (rec.date > asOf) continue
    if (rec.delivered > 0) lastWorkingDate = rec.date
  }

  const d1 = ordersOnDay(records, subDays(asOf, 1))
  const d2 = ordersOnDay(records, subDays(asOf, 2))
  const d3 = ordersOnDay(records, subDays(asOf, 3))
  const d4 = ordersOnDay(records, subDays(asOf, 4))
  const avgOrder = Math.round(((d1 + d2 + d3 + d4) / 4) * 10) / 10

  const iad = lastWorkingDate
    ? differenceInCalendarDays(asOf, lastWorkingDate)
    : 1000

  return {
    d1,
    d2,
    d3,
    d4,
    currentWeekOrders,
    lastWeekOrders,
    currentWeekDelta: currentWeekOrders - lastWeekOrders,
    avgOrder,
    lwd: lastWorkingDate ? format(lastWorkingDate, 'dd/MM/yyyy') : '',
    iad,
  }
}

function buildRowFromAssignment(assignment, stats, asOf, fleetSourceByRider, records) {
  const mobile =
    assignment.mobile ||
    records.find((r) => r.mobile)?.mobile ||
    ''
  const source =
    assignment.source ||
    fleetSourceByRider.get(assignment.riderId)?.source ||
    records.find((r) => r.source)?.source ||
    ''
  const hub =
    assignment.hub ||
    records.find((r) => r.hub)?.hub ||
    ''

  const row = {
    Date: format(assignment.deployDate, 'dd/MM/yyyy'),
    'V no': assignment.vehicleNumber,
    ID: assignment.riderId,
    City: assignment.city,
    Category: assignment.category,
    Client: assignment.client,
    Name: assignment.riderName,
    'mobile no': mobile,
    'Hub location': hub,
    Source: source,
    'Allotment Days': assignment.allotmentDays,
    'Current week +/-': stats.currentWeekDelta,
    'In-active Days': calcInactiveLabel(
      assignment.client,
      stats.iad,
      assignment.allotmentDays,
      stats.lwd
    ),
    'Eff/inff': calcEfficiency(stats.avgOrder),
    'Avg Order': stats.avgOrder,
    [buildDayOrderHeader(asOf, 1)]: stats.d1,
    [buildDayOrderHeader(asOf, 2)]: stats.d2,
    [buildDayOrderHeader(asOf, 3)]: stats.d3,
    [buildDayOrderHeader(asOf, 4)]: stats.d4,
    'Current week orders': stats.currentWeekOrders,
    'Last week orders': stats.lastWeekOrders,
    LWD: stats.lwd,
    IAD: stats.iad,
    _deployDate: assignment.deployDate,
  }

  return row
}

export function buildRiderPerformanceReport(
  fleetRows,
  riderRows,
  asOfDate = new Date(),
  { metricsIndex: metricsIndexOpt = null, fleetSourceByRider: fleetSourceOpt = null } = {}
) {
  const asOf = startOfDay(asOfDate)
  const deployed = getCurrentlyDeployedAssignments(fleetRows, asOf)
  const metricsIndex = metricsIndexOpt || buildRiderMetricsIndex(riderRows)
  const fleetSourceByRider = fleetSourceOpt || buildFleetSourceByRider(fleetRows)

  return deployed.map((assignment) => {
    const records = resolveRiderMetricRecords(assignment, metricsIndex)
    const stats = computeOrderStats(records, assignment.deployDate, asOf)
    return buildRowFromAssignment(assignment, stats, asOf, fleetSourceByRider, records)
  })
}

export const EXCEL_EXPORT_LOOKBACK_DAYS = 5
export const EXCEL_EXPORT_ORDER_DAY_OFFSETS = [2, 3, 4]

/** Dates (yyyy-MM-dd) with rider_metrics rows per client in D-1…D-5 window. */
export function buildClientMetricDatesInWindow(riderRows, asOfDate = new Date(), lookbackDays = EXCEL_EXPORT_LOOKBACK_DAYS) {
  const asOf = startOfDay(asOfDate)
  const from = subDays(asOf, lookbackDays)
  const to = subDays(asOf, 1)
  const byClient = new Map()

  for (const row of riderRows || []) {
    const date = parseMetricDate(row.date_record)
    if (!date || date < from || date > to) continue
    const clientKey = normalizeClientKey(row.client)
    if (!clientKey) continue
    if (!byClient.has(clientKey)) byClient.set(clientKey, new Set())
    byClient.get(clientKey).add(format(date, 'yyyy-MM-dd'))
  }

  return byClient
}

function recordsInMetricWindow(records, asOfDate, lookbackDays = EXCEL_EXPORT_LOOKBACK_DAYS) {
  const asOf = startOfDay(asOfDate)
  const from = subDays(asOf, lookbackDays)
  const to = subDays(asOf, 1)
  return (records || []).filter((rec) => rec.date >= from && rec.date <= to)
}

/**
 * Excel export: only deployed riders whose client uploaded order data in the
 * last 5 days (D-1…D-5) and who have matching rider_metrics in that window.
 */
export function filterReportRowsForExcelExport(
  reportRows,
  riderRows,
  asOfDate = new Date(),
  lookbackDays = EXCEL_EXPORT_LOOKBACK_DAYS
) {
  const clientDates = buildClientMetricDatesInWindow(riderRows, asOfDate, lookbackDays)
  const metricsIndex = buildRiderMetricsIndex(riderRows)

  return (reportRows || []).filter((row) => {
    const clientKey = normalizeClientKey(row.Client)
    if (!clientKey || !clientDates.get(clientKey)?.size) return false

    const records = resolveRiderMetricRecords(
      {
        riderId: row.ID,
        mobile: row['mobile no'],
        riderName: row.Name,
      },
      metricsIndex
    )
    return recordsInMetricWindow(records, asOfDate, lookbackDays).length > 0
  })
}

export function classifyInactiveStatus(label) {
  const s = (label ?? '').toString().trim()
  if (s === 'Active') return 'active'
  if (s === 'ID/Tag Error') return 'id_error'
  if (s.toLowerCase().includes('inactive')) return 'inactive'
  return 'other'
}

export function classifyEfficiencyLabel(label) {
  const s = (label ?? '').toString().trim()
  if (s === 'High frequency') return 'high'
  if (s === 'Mid frequency') return 'mid'
  if (s === 'Low frequency') return 'low'
  if (s === '0 Orders') return 'zero'
  return 'unknown'
}

/**
 * Selected end date (e.g. 21st) → report asOf so D-1…D-4 = 21, 20, 19, 18.
 * Internal asOf is endDate + 1 day (same pattern as All Riders vs yesterday).
 */
export function getZeroOrderAsOfFromEndDate(endDate) {
  return addDays(startOfDay(endDate), 1)
}

/** Four calendar dates in the 0-order window (newest → oldest). */
export function getZeroOrderWindowDates(endDate) {
  const end = startOfDay(endDate)
  return [0, 1, 2, 3].map((n) => subDays(end, n))
}

export function hasZeroOrdersLast4Days(row, asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  for (let n = 1; n <= 4; n++) {
    const header = buildDayOrderHeader(asOf, n)
    const orders = Number(row[header] ?? row[`D-${n} Order`] ?? 0)
    if (orders > 0) return false
  }
  return true
}

export function getZeroOrderRiderPerformanceHeaders(asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  return [
    'Date',
    'V no',
    'ID',
    'City',
    'Category',
    'Client',
    'Name',
    'mobile no',
    'Hub location',
    'Source',
    'Eff/inff',
    buildDayOrderHeader(asOf, 1),
    buildDayOrderHeader(asOf, 2),
    buildDayOrderHeader(asOf, 3),
    buildDayOrderHeader(asOf, 4),
    buildDayKmHeader(asOf, 1),
    buildDayKmHeader(asOf, 2),
    buildDayKmHeader(asOf, 3),
    buildDayKmHeader(asOf, 4),
    'In-active Days',
    'Rental Pending Amount',
  ]
}

export function filterRiderPerformanceRows(
  rows,
  { city = 'All', client = 'All', source = 'All', search = '', view = 'all', asOfDate = new Date() } = {}
) {
  const q = search.trim().toLowerCase()
  return (rows || []).filter((row) => {
    if (view === 'zero_orders' && !hasZeroOrdersLast4Days(row, asOfDate)) return false
    if (city !== 'All' && row.City !== city) return false
    if (client !== 'All' && row.Client !== client) return false
    if (source !== 'All' && row.Source !== source) return false
    if (!q) return true
    const blob = [
      row['V no'],
      row.ID,
      row.Name,
      row.Client,
      row.City,
      row.Source,
      row['mobile no'],
      row['Eff/inff'],
      row['In-active Days'],
      row.Category,
    ]
      .join(' ')
      .toLowerCase()
    return blob.includes(q)
  })
}

export function summarizeRiderPerformanceRows(rows) {
  const summary = {
    total: rows.length,
    active: 0,
    inactive: 0,
    idTagError: 0,
    effHigh: 0,
    effMid: 0,
    effLow: 0,
    effZero: 0,
    efficient: 0,
    inefficient: 0,
  }

  for (const row of rows || []) {
    const inactiveStatus = classifyInactiveStatus(row['In-active Days'])
    if (inactiveStatus === 'active') summary.active++
    else if (inactiveStatus === 'inactive') summary.inactive++
    else if (inactiveStatus === 'id_error') summary.idTagError++

    const eff = classifyEfficiencyLabel(row['Eff/inff'])
    if (eff === 'high') {
      summary.effHigh++
      summary.efficient++
    } else if (eff === 'mid') {
      summary.effMid++
      summary.efficient++
    } else if (eff === 'low') {
      summary.effLow++
      summary.inefficient++
    } else if (eff === 'zero') {
      summary.effZero++
      summary.inefficient++
    }
  }

  return summary
}

export function parseRentalPendingAmount(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Rental pending stats for visible rows. */
export function summarizeRentalPendingRows(rows, { includeNegative = false } = {}) {
  let dueRiders = 0
  let totalDue = 0

  for (const row of rows || []) {
    const amount = parseRentalPendingAmount(row['Rental Pending Amount'])
    if (amount == null) continue
    if (amount > 0 || (includeNegative && amount < 0)) {
      dueRiders++
      totalDue += amount
    }
  }

  return { dueRiders, totalDue }
}

export function rowsToPerformanceCsv(rows, headers) {
  const cols = headers || getRiderPerformanceHeaders()
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [cols.join(',')]
  for (const row of rows) {
    lines.push(cols.map((h) => escape(row[h])).join(','))
  }
  return lines.join('\n')
}

export function getCellValue(row, header, asOfDate = new Date()) {
  if (header === 'Rental Pending Amount') {
    const v = row[header]
    if (v === '' || v == null) return ''
    const n = Number(v)
    if (!Number.isNaN(n)) {
      return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    }
    return v
  }
  if (row[header] !== undefined) return row[header]
  const asOf = startOfDay(asOfDate)
  for (let n = 1; n <= 4; n++) {
    if (header === buildDayOrderHeader(asOf, n)) {
      return row[buildDayOrderHeader(asOf, n)] ?? row[`D-${n} Order`] ?? ''
    }
  }
  for (let n = 1; n <= 4; n++) {
    if (header === buildDayKmHeader(asOf, n)) {
      const v = row[buildDayKmHeader(asOf, n)]
      if (v === '' || v == null) return ''
      const num = Number(v)
      if (!Number.isNaN(num)) {
        return num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }
      return v
    }
  }
  return row[header] ?? ''
}
