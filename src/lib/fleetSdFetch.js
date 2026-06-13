import { fetchAllData } from './supabaseFetch'
import {
  FLEET_FORM_TABLE,
  FLEET_LEGACY_TABLE,
  FLEET_RIDER_LOOKUP_COLUMNS,
  FLEET_SD_COLUMNS,
  FLEET_SLIM_PAGE_SIZE,
} from './fleetDataConfig'
import { mergeFleetSources } from './fleetDataLoad'

let cachedRows = null
let inflight = null

let cachedLookupRows = null
let lookupInflight = null

/** Slim fleet fetch for payment history vehicle/phone as-of lookup (cached per session). */
export async function fetchFleetRiderLookupRows({ force = false } = {}) {
  if (!force && cachedLookupRows) return cachedLookupRows
  if (!force && lookupInflight) return lookupInflight

  const opts = { pageSize: FLEET_SLIM_PAGE_SIZE, deployReturnOnly: true }
  lookupInflight = Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, 'id', opts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, 'id', opts),
  ])
    .then(([fleetRes, formFleetRes]) => {
      cachedLookupRows = mergeFleetSources(fleetRes.data, formFleetRes.data)
      return cachedLookupRows
    })
    .finally(() => {
      lookupInflight = null
    })

  return lookupInflight
}

/** Slim Deployee/Return fleet fetch with SD columns only (cached per session). */
export async function fetchFleetSdRows({ force = false } = {}) {
  if (!force && cachedRows) return cachedRows
  if (!force && inflight) return inflight

  const opts = { pageSize: FLEET_SLIM_PAGE_SIZE, deployReturnOnly: true }
  inflight = Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_SD_COLUMNS, 'id', opts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_SD_COLUMNS, 'id', opts),
  ])
    .then(([fleetRes, formFleetRes]) => {
      cachedRows = mergeFleetSources(fleetRes.data, formFleetRes.data)
      return cachedRows
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

export function clearFleetSdCache() {
  cachedRows = null
  inflight = null
  cachedLookupRows = null
  lookupInflight = null
}
