import { fetchAllData } from './supabaseFetch'

const ONBOARDING_SELECT =
  'id,rider_id_details,rider_id,worker_code,client_rider_id,merge,rider_name,source_name,rider_mobile_number,mobile,phone,email_address'

let memoryCache = null
let memoryCacheAt = 0

/** Clear in-memory onboarding cache (IndexedDB cleared separately in App). */
export function clearRiderOnboardingMemoryCache() {
  memoryCache = null
  memoryCacheAt = 0
}

/**
 * Load rider_onboarding from Supabase.
 * @param {{ force?: boolean, full?: boolean }} options — force skips memory cache; full selects *
 */
export async function fetchRiderOnboardingRows({ force = false, full = true } = {}) {
  const now = Date.now()
  if (!force && memoryCache && now - memoryCacheAt < 60_000) {
    return memoryCache
  }

  const columns = full ? '*' : ONBOARDING_SELECT
  const res = await fetchAllData('rider_onboarding', columns, 'id', { pageSize: 500 })
  const rows = res.data || []
  memoryCache = rows
  memoryCacheAt = now
  return rows
}
