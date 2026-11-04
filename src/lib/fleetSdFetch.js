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
let cacheGeneration = 0

let cachedLookupRows = null
let lookupInflight = null

/** Slim fleet fetch for payment history vehicle/phone as-of lookup (cached per session). */
export async function fetchFleetRiderLookupRows({ force = false } = {}) {
  if (!force && cachedLookupRows) return cachedLookupRows
  if (!force && lookupInflight) return lookupInflight

  const generation = cacheGeneration
  const opts = { pageSize: FLEET_SLIM_PAGE_SIZE, deployReturnOnly: true }
  const request = Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, 'id', opts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_RIDER_LOOKUP_COLUMNS, 'id', opts),
  ])
    .then(([fleetRes, formFleetRes]) => {
      const rows = mergeFleetSources(fleetRes.data, formFleetRes.data)
      if (generation === cacheGeneration && lookupInflight === request) cachedLookupRows = rows
      return rows
    })
    .finally(() => {
      if (lookupInflight === request) lookupInflight = null
    })

  lookupInflight = request
  return request
}

/** Slim Deployee/Return fleet fetch with SD columns only (cached per session). */
export async function fetchFleetSdRows({ force = false } = {}) {
  if (inflight) return inflight
  if (!force && cachedRows) return cachedRows

  const generation = cacheGeneration
  const opts = {
    pageSize: FLEET_SLIM_PAGE_SIZE, deployReturnOnly: true,
    useKeyset: true, untilEmpty: true, throwOnError: true,
    maxRetries: 2, requestTimeoutMs: 15000,
  }
  const request = Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_SD_COLUMNS, 'id', opts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_SD_COLUMNS, 'id', opts),
  ])
    .then(([fleetRes, formFleetRes]) => {
      const rows = mergeFleetSources(fleetRes.data, formFleetRes.data)
      if (generation === cacheGeneration && inflight === request) cachedRows = rows
      return rows
    })
    .finally(() => {
      if (inflight === request) inflight = null
    })

  inflight = request
  return request
}

export function clearFleetSdCache() {
  cacheGeneration++
  cachedRows = null
  inflight = null
  cachedLookupRows = null
  lookupInflight = null
}
