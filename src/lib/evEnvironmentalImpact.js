import { vehiclePartitionKey } from './fleetDeployReturnExport'
import {
  buildVehicleMasterCityIndex,
  iotRowDistanceKm,
  normalizeIotRunDate,
} from './iotDataReport'

/**
 * Assumptions for petrol 2W / last-mile delivery fleet vs EV km from IoT.
 * Shown in the UI so users understand the math.
 */
export const ENV_IMPACT_DEFAULTS = {
  ICE_KM_PER_LITER: 45,
  CO2_KG_PER_LITER_PETROL: 2.31,
  CO2_KG_PER_TREE_PER_YEAR: 21,
}

export const ENV_IMPACT_FORMULAS = [
  {
    title: 'Petrol saved (liters)',
    formula: 'EV running km ÷ Petrol bike mileage (45 km/L)',
    example: '450 km → 450 ÷ 45 = 10 L petrol not burnt',
  },
  {
    title: 'CO₂ saved (kg)',
    formula: 'Petrol saved (L) × 2.31 kg CO₂ per liter',
    example: '10 L → 10 × 2.31 = 23.1 kg CO₂ avoided',
  },
  {
    title: 'Trees equivalent',
    formula: 'CO₂ saved (kg) ÷ 21 kg CO₂ absorbed per tree per year',
    example: '23.1 kg → 23.1 ÷ 21 ≈ 1.1 tree-years of absorption',
  },
]

/** Convert EV IoT km into petrol, CO₂, and tree equivalents. */
export function kmToEnvironmentalImpact(km, defaults = ENV_IMPACT_DEFAULTS) {
  const distanceKm = Math.max(0, Number(km) || 0)
  const petrolLiters = distanceKm / defaults.ICE_KM_PER_LITER
  const co2Kg = petrolLiters * defaults.CO2_KG_PER_LITER_PETROL
  const treesEquivalent = defaults.CO2_KG_PER_TREE_PER_YEAR
    ? co2Kg / defaults.CO2_KG_PER_TREE_PER_YEAR
    : 0

  return {
    distanceKm: round2(distanceKm),
    petrolLiters: round2(petrolLiters),
    co2Kg: round2(co2Kg),
    treesEquivalent: round2(treesEquivalent),
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/** One row per vehicle + run_date with city from Vehicle Inventory. */
export function buildEnvironmentalDailyRows(iotRows, inventoryRows = []) {
  const cityIndex = buildVehicleMasterCityIndex(inventoryRows)
  const rows = []

  for (const row of iotRows || []) {
    const vehicleNumber = (row.vehicle_number || row.raw_vehicle_id || '').toString().trim()
    const vehicleKey = vehiclePartitionKey(vehicleNumber)
    const runDate = normalizeIotRunDate(row.run_date ?? row.record_date)
    if (!vehicleKey || !runDate) continue

    const impact = kmToEnvironmentalImpact(iotRowDistanceKm(row))
    rows.push({
      rowKey: `${vehicleKey}|${runDate}`,
      runDate,
      vehicleNumber,
      city: cityIndex.get(vehicleKey) || '—',
      ...impact,
    })
  }

  return rows.sort(
    (a, b) =>
      b.runDate.localeCompare(a.runDate) ||
      b.distanceKm - a.distanceKm ||
      a.vehicleNumber.localeCompare(b.vehicleNumber)
  )
}

/** Roll daily rows up to one row per vehicle. */
export function aggregateEnvironmentalByVehicle(dailyRows) {
  const byVehicle = new Map()

  for (const row of dailyRows || []) {
    const key = vehiclePartitionKey(row.vehicleNumber)
    if (!key) continue

    const prev = byVehicle.get(key)
    if (!prev) {
      byVehicle.set(key, {
        vehicleNumber: row.vehicleNumber,
        city: row.city,
        activeDays: 1,
        distanceKm: row.distanceKm,
        petrolLiters: row.petrolLiters,
        co2Kg: row.co2Kg,
        treesEquivalent: row.treesEquivalent,
      })
      continue
    }

    prev.activeDays += 1
    prev.distanceKm = round2(prev.distanceKm + row.distanceKm)
    prev.petrolLiters = round2(prev.petrolLiters + row.petrolLiters)
    prev.co2Kg = round2(prev.co2Kg + row.co2Kg)
    prev.treesEquivalent = round2(prev.treesEquivalent + row.treesEquivalent)
    if (prev.city === '—' && row.city !== '—') prev.city = row.city
  }

  return [...byVehicle.values()].sort(
    (a, b) => b.co2Kg - a.co2Kg || b.distanceKm - a.distanceKm
  )
}

export function summarizeEnvironmentalImpact(rows) {
  let distanceKm = 0
  let petrolLiters = 0
  let co2Kg = 0
  let treesEquivalent = 0
  const vehicles = new Set()

  for (const row of rows || []) {
    distanceKm += row.distanceKm || 0
    petrolLiters += row.petrolLiters || 0
    co2Kg += row.co2Kg || 0
    treesEquivalent += row.treesEquivalent || 0
    if (row.vehicleNumber) vehicles.add(row.vehicleNumber)
  }

  return {
    rows: rows?.length || 0,
    vehicles: vehicles.size,
    distanceKm: round2(distanceKm),
    petrolLiters: round2(petrolLiters),
    co2Kg: round2(co2Kg),
    treesEquivalent: round2(treesEquivalent),
  }
}
