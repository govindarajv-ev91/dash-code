import { supabase } from './supabaseClient'
import {
  FLEET_LEGACY_TABLE,
  FLEET_FORM_TABLE,
  FLEET_SLIM_COLUMNS,
  FLEET_SLIM_PAGE_SIZE,
  FLEET_BQ_DR_COLUMNS,
  FLEET_BQ_DR_PAGE_SIZE,
} from './fleetDataConfig'
import { mergeFleetSources } from './fleetDataLoad'

const DEFAULT_PAGE_SIZE = 1000
const WIDE_PAGE_SIZE = 250

const DEPLOY_RETURN_STATUS_FILTER = [
  'vehicle_status.eq.Deployee',
  'vehicle_status.eq.Return',
  'vehicle_status.eq.deployee',
  'vehicle_status.eq.return',
  'vehicle_status.eq.Deployed',
  'vehicle_status.eq.Returned',
  'vehicle_status.eq.deployed',
  'vehicle_status.eq.returned',
].join(',')

/**
 * Paginated table fetch. Uses keyset (cursor) pagination when orderBy is set —
 * avoids slow OFFSET scans and statement timeouts on large tables.
 */
export async function fetchAllData(table, columns = '*', orderBy = 'id', options = {}) {
  const isWideSelect = columns === '*'
  let pageSize = options.pageSize ?? (isWideSelect ? WIDE_PAGE_SIZE : DEFAULT_PAGE_SIZE)
  const useKeyset = orderBy != null && options.useKeyset !== false
  const maxRetries = options.maxRetries ?? 5
  const deployReturnOnly = options.deployReturnOnly === true

  const allData = []
  let consecutiveErrors = 0
  let cursor = null
  let offset = 0
  let pageNum = 0

  while (true) {
    try {
      let query = supabase.from(table).select(columns)
      if (orderBy) query = query.order(orderBy, { ascending: true })
      if (deployReturnOnly) query = query.or(DEPLOY_RETURN_STATUS_FILTER)

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
      consecutiveErrors = 0
      pageNum++

      if (useKeyset) {
        const lastRow = data[data.length - 1]
        const nextCursor = lastRow?.[orderBy]
        if (nextCursor == null) {
          console.warn(`${table}: missing ${orderBy} on last row; stopping pagination.`)
          break
        }
        cursor = nextCursor
      } else {
        offset += data.length
      }

      if (data.length < pageSize) break
    } catch (err) {
      const isTimeout = err?.code === '57014'
      const isBadColumn = err?.code === '42703' || err?.message?.includes('does not exist')
      if (isBadColumn) {
        console.error(`Stopped fetching ${table} — invalid column in select:`, err)
        break
      }
      if (isTimeout && pageSize > 100) {
        pageSize = Math.max(100, Math.floor(pageSize / 2))
        console.warn(`${table}: query timed out; retrying with page size ${pageSize}.`)
        consecutiveErrors = 0
        continue
      }

      consecutiveErrors++
      if (consecutiveErrors > maxRetries) {
        console.error(`Stopped fetching ${table} after ${maxRetries} failures.`, err)
        break
      }
      await new Promise((r) => setTimeout(r, 1000 * consecutiveErrors))
    }
  }

  if (import.meta.env.DEV && pageNum > 0) {
    console.info(`[fetch] ${table}: ${allData.length} rows, ${pageNum} page(s), cols=${isWideSelect ? 'all' : 'slim'}`)
  }

  return { data: allData, totalCount: allData.length }
}

/**
 * Complete Deployee/Return rows from both fleet tables (narrow columns, larger pages).
 * Prefer this for BigQuery Deploy/Return — full `*` fleet loads often time out incomplete.
 */
export async function fetchDeployReturnFleetRows() {
  const opts = { pageSize: FLEET_BQ_DR_PAGE_SIZE, deployReturnOnly: true }
  const [fleetRes, formFleetRes] = await Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_BQ_DR_COLUMNS, 'id', opts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_BQ_DR_COLUMNS, 'id', opts),
  ])
  return mergeFleetSources(fleetRes.data || [], formFleetRes.data || [])
}
