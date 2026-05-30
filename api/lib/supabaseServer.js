import { createClient } from '@supabase/supabase-js'

export function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  return createClient(url, key)
}

export async function fetchAllRows(table, columns = '*', orderBy = 'id', pageSize = 250) {
  const supabase = getSupabase()
  const useKeyset = orderBy != null
  const allData = []
  let cursor = null
  let offset = 0

  while (true) {
    let query = supabase.from(table).select(columns)
    if (orderBy) query = query.order(orderBy, { ascending: true })

    if (useKeyset) {
      if (cursor != null) query = query.gt(orderBy, cursor)
      query = query.limit(pageSize)
    } else {
      query = query.range(offset, offset + pageSize - 1)
    }

    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break

    allData.push(...data)

    if (useKeyset) {
      cursor = data[data.length - 1]?.[orderBy]
      if (cursor == null) break
    } else {
      offset += data.length
    }

    if (data.length < pageSize) break
  }

  return allData
}
