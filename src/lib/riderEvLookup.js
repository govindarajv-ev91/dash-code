import { format } from 'date-fns'
import { parseFleetDate } from './fleetDeployReturnExport'
import { normalizeRiderIdKey } from './riderPerformanceReport'

export function classifyRiderEvType(type1, type2) {
  const check = (value) => {
    const t = String(value || '').toUpperCase().trim()
    if (!t) return false
    return t.includes('EV') && !t.includes('NON')
  }
  return check(type1) || check(type2) ? 'EV' : 'NON-EV'
}

function formatMetricDateKey(date) {
  return format(date, 'dd/MM/yyyy')
}

/** Parse pasted lines: "29/05/2026\tCHN129-R0829" or space-separated. */
export function parseDateWorkerPaste(text) {
  const rows = []
  const lines = (text || '').split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.includes('\t')
      ? line.split('\t').map((p) => p.trim()).filter(Boolean)
      : line.split(/\s{2,}|\s+/).map((p) => p.trim()).filter(Boolean)

    if (parts.length < 2) continue
    if (/^date$/i.test(parts[0]) && /^worker/i.test(parts[1])) continue

    const date = parseFleetDate(parts[0])
    const workerCode = parts.slice(1).join(' ').trim()
    if (!date || !workerCode) continue

    rows.push({
      line: i + 1,
      date,
      dateDisplay: parts[0],
      dateKey: formatMetricDateKey(date),
      workerCode,
      workerKey: normalizeRiderIdKey(workerCode),
    })
  }

  return rows
}

export function buildRiderEvIndex(riderRows) {
  const index = new Map()

  for (const row of riderRows || []) {
    const worker = (row.worker_code ?? '').toString().trim()
    if (!worker) continue
    const date = parseFleetDate(row.date_record)
    if (!date) continue

    const key = `${formatMetricDateKey(date)}|${normalizeRiderIdKey(worker)}`
    index.set(key, classifyRiderEvType(row.type1, row.type2))
  }

  return index
}

/** Per worker, metrics rows sorted newest → oldest (for date fallback). */
export function buildRiderEvHistoryByWorker(riderRows) {
  const byWorker = new Map()

  for (const row of riderRows || []) {
    const worker = (row.worker_code ?? '').toString().trim()
    if (!worker) continue
    const date = parseFleetDate(row.date_record)
    if (!date) continue

    const workerKey = normalizeRiderIdKey(worker)
    if (!byWorker.has(workerKey)) byWorker.set(workerKey, [])
    byWorker.get(workerKey).push({
      date,
      dateKey: formatMetricDateKey(date),
      evType: classifyRiderEvType(row.type1, row.type2),
    })
  }

  for (const records of byWorker.values()) {
    records.sort((a, b) => b.date - a.date)
  }

  return byWorker
}

function findEvTypeOnOrBefore(byWorker, workerKey, asOfDate) {
  const records = byWorker.get(workerKey)
  if (!records?.length) return null

  for (const record of records) {
    if (record.date <= asOfDate) {
      return record
    }
  }

  return null
}

export function lookupRiderEvTypes(pasteText, riderRows) {
  const parsed = parseDateWorkerPaste(pasteText)
  const index = buildRiderEvIndex(riderRows)
  const byWorker = buildRiderEvHistoryByWorker(riderRows)

  return parsed.map((row) => {
    const key = `${row.dateKey}|${row.workerKey}`

    if (index.has(key)) {
      return {
        ...row,
        evType: index.get(key),
        matchedDateKey: row.dateKey,
        status: 'exact',
      }
    }

    const fallback = findEvTypeOnOrBefore(byWorker, row.workerKey, row.date)
    if (fallback) {
      return {
        ...row,
        evType: fallback.evType,
        matchedDateKey: fallback.dateKey,
        status: fallback.dateKey === row.dateKey ? 'exact' : 'fallback',
      }
    }

    return {
      ...row,
      evType: 'NON-EV',
      matchedDateKey: null,
      status: 'not found',
    }
  })
}

export function evLookupToCsv(results) {
  const escapeCsv = (val) => {
    const str = (val ?? '').toString()
    return `"${str.replace(/"/g, '""')}"`
  }

  const headers = ['Date', 'WorkerCode', 'Type', 'From metrics', 'Match status']
  const lines = [headers.map(escapeCsv).join(',')]

  for (const row of results) {
    const matchedDate = row.status === 'not found'
      ? ''
      : row.status === 'fallback'
        ? row.matchedDateKey
        : row.dateDisplay
    const matchStatus = row.status === 'exact'
      ? 'Exact date'
      : row.status === 'fallback'
        ? 'Fallback date'
        : 'Not found'

    lines.push([
      row.dateDisplay,
      row.workerCode,
      row.evType,
      matchedDate,
      matchStatus,
    ].map(escapeCsv).join(','))
  }

  return lines.join('\n')
}

/** One type per line — for paste-back into sheets (Type column only). */
export function evLookupTypesOnly(results) {
  return results.map((row) => row.evType).join('\n')
}

export function evLookupToTsv(results) {
  const lines = ['Date\tWorkerCode\tType\tMatchedDate']
  for (const row of results) {
    lines.push(`${row.dateDisplay}\t${row.workerCode}\t${row.evType}\t${row.matchedDateKey || ''}`)
  }
  return lines.join('\n')
}
