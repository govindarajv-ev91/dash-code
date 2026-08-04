import { differenceInCalendarDays, startOfDay } from 'date-fns'
import {
  buildRiderPerformanceReportFromAssignments,
  getRiderPerformanceHeaders,
  getZeroOrderRiderPerformanceHeaders,
} from './riderPerformanceReport'
import { fetchAllEv91MisData } from './ev91MisApi'
import { lookupRentalPendingAmount } from './rentalPendingDb'
import {
  fillAssignmentSourceFromOnboarding,
  isMissingSourceName,
} from './onboardingSourceLookup'

export { fillAssignmentSourceFromOnboarding } from './onboardingSourceLookup'

/**
 * Placeholder for future EV91 Rider Detail API.
 * When available, merge extra fields (hub, KYC, etc.) into assignments here.
 *
 * Expected future shape (example):
 *   GET /api/v1/public/mis/rider-details?...
 */
export async function fetchEv91RiderDetails(_params = {}) {
  // Not provided yet — return empty map keyed by ev91RiderId / clientRiderId.
  return new Map()
}

export function mergeEv91RiderDetailsIntoAssignments(assignments, detailsById) {
  if (!detailsById?.size) return assignments || []
  return (assignments || []).map((a) => {
    const detail =
      detailsById.get(a.ev91RiderId) ||
      detailsById.get(a.clientRiderId) ||
      detailsById.get(a.riderId)
    if (!detail) return a
    const detailSource = (detail.source || '').toString().trim()
    return {
      ...a,
      hub: a.hub || detail.hub || detail.hubLocation || '',
      category: a.category || detail.category || '',
      source:
        !isMissingSourceName(a.source)
          ? a.source
          : !isMissingSourceName(detailSource)
            ? detailSource
            : a.source,
      riderName: a.riderName || detail.riderName || detail.name || '',
      mobile: a.mobile || detail.mobile || detail.phone || '',
      ...detail._assignmentExtras,
    }
  })
}

function parseEv91Date(value, fallback) {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return startOfDay(d)
}

/**
 * Convert EV91 Current Vehicle Status rows → Rider Performance assignments.
 * Only Deployed riders.
 */
export function ev91CurrentStatusToAssignments(rows, asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  const assignments = []

  for (const row of rows || []) {
    const status = String(row.currentStatus || '').toLowerCase()
    if (!status.includes('deploy')) continue

    const clientRiderId = (row.clientRiderId || '').toString().trim()
    const ev91RiderId = (row.ev91RiderId || '').toString().trim()
    const riderId = clientRiderId || ev91RiderId
    if (!riderId && !row.vehicleNumber) continue

    const deployDate = parseEv91Date(row.lastStatusDate, asOf)
    const aging = Number(row.aging)
    const allotmentDays = Number.isFinite(aging)
      ? Math.max(0, aging)
      : Math.max(0, differenceInCalendarDays(asOf, deployDate))

    const sourceRaw = (row.source || '').toString().trim()
    const source = isMissingSourceName(sourceRaw) ? '' : sourceRaw

    assignments.push({
      vehicleNumber: (row.vehicleNumber || '').toString().trim(),
      riderId,
      clientRiderId,
      ev91RiderId,
      riderName: (row.riderName || '').toString().trim(),
      city: (row.city || '').toString().trim(),
      category: (row.operationalStatus || '').toString().trim(),
      operationalStatus: (row.operationalStatus || '').toString().trim(),
      client: (row.clientName || '').toString().trim(),
      mobile: (row.riderContact || '').toString().trim(),
      hub: '',
      source,
      deployDate,
      allotmentDays,
    })
  }

  return assignments.sort((a, b) => b.deployDate - a.deployDate)
}

/**
 * Load all Deployed riders from EV91 Current Status API.
 */
export async function fetchEv91DeployedRiders({ city = '', search = '' } = {}) {
  const result = await fetchAllEv91MisData('current-status', {
    status: 'Deployed',
    city: city || undefined,
    search: search || undefined,
  })
  return {
    rows: result.data || [],
    summary: result.summary || {},
    pagination: result.pagination || {},
  }
}

export function buildEv91RiderPerformanceReport(
  ev91CurrentStatusRows,
  orderRows,
  asOfDate = new Date(),
  { metricsIndex = null, riderDetailsById = null, onboardingRows = null } = {}
) {
  let assignments = ev91CurrentStatusToAssignments(ev91CurrentStatusRows, asOfDate)
  if (riderDetailsById?.size) {
    assignments = mergeEv91RiderDetailsIntoAssignments(assignments, riderDetailsById)
  }
  if (onboardingRows?.length) {
    assignments = fillAssignmentSourceFromOnboarding(assignments, onboardingRows)
  }
  return buildRiderPerformanceReportFromAssignments(assignments, orderRows, asOfDate, {
    metricsIndex,
  })
}

export function getEv91RiderPerformanceHeaders(asOfDate = new Date()) {
  const headers = getRiderPerformanceHeaders(asOfDate)
  const idIdx = headers.indexOf('ID')
  if (idIdx >= 0 && !headers.includes('EV91 ID')) {
    headers.splice(idIdx + 1, 0, 'EV91 ID')
  }
  return headers
}

export function getEv91ZeroOrderRiderPerformanceHeaders(asOfDate = new Date()) {
  const headers = getZeroOrderRiderPerformanceHeaders(asOfDate)
  const idIdx = headers.indexOf('ID')
  if (idIdx >= 0 && !headers.includes('EV91 ID')) {
    headers.splice(idIdx + 1, 0, 'EV91 ID')
  }
  return headers
}

/** Prefer rental match on client ID, then EV91 ID. */
export function lookupEv91RentalPending(index, row) {
  if (!index || !row) return null
  return (
    lookupRentalPendingAmount(index, row.ID) ??
    lookupRentalPendingAmount(index, row['Client Rider ID']) ??
    lookupRentalPendingAmount(index, row['EV91 ID']) ??
    null
  )
}
