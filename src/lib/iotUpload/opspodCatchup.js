import { toText, vehicleMatchKey } from './uploadParseUtils.js'

function vehicleDayKey(row) {
  // Same canonical-or-raw identifier normalization used by save_iot_upload.
  return `${row.run_date}|${vehicleMatchKey(toText(row.vehicle_number) || row.raw_vehicle_id)}`
}

/** Match each completed vehicle/day independently; a provider-wide latest date can hide gaps. */
export function filterOpspodCatchupRows(rows, existingRows) {
  const existing = new Set((existingRows || []).map(vehicleDayKey))
  const pending = (rows || []).filter((row) => !existing.has(vehicleDayKey(row)))
  return { rows: pending, alreadySaved: (rows || []).length - pending.length }
}
