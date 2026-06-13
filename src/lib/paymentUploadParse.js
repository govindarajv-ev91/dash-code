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
  const n = Number(String(value).replace(/,/g, '').trim())
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
