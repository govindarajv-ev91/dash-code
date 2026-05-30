import { buildRiderPerformanceReport } from '../../src/lib/riderPerformanceReport.js'
import {
  FLEET_SHEET_CSV_URL,
  mapGoogleSheetRowsToFleetKeys,
} from '../../src/lib/fleetSheetMerge.js'
import { fetchAllRows } from './supabaseServer.js'

const RIDER_COLS =
  'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number,fl'

export const RIDER_PERFORMANCE_API_COLUMNS = [
  'ID',
  'In-active Days',
  'Eff/inff',
  'Current week orders',
]

export async function loadRiderPerformanceReportRows(asOfDate = new Date()) {
  const [riderRows, dbFleetRows] = await Promise.all([
    fetchAllRows('rider_metrics', RIDER_COLS, null, 1000),
    fetchAllRows('fleet_data', '*', 'id', 250),
  ])

  const fleetDb = (dbFleetRows || []).map((row) => ({
    ...row,
    data_source: 'Database',
  }))

  let sheetFleetRows = []
  try {
    const upstream = await fetch(FLEET_SHEET_CSV_URL, {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'FleetProDashboard/1.0',
      },
      cache: 'no-store',
    })
    if (upstream.ok) {
      const csvText = await upstream.text()
      const sampleKeys = fleetDb.length ? Object.keys(fleetDb[0]) : []
      const { rows } = mapGoogleSheetRowsToFleetKeys(csvText, sampleKeys)
      sheetFleetRows = rows
    }
  } catch (err) {
    console.warn('[rider-performance-feed] Google Sheet fleet merge skipped:', err?.message)
  }

  const fleetRows = [...fleetDb, ...sheetFleetRows]
  return buildRiderPerformanceReport(fleetRows, riderRows, asOfDate)
}

export function pickRiderPerformanceApiRows(reportRows) {
  return (reportRows || []).map((row) => ({
    ID: row.ID ?? '',
    'In-active Days': row['In-active Days'] ?? '',
    'Eff/inff': row['Eff/inff'] ?? '',
    'Current week orders': row['Current week orders'] ?? 0,
  }))
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function rowsToRiderPerformanceCsv(reportRows) {
  const rows = pickRiderPerformanceApiRows(reportRows)
  const lines = [RIDER_PERFORMANCE_API_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(RIDER_PERFORMANCE_API_COLUMNS.map((col) => escapeCsv(row[col])).join(','))
  }
  return lines.join('\n')
}
