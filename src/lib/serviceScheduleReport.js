import { addMonths, differenceInCalendarDays, format, startOfDay, subDays } from 'date-fns'
import { vehiclePartitionKey } from './fleetDeployReturnExport'
import { iotRowDistanceKm, normalizeIotRunDate } from './iotDataReport'
import { ev91CurrentStatusToAssignments } from './ev91RiderPerformance'

export const SERVICE_INTERVAL_MONTHS = 2
/** Days before next due when dropdown re-opens for the next Service Done. */
export const SERVICE_REOPEN_DAYS = 15
export const SERVICE_DUE_SOON_DAYS = 15

function safeStartOfDay(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return startOfDay(d)
}

/**
 * Prefer aging-based deploy (days on road) over lastStatusDate alone,
 * so Client-Swap / status refreshes don't shrink the KM window.
 */
export function resolveEv91DeployDate(row, asOfDate = new Date()) {
  const asOf = safeStartOfDay(asOfDate) || startOfDay(new Date())
  const aging = Number(row?.aging ?? row?.allotmentDays)
  if (Number.isFinite(aging) && aging >= 0) {
    return subDays(asOf, Math.floor(aging))
  }
  const fromStatus = safeStartOfDay(row?.deployDate || row?.lastStatusDate)
  return fromStatus || asOf
}

/**
 * Service every 2 months from last actual service date (if any), else deploy date.
 */
export function computeServiceDue(deployDate, asOfDate = new Date(), lastActualServiceDate = null) {
  const deploy = safeStartOfDay(deployDate)
  const lastActual = safeStartOfDay(lastActualServiceDate)
  const anchor = lastActual || deploy
  const asOf = safeStartOfDay(asOfDate) || startOfDay(new Date())
  if (!anchor) {
    return {
      lastServiceDue: null,
      nextServiceDue: null,
      daysUntilDue: null,
      status: 'unknown',
      statusLabel: 'No deploy date',
      cycleComplete: false,
    }
  }

  let nextDue = addMonths(anchor, SERVICE_INTERVAL_MONTHS)
  let lastDue = lastActual || null

  while (nextDue < asOf) {
    lastDue = nextDue
    nextDue = addMonths(nextDue, SERVICE_INTERVAL_MONTHS)
  }

  const daysUntilDue = differenceInCalendarDays(nextDue, asOf)
  let status = 'ok'
  let statusLabel = 'Upcoming'
  if (daysUntilDue <= 0) {
    status = 'due'
    statusLabel = 'Due today'
  } else if (daysUntilDue <= SERVICE_DUE_SOON_DAYS) {
    status = 'soon'
    statusLabel = 'Due soon'
  }

  // Keep cycle "Service Done" until 15 days before next due,
  // then reopen dropdown (Not Done) so the next service can be marked.
  const cycleStart = addMonths(nextDue, -SERVICE_INTERVAL_MONTHS)
  const cycleComplete = Boolean(
    lastActual &&
      lastActual >= cycleStart &&
      daysUntilDue > SERVICE_REOPEN_DAYS
  )

  return {
    lastServiceDue: lastDue,
    nextServiceDue: nextDue,
    daysUntilDue,
    status,
    statusLabel,
    cycleComplete,
    serviceDropdownEnabled: !cycleComplete,
  }
}

function formatDisplayDate(date) {
  if (!date) return '—'
  return format(date, 'dd/MM/yyyy')
}

/** vehicleKey → Map(dateKey → km) from iot_data. */
export function buildVehicleDayKmIndex(iotRows) {
  const byVehicle = new Map()

  for (const row of iotRows || []) {
    const vKey = vehiclePartitionKey(row.vehicle_number)
    const dateKey = normalizeIotRunDate(row.run_date)
    if (!vKey || !dateKey) continue
    const km = iotRowDistanceKm(row)
    if (!km) continue

    if (!byVehicle.has(vKey)) byVehicle.set(vKey, new Map())
    const dayMap = byVehicle.get(vKey)
    dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + km)
  }

  return byVehicle
}

export function sumVehicleKmInRange(dayKmIndex, vehicleNumber, fromDate, toDate) {
  if (!dayKmIndex) return 0
  const vKey = vehiclePartitionKey(vehicleNumber)
  if (!vKey) return 0
  const dayMap = dayKmIndex.get(vKey)
  if (!dayMap) return 0

  const from = safeStartOfDay(fromDate)
  const to = safeStartOfDay(toDate)
  if (!from || !to) return 0
  const fromKey = format(from, 'yyyy-MM-dd')
  const toKey = format(to, 'yyyy-MM-dd')

  let total = 0
  for (const [dateKey, km] of dayMap.entries()) {
    if (dateKey >= fromKey && dateKey <= toKey) total += km
  }
  return Math.round(total * 100) / 100
}

/** Normalize EV91 Current Status Deployed rows → schedule assignments. */
export function ev91RowsToServiceAssignments(ev91Rows, asOfDate = new Date()) {
  const base = ev91CurrentStatusToAssignments(ev91Rows, asOfDate)
  return base.map((a) => {
    const deployDate = resolveEv91DeployDate(a, asOfDate)
    const asOf = safeStartOfDay(asOfDate) || startOfDay(new Date())
    return {
      ...a,
      deployDate,
      allotmentDays: Math.max(0, differenceInCalendarDays(asOf, deployDate)),
    }
  })
}

export function getEarliestDeployFromAssignments(assignments) {
  let earliest = null
  for (const a of assignments || []) {
    const d = safeStartOfDay(a.deployDate)
    if (!d) continue
    if (!earliest || d < earliest) earliest = d
  }
  return earliest
}

/**
 * EV91 Deployed vehicles + 2-month service due + KM since deploy → today.
 * serviceIndex: from buildVehicleServiceIndex (optional).
 */
export function buildServiceScheduleReport(
  assignments,
  {
    asOfDate = new Date(),
    city = '',
    statusFilter = '',
    search = '',
    dayKmIndex = null,
    serviceIndex = null,
  } = {}
) {
  const asOf = safeStartOfDay(asOfDate) || startOfDay(new Date())
  const cities = new Set()
  const clients = new Set()

  let rows = (assignments || []).map((a) => {
    const deploy = safeStartOfDay(a.deployDate) || asOf
    const vKey = vehiclePartitionKey(a.vehicleNumber)
    const svc = (vKey && serviceIndex?.get(vKey)) || {
      count: 0,
      lastServiceDate: null,
      lastRow: null,
    }
    const due = computeServiceDue(deploy, asOf, svc.lastServiceDate)
    const totalKm = dayKmIndex
      ? sumVehicleKmInRange(dayKmIndex, a.vehicleNumber, deploy, asOf)
      : 0
    if (a.city) cities.add(a.city)
    if (a.client) clients.add(a.client)

    const serviceDoneValue = due.cycleComplete ? 'done' : 'not_done'

    return {
      vehicleNumber: a.vehicleNumber || '',
      vehicleKey: vKey || '',
      riderId: a.riderId || a.clientRiderId || '',
      ev91RiderId: a.ev91RiderId || '',
      riderName: a.riderName || '',
      city: a.city || 'Unknown',
      client: a.client || 'Unknown',
      mobile: a.mobile || '',
      hub: a.hub || '',
      source: a.source || '',
      operationalStatus: a.operationalStatus || a.category || '',
      deployDate: deploy,
      deployDateLabel: formatDisplayDate(deploy),
      allotmentDays: a.allotmentDays ?? differenceInCalendarDays(asOf, deploy),
      lastServiceDue: due.lastServiceDue,
      lastServiceDueLabel: formatDisplayDate(due.lastServiceDue),
      nextServiceDue: due.nextServiceDue,
      nextServiceDueLabel: formatDisplayDate(due.nextServiceDue),
      daysUntilDue: due.daysUntilDue,
      status: due.status,
      statusLabel: due.statusLabel,
      totalKm,
      servicesDone: svc.count || 0,
      lastServiceDoneDate: svc.lastServiceDate,
      lastServiceDoneLabel: formatDisplayDate(svc.lastServiceDate),
      serviceDoneValue,
      cycleComplete: due.cycleComplete,
      serviceDropdownEnabled: due.serviceDropdownEnabled !== false,
    }
  })

  if (city && city !== 'All') {
    rows = rows.filter((r) => r.city === city)
  }
  if (statusFilter && statusFilter !== 'All') {
    if (statusFilter === 'service_done') {
      rows = rows.filter((r) => r.serviceDoneValue === 'done')
    } else if (statusFilter === 'service_pending') {
      rows = rows.filter((r) => r.serviceDoneValue !== 'done')
    } else {
      rows = rows.filter((r) => r.status === statusFilter)
    }
  }
  const q = (search || '').toString().trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) =>
        r.vehicleNumber.toLowerCase().includes(q) ||
        r.riderId.toLowerCase().includes(q) ||
        r.ev91RiderId.toLowerCase().includes(q) ||
        r.riderName.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q)
    )
  }

  const statusRank = { overdue: 0, due: 1, soon: 2, ok: 3, unknown: 4 }
  rows.sort(
    (a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      (a.daysUntilDue ?? 9999) - (b.daysUntilDue ?? 9999) ||
      a.vehicleNumber.localeCompare(b.vehicleNumber)
  )

  const totals = {
    vehicles: rows.length,
    overdue: rows.filter((r) => r.status === 'overdue' || r.status === 'due').length,
    dueSoon: rows.filter((r) => r.status === 'soon').length,
    serviceDone: rows.filter((r) => r.serviceDoneValue === 'done').length,
    totalKm: Math.round(rows.reduce((s, r) => s + (r.totalKm || 0), 0) * 100) / 100,
    servicesLogged: rows.reduce((s, r) => s + (r.servicesDone || 0), 0),
  }

  return {
    rows,
    totals,
    cities: [...cities].sort(),
    clients: [...clients].sort(),
    asOf,
    asOfLabel: format(asOf, 'dd/MM/yyyy'),
  }
}

export function serviceScheduleExportRows(rows) {
  return (rows || []).map((r) => ({
    'Vehicle No.': r.vehicleNumber,
    'EV91 Rider ID': r.ev91RiderId,
    'Client Rider ID': r.riderId,
    'Rider Name': r.riderName,
    City: r.city,
    Client: r.client,
    Source: r.source,
    Operational: r.operationalStatus,
    'Deploy Date': r.deployDateLabel,
    'Days on Road': r.allotmentDays,
    'Last Service Done': r.lastServiceDoneLabel,
    'Services Done (count)': r.servicesDone,
    'Service Status': r.serviceDoneValue === 'done' ? 'Service Done' : 'Not Done',
    'Last Service Due': r.lastServiceDueLabel,
    'Next Service Due': r.nextServiceDueLabel,
    'Days Until Due': r.daysUntilDue ?? '',
    Status: r.statusLabel,
    'Total KM (Deploy → Today)': r.totalKm,
  }))
}
