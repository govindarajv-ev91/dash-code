import * as XLSX from 'xlsx'
import { format, isValid, parse, parseISO } from 'date-fns'

/**
 * Excel serial → calendar y/m/d (no timezone). Matches SheetJS SSF for modern dates.
 * Avoids XLSX.SSF which is missing from the ESM browser build.
 */
function excelSerialToParts(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n)) return null
  const utc = new Date(Math.round((n - 25569) * 86400 * 1000))
  if (Number.isNaN(utc.getTime())) return null
  return {
    y: utc.getUTCFullYear(),
    m: utc.getUTCMonth() + 1,
    d: utc.getUTCDate(),
  }
}

export const ORDER_UPLOAD_HEADER_LABELS = [
  'Client',
  'Date',
  'WorkerCode',
  'delivered',
  'City',
  'Type1',
]

export const ORDER_UPLOAD_PREVIEW_COLUMNS = [
  { key: 'client', label: 'Client' },
  { key: 'date_record', label: 'Date' },
  { key: 'worker_code', label: 'WorkerCode' },
  { key: 'delivered', label: 'delivered' },
  { key: 'city', label: 'City' },
  { key: 'type1', label: 'Type1' },
  { key: 'month', label: 'Month' },
]

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
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

function parseOrderDate(value) {
  if (value == null || value === '') return null

  // Excel serial (preferred) — calendar y/m/d, no timezone shift.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = excelSerialToParts(value)
    if (parsed?.y && parsed?.m && parsed?.d) {
      const d = new Date(parsed.y, parsed.m - 1, parsed.d, 12, 0, 0, 0)
      return isValid(d) ? d : null
    }
  }

  if (value instanceof Date && isValid(value)) {
    // SheetJS cellDates often yields ~UTC evening prior day (float + TZ).
    // Shift +12h then read UTC y/m/d to recover the Excel calendar day.
    const shifted = new Date(value.getTime() + 12 * 60 * 60 * 1000)
    return new Date(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      12,
      0,
      0,
      0
    )
  }

  const text = String(value).trim()
  if (!text) return null

  // Prefer dd-mm-yyyy (and common day-first variants) over ISO/US formats.
  const formats = [
    'dd-MM-yyyy',
    'd-M-yyyy',
    'dd/MM/yyyy',
    'd/M/yyyy',
    'dd.MM.yyyy',
    'd.M.yyyy',
    'yyyy-MM-dd',
    'dd MMM yyyy',
    'd MMM yyyy',
  ]
  for (const fmt of formats) {
    const d = parse(text, fmt, new Date())
    if (isValid(d) && d.getFullYear() >= 2000) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0)
    }
  }

  // Bare ISO yyyy-MM-dd only (avoid ambiguous Date() parsing)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = parseISO(text.slice(0, 10))
    if (isValid(iso)) {
      return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate(), 12, 0, 0, 0)
    }
  }

  return null
}

function monthLabelFromDate(date) {
  if (!date || !isValid(date)) return ''
  return `${MONTH_SHORT[date.getMonth()]}-${date.getFullYear()}`
}

/**
 * Store dates as yyyy-MM-dd so Overview date filters match.
 * Input still accepts dd-mm-yyyy.
 */
function formatDateRecord(value) {
  const d = parseOrderDate(value)
  if (d) return format(d, 'yyyy-MM-dd')
  return toText(value)
}

function normalizeType1(value) {
  const raw = toText(value).toUpperCase().replace(/\s+/g, '-')
  if (!raw) return ''
  if (raw === 'EV' || raw === 'E-V') return 'EV'
  if (
    raw === 'NON-EV' ||
    raw === 'NONEV' ||
    raw === 'NON_EV' ||
    raw === 'NON EV' ||
    raw.includes('NON')
  ) {
    return 'NON-EV'
  }
  if (raw.includes('EV')) return 'EV'
  return toText(value)
}

function mapOrderUploadRow(rawRow) {
  const row = normalizeRowKeys(rawRow)
  const dateRaw = pickField(row, ['date', 'date_record', 'order_date', 'orderdate'])
  const date = parseOrderDate(dateRaw)
  const mapped = {
    client: toText(pickField(row, ['client', 'client_name', 'clientname'])),
    date_record: formatDateRecord(dateRaw),
    worker_code: toText(
      pickField(row, ['workercode', 'worker_code', 'worker_id', 'rider_id', 'riderid', 'id'])
    ),
    delivered: toNumber(pickField(row, ['delivered', 'orders', 'order', 'delivery'])),
    city: toText(pickField(row, ['city', 'city_locations'])),
    type1: normalizeType1(pickField(row, ['type1', 'type', 'vehicle_type', 'fleet_type'])),
    month: monthLabelFromDate(date),
  }

  const filled = [mapped.client, mapped.date_record, mapped.worker_code, mapped.city, mapped.type1]
    .filter((v) => v !== '' && v != null).length
  if (filled < 2 && mapped.delivered == null) return null
  return mapped
}

export function parseOrderUploadFile(arrayBuffer) {
  // cellDates:false keeps Excel serial numbers so we parse y/m/d without TZ off-by-one.
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { rows: [], sheetName: '' }

  const sheet = workbook.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true })
  const rows = []
  for (const raw of json) {
    const mapped = mapOrderUploadRow(raw)
    if (mapped) rows.push(mapped)
  }
  return { rows, sheetName }
}

/** Summarize distinct date_record values in parsed/saved rows (for upload confirmation). */
export function summarizeOrderUploadDates(rows = []) {
  const counts = new Map()
  for (const row of rows) {
    const d = (row?.date_record ?? '').toString().trim()
    if (!d) continue
    counts.set(d, (counts.get(d) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
}

export function downloadOrderUploadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ORDER_UPLOAD_HEADER_LABELS,
    ['Blinkit', '22-07-2026', 'FE7440678', 12, 'Chennai', 'EV'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Order Upload')
  XLSX.writeFile(wb, 'order_upload_template.xlsx')
}
