import ExcelJS from 'exceljs'
import { format, startOfDay } from 'date-fns'
import {
  EXCEL_EXPORT_ORDER_DAY_OFFSETS,
  buildDayOrderHeader,
  getCellValue,
} from './riderPerformanceReport'

export const TARGET_ORDERS = 20

const C = {
  darkBlue: 'FF1F4E79',
  midBlue: 'FF2E75B6',
  white: 'FFFFFFFF',
  lightGray: 'FFF2F2F2',
  border: 'FFBBBBBB',
  redBg: 'FFFFE0E0',
  redFont: 'FFC00000',
  yellowBg: 'FFFFF2CC',
  yellowBgBelow: 'FFFFFACD',
  goldFont: 'FF7F6000',
  greenBg: 'FFE2EFDA',
  greenFont: 'FF375623',
  kpiZero: 'FFC00000',
  kpiCritical: 'FFC55A11',
  kpiLow: 'FFED7D31',
  kpiBelow: 'FF806000',
  kpiAvg: 'FF375623',
}

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: C.border } },
  left: { style: 'thin', color: { argb: C.border } },
  bottom: { style: 'thin', color: { argb: C.border } },
  right: { style: 'thin', color: { argb: C.border } },
}

const SUMMARY_HEADERS = [
  'Total Riders',
  'Zero Orders',
  'Critical (<5)',
  'Below Target (<20)',
  'Max Order (Last 3 Days)',
  'Avg Order (Last 3 Days)',
]

const SUMMARY_COLUMN_FILLS = [
  null,
  { bg: C.redBg, font: C.redFont, bold: true },
  { bg: C.yellowBg, font: C.goldFont, bold: false },
  { bg: C.yellowBgBelow, font: C.goldFont, bold: false },
  null,
  null,
]

function orderBucket(maxOrder) {
  const n = Number(maxOrder) || 0
  if (n === 0) return 'zero'
  if (n <= 4) return 'critical'
  if (n <= 9) return 'low'
  if (n <= 19) return 'belowTarget'
  return 'onTarget'
}

export function orderStatusLabel(bucket) {
  switch (bucket) {
    case 'zero':
      return 'Zero Order'
    case 'critical':
      return 'Critical (<5)'
    case 'low':
      return 'Low (<10)'
    case 'belowTarget':
      return 'Below Target'
    default:
      return 'On Target'
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

export function normalizeExportRiders(reportRows, asOfDate = new Date()) {
  const asOf = startOfDay(asOfDate)
  return (reportRows || []).map((row) => {
    const d2 = Number(getCellValue(row, buildDayOrderHeader(asOf, 2), asOf)) || 0
    const d3 = Number(getCellValue(row, buildDayOrderHeader(asOf, 3), asOf)) || 0
    const d4 = Number(getCellValue(row, buildDayOrderHeader(asOf, 4), asOf)) || 0
    const maxOrder = Math.max(d2, d3, d4)
    const avgOrder = round1((d2 + d3 + d4) / EXCEL_EXPORT_ORDER_DAY_OFFSETS.length)
    const bucket = orderBucket(maxOrder)

    return {
      date: row.Date || '',
      vNo: row['V no'] || '',
      id: row.ID || '',
      city: row.City || 'Unknown',
      category: row.Category || '',
      client: row.Client || 'Unknown',
      name: row.Name || '',
      mobile: row['mobile no'] || '',
      hub: row['Hub location'] || '',
      source: row.Source || '',
      maxOrder,
      avgOrder,
      shortfall: Math.max(0, TARGET_ORDERS - maxOrder),
      status: orderStatusLabel(bucket),
      bucket,
      d2,
      d3,
      d4,
    }
  })
}

export function filterBelowTargetRiders(riders) {
  return (riders || []).filter((r) => r.maxOrder < TARGET_ORDERS)
}

function summarizeGroup(riders) {
  const list = riders || []
  const total = list.length
  return {
    total,
    zeroOrder: list.filter((r) => r.maxOrder === 0).length,
    critical: list.filter((r) => r.maxOrder < 5).length,
    low: list.filter((r) => r.maxOrder >= 5 && r.maxOrder < 10).length,
    belowTarget: list.filter((r) => r.maxOrder < TARGET_ORDERS).length,
    groupMaxOrder: total ? Math.max(...list.map((r) => r.maxOrder)) : 0,
    avgOrder: total ? round1(list.reduce((s, r) => s + r.avgOrder, 0) / total) : 0,
  }
}

function groupMetricsToRow(m) {
  return [m.total, m.zeroOrder, m.critical, m.belowTarget, m.groupMaxOrder, m.avgOrder]
}

function sumGroupMetrics(rows) {
  const base = {
    total: 0,
    zeroOrder: 0,
    critical: 0,
    low: 0,
    belowTarget: 0,
    groupMaxOrder: 0,
    avgOrder: 0,
  }
  let avgSum = 0
  for (const m of rows) {
    base.total += m.total
    base.zeroOrder += m.zeroOrder
    base.critical += m.critical
    base.low += m.low
    base.belowTarget += m.belowTarget
    base.groupMaxOrder = Math.max(base.groupMaxOrder, m.groupMaxOrder)
    avgSum += m.avgOrder * m.total
  }
  base.avgOrder = base.total ? round1(avgSum / base.total) : 0
  return base
}

function groupBy(riders, keyFn) {
  const map = new Map()
  for (const rider of riders) {
    const key = keyFn(rider)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(rider)
  }
  return map
}

function columnLetter(colNum) {
  let n = colNum
  let letter = ''
  while (n > 0) {
    const mod = (n - 1) % 26
    letter = String.fromCharCode(65 + mod) + letter
    n = Math.floor((n - mod) / 26)
  }
  return letter
}

function setBorder(cell) {
  cell.border = THIN_BORDER
}

function styleTitle(cell, text) {
  cell.value = text
  cell.font = { name: 'Arial', size: 13, bold: true, color: { argb: C.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.darkBlue } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  setBorder(cell)
}

function styleHeaderCell(cell, value) {
  cell.value = value
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.midBlue } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  setBorder(cell)
}

function styleTotalCell(cell, value, align = 'center') {
  cell.value = value
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.white } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.darkBlue } }
  cell.alignment = { vertical: 'middle', horizontal: align }
  setBorder(cell)
}

function styleDataCell(cell, value, { rowIndex, colIndex, keyCols = 0, metricFill = null, bold = false, align = 'center', fontSize = 10 }) {
  cell.value = value
  const isKeyCol = colIndex < keyCols
  let bg = rowIndex % 2 === 0 ? C.white : C.lightGray
  let fontColor = 'FF000000'
  let isBold = bold || isKeyCol

  if (metricFill) {
    bg = metricFill.bg
    fontColor = metricFill.font
    isBold = metricFill.bold ?? isBold
  }

  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
  cell.font = { name: 'Arial', size: fontSize, bold: isBold, color: { argb: fontColor } }
  cell.alignment = {
    vertical: 'middle',
    horizontal: isKeyCol ? 'left' : align,
    wrapText: true,
  }
  setBorder(cell)
}

function statusFill(bucket) {
  switch (bucket) {
    case 'zero':
      return { bg: C.redBg, font: C.redFont, bold: true }
    case 'critical':
      return { bg: C.redBg, font: C.redFont, bold: false }
    case 'low':
      return { bg: C.yellowBg, font: C.goldFont, bold: false }
    case 'belowTarget':
      return { bg: C.yellowBgBelow, font: C.goldFont, bold: false }
    default:
      return null
  }
}

function writeGroupedSummarySheet(ws, { title, keyHeaders, groupedRows, keyCols, colWidths }) {
  const totalCols = keyHeaders.length + SUMMARY_HEADERS.length
  const lastCol = columnLetter(totalCols)
  ws.mergeCells(`A1:${lastCol}1`)
  styleTitle(ws.getCell('A1'), title)
  ws.getRow(1).height = 32

  keyHeaders.forEach((h, i) => styleHeaderCell(ws.getCell(2, i + 1), h))
  SUMMARY_HEADERS.forEach((h, i) => styleHeaderCell(ws.getCell(2, keyHeaders.length + i + 1), h))
  ws.getRow(2).height = 40

  colWidths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  let rowNum = 3
  const metricRows = []
  for (const entry of groupedRows) {
    const m = summarizeGroup(entry.riders)
    metricRows.push(m)
    const values = [...entry.keys, ...groupMetricsToRow(m)]
    values.forEach((val, colIndex) => {
      const metricFill = colIndex >= keyCols ? SUMMARY_COLUMN_FILLS[colIndex - keyCols] : null
      styleDataCell(ws.getCell(rowNum, colIndex + 1), val, {
        rowIndex: rowNum,
        colIndex,
        keyCols,
        metricFill,
        bold: colIndex < keyCols,
      })
    })
    ws.getRow(rowNum).height = 20
    rowNum++
  }

  const totals = sumGroupMetrics(metricRows)
  const totalValues = ['TOTAL', ...Array(keyCols - 1).fill(''), ...groupMetricsToRow(totals)]
  totalValues.forEach((val, colIndex) => {
    styleTotalCell(ws.getCell(rowNum, colIndex + 1), val, colIndex === 0 ? 'left' : 'center')
  })
  ws.getRow(rowNum).height = 24

  ws.views = [{ state: 'frozen', ySplit: 2, activeCell: 'A3' }]
}

function buildDashboardSheet(ws, riders, exportDate) {
  const totals = summarizeGroup(riders)
  const cityGroups = [...groupBy(riders, (r) => r.city).entries()]
    .map(([city, list]) => ({ city, metrics: summarizeGroup(list) }))
    .sort((a, b) => b.metrics.zeroOrder - a.metrics.zeroOrder || a.city.localeCompare(b.city))

  const clientGroups = [...groupBy(riders, (r) => r.client).entries()]
    .map(([client, list]) => ({ client, metrics: summarizeGroup(list) }))
    .sort((a, b) => b.metrics.total - a.metrics.total || a.client.localeCompare(b.client))

  const cityCount = cityGroups.length
  const clientCount = clientGroups.length
  const sourceCount = new Set(riders.map((r) => r.source).filter(Boolean)).size

  ws.mergeCells('A1:N1')
  styleTitle(
    ws.getCell('A1'),
    `LOW ORDER RIDER DASHBOARD | Target: ${TARGET_ORDERS} Orders Per Rider | Export Date: ${exportDate}`
  )

  ws.mergeCells('A2:N2')
  const sub = ws.getCell('A2')
  sub.value = `Total Riders: ${totals.total}  |  Cities: ${cityCount}  |  Clients: ${clientCount}  |  Sources: ${sourceCount}`
  sub.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.white } }
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.midBlue } }
  sub.alignment = { vertical: 'middle', horizontal: 'center' }
  setBorder(sub)
  ws.getRow(2).height = 24
  ws.getRow(3).height = 10

  const kpis = [
    { label: 'Total Riders', value: totals.total, color: C.darkBlue },
    { label: 'Zero Order Riders', value: totals.zeroOrder, color: C.kpiZero },
    { label: 'Critical (<5 Orders)', value: totals.critical, color: C.kpiCritical },
    { label: 'Low (<10 Orders)', value: totals.low, color: C.kpiLow },
    { label: 'Below Target (<20)', value: totals.belowTarget, color: C.kpiBelow },
    { label: 'Avg Order (All)', value: totals.avgOrder, color: C.kpiAvg },
  ]

  let col = 1
  for (const kpi of kpis) {
    ws.mergeCells(4, col, 4, col + 1)
    ws.mergeCells(5, col, 5, col + 1)
    const labelCell = ws.getCell(4, col)
    labelCell.value = kpi.label
    labelCell.font = { name: 'Arial', size: 9, bold: true, color: { argb: C.white } }
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.color } }
    labelCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    setBorder(labelCell)

    const valueCell = ws.getCell(5, col)
    valueCell.value = kpi.value
    valueCell.font = { name: 'Arial', size: 22, bold: true, color: { argb: C.white } }
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.color } }
    valueCell.alignment = { vertical: 'middle', horizontal: 'center' }
    setBorder(valueCell)
    col += 2
  }
  ws.getRow(4).height = 20
  ws.getRow(5).height = 40
  ws.getRow(6).height = 10

  ws.mergeCells('A7:H7')
  styleTitle(ws.getCell('A7'), 'CITY WISE SUMMARY')
  ws.mergeCells('J7:N7')
  styleTitle(ws.getCell('J7'), 'CLIENT WISE SUMMARY')

  const cityHeaders = ['City', 'Total Riders', 'Zero Orders', 'Critical (<5)', 'Max Order (Last 3D)', 'Avg Order (Last 3D)']
  cityHeaders.forEach((h, i) => styleHeaderCell(ws.getCell(8, i + 1), h))

  const clientHeaders = ['Client', 'Total Riders', 'Zero Orders', 'Max Order', 'Avg Order']
  clientHeaders.forEach((h, i) => styleHeaderCell(ws.getCell(8, 10 + i), h))

  let row = 9
  const maxRows = Math.max(cityGroups.length, clientGroups.length)
  for (let i = 0; i < maxRows; i++) {
    const cg = cityGroups[i]
    if (cg) {
      const vals = [
        cg.city,
        cg.metrics.total,
        cg.metrics.zeroOrder,
        cg.metrics.critical,
        cg.metrics.groupMaxOrder,
        cg.metrics.avgOrder,
      ]
      vals.forEach((v, ci) => {
        let metricFill = null
        if (ci === 2) metricFill = SUMMARY_COLUMN_FILLS[1]
        if (ci === 3) metricFill = SUMMARY_COLUMN_FILLS[2]
        styleDataCell(ws.getCell(row, ci + 1), v, { rowIndex: row, colIndex: ci, keyCols: 1, metricFill })
      })
    }
    const cl = clientGroups[i]
    if (cl) {
      const vals = [cl.client, cl.metrics.total, cl.metrics.zeroOrder, cl.metrics.groupMaxOrder, cl.metrics.avgOrder]
      vals.forEach((v, ci) => {
        let metricFill = null
        if (ci === 2) metricFill = SUMMARY_COLUMN_FILLS[1]
        styleDataCell(ws.getCell(row, 10 + ci), v, { rowIndex: row, colIndex: ci, keyCols: 1, metricFill })
      })
    }
    ws.getRow(row).height = 20
    row++
  }

  const cityTotal = sumGroupMetrics(cityGroups.map((g) => g.metrics))
  const clientTotal = sumGroupMetrics(clientGroups.map((g) => g.metrics))
  styleTotalCell(ws.getCell(row, 1), 'TOTAL', 'left')
  ;[cityTotal.total, cityTotal.zeroOrder, cityTotal.critical, cityTotal.groupMaxOrder, cityTotal.avgOrder].forEach((v, i) => {
    styleTotalCell(ws.getCell(row, 2 + i), v)
  })
  styleTotalCell(ws.getCell(row, 10), 'TOTAL', 'left')
  ;[clientTotal.total, clientTotal.zeroOrder, clientTotal.groupMaxOrder, clientTotal.avgOrder].forEach((v, i) => {
    styleTotalCell(ws.getCell(row, 11 + i), v)
  })
  ws.getRow(row).height = 24

  ;[16, 10, 12, 12, 14, 12, 2, 16, 10, 12, 12, 12, 2, 2].forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

function buildCityWiseSheet(ws, riders, exportDate) {
  const grouped = [...groupBy(riders, (r) => r.city).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([city, list]) => ({ keys: [city], riders: list }))

  writeGroupedSummarySheet(ws, {
    title: `CITY WISE SUMMARY | Target: ${TARGET_ORDERS} Orders Per Rider | Export Date: ${exportDate}`,
    keyHeaders: ['City'],
    groupedRows: grouped,
    keyCols: 1,
    colWidths: [16, 12, 12, 14, 16, 18, 18],
  })
}

function buildClientWiseSheet(ws, riders, exportDate) {
  const grouped = [...groupBy(riders, (r) => r.client).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([client, list]) => ({ keys: [client], riders: list }))

  writeGroupedSummarySheet(ws, {
    title: `CLIENT WISE SUMMARY | Target: ${TARGET_ORDERS} Orders Per Rider | Export Date: ${exportDate}`,
    keyHeaders: ['Client'],
    groupedRows: grouped,
    keyCols: 1,
    colWidths: [18, 12, 12, 14, 16, 18, 18],
  })
}

function buildSourceWiseSheet(ws, riders, exportDate) {
  const keys = [...groupBy(riders, (r) => `${r.city}\0${r.source}`).entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )
  let lastCity = ''
  const grouped = keys.map(([key, list]) => {
    const [city, source] = key.split('\0')
    const showCity = city !== lastCity ? city : ''
    if (city !== lastCity) lastCity = city
    return { keys: [showCity, source], riders: list }
  })

  writeGroupedSummarySheet(ws, {
    title: `SOURCE WISE SUMMARY | Target: ${TARGET_ORDERS} Orders Per Rider | Export Date: ${exportDate}`,
    keyHeaders: ['City', 'Source'],
    groupedRows: grouped,
    keyCols: 2,
    colWidths: [14, 32, 12, 12, 14, 16, 18, 18],
  })
}

function buildCityClientSourceSheet(ws, riders, exportDate) {
  const keys = [...groupBy(riders, (r) => `${r.city}\0${r.client}\0${r.source}`).entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )
  let lastCity = ''
  let lastClientKey = ''
  const grouped = keys.map(([key, list]) => {
    const [city, client, source] = key.split('\0')
    const cityClientKey = `${city}\0${client}`
    const showCity = city !== lastCity ? city : ''
    const showClient = cityClientKey !== lastClientKey ? client : ''
    if (city !== lastCity) lastCity = city
    lastClientKey = cityClientKey
    return { keys: [showCity, showClient, source], riders: list }
  })

  writeGroupedSummarySheet(ws, {
    title: `CITY × CLIENT × SOURCE DRILL-DOWN | Target: ${TARGET_ORDERS} Orders | Export Date: ${exportDate}`,
    keyHeaders: ['City', 'Client', 'Source'],
    groupedRows: grouped,
    keyCols: 3,
    colWidths: [14, 16, 30, 12, 12, 14, 16, 18, 18],
  })
}

function buildRawDataSheet(ws, riders, exportDate) {
  const headers = [
    'City',
    'Client',
    'Source',
    'Client Id',
    'Rider Name',
    'Mobile No',
    'Order (Max Last 3D)',
    'Avg Order (Last 3D)',
    'Shortfall',
    'Status',
  ]

  ws.mergeCells('A1:J1')
  styleTitle(
    ws.getCell('A1'),
    `RAW RIDER DATA | All ${riders.length} Riders Below Target | Target: ${TARGET_ORDERS} Orders | Export Date: ${exportDate}`
  )
  ws.getRow(1).height = 32

  headers.forEach((h, i) => styleHeaderCell(ws.getCell(2, i + 1), h))
  ws.getRow(2).height = 40

  const sorted = [...riders].sort((a, b) => {
    const city = a.city.localeCompare(b.city)
    if (city !== 0) return city
    const client = a.client.localeCompare(b.client)
    if (client !== 0) return client
    const source = a.source.localeCompare(b.source)
    if (source !== 0) return source
    return a.maxOrder - b.maxOrder
  })

  sorted.forEach((r, idx) => {
    const rowNum = idx + 3
    const fill = statusFill(r.bucket)
    const values = [r.city, r.client, r.source, r.id, r.name, r.mobile, r.maxOrder, r.avgOrder, r.shortfall, r.status]

    values.forEach((val, colIndex) => {
      const isKey = [0, 1, 2, 4].includes(colIndex)
      styleDataCell(ws.getCell(rowNum, colIndex + 1), val, {
        rowIndex: rowNum,
        colIndex,
        keyCols: 0,
        metricFill: colIndex === 9 ? fill : null,
        bold: isKey,
        align: isKey ? 'left' : 'center',
        fontSize: colIndex === 2 ? 9 : 10,
      })
    })
    ws.getRow(rowNum).height = 18
  })

  ;[12, 14, 30, 14, 24, 13, 16, 16, 12, 16].forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  ws.views = [{ state: 'frozen', ySplit: 2, activeCell: 'A3' }]
}

export async function buildRiderPerformanceSummaryWorkbook(reportRows, asOfDate = new Date()) {
  const exportDate = format(new Date(), 'dd/MM/yyyy')
  const allRiders = normalizeExportRiders(reportRows, asOfDate)
  const riders = filterBelowTargetRiders(allRiders)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FleetPro Dashboard'
  workbook.created = new Date()

  buildDashboardSheet(workbook.addWorksheet('📊 Dashboard'), riders, exportDate)
  buildCityWiseSheet(workbook.addWorksheet('🏙️ City Wise'), riders, exportDate)
  buildClientWiseSheet(workbook.addWorksheet('👤 Client Wise'), riders, exportDate)
  buildSourceWiseSheet(workbook.addWorksheet('📋 Source Wise'), riders, exportDate)
  buildCityClientSourceSheet(workbook.addWorksheet('🔍 City-Client-Source'), riders, exportDate)
  buildRawDataSheet(workbook.addWorksheet('📄 Raw Data'), riders, exportDate)

  return { workbook, exportDate, riderCount: riders.length }
}

export async function downloadRiderPerformanceSummaryExcel(reportRows, asOfDate = new Date()) {
  const { workbook, exportDate, riderCount } = await buildRiderPerformanceSummaryWorkbook(reportRows, asOfDate)
  if (!riderCount) {
    throw new Error('No riders below target (Max Order < 20) to export.')
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const safeDate = exportDate.replace(/\//g, '-')
  const filename = `Low_Order_Rider_Summary_${safeDate}.xlsx`

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
