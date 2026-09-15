import { normalizeSummaryCity } from './citySummaryAliases'
import { vehiclePartitionKey } from './fleetDeployReturnExport'

export function normalizeOperationalStatusLabel(value) {
  return String(value ?? '').trim()
}

/** RTD = Ready To Deploy — EV91 Operational Status "Available". */
export function isOperationalAvailable(value) {
  const s = normalizeOperationalStatusLabel(value).toLowerCase()
  if (!s) return false
  if (s.includes('not available') || s.includes('unavailable')) return false
  if (s === 'available') return true

  // Exclude variants that explicitly say "without" (e.g. "Available - Without(Battery & Charger)")
  // but keep other "Available …" labels (if any) that don't indicate missing equipment.
  if (s.startsWith('available')) {
    const rest = s.slice('available'.length).trim()
    if (!rest) return true
    // If remainder starts with punctuation then the word 'without', exclude it.
    if (/^[-:\s(]*without\b/.test(rest)) return false
    // Also exclude if 'without' appears anywhere in the remainder as a word.
    if (/\bwithout\b/.test(rest)) return false
    return true
  }
  return false
}

function classifyOperationalBucket(label) {
  const s = label.toLowerCase()
  if (isOperationalAvailable(label)) return 'available'
  if (s.includes('team use')) return 'teamUse'
  if (s.includes('assigned')) return 'assigned'
  if (s.includes('maintenance') || s.includes('repair') || s.includes('warranty') || s.includes('iot')) {
    return 'maintenance'
  }
  if (s.includes('return')) return 'returned'
  return 'other'
}

/**
 * City-wise counts from EV91 Current Status (operationalStatus field).
 * @returns {Map<string, { city, available, assigned, teamUse, maintenance, returned, other, total, byStatus: Map }>}
 */
export function buildCityOperationalStatusCounts(currentStatusRows = []) {
  const byCity = new Map()

  // Deduplicate by vehicle across rows to avoid inflated counts when the
  // current-status feed contains multiple entries for the same vehicle.
  const seenVehicles = new Set()

  for (const row of currentStatusRows || []) {
    const city = normalizeSummaryCity(row.city)
    if (!city) continue

    // Try to obtain a normalized vehicle key; if present, use it to
    // deduplicate across rows. If no vehicle key is available, fall
    // back to counting the raw row (can't dedupe reliably).
    const vehicleRaw = row.vehicleNumber || row.Vehiclenumber || row.vehicle_number || row.vehicle || ''
    const vKey = vehiclePartitionKey(vehicleRaw || '')
    if (vKey) {
      if (seenVehicles.has(vKey)) continue
      seenVehicles.add(vKey)
    }

    const label = normalizeOperationalStatusLabel(
      row.operationalStatus ?? row.operational ?? row.operational_status
    )
    const bucketKey = classifyOperationalBucket(label)

    if (!byCity.has(city)) {
      byCity.set(city, {
        city,
        available: 0,
        assigned: 0,
        teamUse: 0,
        maintenance: 0,
        returned: 0,
        other: 0,
        total: 0,
        byStatus: new Map(),
      })
    }

    const bucket = byCity.get(city)
    bucket.total++
    bucket[bucketKey]++
    if (label) {
      bucket.byStatus.set(label, (bucket.byStatus.get(label) || 0) + 1)
    }
  }

  return byCity
}

export function cityOperationalCountsToSortedRows(byCity) {
  return [...(byCity || new Map()).values()].sort((a, b) =>
    String(a.city || '').localeCompare(String(b.city || ''))
  )
}

/** RTD (Available) count for one city or sum across all cities. */
export function getCityRtdAvailableCount(byCity, city = 'All') {
  if (!byCity?.size) return 0
  if (city && city !== 'All') {
    return byCity.get(city)?.available ?? 0
  }
  let sum = 0
  for (const bucket of byCity.values()) sum += bucket.available || 0
  return sum
}

/** Vehicles with Operational Status Available (optionally filtered by city). */
export function filterOperationalAvailableRows(currentStatusRows = [], city = 'All') {
  return (currentStatusRows || []).filter((row) => {
    const label = normalizeOperationalStatusLabel(
      row.operationalStatus ?? row.operational ?? row.operational_status
    )
    if (!isOperationalAvailable(label)) return false
    if (city && city !== 'All') {
      return normalizeSummaryCity(row.city) === city
    }
    return true
  })
}
