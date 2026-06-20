import * as XLSX from 'xlsx'
import { format, isValid, parseISO } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { normalizeIotRunDate } from './iotDataReport'

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
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

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  let s = String(value).replace(/[₹,\s]/g, '').trim()
  if (!s || s === '-' || s === '—') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseRunDate(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && value > 30000 && value < 60000) {
    const d = XLSX.SSF?.parse_date_code?.(value)
    if (d) {
      const js = new Date(Date.UTC(d.y, d.m - 1, d.d))
      return format(js, 'yyyy-MM-dd')
    }
  }
  return normalizeIotRunDate(value) || null
}

const IOT_FIELD_ALIASES = {
  vehicle_number: [
    'vehicle_number',
    'vehicle',
    'vehicle_no',
    'vehicleno',
    'reg_no',
    'registration_number',
    'vehregno',
    'raw_vehicle_id',
  ],
  run_date: ['run_date', 'record_date', 'date', 'trip_date', 'day', 'data_date'],
  total_distance: [
    'total_distance',
    'running_distance_km',
    'running_distance',
    'distance',
    'distance_km',
    'km',
    'running_km',
    'total_km',
  ],
}

export const IOT_HEADER_LABELS = [
  'Vehicle Number',
  'Run Date',
  'Total Distance (KM)',
]

export function mapIotUploadRow(row) {
  const normalized = normalizeRowKeys(row)
  const vehicle_number = pickField(normalized, IOT_FIELD_ALIASES.vehicle_number).toString().trim().toUpperCase()
  const run_date = parseRunDate(pickField(normalized, IOT_FIELD_ALIASES.run_date))
  const total_distance = toNumber(pickField(normalized, IOT_FIELD_ALIASES.total_distance))

  if (!vehicle_number || !run_date) return null
  return {
    vehicle_number,
    run_date,
    total_distance,
    data_source: 'dashboard_upload',
    raw_vehicle_id: vehicle_number,
    lookup_matched: false,
    lookup_match_type: null,
  }
}

export async function parseIotDataFile(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const mapped = []
  const errors = []

  rows.forEach((row, index) => {
    const mappedRow = mapIotUploadRow(row)
    if (mappedRow) mapped.push(mappedRow)
    else if (Object.values(row).some((v) => String(v ?? '').trim())) {
      errors.push(`Row ${index + 2}: missing vehicle number or run date`)
    }
  })

  return { rows: mapped, errors }
}
