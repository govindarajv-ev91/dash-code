import { fetchAllOrderUploads } from './orderUploadDb'
import { fetchAllData } from './supabaseFetch'
import { clearEv91AllCache, fetchAllEv91MisData } from './ev91MisApi'

/** Complete reads are required before deciding that an onboarding ID is absent. */
export async function loadEv91FlPendingData({ force = false } = {}) {
  if (force) {
    clearEv91AllCache('client-mapping-history')
    clearEv91AllCache('rider-details')
  }
  const [orderRows, onboarding, mapping, details] = await Promise.all([
    fetchAllOrderUploads({ force }),
    fetchAllData('rider_onboarding', '*', 'id', { pageSize: 500, maxRetries: 2, throwOnError: true, untilEmpty: true }),
    fetchAllEv91MisData('client-mapping-history'),
    fetchAllEv91MisData('rider-details'),
  ])
  return { orderRows, onboardingRows: onboarding.data || [], mappingRows: mapping.data || [], riderDetails: details.data || [] }
}
