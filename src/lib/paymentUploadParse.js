import * as XLSX from 'xlsx'

function normalizeHeader(value) {
  const raw = String(value ?? '').trim()
  if (/margin\s*%/i.test(raw)) return 'margin_pct'
  return raw
    .toLowerCase()
    .replace(/[#]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function normalizeRowKeys(row) {
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeHeader(key)] = value
  }
  return out
}

function pickField(row, aliases) {
  for (const alias of aliases) {
    const v = row[alias]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return ''
}

function toText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  let s = String(value).replace(/[₹,\s]/g, '').trim()
  if (!s || s === '-' || s === '—' || s === '–') return null
  if (s.startsWith('(') && s.endsWith(')')) s = `-${s.slice(1, -1)}`
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const RIDER_PAYMENT_FIELD_ALIASES = {
  client_name: ['client_name', 'client'],
  type: ['type'],
  week: ['week'],
  month: ['month'],
  rider_id: ['rider_id', 'riderid'],
  rider_name: ['rider_name', 'ridername'],
  city: ['city'],
  orders: ['orders'],
  payout_1: ['payout_1', 'payout1'],
  payout_2: ['payout_2', 'payout2'],
  margin: ['margin'],
  gross_payout: ['gross_payout', 'grosspayout'],
  tds: ['tds'],
  cod_deduction: ['cod_deduction', 'cod_deductions'],
  cod_recovery: ['cod_recovery'],
  client_deductions: ['client_deductions'],
  sd: ['sd'],
  damage: ['damage'],
  insurance: ['insurance'],
  fleet: ['fleet'],
  traffic: ['traffic'],
  on_hold: ['on_hold', 'onhold'],
  ev_rent: ['ev_rent', 'evrent'],
  final_net_payout: ['final_net_payout', 'finalnetpayout'],
  payment_status: ['payment_status', 'paymentstatus'],
  payment_date: ['payment_date', 'paymentdate'],
  utr_number: ['utr_number', 'utr', 'utr_'],
  remarks: ['remarks'],
  acc_no: ['acc_no', 'accno', 'account_no'],
  ifsc_code: ['ifsc_code', 'ifsccode'],
  pan_number: ['pan_number', 'pannumber', 'pan'],
  vehicle_number: ['vehicle_number', 'vehicle', 'vehicle_', 'vehicle_no', 'vehicleno', 'vehicle_number_'],
  margin_pct: ['margin_pct', 'margin_percent'],
  margin_amount: ['margin_amount', 'marginamount'],
  region: ['region'],
}

const MANUAL_COLLATION_FIELD_ALIASES = {
  month: ['month'],
  transaction_date: ['transaction_date', 'transactiondate'],
  value_date: ['value_date', 'valuedate'],
  transaction_particulars: ['transaction_particulars', 'transactionparticulars'],
  reference_number: ['reference_number', 'referencenumber'],
  withdrawals: ['withdrawals'],
  deposits: ['deposits'],
  purpose: ['purpose'],
  rider_name: ['rider_name', 'ridername'],
  city: ['city'],
  rider_id: ['rider_id', 'riderid'],
  vehicle_number: ['vehicle_number', 'vehiclenumber'],
  remarks: ['remarks'],
}

const RIDER_PAYMENT_NUMERIC = new Set([
  'orders', 'payout_1', 'payout_2', 'margin', 'gross_payout', 'tds',
  'cod_deduction', 'cod_recovery', 'client_deductions', 'sd', 'damage',
  'insurance', 'fleet', 'traffic', 'on_hold', 'ev_rent', 'final_net_payout',
  'margin_pct', 'margin_amount',
])

const MANUAL_COLLATION_NUMERIC = new Set(['withdrawals', 'deposits'])

function mapRow(row, fieldAliases, numericFields) {
  const normalized = normalizeRowKeys(row)
  const mapped = {}
  for (const [field, aliases] of Object.entries(fieldAliases)) {
    const raw = pickField(normalized, aliases)
    mapped[field] = numericFields.has(field) ? toNumber(raw) : toText(raw)
  }
  return mapped
}

function hasAnyValue(row) {
  return Object.values(row).some((v) => v !== null && v !== '' && v !== undefined)
}

export function parseWorkbookArrayBuffer(arrayBuffer, { mapFn, minFields = 2 }) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { rows: [], sheetName: null }

  const sheet = workbook.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const rows = json.map(mapFn).filter((row) => {
    if (!hasAnyValue(row)) return false
    const filled = Object.values(row).filter((v) => v !== null && v !== '' && v !== undefined).length
    return filled >= minFields
  })

  return { rows, sheetName }
}

export function parseRiderPaymentFile(arrayBuffer) {
  return parseWorkbookArrayBuffer(arrayBuffer, {
    mapFn: (row) => mapRow(row, RIDER_PAYMENT_FIELD_ALIASES, RIDER_PAYMENT_NUMERIC),
    minFields: 3,
  })
}

export function parseManualCollationFile(arrayBuffer) {
  return parseWorkbookArrayBuffer(arrayBuffer, {
    mapFn: (row) => mapRow(row, MANUAL_COLLATION_FIELD_ALIASES, MANUAL_COLLATION_NUMERIC),
    minFields: 2,
  })
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseUploadDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const s = String(value).trim()
  if (!s) return null
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (slash) {
    let year = Number(slash[3])
    if (year < 100) year += 2000
    const d = new Date(year, Number(slash[2]) - 1, Number(slash[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function deriveMonthLabel(dateText) {
  const d = parseUploadDate(dateText)
  if (!d) return ''
  return `${MONTH_SHORT[d.getMonth()]}-${d.getFullYear()}`
}

const RENTAL_PENDING_FIELD_ALIASES = {
  deployed_date: ['deployed_date', 'deployeddate'],
  vehicle_status: ['vehicle_status', 'vehiclestatus'],
  current_status: ['current_status', 'currentstatus'],
  client_name: ['client', 'client_name', 'clientname'],
  contact_no: ['contact_no', 'contactno', 'contact_number'],
  rider_name: ['rider_name', 'ridername'],
  rider_id: ['rider_id', 'riderid'],
  vehicle_number: ['vehicle_number', 'vehiclenumber', 'vehicle_no'],
  city: ['city'],
  week_start_date: ['week_start_date', 'weekstartdate'],
  week_end_date: ['week_end_date', 'weekenddate'],
  number_of_days_with_rider: ['number_of_days_with_rider', 'numberofdayswithrider'],
  area_location: ['area_location', 'arealocation'],
  rent_per_week: ['rent_week', 'rent_per_week', 'rentperweek'],
  source_name: ['source_name', 'sourcename'],
  deficit_amount_week_22: ['deficit_amount_week_22', 'deficitamountweek22'],
  wk_23_ev_rent: ['wk_23_ev_rent', 'wk23evrent'],
  total_rent_amount: ['total_rent_amount', 'totalrentamount'],
  payout_deduction_week_23: ['payout_deduction_week_23', 'payoutdeductionweek23'],
  total_sd_amount: ['total_sd_amount', 'totalsdamount'],
  pending_amount: ['pending_amount', 'pendingamount'],
  manual_payment_collection: ['manual_payment_collection', 'manualpaymentcollection'],
  actual_pending_for_week_after_sd: [
    'actual_pending_for_week_after_sd',
    'actual_pending_for_week_after_sd_1',
    'actual_pending_for_week_after_sd_2',
    'actual_pending_for_week_after_sd_3',
    'actualpendingforweekaftersd',
  ],
  payment_collected_date: ['payment_collected_date', 'paymentcollecteddate'],
  inactive_days: ['in_active_days', 'inactive_days', 'inactivedays'],
  eff_inff: ['eff_inff', 'effinff', 'eff_infficiency'],
  current_week_orders: ['current_week_orders', 'currentweekorders'],
  remarks: ['remarks'],
  remarks_by_fr: ['remarks_by_fr_s', 'remarks_by_fr', 'remarksbyfrs'],
}

const RENTAL_PENDING_NUMERIC = new Set([
  'number_of_days_with_rider',
  'rent_per_week',
  'deficit_amount_week_22',
  'wk_23_ev_rent',
  'total_rent_amount',
  'payout_deduction_week_23',
  'total_sd_amount',
  'pending_amount',
  'manual_payment_collection',
  'actual_pending_for_week_after_sd',
  'inactive_days',
  'current_week_orders',
])

/** Match "Actual pending for Week After SD" including duplicate / multiline Excel headers. */
function isActualPendingAfterSdHeader(header) {
  const n = normalizeHeader(header)
  if (!n) return false
  if (n === 'pending_amount' || n === 'manual_payment_collection') return false
  return n.includes('actual') && n.includes('pending') && n.includes('after') && n.includes('sd')
}

function extractActualPendingAfterSd(rawRow) {
  let lastValue = null
  for (const [key, value] of Object.entries(rawRow || {})) {
    if (!isActualPendingAfterSdHeader(key)) continue
    if (value === null || value === undefined || String(value).trim() === '') continue
    const n = toNumber(value)
    if (n !== null) lastValue = n
  }
  return lastValue
}

function findRentalHeaderRowIndex(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const row = matrix[i]
    if (!row?.length) continue
    const text = row.map((c) => String(c ?? '').toLowerCase()).join(' ')
    if (
      text.includes('rider') &&
      (text.includes('vehicle') || text.includes('deployed') || text.includes('week end'))
    ) {
      return i
    }
  }
  return 0
}

function assignRentalMappedField(mapped, field, value) {
  if (RENTAL_PENDING_NUMERIC.has(field)) {
    mapped[field] = toNumber(value)
    return
  }
  mapped[field] = toText(value)
}

function parseRentalPendingSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
  if (!matrix.length) return []

  const headerRowIdx = findRentalHeaderRowIndex(matrix)
  const headers = (matrix[headerRowIdx] || []).map((h) => String(h ?? '').trim())

  const columnFields = headers.map((header) => {
    const n = normalizeHeader(header)
    if (!n) return null
    if (isActualPendingAfterSdHeader(header)) return null
    for (const [field, aliases] of Object.entries(RENTAL_PENDING_FIELD_ALIASES)) {
      if (field === 'actual_pending_for_week_after_sd') continue
      if (aliases.includes(n)) return field
    }
    return null
  })

  const actualPendingColIndexes = headers
    .map((header, idx) => (isActualPendingAfterSdHeader(header) ? idx : -1))
    .filter((idx) => idx >= 0)

  const rows = []

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r]
    if (!cells?.length) continue

    const mapped = {}
    for (const field of Object.keys(RENTAL_PENDING_FIELD_ALIASES)) {
      mapped[field] = RENTAL_PENDING_NUMERIC.has(field) ? null : ''
    }

    let filled = 0
    headers.forEach((_, colIdx) => {
      const field = columnFields[colIdx]
      if (!field) return
      const value = cells[colIdx]
      if (value === null || value === undefined || String(value).trim() === '') return
      assignRentalMappedField(mapped, field, value)
      filled++
    })

    for (const colIdx of actualPendingColIndexes) {
      const value = cells[colIdx]
      if (value === null || value === undefined || String(value).trim() === '') continue
      const n = toNumber(value)
      if (n !== null) {
        mapped.actual_pending_for_week_after_sd = n
        filled++
      }
    }

    if (filled < 3) continue
    if (!hasAnyValue(mapped)) continue

    mapped.month =
      deriveMonthLabel(mapped.week_end_date) ||
      deriveMonthLabel(mapped.week_start_date) ||
      deriveMonthLabel(mapped.deployed_date)

    rows.push(mapped)
  }

  return rows
}

function mapRentalPendingRow(row) {
  const mapped = mapRow(row, RENTAL_PENDING_FIELD_ALIASES, RENTAL_PENDING_NUMERIC)

  const pendingFromRaw = extractActualPendingAfterSd(row)
  if (pendingFromRaw !== null) {
    mapped.actual_pending_for_week_after_sd = pendingFromRaw
  } else {
    const pendingRaw = pickField(normalizeRowKeys(row), [
      'actual_pending_for_week_after_sd',
      'actual_pending_for_week_after_sd_1',
      'actual_pending_for_week_after_sd_2',
      'actual_pending_for_week_after_sd_3',
    ])
    if (pendingRaw !== '') mapped.actual_pending_for_week_after_sd = toNumber(pendingRaw)
  }

  mapped.month =
    deriveMonthLabel(mapped.week_end_date) ||
    deriveMonthLabel(mapped.week_start_date) ||
    deriveMonthLabel(mapped.deployed_date)

  return mapped
}

export function parseRentalPendingFile(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { rows: [], sheetName: null }

  const sheet = workbook.Sheets[sheetName]
  let rows = parseRentalPendingSheet(sheet)

  if (!rows.length) {
    const fallback = parseWorkbookArrayBuffer(arrayBuffer, {
      mapFn: mapRentalPendingRow,
      minFields: 3,
    })
    rows = fallback.rows
  }

  return { rows, sheetName }
}

export const RIDER_PAYMENT_HEADER_LABELS = [
  'Client Name', 'Type', 'Week', 'Month', 'Rider ID', 'Rider Name', 'City', 'Orders',
  'Payout 1', 'Payout 2', 'Margin', 'Gross Payout', 'TDS', 'COD_Deduction', 'COD Recovery',
  'Client Deductions', 'SD', 'Damage', 'Insurance', 'Fleet', 'Traffic', 'On Hold',
  'EV rent', 'Final Net Payout', 'Payment Status', 'Payment Date', 'UTR #', 'Remarks',
  'Acc No', 'IFSC Code', 'PAN Number', 'Vehicle#', 'Margin %', 'Margin Amount', 'Region',
]

export const MANUAL_COLLATION_HEADER_LABELS = [
  'Month', 'Transaction Date', 'Value Date', 'Transaction Particulars', 'Reference Number',
  'Withdrawals', 'Deposits', 'Purpose', 'Rider name', 'City', 'Rider ID', 'Vehicle Number', 'Remarks',
]

export const RENTAL_PENDING_HEADER_LABELS = [
  'Deployed Date', 'Vehicle Status', 'Current Status', 'Client', 'Contact No', 'Rider Name', 'Rider ID',
  'Vehicle Number', 'City', 'Week Start Date', 'Week End Date', 'Number_of_days_with_rider', 'Area Location',
  'Rent / week', 'Source Name', 'Deficit Amount Week 22', 'WK 23 EV Rent', 'Total Rent Amount',
  'Payout Deduction Week 23', 'Total SD Amount', 'Pending Amount', 'Manual Payment Collection',
  'Actual pending for Week After SD', 'Payment Collected Date', 'In-active Days', 'Eff/inff',
  'Current week orders', 'Remarks', "Remarks BY FR 'S",
]
