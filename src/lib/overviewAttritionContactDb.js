import { fetchAllData } from './supabaseFetch'
import { buildOverviewAttritionPhoneIndex, buildOverviewAttritionNameIndex } from './overviewAttritionContacts.js'

const CONTACT_TABLES = [
  ['rider_onboarding', 'id,rider_id_details,merge,rider_name,rider_mobile_number,updated_at,created_at'],
  ['fleet_data', 'id,rider_id,rider_name,rider_contact_number,date_record,updated_at,created_at'],
  ['new_fleet_data', 'id,rider_id,rider_name,rider_contact_number,date_record,updated_at,created_at'],
  ['rider_kyc', 'id,rider_id,rider_name,rider_mobile_number,updated_at,created_at'],
]

/** Read fresh, narrow contact rows only when Export Details is clicked. */
export async function fetchOverviewAttritionContactIndexes() {
  const [onboarding, fleet, newFleet, kyc] = await Promise.all(CONTACT_TABLES.map(([table, columns]) =>
    fetchAllData(table, columns, 'id', { pageSize: 1000, maxRetries: 2, throwOnError: true, untilEmpty: true })
  ))
  const sources = {
    onboardingRows: onboarding.data, fleetRows: fleet.data,
    newFleetRows: newFleet.data, kycRows: kyc.data,
  }
  return { phoneIndex: buildOverviewAttritionPhoneIndex(sources), nameIndex: buildOverviewAttritionNameIndex(sources) }
}
