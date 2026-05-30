import { createClient } from '@supabase/supabase-js'
import { FLEET_FORM_TABLE, FLEET_LEGACY_TABLE } from '../../src/lib/fleetDataConfig.js'

export function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  return createClient(url, key)
}

export async function fetchAllRows(table, columns = '*', orderBy = 'id', pageSize = 250, filters = null) {
  const supabase = getSupabase()
  const useKeyset = orderBy != null
  const allData = []
  let cursor = null
  let offset = 0

  while (true) {
    let query = supabase.from(table).select(columns)
    if (filters) query = filters(query)
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

const FLEET_DEPLOY_RETURN_COLS =
  'id,date_record,vehicle_number,rider_name,rider_id,rider_contact_number,vehicle_status,city_locations,city,client_name,hub_location,category,source_name,source_name_vehicle_asset_details,filled_by'

function deployReturnFilter(query) {
  return query.in('vehicle_status', ['Deployee', 'Return', 'deployee', 'return'])
}

export async function fetchAllFleetTables(columns = '*', pageSize = 250, filters = null) {
  const [legacy, form] = await Promise.all([
    fetchAllRows(FLEET_LEGACY_TABLE, columns, 'id', pageSize, filters),
    fetchAllRows(FLEET_FORM_TABLE, columns, 'id', pageSize, filters),
  ])
  return [...(legacy || []), ...(form || [])]
}

export function fetchFleetDeployReturnRows(pageSize = 500) {
  return fetchAllFleetTables(FLEET_DEPLOY_RETURN_COLS, pageSize, deployReturnFilter)
}
