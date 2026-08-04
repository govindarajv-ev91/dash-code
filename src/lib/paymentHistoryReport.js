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
  onboardingRows = []
) {
  const fleetRiders = fleetRows?.length ? buildFleetRiderIndex(fleetRows) : null
  const fleetLookupIndex = getRiderFleetLookupIndex(fleetRows)
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
        rows: 0,
        riders: new Set(),
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
    s.rows += 1
    if (r.riderId) s.riders.add(r.riderId)
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
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name))
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
