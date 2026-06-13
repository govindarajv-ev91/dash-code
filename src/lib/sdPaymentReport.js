import { parseFleetDate } from './fleetDeployReturnExport'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { normalizeRiderIdKey } from './riderPerformanceReport'
import { formatInr } from './paymentHistoryReport'

export { formatInr }

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function pickText(...values) {
  for (const v of values) {
    const s = (v ?? '').toString().trim()
    if (s && s.toLowerCase() !== 'n/a') return s
  }
  return ''
}

function normalizePurpose(value) {
  return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Manual collation purposes counted as SD payment. */
export const SD_MANUAL_PURPOSE_MATCHERS = [
  (p) => p === 'sd',
  (p) => p.includes('security deposit'),
  (p) => p.includes('sd payment'),
  (p) => p.includes('sd paid'),
  (p) => p.includes('deploy sd'),
  (p) => /^s\.?\s*d\.?/.test(p),
]

/** Manual collation purposes counted as EV rent (user list). */
export const EV_RENT_MANUAL_PURPOSE_MATCHERS = [
  (p) => p === 'bike rent',
  (p) => p === 'ev rent',
  (p) => p === 'evrent',
  (p) => p === 'ev rent amount',
  (p) => p.includes('bike rent'),
  (p) => p.includes('ev rent'),
  (p) => p.includes('evrent'),
]

export function matchesSdManualPurpose(purpose) {
  const p = normalizePurpose(purpose)
  if (!p) return false
  return SD_MANUAL_PURPOSE_MATCHERS.some((fn) => fn(p))
}

export function matchesEvRentManualPurpose(purpose) {
  const p = normalizePurpose(purpose)
  if (!p) return false
  return EV_RENT_MANUAL_PURPOSE_MATCHERS.some((fn) => fn(p))
}

function manualCollationAmount(row) {
  const deposits = num(row.deposits)
  const withdrawals = num(row.withdrawals)
  return deposits > 0 ? deposits : withdrawals
}

/** Riders with at least one Deployee/Return fleet record (EV fleet). */
export function buildEvRiderIdSet(fleetRows) {
  const ids = new Set()
  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    if (status !== 'deployee' && status !== 'return') continue
    const id = normalizeRiderIdKey(row.rider_id)
    if (id) ids.add(id)
  }
  return ids
}

function buildFleetEvSdIndex(fleetRows) {
  const byRider = new Map()

  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    const date = parseFleetDate(row.date_record)
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id) continue

    const sdPaid = num(row.security_deposit_paid_deployee)
    const sdTotal = num(row.security_deposit_total_deployee)
    const sdPending = num(row.security_deposit_pending_deployee)
    const hasSd = sdPaid > 0 || sdTotal > 0 || sdPending > 0 || row.sd_paid_utr_deployee
    if (!hasSd && status !== 'deployee') continue

    const prev = byRider.get(id)
    const prevDate = prev?.date ? prev.date.getTime() : 0
    const curDate = date ? date.getTime() : 0
    if (prev && curDate < prevDate) continue

    byRider.set(id, {
      date,
      riderId: pickText(row.rider_id),
      riderName: pickText(row.rider_name) || 'N/A',
      city: normalizeSummaryCity(row.city_locations || row.city) || 'Unknown',
      client: normalizeSummaryClient(row.client_name) || 'Unknown',
      vehicleNumber: (row.vehicle_number || '').toString().trim(),
      phone: (row.rider_contact_number || '').toString().trim(),
      sdTotal,
      sdPaid,
      sdPending,
      sdUtr: (row.sd_paid_utr_deployee || '').toString().trim(),
    })
  }

  return byRider
}

function aggregatePaymentSd(paymentRows, evRiders) {
  const byRider = new Map()
  for (const row of paymentRows || []) {
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id || !evRiders.has(id)) continue
    const sd = num(row.sd)
    if (!sd) continue
    if (!byRider.has(id)) {
      byRider.set(id, {
        amount: 0,
        riderName: pickText(row.rider_name),
        city: normalizeSummaryCity(row.city),
        client: normalizeSummaryClient(row.client_name),
      })
    }
    const entry = byRider.get(id)
    entry.amount += sd
    entry.riderName = pickText(row.rider_name, entry.riderName) || entry.riderName
    entry.city = normalizeSummaryCity(pickText(row.city, entry.city)) || entry.city
    entry.client = normalizeSummaryClient(pickText(row.client_name, entry.client)) || entry.client
  }
  return byRider
}

function aggregateManualSd(collationRows, evRiders) {
  const byRider = new Map()
  for (const row of collationRows || []) {
    if (!matchesSdManualPurpose(row.purpose)) continue
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id || !evRiders.has(id)) continue
    const amount = manualCollationAmount(row)
    if (!amount) continue
    if (!byRider.has(id)) {
      byRider.set(id, {
        amount: 0,
        riderName: pickText(row.rider_name),
        city: normalizeSummaryCity(row.city),
      })
    }
    const entry = byRider.get(id)
    entry.amount += amount
    entry.riderName = pickText(row.rider_name, entry.riderName) || entry.riderName
    entry.city = normalizeSummaryCity(pickText(row.city, entry.city)) || entry.city
  }
  return byRider
}

/** Unique EV riders — fleet SD vs payment SD deduction vs manual SD (Purpose). */
export function buildSdPaymentReport(paymentRows = [], collationRows = [], fleetRows = []) {
  const evRiders = buildEvRiderIdSet(fleetRows)
  const fleetIndex = buildFleetEvSdIndex(fleetRows)
  const paymentSd = aggregatePaymentSd(paymentRows, evRiders)
  const manualSd = aggregateManualSd(collationRows, evRiders)

  const riderIds = new Set(evRiders)
  const rows = []

  for (const id of riderIds) {
    const fleet = fleetIndex.get(id)
    const pay = paymentSd.get(id)
    const manual = manualSd.get(id)
    if (!fleet && !pay && !manual) continue

    const fleetSdPaid = fleet?.sdPaid ?? 0
    const paymentSdDeduction = pay?.amount ?? 0
    const manualSdPaid = manual?.amount ?? 0

    rows.push({
      rowKey: `sd-${id}`,
      riderId: fleet?.riderId || id,
      riderName: pickText(fleet?.riderName, pay?.riderName, manual?.riderName) || 'N/A',
      city: pickText(fleet?.city, pay?.city, manual?.city) || 'Unknown',
      client: fleet?.client || pay?.client || 'Unknown',
      vehicleNumber: fleet?.vehicleNumber || '',
      riderPhone: fleet?.phone || '',
      fleetSdTotal: fleet?.sdTotal ?? 0,
      fleetSdPaid,
      fleetSdPending: fleet?.sdPending ?? 0,
      sdUtr: fleet?.sdUtr ?? '',
      paymentSdDeduction,
      manualSdPaid,
      sdGap: fleetSdPaid - paymentSdDeduction - manualSdPaid,
    })
  }

  rows.sort((a, b) => b.fleetSdPaid - a.fleetSdPaid || a.riderName.localeCompare(b.riderName))
  return rows
}

/** EV riders — all payment rows + manual EV rent rows (Purpose). */
export function buildEvRentMonthReport(paymentRows = [], collationRows = [], fleetRows = []) {
  const evRiders = buildEvRiderIdSet(fleetRows)
  const fleetIndex = buildFleetEvSdIndex(fleetRows)
  const rows = []

  for (const row of paymentRows || []) {
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id || !evRiders.has(id)) continue

    const fleet = fleetIndex.get(id)
    const paymentEvRent = num(row.ev_rent)

    rows.push({
      rowKey: `payment-${row.id}`,
      rowType: 'payment',
      month: pickText(row.month) || 'Unknown',
      week: pickText(row.week),
      type: pickText(row.type),
      riderId: pickText(row.rider_id),
      riderName: pickText(row.rider_name, fleet?.riderName) || 'N/A',
      city: normalizeSummaryCity(pickText(row.city, fleet?.city)) || 'Unknown',
      client: normalizeSummaryClient(pickText(row.client_name, fleet?.client)) || 'Unknown',
      vehicleNumber: pickText(row.vehicle_number, fleet?.vehicleNumber) || '',
      purpose: '',
      paymentEvRent,
      manualEvRent: 0,
      totalEvRent: paymentEvRent,
    })
  }

  for (const row of collationRows || []) {
    if (!matchesEvRentManualPurpose(row.purpose)) continue
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id || !evRiders.has(id)) continue

    const fleet = fleetIndex.get(id)
    const manualEvRent = manualCollationAmount(row)

    rows.push({
      rowKey: `collation-${row.id}`,
      rowType: 'manual',
      month: pickText(row.month) || 'Unknown',
      week: '',
      type: 'Manual',
      riderId: pickText(row.rider_id),
      riderName: pickText(row.rider_name, fleet?.riderName) || 'N/A',
      city: normalizeSummaryCity(pickText(row.city, fleet?.city)) || 'Unknown',
      client: fleet?.client || 'Unknown',
      vehicleNumber: pickText(row.vehicle_number, fleet?.vehicleNumber) || '',
      purpose: pickText(row.purpose),
      paymentEvRent: 0,
      manualEvRent,
      totalEvRent: manualEvRent,
    })
  }

  rows.sort((a, b) => {
    const monthCmp = (b.month || '').localeCompare(a.month || '')
    if (monthCmp) return monthCmp
    const nameCmp = a.riderName.localeCompare(b.riderName)
    if (nameCmp) return nameCmp
    return a.rowType.localeCompare(b.rowType)
  })

  return rows
}

export function filterSdRows(rows, { search = '', cities = [] } = {}) {
  const q = search.toLowerCase().trim()
  return rows.filter((r) => {
    if (cities.length && !cities.includes(r.city)) return false
    if (!q) return true
    return (
      r.riderId.toLowerCase().includes(q) ||
      r.riderName.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      (r.vehicleNumber || '').toLowerCase().includes(q) ||
      (r.sdUtr || '').toLowerCase().includes(q)
    )
  })
}

export function filterEvRentRows(rows, { search = '', cities = [], months = [] } = {}) {
  const q = search.toLowerCase().trim()
  return rows.filter((r) => {
    if (cities.length && !cities.includes(r.city)) return false
    if (months.length && !months.includes(r.month)) return false
    if (!q) return true
    return (
      r.riderId.toLowerCase().includes(q) ||
      r.riderName.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      (r.month || '').toLowerCase().includes(q) ||
      (r.week || '').toLowerCase().includes(q) ||
      (r.type || '').toLowerCase().includes(q) ||
      (r.purpose || '').toLowerCase().includes(q) ||
      (r.vehicleNumber || '').toLowerCase().includes(q)
    )
  })
}
