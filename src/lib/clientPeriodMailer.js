import { clientPeriodValueLevels, TREND_VALUE_COLORS } from './clientPeriodValueColors.js'
import { clientPeriodSparklinePng } from './clientPeriodMailSparkline.js'
import { addDays, format, getISOWeek, parseISO, startOfWeek } from 'date-fns'
import { normalizeRows, periodInfo, buildRevenueReport, buildRiderReport } from './clientPeriodTrendReports.js'
import { normalizeSummaryCity } from './citySummaryAliases.js'
import { buildOnboardingSourceLookupIndex, lookupOnboardingSource } from './onboardingSourceLookup.js'
import { isListedSource } from './sourceMaster.js'
import { buildClientSourceReport } from './ev91ClientSourceReport.js'

export { buildSourceMasterIndex } from './sourceMaster.js'
export { normalizeSummaryCity } from './citySummaryAliases.js'
export { summaryCityLookupKeys } from './citySummaryAliases.js'
export { scheduleDue, emailList } from './cityMailSettings.js'

export const CLIENT_PERIOD_TEST_TO = 'govindaraj.v@ev91riderz.com'
export const MAIL_TABLE_TITLES = ['Client payout revenue', 'Client rider count', 'Source rider count', 'Source payout revenue']

export function clientPeriodMailRange(mode, today) {
  if (!['weekly', 'monthly'].includes(mode)) throw new Error('Choose Weekly or Monthly.')
  const date = parseISO(today)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(date.getTime()) || format(date, 'yyyy-MM-dd') !== today) throw new Error('Invalid report date.')
  if (today < '2026-03-30') throw new Error('The report starts on 30 March 2026.')
  const weekStart = format(addDays(startOfWeek(date, { weekStartsOn: 1 }), -63), 'yyyy-MM-dd')
  return { fromDate: mode === 'weekly' && weekStart > '2026-03-30' ? weekStart : '2026-03-30', toDate: today }
}

export function buildClientPeriodMailReport({ payments, onboarding, sourceIndex, city, mode = 'weekly', today }) {
  const selectedCity = normalizeSummaryCity(city)
  if (!city || city === 'All' || selectedCity === 'Unknown') throw new Error('Select one city before preparing an email.')
  const range = clientPeriodMailRange(mode, today)
  const index = buildOnboardingSourceLookupIndex(onboarding)
  const sourceForRow = (row) => lookupOnboardingSource(index, {
    riderIds: [row.rider_id, row.rider_name], phone: row.rider_mobile_number,
  }) || String(row.source_name || 'Unknown').trim() || 'Unknown'
  const rows = normalizeRows(payments).filter((row) => normalizeSummaryCity(row.city) === selectedCity &&
    (mode !== 'weekly' || (row.period_start >= range.fromDate && row.period_start <= today)))
  const visible = rows.filter((row) => isListedSource(sourceIndex, row.city, sourceForRow(row)))
  const filters = { ...range, city: selectedCity, client: 'All' }
  const revenue = buildRevenueReport(rows, filters, mode)
  const periods = []
  let cursor = mode === 'weekly' ? startOfWeek(parseISO(range.fromDate), { weekStartsOn: 1 }) : parseISO('2026-03-01')
  while (format(cursor, 'yyyy-MM-dd') <= today) {
    const start = format(cursor, 'yyyy-MM-dd')
    const end = mode === 'weekly' ? format(addDays(cursor, 6), 'yyyy-MM-dd') : format(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), 'yyyy-MM-dd')
    periods.push({ key: mode === 'weekly' ? `Week ${getISOWeek(cursor)}` : format(cursor, 'MMM yyyy'), start, end,
      label: mode === 'weekly' ? `Week ${getISOWeek(cursor)} · ${format(cursor, 'dd MMM')}–${format(addDays(cursor, 6), 'dd MMM')}` : format(cursor, 'MMM yyyy'),
      isPartial: end >= today })
    cursor = mode === 'weekly' ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  const keys = periods.map((period) => period.key)
  const riders = buildRiderReport(visible, filters, mode, keys)
  const sources = buildClientSourceReport(visible, { mode, periods: keys,
    matches: (row) => {
      const info = periodInfo(row, mode)
      return mode === 'monthly' ? info.end >= range.fromDate && info.start <= today : true
    }, sourceForRow, periodForRow: (row) => periodInfo(row, mode).label })
  const matrix = (items, source = false) => items.map((row) => ({ name: source ? row.source : row.name,
    values: keys.map((key) => row.values[key] || 0) }))
  const report = { version: 1, city: selectedCity, mode, ...range, periods, paymentRowCount: rows.filter((row) => {
    const info = periodInfo(row, mode)
    return mode === 'weekly' || (info.end >= range.fromDate && info.start <= today)
  }).length,
  tables: [
    { title: MAIL_TABLE_TITLES[0], entity: 'Client', unit: 'INR', rows: matrix(revenue.rows) },
    { title: MAIL_TABLE_TITLES[1], entity: 'Client', unit: 'riders', rows: matrix(riders.rows) },
    { title: MAIL_TABLE_TITLES[2], entity: 'Source', unit: 'riders', rows: matrix(sources.riderRows, true) },
    { title: MAIL_TABLE_TITLES[3], entity: 'Source', unit: 'INR', rows: matrix(sources.revenueRows, true) },
  ] }
  validateClientPeriodMailReport(report)
  return report
}

export function validateClientPeriodMailReport(report) {
  if (report?.mode === 'both') {
    if (report.version !== 1 || !Array.isArray(report.reports) || report.reports.length !== 2) throw new Error('Weekly and Monthly reports are required.')
    report.reports.forEach((item, index) => {
      if (item.mode !== (index === 0 ? 'weekly' : 'monthly') || item.city !== report.city || item.toDate !== report.toDate) throw new Error('Both reports must use the same city and report date.')
      validateClientPeriodMailReport(item)
    })
    if (report.logo && (typeof report.logo !== 'string' || report.logo.length > 70000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(report.logo))) throw new Error('Use a PNG or JPEG logo smaller than 50 KB.')
    return report
  }
  if (!report || report.version !== 1 || typeof report.city !== 'string' || !report.city.trim() || report.city.length > 80 || Array.from(report.city).some((char) => char.charCodeAt(0) < 32) || report.city === 'All' || normalizeSummaryCity(report.city) === 'Unknown') throw new Error('A single city report is required.')
  const range = clientPeriodMailRange(report.mode, report.toDate)
  if (report.fromDate !== range.fromDate || !Array.isArray(report.periods) || !report.periods.length || report.periods.length > 120) throw new Error('Invalid report window.')
  if (report.mode === 'weekly' && report.periods.length > 10) throw new Error('Weekly email may contain at most 10 weeks.')
  if (!Array.isArray(report.tables) || report.tables.length !== 4) throw new Error('All four summary tables are required.')
  report.tables.forEach((table, index) => {
    if (table.title !== MAIL_TABLE_TITLES[index] || table.entity !== (index < 2 ? 'Client' : 'Source') ||
      table.unit !== (index === 0 || index === 3 ? 'INR' : 'riders') || !Array.isArray(table.rows) || table.rows.length > 2000) throw new Error('Invalid report table.')
    table.rows.forEach((row) => {
      if (typeof row.name !== 'string' || !row.name.trim() || !Array.isArray(row.values) || row.values.length !== report.periods.length ||
        row.values.some((value) => typeof value !== 'number' || !Number.isFinite(value) ||
          (table.unit === 'riders' && (!Number.isSafeInteger(value) || value < 0)))) throw new Error('Invalid summary values.')
    })
  })
  return report
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const totalValues = (values) => values.reduce((sum, value) => sum + value, 0)
function sparkline(values, periods) {
  values = values.filter((_, index) => !periods[index].isPartial)
  if (!values.length) return '<span>No completed periods</span>'
  return `<img src="${clientPeriodSparklinePng(values)}" alt="Line trend, oldest to newest: ${escapeHtml(values.join(', '))}" width="96" height="28" style="display:block;width:96px;height:28px;">`
}
function mailGreeting(report) {
  return `<p>Hi Team,</p><p>Please find the ${escapeHtml(report.city)} summary for ${escapeHtml(report.fromDate)} through ${escapeHtml(report.toDate)}.</p>`
}
export function renderClientPeriodMailHtml(report, { section = false } = {}) {
  validateClientPeriodMailReport(report)
  if (report.mode === 'both') {
    const sections = report.reports.map((item) => {
      const document = renderClientPeriodMailHtml(item, { section: true })
      return `<div id="${item.mode}" style="margin-top:32px;">${document.slice(document.indexOf('<body') + document.slice(document.indexOf('<body')).indexOf('>') + 1, document.lastIndexOf('</body>'))}</div>`
    }).join('')
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0f172a;font-family:Arial,sans-serif;"><div style="padding:24px;background:#182337;color:#f8fafc;border-radius:12px;">${report.logo ? `<img src="${report.logo}" alt="Company logo" width="220" style="max-width:220px;height:auto;display:block;margin-bottom:20px;">` : '<p style="font-size:26px;font-weight:bold;color:#4ade80;">EV91</p>'}<h1>${escapeHtml(report.city)} — Weekly &amp; Monthly Reports</h1>${mailGreeting({ ...report, fromDate: report.fromDate || report.reports[1].fromDate })}<p><a href="#weekly" style="display:inline-block;padding:12px 22px;background:#6366f1;color:white;text-decoration:none;border-radius:6px;">Weekly</a> <a href="#monthly" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px;">Monthly</a></p><p style="font-size:12px;color:#94a3b8;">Both reports are included below. Buttons jump to each section where supported by your email app. Rows: highest to lowest total. Value colors within each row: <span style="color:#f87171;">Low</span> / <span style="color:#facc15;">Middle</span> / <span style="color:#4ade80;">High</span>. Equal values are yellow. Totals are excluded. Line trends use completed periods only, oldest to newest; the current partial period is excluded. Each row has its own scale.</p>${sections}</div></body></html>`
  }
  const number = (value, money) => value.toLocaleString('en-IN', { maximumFractionDigits: money ? 2 : 0 })
  // Inherit spacing and borders from the table instead of repeating them in every cell.
  const cellStyle = 'text-align:right;'
  const tables = report.tables.map((table) => {
    const totals = report.periods.map((_period, index) => table.rows.reduce((sum, row) => sum + row.values[index], 0))
    const total = totalValues
    const sorted = [...table.rows].sort((a, b) => total(b.values) - total(a.values) || a.name.localeCompare(b.name))
    const body = sorted.map((row) => {
      const levels = clientPeriodValueLevels(row.values.map((_, index) => index), row.values)
      return `<tr><td style="${cellStyle}">${sparkline(row.values, report.periods)}</td><td style="${cellStyle}text-align:left;font-weight:600;">${escapeHtml(row.name)}</td>${row.values.map((value, index) => `<td style="${cellStyle}color:${TREND_VALUE_COLORS[levels[index]]};">${number(value, table.unit === 'INR')}</td>`).join('')}<td style="${cellStyle}font-weight:bold;background:#243247;color:#f8fafc;">${number(total(row.values), table.unit === 'INR')}</td></tr>`
    }).join('')
    return `<h2 style="font-size:17px;margin:26px 0 10px;color:#38bdf8;">${escapeHtml(table.title)}${table.unit === 'INR' ? ' (INR)' : ''}</h2><div style="overflow-x:auto;border:1px solid #334155;border-radius:10px;"><table cellpadding="7" cellspacing="0" border="1" bordercolor="#334155" bgcolor="#182337" style="border-collapse:collapse;font-size:12px;width:100%;background:#182337;color:#f8fafc;white-space:nowrap;"><thead><tr style="background:#243247;color:#f8fafc;"><th style="${cellStyle}">Trend</th><th style="${cellStyle}text-align:left;">${table.entity}</th>${report.periods.map((period) => `<th style="${cellStyle}">${escapeHtml(period.label)}${period.isPartial ? '<br><small>Partial</small>' : ''}</th>`).join('')}<th style="${cellStyle}">Total</th></tr></thead><tbody><tr style="background:#243247;font-weight:bold;"><td style="${cellStyle}">${sparkline(totals, report.periods)}</td><th style="${cellStyle}text-align:left;">Total</th>${totals.map((value) => `<td style="${cellStyle}">${number(value, table.unit === 'INR')}</td>`).join('')}<td style="${cellStyle}">${number(total(totals), table.unit === 'INR')}</td></tr>${body || `<tr><td colspan="${report.periods.length + 3}" style="${cellStyle}text-align:left;">No eligible data for this table.</td></tr>`}</tbody></table></div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0f172a;"><div style="padding:24px;background:#182337;color:#f8fafc;border-radius:12px;font-family:Arial,sans-serif;color:#f8fafc;"><p style="font-size:12px;color:#94a3b8;margin:0 0 8px;">EV91 · CITY PERFORMANCE</p><h1 style="font-size:24px;color:#38bdf8;margin:0 0 12px;">${escapeHtml(report.city)} — ${report.mode === 'weekly' ? 'Weekly' : 'Monthly'} Client Period Trend</h1>${section ? '' : mailGreeting(report)}<p style="font-size:12px;color:#94a3b8;">${report.mode === 'weekly' ? 'Latest 10 calendar weeks, including the current partial week.' : 'Accounting months from March 2026 through today; March includes the full accounting month.'} Client revenue includes all sources. Rider counts and source tables include only this city’s active listed sources. All clients are included.</p>${tables}<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Rider totals sum period counts; they are not distinct riders across the full date range. The current period is partial and excluded from sparklines. Prepared from EV91 Client Period Trend.</p></div></body></html>`
}

export function clientPeriodMailSubject(report) {
  if (report.mode === 'both') return `EV91 ${report.city} | Weekly & Monthly Client Period Trend | ${report.toDate}`
  return `EV91 ${report.city} | ${report.mode === 'weekly' ? 'Weekly' : 'Monthly'} Client Period Trend | ${report.toDate}`
}
