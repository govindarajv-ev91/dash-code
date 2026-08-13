import { parseFleetDate, vehiclePartitionKey } from './fleetDeployReturnExport'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import { normalizeRiderIdKey } from './riderPerformanceReport'

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
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

function buildFleetRiderIndex(fleetRows) {
  const byRider = new Map()

  for (const row of fleetRows || []) {
    const date = parseFleetDate(row.date_record)
    const id = normalizeRiderIdKey(row.rider_id)
    const phone = normalizePhone(row.rider_contact_number)
    const key = id || (phone ? `phone:${phone}` : null)
    if (!key) continue

    const vehicleNumber = (row.vehicle_number || '').toString().trim()
    const contactPhone = (row.rider_contact_number || '').toString().trim()
    if (!vehicleNumber && !contactPhone) continue

    const prev = byRider.get(key)
    const prevDate = prev?.date ? prev.date.getTime() : 0
    const curDate = date ? date.getTime() : 0
    if (prev && curDate < prevDate) continue

    byRider.set(key, {
      date,
      vehicleNumber,
      phone: contactPhone,
    })
  }

  return byRider
}

function lookupFleetRider(fleetRiders, riderId) {
  const id = normalizeRiderIdKey(riderId)
  if (id && fleetRiders?.has(id)) return fleetRiders.get(id)
  return null
}

function sortFleetEvents(a, b) {
  const diff = a.date - b.date
  if (diff !== 0) return diff
  if (a.status === 'Return' && b.status === 'Deployee') return -1
  if (a.status === 'Deployee' && b.status === 'Return') return 1
  return 0
}

function pushRiderAssignmentInterval(map, deployEvent, returnDate) {
  const riderId = normalizeRiderIdKey(deployEvent.row.rider_id)
  if (!riderId) return
  const row = deployEvent.row
  if (!map.has(riderId)) map.set(riderId, [])
  map.get(riderId).push({
    from: deployEvent.date,
    to: returnDate,
    vehicleNumber: (row.vehicle_number || '').toString().trim(),
    mobile: (row.rider_contact_number || '').toString().trim(),
  })
}

/** Single fleet pass: rider deploy intervals + contact timeline (replaces per-date scans). */
function buildRiderFleetLookupIndex(fleetRows) {
  const byVehicle = new Map()

  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    if (status !== 'deployee' && status !== 'return') continue
    const date = parseFleetDate(row.date_record)
    const vehicleKey = vehiclePartitionKey(row.vehicle_number)
    if (!date || !vehicleKey) continue
    if (!byVehicle.has(vehicleKey)) byVehicle.set(vehicleKey, [])
    byVehicle.get(vehicleKey).push({
      status: status === 'deployee' ? 'Deployee' : 'Return',
      date,
      row,
    })
  }

  const riderAssignments = new Map()

  for (const [, events] of byVehicle) {
    events.sort(sortFleetEvents)
    let openDeploy = null
    for (const event of events) {
      if (event.status === 'Deployee') {
        openDeploy = event
      } else if (event.status === 'Return' && openDeploy) {
        pushRiderAssignmentInterval(riderAssignments, openDeploy, event.date)
        openDeploy = null
      }
    }
    if (openDeploy) pushRiderAssignmentInterval(riderAssignments, openDeploy, null)
  }

  const riderContacts = new Map()
  for (const row of fleetRows || []) {
    const date = parseFleetDate(row.date_record)
    const phone = (row.rider_contact_number || '').toString().trim()
    const id = normalizeRiderIdKey(row.rider_id)
    if (!date || !phone || !id) continue
    if (!riderContacts.has(id)) riderContacts.set(id, [])
    riderContacts.get(id).push({ date, phone })
  }
  for (const list of riderContacts.values()) list.sort((a, b) => a.date - b.date)

  return { riderAssignments, riderContacts }
}

let cachedFleetLookupSource = null
let cachedFleetLookupIndex = null

function getRiderFleetLookupIndex(fleetRows) {
  if (!fleetRows?.length) return null
  if (fleetRows === cachedFleetLookupSource && cachedFleetLookupIndex) return cachedFleetLookupIndex
  cachedFleetLookupIndex = buildRiderFleetLookupIndex(fleetRows)
  cachedFleetLookupSource = fleetRows
  return cachedFleetLookupIndex
}

function lookupRiderFleetAsOf(index, riderId, paymentDate) {
  const asOfDate = parseFleetDate(paymentDate)
  if (!asOfDate || !index) return null

  const asOf = asOfDate.getTime()
  const id = normalizeRiderIdKey(riderId)
  if (!id) return null

  let vehicleNumber = ''
  let mobile = ''
  const intervals = index.riderAssignments.get(id)

  if (intervals) {
    let best = null
    for (const interval of intervals) {
      const from = interval.from.getTime()
      const to = interval.to ? interval.to.getTime() : Number.MAX_SAFE_INTEGER
      if (from <= asOf && to > asOf) {
        if (!best || interval.from > best.from) best = interval
      }
    }
    if (best) {
      vehicleNumber = best.vehicleNumber
      mobile = best.mobile
    }
  }

  if (!mobile) {
    const contacts = index.riderContacts.get(id)
    if (contacts) {
      for (const contact of contacts) {
        if (contact.date.getTime() > asOf) break
        mobile = contact.phone
      }
    }
  }

  return { vehicleNumber, phone: mobile }
}

function buildFleetSdIndex(fleetRows) {
  const byRider = new Map()

  for (const row of fleetRows || []) {
    const status = (row.vehicle_status || '').toString().trim().toLowerCase()
    const date = parseFleetDate(row.date_record)
    const id = normalizeRiderIdKey(row.rider_id)
    const phone = normalizePhone(row.rider_contact_number)
    const key = id || (phone ? `phone:${phone}` : null)
    if (!key) continue

    const sdPaid = num(row.security_deposit_paid_deployee)
    const sdTotal = num(row.security_deposit_total_deployee)
    const sdPending = num(row.security_deposit_pending_deployee)
    const hasSd = sdPaid > 0 || sdTotal > 0 || sdPending > 0 || row.sd_paid_utr_deployee
    if (!hasSd && status !== 'deployee') continue

    const prev = byRider.get(key)
    const prevDate = prev?.date ? prev.date.getTime() : 0
    const curDate = date ? date.getTime() : 0
    if (prev && curDate < prevDate) continue

    byRider.set(key, {
      date,
      riderId: row.rider_id,
      riderName: row.rider_name,
      phone: row.rider_contact_number,
      city: normalizeSummaryCity(row.city_locations || row.city),
      client: normalizeSummaryClient(row.client_name),
      vehicleNumber: (row.vehicle_number || '').toString().trim(),
      sdTotal,
      sdPaid,
      sdPending,
      sdUtr: (row.sd_paid_utr_deployee || '').toString().trim(),
    })
  }

  return byRider
}

/** Map rider → sourcer name from rider_onboarding (rider_id_details + source_name). */
export function buildOnboardingSourceIndex(onboardingRows) {
  const byRider = new Map()

  for (const row of onboardingRows || []) {
    const source = pickText(row.source_name)
    if (!source || source === '-') continue

    const idFields = [
      row.rider_id_details,
      row.rider_id,
      row.worker_code,
      row.client_rider_id,
    ]
    const keys = new Set()
    for (const field of idFields) {
      const rawRider = pickText(field)
      if (!rawRider) continue
      const normalized = normalizeRiderIdKey(rawRider)
      if (normalized) keys.add(normalized)
      const digits = rawRider.replace(/\D/g, '')
      if (digits) keys.add(digits)
      keys.add(rawRider.toUpperCase())
    }

    for (const key of keys) {
      if (!byRider.has(key)) byRider.set(key, source)
    }
  }

  return { byRider }
}

/** @deprecated use buildOnboardingSourceIndex */
export function buildRiderSourceIndex(onboardingRows) {
  return buildOnboardingSourceIndex(onboardingRows)
}

function resolveRiderSource(sourceIndex, _month, riderId) {
  if (!sourceIndex?.byRider) return 'Unknown'
  const raw = pickText(riderId)
  if (!raw) return 'Unknown'

  const candidates = [
    normalizeRiderIdKey(raw),
    raw.replace(/\D/g, ''),
    raw.toUpperCase(),
  ].filter(Boolean)

  for (const key of candidates) {
    if (sourceIndex.byRider.has(key)) return sourceIndex.byRider.get(key)
  }

  return 'Unknown'
}

/** Lookup source_name from rider_onboarding index; empty string when not found. */
export function lookupOnboardingSourceName(sourceIndex, ...riderIds) {
  for (const riderId of riderIds) {
    const hit = resolveRiderSource(sourceIndex, null, riderId)
    if (hit && hit !== 'Unknown') return hit
  }
  return ''
}

function lookupFleetSd(fleetSd, riderId, phone) {
  const id = normalizeRiderIdKey(riderId)
  const p = normalizePhone(phone)
  if (id && fleetSd.has(id)) return fleetSd.get(id)
  if (p && fleetSd.has(`phone:${p}`)) return fleetSd.get(`phone:${p}`)
  return null
}

function buildPaymentDetailRow(row, fleetRiders, fleetLookupIndex, sourceIndex) {
  const asOfFleet = lookupRiderFleetAsOf(fleetLookupIndex, row.rider_id, row.payment_date)
  const fleetFallback = lookupFleetRider(fleetRiders, row.rider_id)
  const tds = num(row.tds)
  const codDeduction = num(row.cod_deduction)
  const clientDeductions = num(row.client_deductions)
  const sdDeduction = num(row.sd)
  const damage = num(row.damage)
  const insurance = num(row.insurance)
  const fleetCharge = num(row.fleet)
  const traffic = num(row.traffic)
  const onHold = num(row.on_hold)
  const evRent = num(row.ev_rent)
  const deductionsOut = tds + codDeduction + clientDeductions + sdDeduction + damage + insurance + fleetCharge + traffic + onHold + evRent
  const finalNetPayout = num(row.final_net_payout)
  const codRecovery = num(row.cod_recovery)
  const grossPayout = num(row.gross_payout)
  const moneyIn = grossPayout
  const month = pickText(row.month)
  const riderId = pickText(row.rider_id)

  return {
    rowKey: `payment-${row.id}`,
    rowType: 'payment',
    riderId,
    riderName: pickText(row.rider_name) || 'N/A',
    city: normalizeSummaryCity(pickText(row.city)) || 'Unknown',
    client: normalizeSummaryClient(pickText(row.client_name)) || 'Unknown',
    source: resolveRiderSource(sourceIndex, month, riderId),
    month,
    week: pickText(row.week),
    type: pickText(row.type),
    orders: num(row.orders),
    grossPayout,
    payout1: num(row.payout_1),
    payout2: num(row.payout_2),
    codRecovery,
    finalNetPayout,
    deductionsOut,
    bankDeposits: 0,
    bankWithdrawals: 0,
    sdTotal: 0,
    sdPaid: 0,
    sdPending: 0,
    sdUtr: '',
    vehicleNumber: pickText(asOfFleet?.vehicleNumber, row.vehicle_number, fleetFallback?.vehicleNumber),
    riderPhone: pickText(asOfFleet?.phone, fleetFallback?.phone),
    paymentStatus: pickText(row.payment_status),
    paymentDate: pickText(row.payment_date),
    utr: pickText(row.utr_number),
    transactionDate: '',
    transactionParticulars: '',
    moneyIn,
    netFlow: grossPayout - deductionsOut,
    tds,
    codDeduction,
    clientDeductions,
    sdDeduction,
    damage,
    insurance,
    fleetCharge,
    traffic,
    onHold,
    evRent,
  }
}

function buildCollationDetailRow(row, fleetSd) {
  const sd = lookupFleetSd(fleetSd, row.rider_id, null)
  const bankDeposits = num(row.deposits)
  const bankWithdrawals = num(row.withdrawals)
  const moneyIn = bankDeposits

  return {
    rowKey: `collation-${row.id}`,
    rowType: 'collation',
    riderId: pickText(row.rider_id),
    riderName: pickText(row.rider_name) || 'N/A',
    city: normalizeSummaryCity(pickText(row.city)) || 'Unknown',
    client: 'Bank',
    month: pickText(row.month),
    week: '',
    type: 'Collation',
    grossPayout: 0,
    payout1: 0,
    payout2: 0,
    codRecovery: 0,
    finalNetPayout: 0,
    deductionsOut: 0,
    bankDeposits,
    bankWithdrawals,
    sdTotal: sd?.sdTotal ?? 0,
    sdPaid: sd?.sdPaid ?? 0,
    sdPending: sd?.sdPending ?? 0,
    sdUtr: sd?.sdUtr ?? '',
    vehicleNumber: pickText(row.vehicle_number, sd?.vehicleNumber),
    paymentStatus: '',
    paymentDate: pickText(row.transaction_date),
    utr: pickText(row.reference_number),
    transactionDate: pickText(row.transaction_date),
    transactionParticulars: pickText(row.transaction_particulars),
    moneyIn,
    netFlow: moneyIn - bankWithdrawals,
    tds: 0,
    codDeduction: 0,
    clientDeductions: 0,
    sdDeduction: 0,
    damage: 0,
    insurance: 0,
    fleetCharge: 0,
    traffic: 0,
    onHold: 0,
    evRent: 0,
  }
}

export function buildPaymentHistoryReport(
  paymentRows = [],
  _collationRows = [],
  fleetRows = [],
  onboardingRows = [],
  { includeFleetLookup = true } = {}
) {
  const useFleet = includeFleetLookup && fleetRows?.length
  const fleetRiders = useFleet ? buildFleetRiderIndex(fleetRows) : null
  const fleetLookupIndex = useFleet ? getRiderFleetLookupIndex(fleetRows) : null
  const sourceIndex = onboardingRows?.length ? buildOnboardingSourceIndex(onboardingRows) : null
  const rows = []

  for (const row of paymentRows) {
    if (!pickText(row.rider_id) && !pickText(row.rider_name)) continue
    rows.push(buildPaymentDetailRow(row, fleetRiders, fleetLookupIndex, sourceIndex))
  }

  rows.sort((a, b) => {
    const monthCmp = (b.month || '').localeCompare(a.month || '')
    if (monthCmp) return monthCmp
    return a.riderName.localeCompare(b.riderName)
  })

  return { rows, riders: rows }
}

export function summarizePaymentHistory(rows, field) {
  const map = new Map()

  for (const r of rows) {
    const name = r[field] || 'Unknown'
    if (!map.has(name)) {
      map.set(name, {
        name,
        riders: new Set(),
        orders: 0,
        totalIn: 0,
        netFlow: 0,
        finalNetPayout: 0,
        bankDeposits: 0,
        bankWithdrawals: 0,
        sdPaid: 0,
        deductionsOut: 0,
      })
    }
    const s = map.get(name)
    if (r.riderId) s.riders.add(r.riderId)
    s.orders += Number(r.orders) || 0
    s.totalIn += r.moneyIn
    s.netFlow += r.netFlow
    s.finalNetPayout += r.finalNetPayout
    s.bankDeposits += r.bankDeposits
    s.bankWithdrawals += r.bankWithdrawals
    s.sdPaid += r.sdPaid
    s.deductionsOut += r.deductionsOut
  }

  return [...map.values()]
    .map((s) => ({ ...s, riders: s.riders.size }))
    .sort((a, b) => b.riders - a.riders || b.orders - a.orders || a.name.localeCompare(b.name))
}

/** Source-wise revenue for a month (optional city filter). */
export function buildSourceRevenueReport(rows, { month = '', city = '' } = {}) {
  if (!month) {
    return { groups: [], totals: { riders: 0, orders: 0, grossPayout: 0, paymentRows: 0, groups: 0 } }
  }

  const map = new Map()
  const grandRiders = new Set()
  let grandOrders = 0
  let grandGrossPayout = 0
  let grandPaymentRows = 0

  for (const r of rows) {
    if (r.rowType !== 'payment') continue
    if (r.month !== month) continue
    if (city && r.city !== city) continue

    const groupCity = r.city || 'Unknown'
    const source = r.source || 'Unknown'
    const key = `${groupCity}|${source}`

    if (!map.has(key)) {
      map.set(key, {
        city: groupCity,
        source,
        riders: new Set(),
        orders: 0,
        grossPayout: 0,
        paymentRows: 0,
      })
    }

    const bucket = map.get(key)
    if (r.riderId) {
      bucket.riders.add(r.riderId)
      grandRiders.add(r.riderId)
    }
    bucket.orders += num(r.orders)
    bucket.grossPayout += num(r.grossPayout)
    bucket.paymentRows += 1
    grandOrders += num(r.orders)
    grandGrossPayout += num(r.grossPayout)
    grandPaymentRows += 1
  }

  const groups = [...map.values()]
    .map((b) => ({
      city: b.city,
      source: b.source,
      riders: b.riders.size,
      orders: b.orders,
      grossPayout: b.grossPayout,
      paymentRows: b.paymentRows,
    }))
    .sort((a, b) => b.grossPayout - a.grossPayout || a.city.localeCompare(b.city) || a.source.localeCompare(b.source))

  return {
    groups,
    totals: {
      riders: grandRiders.size,
      orders: grandOrders,
      grossPayout: grandGrossPayout,
      paymentRows: grandPaymentRows,
      groups: groups.length,
    },
  }
}

/**
 * Top riders by Money In and by Orders.
 * months / cities: arrays (or single string). Empty = overall (all months / all cities).
 */
export function buildTopPerformersReport(rows, { month = '', city = '', months = null, cities = null, limit = 10 } = {}) {
  const empty = {
    byMoneyIn: [],
    byOrders: [],
    totals: { riders: 0, orders: 0, moneyIn: 0, paymentRows: 0 },
  }

  const monthList = Array.isArray(months)
    ? months.filter(Boolean)
    : month
      ? [month]
      : []
  const cityList = Array.isArray(cities)
    ? cities.filter(Boolean)
    : city
      ? [city]
      : []
  const monthSet = monthList.length ? new Set(monthList) : null
  const citySet = cityList.length ? new Set(cityList) : null

  const map = new Map()
  let grandOrders = 0
  let grandMoneyIn = 0
  let grandPaymentRows = 0

  for (const r of rows || []) {
    if (r.rowType !== 'payment') continue
    if (monthSet && !monthSet.has(r.month)) continue
    if (citySet && !citySet.has(r.city)) continue

    const riderId = pickText(r.riderId)
    const riderName = pickText(r.riderName) || 'N/A'
    const key = riderId || `name:${riderName.toLowerCase()}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        riderId: riderId || '',
        riderName,
        phone: '',
        client: '',
        orders: 0,
        moneyIn: 0,
        paymentRows: 0,
      })
    }

    const bucket = map.get(key)
    if (!bucket.phone && pickText(r.riderPhone)) bucket.phone = pickText(r.riderPhone)
    if (!bucket.client && pickText(r.client) && r.client !== 'Unknown') {
      bucket.client = pickText(r.client)
    }
    if (bucket.riderName === 'N/A' && riderName !== 'N/A') bucket.riderName = riderName
    if (!bucket.riderId && riderId) bucket.riderId = riderId

    const orders = num(r.orders)
    const moneyIn = num(r.moneyIn)
    bucket.orders += orders
    bucket.moneyIn += moneyIn
    bucket.paymentRows += 1
    grandOrders += orders
    grandMoneyIn += moneyIn
    grandPaymentRows += 1
  }

  if (!map.size && !(rows || []).length) return empty

  const all = [...map.values()]
  const byMoneyIn = [...all]
    .sort((a, b) => b.moneyIn - a.moneyIn || b.orders - a.orders || a.riderName.localeCompare(b.riderName))
    .slice(0, Math.max(1, limit))
    .map((r, i) => ({ ...r, rank: i + 1 }))
  const byOrders = [...all]
    .sort((a, b) => b.orders - a.orders || b.moneyIn - a.moneyIn || a.riderName.localeCompare(b.riderName))
    .slice(0, Math.max(1, limit))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  return {
    byMoneyIn,
    byOrders,
    totals: {
      riders: all.length,
      orders: grandOrders,
      moneyIn: grandMoneyIn,
      paymentRows: grandPaymentRows,
    },
  }
}

/** Payment rows for one rider; months/cities empty = no filter (overall). */
export function filterRiderHistoryForPeriod(
  rows,
  { month = '', city = '', months = null, cities = null, riderId = '', riderKey = '' } = {}
) {
  const id = pickText(riderId)
  const key = pickText(riderKey)
  const monthList = Array.isArray(months)
    ? months.filter(Boolean)
    : month
      ? [month]
      : []
  const cityList = Array.isArray(cities)
    ? cities.filter(Boolean)
    : city
      ? [city]
      : []
  const monthSet = monthList.length ? new Set(monthList) : null
  const citySet = cityList.length ? new Set(cityList) : null

  return (rows || []).filter((r) => {
    if (r.rowType !== 'payment') return false
    if (monthSet && !monthSet.has(r.month)) return false
    if (citySet && !citySet.has(r.city)) return false
    if (id) return pickText(r.riderId) === id
    if (key) {
      const nameKey = `name:${(pickText(r.riderName) || 'N/A').toLowerCase()}`
      return nameKey === key || pickText(r.riderId) === key
    }
    return false
  })
}

function filterPaymentRowsForSource(rows, { month, city }) {
  return (rows || []).filter((r) => {
    if (r.rowType !== 'payment') return false
    if (month && r.month !== month) return false
    if (city && r.city !== city) return false
    return true
  })
}

function emptyCell() {
  return ['-', '-', '-']
}

function cellValues(bucket) {
  if (!bucket || (!bucket.orders && !bucket.riders.size && !bucket.grossPayout)) {
    return emptyCell()
  }
  return [bucket.orders, bucket.riders.size, bucket.grossPayout]
}

/** Source × Client pivot (Orders, Riders, Gross Payout) for one city + month. */
export function buildSourceClientPivot(rows, { month = '', city = '' } = {}) {
  const filtered = filterPaymentRowsForSource(rows, { month, city })
  const cells = new Map()
  const sources = new Set()
  const clients = new Set()

  for (const r of filtered) {
    const source = r.source || 'Unknown'
    const client = r.client || 'Unknown'
    sources.add(source)
    clients.add(client)
    const key = `${source}|${client}`
    if (!cells.has(key)) {
      cells.set(key, { riders: new Set(), orders: 0, grossPayout: 0 })
    }
    const bucket = cells.get(key)
    if (r.riderId) bucket.riders.add(r.riderId)
    bucket.orders += num(r.orders)
    bucket.grossPayout += num(r.grossPayout)
  }

  const sourceList = [...sources].sort((a, b) => a.localeCompare(b))
  const clientList = [...clients].sort((a, b) => a.localeCompare(b))

  const rowTotals = new Map()
  for (const source of sourceList) {
    const riders = new Set()
    let orders = 0
    let grossPayout = 0
    for (const client of clientList) {
      const bucket = cells.get(`${source}|${client}`)
      if (!bucket) continue
      bucket.riders.forEach((id) => riders.add(id))
      orders += bucket.orders
      grossPayout += bucket.grossPayout
    }
    rowTotals.set(source, { riders: riders.size, orders, grossPayout })
  }

  const colTotals = new Map()
  const grandRiders = new Set()
  let grandOrders = 0
  let grandGrossPayout = 0

  for (const client of clientList) {
    const riders = new Set()
    let orders = 0
    let grossPayout = 0
    for (const source of sourceList) {
      const bucket = cells.get(`${source}|${client}`)
      if (!bucket) continue
      bucket.riders.forEach((id) => {
        riders.add(id)
        grandRiders.add(id)
      })
      orders += bucket.orders
      grossPayout += bucket.grossPayout
    }
    colTotals.set(client, { riders: riders.size, orders, grossPayout })
    grandOrders += orders
    grandGrossPayout += grossPayout
  }

  return {
    month,
    city: city || 'All Cities',
    sourceList,
    clientList,
    cells,
    rowTotals,
    colTotals,
    grandTotal: {
      riders: grandRiders.size,
      orders: grandOrders,
      grossPayout: grandGrossPayout,
    },
  }
}

export function listSourcePivotCities(rows, month) {
  const cities = new Set()
  for (const r of filterPaymentRowsForSource(rows, { month })) {
    cities.add(r.city || 'Unknown')
  }
  return [...cities].sort((a, b) => a.localeCompare(b))
}

/** Excel sheet rows + merges for Source × Client summary (like client-wise pivot). */
export function buildSourceClientPivotSheet(pivot) {
  const { month, city, sourceList, clientList, cells, rowTotals, colTotals, grandTotal } = pivot
  const aoa = []
  const merges = []
  const metricCols = clientList.length * 3 + 3
  const totalCols = 1 + metricCols

  aoa.push([`Key City: ${city} | Month: ${month} | Source Name × Client Wise Summary`])
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } })

  const header1 = ['Source Name']
  const header2 = ['']
  let col = 1
  for (const client of clientList) {
    header1.push(client, '', '')
    header2.push('Orders', 'Riders', 'Gross Payout')
    merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + 2 } })
    col += 3
  }
  header1.push('TOTAL', '', '')
  header2.push('Orders', 'Riders', 'Gross Payout')
  merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + 2 } })
  aoa.push(header1, header2)

  for (const source of sourceList) {
    const row = [source]
    for (const client of clientList) {
      row.push(...cellValues(cells.get(`${source}|${client}`)))
    }
    const rt = rowTotals.get(source) || { orders: 0, riders: 0, grossPayout: 0 }
    row.push(rt.orders, rt.riders, rt.grossPayout)
    aoa.push(row)
  }

  const totalRow = ['Client Total']
  for (const client of clientList) {
    const ct = colTotals.get(client) || { orders: 0, riders: 0, grossPayout: 0 }
    totalRow.push(ct.orders, ct.riders, ct.grossPayout)
  }
  totalRow.push(grandTotal.orders, grandTotal.riders, grandTotal.grossPayout)
  aoa.push(totalRow)

  const sheetName = `${city}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Summary'

  return { aoa, merges, sheetName }
}

/** One sheet per city when city filter is empty. */
export function buildSourceClientPivotSheets(rows, { month = '', city = '' } = {}) {
  if (!month) return []
  const cities = city ? [city] : listSourcePivotCities(rows, month)
  return cities.map((cityName) => {
    const pivot = buildSourceClientPivot(rows, { month, city: cityName })
    return buildSourceClientPivotSheet(pivot)
  })
}

/** Flat source revenue rows for export (city + source summary). */
export function buildSourceRevenueFlatRows(rows, { month = '', city = '' } = {}) {
  const { groups } = buildSourceRevenueReport(rows, { month, city })
  return groups.map((r) => ({
    Month: month,
    City: r.city,
    Source: r.source,
    'Unique Riders': r.riders,
    Orders: r.orders,
    'Gross Payout': r.grossPayout,
    'Payment Rows': r.paymentRows,
  }))
}

/** Rider-level detail rows with sourcer name for export. */
export function buildSourceDetailExportRows(rows, { month = '', city = '' } = {}) {
  return filterPaymentRowsForSource(rows, { month, city })
    .map((r) => ({
      Month: r.month,
      City: r.city,
      Source: r.source || 'Unknown',
      'Rider ID': r.riderId,
      'Rider Name': r.riderName,
      Phone: r.riderPhone || '',
      Client: r.client,
      Orders: r.orders,
      'Gross Payout': r.grossPayout,
      'Net Payout': r.finalNetPayout,
      Week: r.week || '',
      Type: r.type || '',
      Vehicle: r.vehicleNumber || '',
      'Payment Status': r.paymentStatus || '',
      'Payment Date': r.paymentDate || '',
      UTR: r.utr || '',
    }))
    .sort((a, b) => {
      const src = (a.Source || '').localeCompare(b.Source || '')
      if (src) return src
      const cty = (a.City || '').localeCompare(b.City || '')
      if (cty) return cty
      return (a['Rider Name'] || '').localeCompare(b['Rider Name'] || '')
    })
}

export function filterPaymentHistory(
  rows,
  { search = '', cities = [], clients = [], months = [] } = {}
) {
  const q = search.toLowerCase().trim()
  return rows.filter((r) => {
    if (cities.length && !cities.includes(r.city)) return false
    if (clients.length && !clients.includes(r.client)) return false
    if (months.length && !months.includes(r.month)) return false
    if (!q) return true
    return (
      r.riderId.toLowerCase().includes(q) ||
      r.riderName.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      (r.riderPhone || '').toLowerCase().includes(q) ||
      (r.month || '').toLowerCase().includes(q) ||
      (r.week || '').toLowerCase().includes(q) ||
      (r.type || '').toLowerCase().includes(q) ||
      (r.vehicleNumber || '').toLowerCase().includes(q) ||
      (r.sdUtr || '').toLowerCase().includes(q) ||
      (r.utr || '').toLowerCase().includes(q) ||
      (r.transactionParticulars || '').toLowerCase().includes(q)
    )
  })
}

export const PAYMENT_DEDUCTION_COLUMNS = [
  { key: 'tds', label: 'TDS' },
  { key: 'codDeduction', label: 'COD Ded.' },
  { key: 'clientDeductions', label: 'Client Ded.' },
  { key: 'sdDeduction', label: 'SD' },
  { key: 'damage', label: 'Damage' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'fleetCharge', label: 'Fleet' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'onHold', label: 'On Hold' },
  { key: 'evRent', label: 'EV Rent' },
]

export function formatInr(value) {
  const n = num(value)
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

const MONTH_ABBR_REV = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const MONTH_SHORT_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse "Jul-2026", "Jul-26", "Jul 2026", "July-2026". */
export function parsePaymentMonthLabel(label) {
  const text = (label ?? '').toString().trim()
  const m = text.match(/^([A-Za-z]{3,9})[-\s\/]?(\d{2}|\d{4})$/)
  if (!m) return null
  const monthIndex = MONTH_ABBR_REV[m[1].slice(0, 3).toLowerCase()]
  let year = Number(m[2])
  if (monthIndex == null || !Number.isFinite(year)) return null
  if (year < 100) year += year >= 70 ? 1900 : 2000
  const mm = String(monthIndex + 1).padStart(2, '0')
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const fyStart = monthIndex >= 3 ? year : year - 1
  return {
    year,
    monthIndex,
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    sortKey: year * 12 + monthIndex,
    /** Indian FY Apr–Mar: Apr=0 … Mar=11 */
    fyMonthOrder: monthIndex >= 3 ? monthIndex - 3 : monthIndex + 9,
    fyStart,
    fyLabel: `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`,
    display: `${MONTH_SHORT_LABELS[monthIndex]}-${String(year).slice(-2)}`,
  }
}

/** Current Indian financial year label, e.g. FY 2025-26. */
export function currentIndianFinancialYearLabel(asOf = new Date()) {
  const y = asOf.getFullYear()
  const m = asOf.getMonth()
  const fyStart = m >= 3 ? y : y - 1
  return `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`
}

/**
 * Monthly metrics from rider_payment_data: revenue, unique riders, order count.
 * Defaults to one Indian Financial Year (Apr→Mar) so months stay in calendar order.
 */
export function buildMonthlyRevenueSeries(
  paymentRows = [],
  { dateFrom = '', dateTo = '', financialYear = '', sortBy = 'fy' } = {}
) {
  const byMonth = new Map()
  const fySet = new Set()
  const allRiders = new Set()

  for (const row of paymentRows || []) {
    const monthRaw = (row.month ?? '').toString().trim()
    if (!monthRaw) continue

    const parsed = parsePaymentMonthLabel(monthRaw)
    if (!parsed) continue

    fySet.add(parsed.fyLabel)

    if (dateFrom && parsed.end < dateFrom) continue
    if (dateTo && parsed.start > dateTo) continue
    if (financialYear && parsed.fyLabel !== financialYear) continue

    const key = `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, '0')}`
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: parsed.display,
        monthKey: key,
        sortKey: parsed.sortKey,
        fyMonthOrder: parsed.fyMonthOrder,
        fyLabel: parsed.fyLabel,
        gross: 0,
        net: 0,
        orders: 0,
        riders: new Set(),
        rows: 0,
      })
    }
    const bucket = byMonth.get(key)
    bucket.gross += num(row.gross_payout)
    bucket.net += num(row.final_net_payout)
    bucket.orders += num(row.orders)
    bucket.rows += 1
    const riderId = (row.rider_id ?? '').toString().trim()
    if (riderId) {
      bucket.riders.add(riderId)
      allRiders.add(riderId)
    }
  }

  const series = [...byMonth.values()]
    .sort((a, b) => {
      if (sortBy === 'revenue') {
        const byGross = b.gross - a.gross
        if (byGross !== 0) return byGross
        return a.fyMonthOrder - b.fyMonthOrder
      }
      if (financialYear) return a.fyMonthOrder - b.fyMonthOrder
      return a.sortKey - b.sortKey
    })
    .map((row) => ({
      month: row.month,
      monthKey: row.monthKey,
      sortKey: row.sortKey,
      fyMonthOrder: row.fyMonthOrder,
      fyLabel: row.fyLabel,
      gross: row.gross,
      net: row.net,
      orders: row.orders,
      riders: row.riders.size,
      rows: row.rows,
    }))

  const financialYears = [...fySet].sort((a, b) => {
    const ya = Number(a.match(/\d{4}/)?.[0] || 0)
    const yb = Number(b.match(/\d{4}/)?.[0] || 0)
    return yb - ya
  })

  const totals = series.reduce(
    (acc, row) => {
      acc.gross += row.gross
      acc.net += row.net
      acc.orders += row.orders
      acc.ridersMonthlySum += row.riders
      acc.rows += row.rows
      return acc
    },
    {
      gross: 0,
      net: 0,
      orders: 0,
      ridersMonthlySum: 0,
      uniqueRiders: allRiders.size,
      rows: 0,
      months: series.length,
    }
  )

  return { series, totals, financialYears }
}

const FY_MONTH_SHORT = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

/** FY 2025-26 → FY 2024-25 */
export function previousIndianFinancialYearLabel(fyLabel) {
  const m = String(fyLabel || '').match(/FY\s+(\d{4})-(\d{2})/i)
  if (!m) return ''
  const start = Number(m[1]) - 1
  if (!Number.isFinite(start)) return ''
  return `FY ${start}-${String(start + 1).slice(-2)}`
}

export function formatCompactCount(value) {
  const n = num(value)
  if (Math.abs(n) >= 10000000) return `${(n / 10000000).toFixed(2).replace(/\.?0+$/, '')}Cr`
  if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(2).replace(/\.?0+$/, '')}L`
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

/**
 * Current FY vs previous FY monthly series for sparkline KPI cards.
 * metric: 'orders' | 'riders'
 */
export function buildFyCompareMetric(
  paymentRows = [],
  { financialYear = '', dateFrom = '', dateTo = '', metric = 'orders' } = {}
) {
  const fy = financialYear || currentIndianFinancialYearLabel()
  const prevFy = previousIndianFinancialYearLabel(fy)
  const current = buildMonthlyRevenueSeries(paymentRows, { financialYear: fy, dateFrom, dateTo })
  const previous = prevFy
    ? buildMonthlyRevenueSeries(paymentRows, { financialYear: prevFy, dateFrom, dateTo })
    : { series: [], totals: { orders: 0, uniqueRiders: 0 } }

  const curByOrder = new Map(current.series.map((r) => [r.fyMonthOrder, r]))
  const prevByOrder = new Map(previous.series.map((r) => [r.fyMonthOrder, r]))

  const spark = FY_MONTH_SHORT.map((month, i) => ({
    month,
    current: curByOrder.get(i)?.[metric] ?? 0,
    previous: prevByOrder.get(i)?.[metric] ?? 0,
  }))

  const total =
    metric === 'riders' ? Number(current.totals.uniqueRiders) || 0 : Number(current.totals.orders) || 0
  const prevTotal =
    metric === 'riders' ? Number(previous.totals.uniqueRiders) || 0 : Number(previous.totals.orders) || 0

  let vsPyPct = null
  if (prevTotal > 0) vsPyPct = ((total - prevTotal) / prevTotal) * 100
  else if (total > 0 && previous.series.length === 0) vsPyPct = null

  let peakIdx = -1
  let lowIdx = -1
  let peakVal = -Infinity
  let lowVal = Infinity
  spark.forEach((row, i) => {
    const v = Number(row.current) || 0
    if (v > peakVal) {
      peakVal = v
      peakIdx = i
    }
    if (v < lowVal) {
      lowVal = v
      lowIdx = i
    }
  })
  // Only mark peak/low when there is some current data
  const hasCurrent = spark.some((r) => (Number(r.current) || 0) > 0)
  if (!hasCurrent) {
    peakIdx = -1
    lowIdx = -1
  } else if (peakIdx === lowIdx) {
    lowIdx = -1
  }

  return {
    fy,
    prevFy,
    total,
    prevTotal,
    vsPyPct,
    spark,
    peakIdx,
    lowIdx,
    hasPrevious: previous.series.length > 0,
  }
}

/**
 * Client-wise revenue / orders / unique riders from rider_payment_data.
 * sortBy: 'name-za' (default) | 'revenue' (high → low)
 */
export function buildClientWisePaymentMetrics(
  paymentRows = [],
  { dateFrom = '', dateTo = '', financialYear = '', sortBy = 'name-za' } = {}
) {
  const byClient = new Map()

  for (const row of paymentRows || []) {
    const monthRaw = (row.month ?? '').toString().trim()
    const parsed = monthRaw ? parsePaymentMonthLabel(monthRaw) : null
    if (monthRaw && !parsed) continue
    if (parsed) {
      if (dateFrom && parsed.end < dateFrom) continue
      if (dateTo && parsed.start > dateTo) continue
      if (financialYear && parsed.fyLabel !== financialYear) continue
    } else if (financialYear || dateFrom || dateTo) {
      continue
    }

    const client =
      normalizeSummaryClient(pickText(row.client_name)) ||
      pickText(row.client_name) ||
      'Unknown'

    if (!byClient.has(client)) {
      byClient.set(client, {
        client,
        gross: 0,
        net: 0,
        orders: 0,
        riders: new Set(),
        rows: 0,
      })
    }
    const bucket = byClient.get(client)
    bucket.gross += num(row.gross_payout)
    bucket.net += num(row.final_net_payout)
    bucket.orders += num(row.orders)
    bucket.rows += 1
    const riderId = (row.rider_id ?? '').toString().trim()
    if (riderId) bucket.riders.add(riderId)
  }

  const rows = [...byClient.values()]
    .map((b) => ({
      client: b.client,
      gross: b.gross,
      net: b.net,
      orders: b.orders,
      riders: b.riders.size,
      rows: b.rows,
    }))
    .sort((a, b) => {
      if (sortBy === 'revenue') {
        const byGross = b.gross - a.gross
        if (byGross !== 0) return byGross
        return b.client.localeCompare(a.client, undefined, { sensitivity: 'base' })
      }
      return b.client.localeCompare(a.client, undefined, { sensitivity: 'base' })
    })

  const totals = rows.reduce(
    (acc, row) => {
      acc.gross += row.gross
      acc.net += row.net
      acc.orders += row.orders
      acc.riders += row.riders
      acc.rows += row.rows
      return acc
    },
    { gross: 0, net: 0, orders: 0, riders: 0, rows: 0, clients: rows.length }
  )

  return { rows, totals }
}

/**
 * Month-wise line series for one client (or all) within an Indian FY.
 * Returns Apr→Mar points: gross, orders, riders + client list for filters.
 */
export function buildClientMonthLineSeries(
  paymentRows = [],
  { dateFrom = '', dateTo = '', financialYear = '', client = '' } = {}
) {
  const clientFilter = (client || '').toString().trim()
  const byMonth = new Map()
  const clientSet = new Map() // name → gross for sorting options
  const allRiders = new Set()

  for (const row of paymentRows || []) {
    const monthRaw = (row.month ?? '').toString().trim()
    if (!monthRaw) continue
    const parsed = parsePaymentMonthLabel(monthRaw)
    if (!parsed) continue

    if (dateFrom && parsed.end < dateFrom) continue
    if (dateTo && parsed.start > dateTo) continue
    if (financialYear && parsed.fyLabel !== financialYear) continue

    const clientName =
      normalizeSummaryClient(pickText(row.client_name)) ||
      pickText(row.client_name) ||
      'Unknown'

    const prevGross = clientSet.get(clientName) || 0
    clientSet.set(clientName, prevGross + num(row.gross_payout))

    if (clientFilter && clientFilter !== 'All' && clientName !== clientFilter) continue

    const key = `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, '0')}`
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: parsed.display,
        monthKey: key,
        fyMonthOrder: parsed.fyMonthOrder,
        gross: 0,
        orders: 0,
        riders: new Set(),
      })
    }
    const bucket = byMonth.get(key)
    bucket.gross += num(row.gross_payout)
    bucket.orders += num(row.orders)
    const riderId = (row.rider_id ?? '').toString().trim()
    if (riderId) {
      bucket.riders.add(riderId)
      allRiders.add(riderId)
    }
  }

  const series = [...byMonth.values()]
    .sort((a, b) => a.fyMonthOrder - b.fyMonthOrder)
    .map((row) => ({
      month: row.month,
      monthKey: row.monthKey,
      fyMonthOrder: row.fyMonthOrder,
      gross: row.gross,
      orders: row.orders,
      riders: row.riders.size,
    }))

  // Fill missing FY months so the line stays continuous Apr→Mar
  const filled = []
  if (financialYear) {
    const byOrder = new Map(series.map((r) => [r.fyMonthOrder, r]))
    for (let i = 0; i < FY_MONTH_SHORT.length; i++) {
      const existing = byOrder.get(i)
      if (existing) filled.push(existing)
      else {
        filled.push({
          month: FY_MONTH_SHORT[i],
          monthKey: `gap-${i}`,
          fyMonthOrder: i,
          gross: 0,
          orders: 0,
          riders: 0,
        })
      }
    }
  }

  const clients = [...clientSet.entries()]
    .map(([name, gross]) => ({ name, gross }))
    .sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name))

  const useSeries = financialYear ? filled : series
  const totals = useSeries.reduce(
    (acc, row) => {
      acc.gross += row.gross
      acc.orders += row.orders
      return acc
    },
    { gross: 0, orders: 0, riders: allRiders.size, months: useSeries.length }
  )

  return { series: useSeries, totals, clients }
}
