import { supabase } from './supabaseClient'
import { fetchAllData } from './supabaseFetch'

export const CLIENT_TARGETS_TABLE = 'client_targets'
export const CLIENT_TARGETS_COLUMNS = 'id,week_key,city,client,type,target,created_at,updated_at'

export function groupDbRowsToByWeek(rows) {
  const byWeek = {}

  for (const row of rows || []) {
    const weekKey = (row.week_key ?? '').toString().trim()
    if (!weekKey) continue

    if (!byWeek[weekKey]) byWeek[weekKey] = []
    byWeek[weekKey].push({
      city: row.city || '',
      client: row.client,
      type: row.type || '',
      target: Number(row.target) || 0,
    })
  }

  return byWeek
}

export async function fetchClientTargetsFromDb() {
  const probe = await supabase.from(CLIENT_TARGETS_TABLE).select('id').limit(1)
  if (probe.error) throw probe.error

  const { data } = await fetchAllData(
    CLIENT_TARGETS_TABLE,
    CLIENT_TARGETS_COLUMNS,
    'id',
    { useKeyset: true }
  )

  const byWeek = groupDbRowsToByWeek(data)
  return {
    byWeek,
    weekKeys: Object.keys(byWeek),
    fromDb: true,
  }
}

export async function saveClientTargetsForWeeks(byWeek) {
  const weekKeys = Object.keys(byWeek || {})
  if (!weekKeys.length) return

  for (const weekKey of weekKeys) {
    const { error: deleteError } = await supabase
      .from(CLIENT_TARGETS_TABLE)
      .delete()
      .eq('week_key', weekKey)

    if (deleteError) throw deleteError
  }

  const inserts = []
  for (const [weekKey, rows] of Object.entries(byWeek)) {
    for (const row of rows) {
      inserts.push({
        week_key: weekKey,
        city: row.city || '',
        client: row.client,
        type: row.type || '',
        target: Number(row.target) || 0,
        updated_at: new Date().toISOString(),
      })
    }
  }

  const chunkSize = 500
  for (let i = 0; i < inserts.length; i += chunkSize) {
    const chunk = inserts.slice(i, i + chunkSize)
    const { error: insertError } = await supabase.from(CLIENT_TARGETS_TABLE).insert(chunk)
    if (insertError) throw insertError
  }
}

export function isMissingClientTargetsTable(error) {
  const msg = (error?.message || '').toLowerCase()
  return msg.includes('client_targets') && (msg.includes('does not exist') || msg.includes('schema cache'))
}
