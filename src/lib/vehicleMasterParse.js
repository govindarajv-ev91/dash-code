import { format } from 'date-fns'
import { parseWorkbookArrayBuffer } from './paymentUploadParse'

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

function toText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const VEHICLE_MASTER_FIELD_ALIASES = {
  vehicle_number: [
    'vehicle_number',
    'vehiclenumber',
    'vehicle_no',
    'vehicle',
    'reg_no',
    'vehregno',
  ],
  chassis_number: ['chassis_number', 'chassisnumber', 'chassis_no', 'chassis'],
  engine_motor_number: [
    'engine_motor_number',
    'engine_number',
    'motor_number',
    'engine_motor_no',
    'engine',
    'motor',
  ],
}

function mapVehicleMasterRow(row) {
  const normalized = normalizeRowKeys(row)
  return {
    vehicle_number: toText(pickField(normalized, VEHICLE_MASTER_FIELD_ALIASES.vehicle_number)),
    chassis_number: toText(pickField(normalized, VEHICLE_MASTER_FIELD_ALIASES.chassis_number)),
    engine_motor_number: toText(pickField(normalized, VEHICLE_MASTER_FIELD_ALIASES.engine_motor_number)),
  }
}

function hasAnyValue(row) {
  return Boolean(row.vehicle_number || row.chassis_number || row.engine_motor_number)
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function deriveMonthLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${MONTH_SHORT[date.getMonth()]}-${date.getFullYear()}`
}

export function formatMasterDateLabel(date) {
  if (!date || Number.isNaN(date.getTime())) return ''
  return format(date, 'yyyy-MM-dd')
}

export function attachMasterDate(rows, masterDate) {
  const dateLabel = formatMasterDateLabel(masterDate)
  const month = deriveMonthLabel(masterDate)
  return (rows || [])
    .filter(hasAnyValue)
    .map((row) => ({
      ...row,
      master_date: dateLabel,
      month,
    }))
}

export function parseVehicleMasterFile(arrayBuffer) {
  return parseWorkbookArrayBuffer(arrayBuffer, {
    mapFn: mapVehicleMasterRow,
    minFields: 1,
  })
}

export const VEHICLE_MASTER_HEADER_LABELS = [
  'Vehicle Number',
  'Chassis Number',
  'Engine (Motor) Number',
]
