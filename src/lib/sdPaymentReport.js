import { parseFleetDate } from './fleetDeployReturnExport'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { normalizeRiderIdKey } from './riderPerformanceReport'
import { formatInr } from './paymentHistoryReport'
import { monthSortKey, normalizeMonthLabel } from './paymentMonthList'

export { formatInr }

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function normalizePaymentMonth(value) {
  const text = normalizeMonthLabel(value)
  if (!text) return ''

  const named = text.match(/^([A-Za-z]+)[\s\-_/]+(\d{4})$/)
  if (named) {
    const abbr = named[1].slice(0, 3).toLowerCase()
    const monthIndex = MONTH_ABBR[abbr]
    const year = Number(named[2])
    if (monthIndex != null && Number.isFinite(year)) {
      return `${MONTH_SHORT[monthIndex]}-${year}`
    }
  }

  const short = text.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (short) {
    const abbr = short[1].toLowerCase()
    const monthIndex = MONTH_ABBR[abbr]
    const year = Number(short[2])
    if (monthIndex != null && Number.isFinite(year)) {
      return `${MONTH_SHORT[monthIndex]}-${year}`
    }
  }

  return text
}

function normalizePaymentWeek(value) {
  const text = pickText(value)
  if (!text) return ''
  const n = parseInt(text.replace(/^W/i, '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? String(n) : text
}

function monthLabelFromDate(date) {
  if (!date) return ''
  return `${MONTH_SHORT[date.getMonth()]}-${date.getFullYear()}`
}

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

export function formatDeployedAt(value) {
  const raw = pickText(value)
  if (!raw) return ''
  const d = parseFleetDate(raw)
  if (!d) return raw
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function paymentWeekKey(row) {
  const month = normalizePaymentMonth(row.month)
  const week = normalizePaymentWeek(row.week)
  if (month && week) return `${month}|${week}`

  const paymentDate = parseFleetDate(row.payment_date)
  if (paymentDate) {
    const monthFromDate = month || monthLabelFromDate(paymentDate)
    const dateKey = paymentDate.toISOString().slice(0, 10)
    if (monthFromDate && week) return `${monthFromDate}|${week}`
    if (monthFromDate) return `${monthFromDate}|date:${dateKey}`
    return `date:${dateKey}`
  }

  return ''
}

function paymentWeekSortValue(row) {
  const paymentDate = parseFleetDate(row.payment_date)
  if (paymentDate) return paymentDate.getTime()
  const mk = monthSortKey(normalizePaymentMonth(row.month))
  const weekNum = parseInt(normalizePaymentWeek(row.week), 10) || 0
  if (typeof mk === 'number') return mk * 100 + weekNum
  const key = paymentWeekKey(row)
  if (key.startsWith('date:')) {
    const d = parseFleetDate(key.slice(5))
    if (d) return d.getTime()
  }
  return 0
}

function formatPaymentWeekLabel(key) {
  if (!key) return ''
  if (key.startsWith('date:')) return key.slice(5)
  const [month, week] = key.split('|')
  if (week.startsWith('date:')) return `${month} (${week.slice(5)})`
  const w = week.replace(/^W/i, '')
  const n = parseInt(w, 10)
  return n ? `${month} W${n}` : month
}

/** Two most recent payment month+week keys from uploaded payment rows. */
export function resolveLatestPaymentWeeks(paymentRows, count = 2) {
  const weekMap = new Map()
  for (const row of paymentRows || []) {
    const key = paymentWeekKey(row)
    if (!key) continue
    const sort = paymentWeekSortValue(row)
    const prev = weekMap.get(key)
    if (prev == null || sort >= prev) weekMap.set(key, sort)
  }
  return [...weekMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => key)
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

export function isViewableFleetUrl(val) {
  if (!val || typeof val !== 'string') return false
  const str = val.trim()
  if (!str || str.toLowerCase() === 'n/a') return false
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('www.')
}

function buildLatestDeployeeIndex(fleetRows) {
  const byRider = new Map()

  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    if (status !== 'deployee') continue
    const date = parseFleetDate(row.date_record)
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id) continue

    const prev = byRider.get(id)
    const prevDate = prev?.date ? prev.date.getTime() : 0
    const curDate = date ? date.getTime() : 0
    if (prev && curDate < prevDate) continue

    byRider.set(id, {
      date,
      sdPaidScreenshot: pickText(row.sd_amount_paid_screenshot_deployee),
    })
  }

  return byRider
}

function buildFirstDeployeeIndex(fleetRows) {
  const byRider = new Map()

  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    if (status !== 'deployee') continue
    const date = parseFleetDate(row.date_record)
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id) continue

    const prev = byRider.get(id)
    const prevDate = prev?.date ? prev.date.getTime() : Number.MAX_SAFE_INTEGER
    const curDate = date ? date.getTime() : Number.MAX_SAFE_INTEGER
    if (prev && curDate >= prevDate) continue

    byRider.set(id, {
      date,
      dateRecord: pickText(row.date_record),
      riderId: pickText(row.rider_id),
      riderName: pickText(row.rider_name),
      phone: pickText(row.rider_contact_number),
    })
  }

  return byRider
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
      vehicleDeployedAt: pickText(row.vehicle_deployed_at_deployed, row.bike_deployed_date_sd_refund_request),
    })
  }

  return byRider
}

function aggregatePaymentSdTotal(paymentRows, evRiders) {
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

function aggregatePaymentSdWeeksPerRider(paymentRows, evRiders) {
  const byRider = new Map()
  for (const row of paymentRows || []) {
    const id = normalizeRiderIdKey(row.rider_id)
    if (!id || !evRiders.has(id)) continue
    const sd = num(row.sd)
    if (!sd) continue
    const wk = paymentWeekKey(row)
    if (!wk) continue
    const sort = paymentWeekSortValue(row)
    if (!byRider.has(id)) byRider.set(id, new Map())
    const weekMap = byRider.get(id)
    const prev = weekMap.get(wk) || { amount: 0, sort: 0 }
    weekMap.set(wk, {
      amount: prev.amount + sd,
      sort: Math.max(prev.sort, sort),
    })
  }
  return byRider
}

function riderRecentSdWeeks(weekMap, count = 2) {
  if (!weekMap?.size) return []
  return [...weekMap.entries()]
    .sort((a, b) => b[1].sort - a[1].sort || b[1].amount - a[1].amount)
    .slice(0, count)
    .map(([key, value]) => ({
      key,
      label: formatPaymentWeekLabel(key),
      amount: value.amount,
    }))
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
  const latestDeployeeIndex = buildLatestDeployeeIndex(fleetRows)
  const firstDeployeeIndex = buildFirstDeployeeIndex(fleetRows)
  const weekKeys = resolveLatestPaymentWeeks(paymentRows, 2)
  const paymentWeekLabels = weekKeys.map(formatPaymentWeekLabel)
  const sdWeeksByRider = aggregatePaymentSdWeeksPerRider(paymentRows, evRiders)
  const paymentSdTotal = aggregatePaymentSdTotal(paymentRows, evRiders)
  const manualSd = aggregateManualSd(collationRows, evRiders)

  const riderIds = new Set(evRiders)
  const rows = []

  for (const id of riderIds) {
    const fleet = fleetIndex.get(id)
    const deployee = latestDeployeeIndex.get(id)
    const firstDeployee = firstDeployeeIndex.get(id)
    const payTotal = paymentSdTotal.get(id)
    const manual = manualSd.get(id)
    const recentSdWeeks = riderRecentSdWeeks(sdWeeksByRider.get(id), 2)
    if (!fleet && !recentSdWeeks.length && !payTotal && !manual) continue

    const fleetSdPaid = fleet?.sdPaid ?? 0
    const paymentSdLastWeek = recentSdWeeks[0]?.amount ?? 0
    const paymentSdPrevWeek = recentSdWeeks[1]?.amount ?? 0
    const paymentSdLastWeekLabel = recentSdWeeks[0]?.label ?? ''
    const paymentSdPrevWeekLabel = recentSdWeeks[1]?.label ?? ''
    const paymentSdDeduction2Wks = paymentSdLastWeek + paymentSdPrevWeek
    const paymentSdDeductionTotal = payTotal?.amount ?? 0
    const manualSdPaid = manual?.amount ?? 0

    rows.push({
      rowKey: `sd-${id}`,
      riderId: pickText(firstDeployee?.riderId, fleet?.riderId) || id,
      riderName: pickText(fleet?.riderName, firstDeployee?.riderName, payTotal?.riderName, manual?.riderName) || 'N/A',
      city: pickText(fleet?.city, payTotal?.city, manual?.city) || 'Unknown',
      client: fleet?.client || payTotal?.client || 'Unknown',
      vehicleNumber: fleet?.vehicleNumber || '',
      riderPhone: pickText(firstDeployee?.phone, fleet?.phone) || '',
      firstDeployeeDate: formatDeployedAt(firstDeployee?.dateRecord),
      vehicleDeployedAt: formatDeployedAt(fleet?.vehicleDeployedAt),
      fleetSdTotal: fleet?.sdTotal ?? 0,
      fleetSdPaid,
      fleetSdPending: fleet?.sdPending ?? 0,
      sdUtr: fleet?.sdUtr ?? '',
      sdPaidScreenshot: deployee?.sdPaidScreenshot ?? '',
      paymentSdLastWeek,
      paymentSdPrevWeek,
      paymentSdLastWeekLabel,
      paymentSdPrevWeekLabel,
      paymentSdDeduction2Wks,
      paymentSdDeductionTotal,
      manualSdPaid,
      sdGap: fleetSdPaid - paymentSdDeductionTotal - manualSdPaid,
    })
  }

  rows.sort((a, b) => b.fleetSdPaid - a.fleetSdPaid || a.riderName.localeCompare(b.riderName))
  return { rows, paymentWeekLabels }
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
      (r.riderPhone || '').toLowerCase().includes(q) ||
      (r.firstDeployeeDate || '').toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      (r.vehicleNumber || '').toLowerCase().includes(q) ||
      (r.vehicleDeployedAt || '').toLowerCase().includes(q) ||
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
