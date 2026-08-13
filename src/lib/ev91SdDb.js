import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'
import { fetchTableCount, fetchLastUploadAtSafe, isStatementTimeout, deleteRowsInBatches } from './paymentMonthList'
import { normalizeRiderIdKey } from './riderPerformanceReport'

export const EV91_SD_TABLE = 'ev91_sd_data'
export const EV91_SD_COLUMNS = '*'

export function isMissingEv91SdTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('ev91_sd_data') && (msg.includes('does not exist') || msg.includes('schema cache'))
}

export async function fetchEv91SdCount() {
  return fetchTableCount(EV91_SD_TABLE)
}

export async function fetchEv91SdPreview(limit = 50) {
  const { data, error } = await supabase
    .from(EV91_SD_TABLE)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function clearEv91SdData() {
  await deleteRowsInBatches(EV91_SD_TABLE)
  clearEv91SdCache()
}

export async function saveEv91SdRows(rows, { replace = true } = {}) {
  if (!rows?.length) return 0

  if (replace) {
    await clearEv91SdData()
  }

  const chunkSize = 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(EV91_SD_TABLE).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  clearEv91SdCache()
  return inserted
}

let cachedEv91Sd = null
let ev91SdInflight = null

export async function fetchAllEv91Sd({ force = false } = {}) {
  if (!force && cachedEv91Sd) return cachedEv91Sd
  if (!force && ev91SdInflight) return ev91SdInflight

  ev91SdInflight = (async () => {
    const probe = await supabase.from(EV91_SD_TABLE).select('id').limit(1)
    if (probe.error) throw probe.error
    const { data } = await fetchAllData(EV91_SD_TABLE, EV91_SD_COLUMNS, 'id', {
      useKeyset: true,
      maxRetries: 10,
    })
    cachedEv91Sd = data || []
    return cachedEv91Sd
  })().finally(() => {
    ev91SdInflight = null
  })

  return ev91SdInflight
}

export function clearEv91SdCache() {
  cachedEv91Sd = null
  ev91SdInflight = null
}

export async function loadEv91SdSummary() {
  try {
    const preview = await fetchEv91SdPreview(25).catch((err) => {
      if (isMissingEv91SdTable(err)) throw err
      return []
    })

    const probe = await supabase.from(EV91_SD_TABLE).select('id').limit(1)
    if (probe.error) {
      if (isMissingEv91SdTable(probe.error)) {
        return { count: 0, preview: [], lastUploadAt: null, fromDb: false, missingTable: true }
      }
      throw probe.error
    }
    if (!probe.data?.length) {
      return { count: 0, preview: [], lastUploadAt: null, fromDb: true }
    }

    let count = 0
    try {
      count = await fetchEv91SdCount()
    } catch (err) {
      if (isMissingEv91SdTable(err)) throw err
      count = preview.length
    }
    if (count === 0 && preview.length > 0) count = preview.length

    const lastUploadAt = await fetchLastUploadAtSafe(EV91_SD_TABLE)
    return { count, preview, lastUploadAt, fromDb: true }
  } catch (err) {
    if (isMissingEv91SdTable(err)) {
      return { count: 0, preview: [], lastUploadAt: null, fromDb: false, missingTable: true }
    }
    if (isStatementTimeout(err)) {
      console.warn('[ev91-sd] summary timed out:', err.message || err)
      return { count: 0, preview: [], lastUploadAt: null, fromDb: true, timedOut: true }
    }
    throw err
  }
}

export function getEv91SdDbSetupMessage() {
  return 'Database table missing. Run sql/create_ev91_sd_table.sql in Supabase SQL Editor, then upload again.'
}

function isNumericWorkerCode(raw) {
  const s = (raw ?? '').toString().trim()
  return /^[\d.\s-]+$/.test(s) && /\d/.test(s)
}

/** Aliases for ClientRiderId / PublicRiderId ↔ fleet performance ID. */
export function ev91SdRiderAliases(value) {
  const aliases = new Set()
  const raw = (value ?? '').toString().trim()
  if (!raw) return aliases

  const idKey = normalizeRiderIdKey(raw)
  if (idKey) aliases.add(idKey)

  const prefixMatch = idKey.match(/^([A-Z]{2,5})(\d+)$/i)
  if (prefixMatch?.[2]?.length >= 5) {
    aliases.add(prefixMatch[2])
    aliases.add(`${prefixMatch[1]}${prefixMatch[2]}`)
  }

  const embeddedFe = idKey.match(/FE(\d{5,})/i)
  if (embeddedFe) {
    aliases.add(`FE${embeddedFe[1]}`)
    aliases.add(embeddedFe[1])
  }

  if (isNumericWorkerCode(raw)) {
    const digits = raw.replace(/\D/g, '')
    if (digits) aliases.add(digits)
  }

  return aliases
}

function preferEv91SdRow(next, prev) {
  return (next.id ?? 0) >= (prev.id ?? 0)
}

/** Map rider ID aliases → latest EV91 SD row. */
export function buildEv91SdByRiderIndex(ev91Rows) {
  const byAlias = new Map()

  for (const row of ev91Rows || []) {
    const keys = [
      ...(row?.client_rider_id ? ev91SdRiderAliases(row.client_rider_id) : []),
      ...(row?.public_rider_id ? ev91SdRiderAliases(row.public_rider_id) : []),
    ]
    for (const alias of keys) {
      const prev = byAlias.get(alias)
      if (!prev || preferEv91SdRow(row, prev)) {
        byAlias.set(alias, row)
      }
    }
  }

  return byAlias
}

export function lookupEv91SdRow(index, riderId) {
  if (!index || !riderId) return null
  for (const alias of ev91SdRiderAliases(riderId)) {
    const row = index.get(alias)
    if (row) return row
  }
  return null
}
