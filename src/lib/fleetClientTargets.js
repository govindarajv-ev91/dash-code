import {
  addWeeks,
  endOfISOWeek,
  format,
  getISOWeek,
  getISOWeekYear,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
} from 'date-fns'
import * as XLSX from 'xlsx'
import { normalizeCityKey } from './fleetMasterSheet'
import { normalizeSummaryCity } from './citySummaryAliases'
import { normalizeSummaryClient } from './clientSummaryClients'
import {
  fetchClientTargetsFromDb,
  isMissingClientTargetsTable,
  saveClientTargetsForWeeks,
} from './clientTargetsDb'

export { isMissingClientTargetsTable }

const STORAGE_KEY = 'fleet_client_targets_v1'

const HEADER_ALIASES = {
  week: ['week', 'week_key', 'weekkey'],
  city: ['city', 'city_locations', 'city_name'],
  client: ['client', 'client_name', 'clientname'],
  type: ['type', 'metric', 'metric_type'],
  target: ['target', 'targets', 'target_value', 'value'],
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function pickField(normalizedRow, field) {
  const aliases = HEADER_ALIASES[field] || [field]
  for (const alias of aliases) {
    if (normalizedRow[alias] != null && String(normalizedRow[alias]).trim() !== '') {
      return normalizedRow[alias]
    }
  }
  return ''
}

export function parseWeekKey(weekKey) {
  const raw = String(weekKey ?? '').trim()
  const match = raw.match(/^(\d{1,2})[_/-](\d{2,4})$/)
  if (!match) return null

  const week = parseInt(match[1], 10)
  let year = parseInt(match[2], 10)
  if (year < 100) year += 2000

  if (!week || !year || week < 1 || week > 53) return null
  return { week, year, key: `${week}_${year}` }
}

export function formatWeekKey(week, year) {
  return `${week}_${year}`
}

export function dateToWeekKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return formatWeekKey(getISOWeek(d), getISOWeekYear(d))
}

export function weekKeyToDateRange(weekKey) {
  const parsed = parseWeekKey(weekKey)
  if (!parsed) return null

  let anchor = new Date(parsed.year, 0, 4)
  anchor = setISOWeekYear(anchor, parsed.year)
  anchor = setISOWeek(anchor, parsed.week)

  const start = startOfISOWeek(anchor, { weekStartsOn: 1 })
  const end = endOfISOWeek(anchor, { weekStartsOn: 1 })

  return {
    start,
    end,
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
    label: `${format(start, 'dd/MM/yyyy')} – ${format(end, 'dd/MM/yyyy')}`,
  }
}

export function sortWeekKeys(keys) {
  return [...new Set(keys.filter(Boolean))].sort((a, b) => {
    const pa = parseWeekKey(a)
    const pb = parseWeekKey(b)
    if (!pa || !pb) return 0
    if (pa.year !== pb.year) return pb.year - pa.year
    return pb.week - pa.week
  })
}

/** Recent + upcoming ISO weeks for the dropdown (not only uploaded weeks). */
export function buildWeekOptions({ storedWeekKeys = [], anchorDate = new Date(), pastWeeks = 20, futureWeeks = 4 } = {}) {
  const set = new Set(storedWeekKeys)
  const anchor = startOfISOWeek(anchorDate, { weekStartsOn: 1 })

  for (let offset = -pastWeeks; offset <= futureWeeks; offset += 1) {
    const key = dateToWeekKey(addWeeks(anchor, offset))
    if (key) set.add(key)
  }

  const current = dateToWeekKey(anchorDate)
  if (current) set.add(current)

  return sortWeekKeys([...set])
}

export function loadAllClientTargets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveAllClientTargets(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export async function loadClientTargets() {
  try {
    const dbResult = await fetchClientTargetsFromDb()
    if (Object.keys(dbResult.byWeek).length > 0) {
      saveAllClientTargets(dbResult.byWeek)
      return {
        byWeek: dbResult.byWeek,
        weekKeys: dbResult.weekKeys,
        source: 'database',
      }
    }
  } catch (error) {
    if (!isMissingClientTargetsTable(error)) {
      console.warn('Failed to load client targets from database:', error)
    }
  }

  const local = loadAllClientTargets()
  return {
    byWeek: local,
    weekKeys: Object.keys(local),
    source: 'local',
  }
}

export async function persistClientTargets(byWeek, replaceExisting = true) {
  let dbSaved = false
  let dbError = null

  try {
    await saveClientTargetsForWeeks(byWeek)
    dbSaved = true
  } catch (error) {
    dbError = error
    if (!isMissingClientTargetsTable(error)) {
      console.warn('Failed to save client targets to database:', error)
    }
  }

  const all = loadAllClientTargets()
  for (const [weekKey, rows] of Object.entries(byWeek)) {
    all[weekKey] = replaceExisting ? rows : [...(all[weekKey] || []), ...rows]
  }
  saveAllClientTargets(all)

  return { byWeek: all, dbSaved, dbError }
}

export function getTargetsForWeek(allTargets, weekKey) {
  const parsed = parseWeekKey(weekKey)
  if (!parsed) return []
  return allTargets[parsed.key] || []
}

export function listStoredWeekKeys(allTargets) {
  return sortWeekKeys(Object.keys(allTargets || {}))
}

export function normalizeTargetEvType(value) {
  const t = String(value || '').toUpperCase().trim().replace(/\s+/g, '-')
  if (!t) return null
  if (t === 'NON-EV' || t === 'NONEV' || t.includes('NON')) return 'NON-EV'
  if (t === 'EV' || (t.includes('EV') && !t.includes('NON'))) return 'EV'
  return null
}

function normalizeTargetRow(rawRow, fallbackWeekKey) {
  const normalized = {}
  for (const [key, value] of Object.entries(rawRow || {})) {
    normalized[normalizeHeader(key)] = value
  }

  const weekRaw = pickField(normalized, 'week') || fallbackWeekKey
  const weekParsed = parseWeekKey(weekRaw)
  if (!weekParsed) return null

  const cityRaw = String(pickField(normalized, 'city') || '').trim()
  const city = cityRaw ? normalizeSummaryCity(cityRaw) : ''
  const client = normalizeSummaryClient(pickField(normalized, 'client'))
  const type = normalizeTargetEvType(pickField(normalized, 'type'))
  const target = Number(String(pickField(normalized, 'target')).replace(/,/g, ''))

  if (!client || !type || Number.isNaN(target)) return null

  return {
    weekKey: weekParsed.key,
    city,
    client,
    type,
    target,
  }
}

export function parseTargetsExcelArrayBuffer(arrayBuffer, fallbackWeekKey) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const parsedRows = []
  const byWeek = {}

  for (const row of rows) {
    const targetRow = normalizeTargetRow(row, fallbackWeekKey)
    if (!targetRow) continue
    parsedRows.push(targetRow)
    if (!byWeek[targetRow.weekKey]) byWeek[targetRow.weekKey] = []
    byWeek[targetRow.weekKey].push({
      city: targetRow.city,
      client: targetRow.client,
      type: targetRow.type,
      target: targetRow.target,
    })
  }

  return { parsedRows, byWeek, sheetName }
}

export function buildTargetTotalsByEvType(targetRows, selectedCity = 'All') {
  const ev = new Map()
  const nonEv = new Map()
  const cityKey = selectedCity && selectedCity !== 'All' ? normalizeCityKey(selectedCity) : null

  for (const row of targetRows || []) {
    if (cityKey && normalizeCityKey(row.city) !== cityKey) continue
    const client = normalizeSummaryClient(row.client)
    const type = normalizeTargetEvType(row.type)
    if (!type) continue

    const bucket = type === 'EV' ? ev : nonEv
    bucket.set(client, (bucket.get(client) || 0) + (Number(row.target) || 0))
  }

  return { ev, nonEv }
}

/** @deprecated use buildTargetTotalsByEvType */
export function buildTargetTotalsByClient(targetRows, selectedCity = 'All') {
  const { ev, nonEv } = buildTargetTotalsByEvType(targetRows, selectedCity)
  const total = new Map()

  for (const [client, value] of ev) {
    total.set(client, (total.get(client) || 0) + value)
  }
  for (const [client, value] of nonEv) {
    total.set(client, (total.get(client) || 0) + value)
  }

  return total
}

export function mergeSummaryWithTargets(summary, targetMaps) {
  const evMap = targetMaps?.ev || new Map()
  const nonEvMap = targetMaps?.nonEv || new Map()
  const clientMap = new Map()

  for (const row of summary.clients || []) {
    clientMap.set(row.client, {
      ...row,
      targetEv: evMap.get(row.client) || 0,
      targetNonEv: nonEvMap.get(row.client) || 0,
    })
  }

  for (const [client, targetEv] of evMap) {
    if (!clientMap.has(client)) {
      clientMap.set(client, {
        client,
        totalDeployed: 0,
        evDeployed: 0,
        icDeployed: 0,
        returnCount: 0,
        netAddon: 0,
        targetEv,
        targetNonEv: nonEvMap.get(client) || 0,
      })
    }
  }

  for (const [client, targetNonEv] of nonEvMap) {
    if (!clientMap.has(client)) {
      clientMap.set(client, {
        client,
        totalDeployed: 0,
        evDeployed: 0,
        icDeployed: 0,
        returnCount: 0,
        netAddon: 0,
        targetEv: evMap.get(client) || 0,
        targetNonEv,
      })
    }
  }

  const clients = [...clientMap.values()].sort((a, b) => a.client.localeCompare(b.client))
  const totals = {
    ...summary.totals,
    targetEv: clients.reduce((sum, row) => sum + (row.targetEv || 0), 0),
    targetNonEv: clients.reduce((sum, row) => sum + (row.targetNonEv || 0), 0),
  }

  return { clients, totals }
}

export function getDbSetupMessage() {
  return 'Database table missing. Run sql/create_client_targets.sql in Supabase SQL Editor, then upload again.'
}
