/** Legacy fleet rows (original Supabase table). */
export const FLEET_LEGACY_TABLE = 'fleet_data'
export const FLEET_LEGACY_SOURCE = 'Database'

/** Former Google Sheet fleet rows — now stored in Supabase. */
export const FLEET_FORM_TABLE = 'new_fleet_data'
export const FLEET_FORM_SOURCE = 'new_fleet_data'
export const FLEET_FORM_SOURCE_LABEL = 'New Fleet Data'
export const FLEET_FORM_CACHE_KEY = 'new_fleet_data'

/**
 * Columns needed for dashboards, rider performance, deploy/return logic.
 * ~20 fields instead of 100+ — much smaller payloads per page.
 */
export const FLEET_SLIM_COLUMNS = [
  'id',
  'date_record',
  'vehicle_number',
  'vehicle_status',
  'rider_id',
  'rider_name',
  'rider_contact_number',
  'city_locations',
  'city',
  'client_name',
  'hub_location',
  'category',
  'month',
  'source_name',
  'source_name_vehicle_asset_details',
  'filled_by',
  'created_at',
  'bike_deployed_date_sd_refund_request',
  'bike_return_date_sd_refund_request',
].join(',')

export const FLEET_SLIM_PAGE_SIZE = 1000
export const FLEET_FULL_PAGE_SIZE = 250
