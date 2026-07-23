import { format } from 'date-fns'
import { normalizeRiderIdKey, parseMetricDate } from './riderPerformanceReport'

/** Normalize any date_record to yyyy-MM-dd for filters / charts / merge keys. */
export function toMetricDateKey(value) {
  const date = parseMetricDate(value)
  if (!date) return ''
  return format(date, 'yyyy-MM-dd')
}

function deliveredValue(row) {
  if (row?.delivered == null || row.delivered === '') return 0
  const n = Number(row.delivered)
  return Number.isFinite(n) ? n : 0
}

/** Group key without order count (for metrics vs upload preference). */
function groupKey(row) {
  const worker = normalizeRiderIdKey(row?.worker_code)
  const dateKey = toMetricDateKey(row?.date_record)
  if (!worker || !dateKey) return null
  const client = (row?.client ?? '').toString().trim().toLowerCase()
  return `${worker}|${dateKey}|${client}`
}

/** Map order_upload_data row → rider_metrics-shaped record. */
export function mapOrderUploadToRiderMetric(row) {
  if (!row) return null
  const worker = (row.worker_code ?? '').toString().trim()
  const dateKey = toMetricDateKey(row.date_record)
  if (!worker || !dateKey) return null
  const delivered = deliveredValue(row)

  return {
    id: row.id != null ? `ou-${row.id}` : `ou-${worker}-${dateKey}-${delivered}`,
    delivered,
    // Store ISO so Dashboard / Attendance date filters match startDate/endDate (yyyy-MM-dd).
    date_record: dateKey,
    worker_code: worker,
    worker_name: '',
    hub_name: '',
    city: (row.city ?? '').toString().trim(),
    client: (row.client ?? '').toString().trim(),
    cumulative_order: null,
    source: '',
    week: '',
    month: (row.month ?? '').toString().trim(),
    state: '',
    type1: (row.type1 ?? '').toString().trim(),
    type2: '',
    mob_number: '',
    fl: '',
    _data_source: 'order_upload',
  }
}

/**
 * Merge rider_metrics + order_upload_data into one riderData array.
 *
 * Upload unique rows: Date + WorkerCode + Client + delivered
 * (same rider can have 11 and 5 orders on the same day — both kept).
 *
 * If uploads exist for a Date+Worker+Client group, metrics for that group are skipped
 * (avoids double-counting when rider_metrics later catches up).
 */
export function mergeRiderMetricSources(
  metricsRows = [],
  uploadRows = [],
  { prefer = 'order_upload' } = {}
) {
  const mappedUploads = (uploadRows || []).map(mapOrderUploadToRiderMetric).filter(Boolean)

  // uploads grouped by Date+Worker+Client; within group keep one row per delivered count
  const uploadGroups = new Map()
  for (const row of mappedUploads) {
    const gkey = groupKey(row)
    if (!gkey) continue
    if (!uploadGroups.has(gkey)) uploadGroups.set(gkey, new Map())
    uploadGroups.get(gkey).set(deliveredValue(row), row)
  }

  const metricsGroups = new Map()
  for (const row of metricsRows || []) {
    const gkey = groupKey(row)
    if (!gkey) continue
    if (!metricsGroups.has(gkey)) metricsGroups.set(gkey, [])
    metricsGroups.get(gkey).push({ ...row, _data_source: 'rider_metrics' })
  }

  const out = []
  const uploadGroupKeys = new Set(uploadGroups.keys())

  for (const rowsByDelivered of uploadGroups.values()) {
    out.push(...rowsByDelivered.values())
  }

  for (const [gkey, rows] of metricsGroups) {
    if (prefer === 'order_upload' && uploadGroupKeys.has(gkey)) continue
    out.push(...rows)
  }

  return out
}

/**
 * Overview order cards/charts: when any Order Upload rows exist, use ONLY uploads
 * (so a day you did not upload — e.g. 22nd — does not show from rider_metrics).
 * If nothing uploaded yet, fall back to rider_metrics.
 */
export function selectOverviewOrderRows(riderRows = []) {
  const rows = riderRows || []
  const uploads = rows.filter((r) => r?._data_source === 'order_upload')
  if (uploads.length) return uploads
  return rows.filter((r) => r?._data_source !== 'order_upload')
}
