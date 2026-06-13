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

function lookupFleetSd(fleetSd, riderId, phone) {
  const id = normalizeRiderIdKey(riderId)
  const p = normalizePhone(phone)
  if (id && fleetSd.has(id)) return fleetSd.get(id)
  if (p && fleetSd.has(`phone:${p}`)) return fleetSd.get(`phone:${p}`)
  return null
}

function buildPaymentDetailRow(row, fleetRiders, fleetLookupIndex) {
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

  return {
    rowKey: `payment-${row.id}`,
    rowType: 'payment',
    riderId: pickText(row.rider_id),
    riderName: pickText(row.rider_name) || 'N/A',
    city: normalizeSummaryCity(pickText(row.city)) || 'Unknown',
    client: normalizeSummaryClient(pickText(row.client_name)) || 'Unknown',
    month: pickText(row.month),
    week: pickText(row.week),
    type: pickText(row.type),
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

export function buildPaymentHistoryReport(paymentRows = [], _collationRows = [], fleetRows = []) {
  const fleetRiders = fleetRows?.length ? buildFleetRiderIndex(fleetRows) : null
  const fleetLookupIndex = getRiderFleetLookupIndex(fleetRows)
  const rows = []

  for (const row of paymentRows) {
    if (!pickText(row.rider_id) && !pickText(row.rider_name)) continue
    rows.push(buildPaymentDetailRow(row, fleetRiders, fleetLookupIndex))
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
