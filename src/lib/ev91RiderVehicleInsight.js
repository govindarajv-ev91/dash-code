import {
  buildMergedDeployReturnReport,
  applyEv91CurrentStatusToDeployReturn,
  vehiclePartitionKey,
} from './fleetDeployReturnExport'
import { EV91_WEBAPP_CUTOVER_DATE, EV91_FLEET_DATA_UNTIL_DATE, fetchAllEv91MisData } from './ev91MisApi'
import { fetchEv91OverallStatusAll, fetchEv91CurrentStatusAll } from './ev91EvLookup'
import { fetchDeployReturnFleetRows } from './supabaseFetch'
import {
  fetchEv91ClientMappingAll,
  buildEv91PublicRiderIndex,
  lookupEv91PublicRiderId,
} from './ev91OnboardingPending'
import { riderIdLookupKeys } from './riderPerformanceReport'

/** Columns for Rider & Vehicle Insight table / Excel export. */
export const RIDER_VEHICLE_INSIGHT_COLUMNS = [
  { key: 'dataSource', label: 'Source' },
  { key: 'publicRiderId', label: 'EV91 Rider ID' },
  { key: 'clientRiderId', label: 'Client Rider ID' },
  { key: 'riderName', label: 'Rider Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'isActive', label: 'Active' },
  { key: 'kycStatus', label: 'KYC' },
  { key: 'city', label: 'City' },
  { key: 'clientName', label: 'Client' },
  { key: 'vehicleNumber', label: 'Vehicle' },
  { key: 'vehicleStatus', label: 'Status' },
  { key: 'deployDate', label: 'Deployee Date' },
  { key: 'returnDate', label: 'Return Date' },
  { key: 'daysWithRider', label: 'Days with Rider' },
  { key: 'currentStatus', label: 'Current Status' },
  { key: 'needEvRental', label: 'Need EV Rental' },
  { key: 'assignmentDate', label: 'Assigned Date' },
  { key: 'onboardedAt', label: 'Onboarded' },
  { key: 'referredBy', label: 'Source / Referred By' },
  { key: 'hub', label: 'Hub' },
  { key: 'category', label: 'Category' },
]

function normalizePhone(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function pickNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === 'boolean') return v
    const s = (v ?? '').toString().trim()
    if (s) return s
  }
  return ''
}

function formatBool(value) {
  if (value === true || value === 'true' || value === 'Yes') return 'Yes'
  if (value === false || value === 'false' || value === 'No') return 'No'
  return value == null || value === '' ? '' : String(value)
}

/** Identity keys used to merge Fleet cycles ↔ EV91 rider-details. */
export function riderInsightIdentityKeys({
  publicRiderId = '',
  clientRiderId = '',
  phone = '',
} = {}) {
  const keys = new Set()
  const pub = (publicRiderId || '').toString().trim()
  const client = (clientRiderId || '').toString().trim()
  const ph = normalizePhone(phone)

  if (pub) {
    keys.add(`ev91:${pub.toUpperCase()}`)
    keys.add(pub.toUpperCase())
  }
  if (client) {
    keys.add(`client:${client.toUpperCase()}`)
    for (const alias of riderIdLookupKeys(client)) {
      keys.add(`client:${alias}`)
    }
  }
  if (ph.length === 10) keys.add(`phone:${ph}`)
  return [...keys]
}

function emptyInsightRow() {
  return {
    dataSource: '',
    publicRiderId: '',
    clientRiderId: '',
    riderName: '',
    phone: '',
    isActive: '',
    kycStatus: '',
    city: '',
    clientName: '',
    vehicleNumber: '',
    vehicleStatus: '',
    deployDate: '',
    returnDate: '',
    daysWithRider: '',
    currentStatus: '',
    needEvRental: '',
    assignmentDate: '',
    onboardedAt: '',
    referredBy: '',
    hub: '',
    category: '',
    _sortDeploy: 0,
    _matchKeys: [],
  }
}

function upsertBucket(buckets, byKey, seed) {
  const keys = riderInsightIdentityKeys(seed)
  if (!keys.length) return null

  let bucket = null
  for (const k of keys) {
    if (byKey.has(k)) {
      bucket = byKey.get(k)
      break
    }
  }
  if (!bucket) {
    bucket = emptyInsightRow()
    buckets.push(bucket)
  }
  for (const k of keys) byKey.set(k, bucket)
  bucket._matchKeys = [...new Set([...(bucket._matchKeys || []), ...keys])]
  return bucket
}

function mergeProfileIntoBucket(bucket, profile) {
  if (!bucket || !profile) return
  bucket.publicRiderId = pickNonEmpty(bucket.publicRiderId, profile.publicRiderId)
  bucket.clientRiderId = pickNonEmpty(bucket.clientRiderId, profile.clientRiderId)
  bucket.riderName = pickNonEmpty(bucket.riderName, profile.riderName)
  bucket.phone = pickNonEmpty(bucket.phone, profile.phone)
  bucket.city = pickNonEmpty(bucket.city, profile.city)
  bucket.clientName = pickNonEmpty(bucket.clientName, profile.clientName)
  bucket.kycStatus = pickNonEmpty(bucket.kycStatus, profile.kycStatus)
  bucket.referredBy = pickNonEmpty(bucket.referredBy, profile.referredBy)
  bucket.assignmentDate = pickNonEmpty(bucket.assignmentDate, profile.assignmentDate)
  bucket.onboardedAt = pickNonEmpty(bucket.onboardedAt, profile.onboardedAt)
  if (bucket.isActive === '' || bucket.isActive == null) {
    bucket.isActive = formatBool(profile.isActive)
  }
  if (bucket.needEvRental === '' || bucket.needEvRental == null) {
    bucket.needEvRental = formatBool(profile.needEvRental)
  }
  if (!bucket.vehicleNumber && profile.assignedVehicleId) {
    const assigned = String(profile.assignedVehicleId).trim()
    if (assigned && !/not\s*assign/i.test(assigned)) {
      bucket.vehicleNumber = assigned
    }
  }
  const src = pickNonEmpty(bucket.dataSource)
  if (!src) bucket.dataSource = 'EV91 Rider Details'
  else if (src === 'Fleet' || src === 'EV91 API' || src === 'Cutover') {
    /* keep cycle source; mark merged below */
  }
}

function mergeCycleIntoBucket(bucket, cycle) {
  if (!bucket || !cycle) return
  const deployTs = Date.parse(cycle.Deployee_date || '') || 0
  const prevTs = bucket._sortDeploy || 0
  // Keep the latest deploy cycle for the unique rider.
  if (deployTs < prevTs) {
    bucket.publicRiderId = pickNonEmpty(bucket.publicRiderId, cycle.EV91_PublicRiderId)
    bucket.clientRiderId = pickNonEmpty(bucket.clientRiderId, cycle.Rider_ID)
    bucket.riderName = pickNonEmpty(bucket.riderName, cycle.Rider_Name)
    bucket.phone = pickNonEmpty(bucket.phone, cycle.Rider_Contact_Number)
    bucket.city = pickNonEmpty(bucket.city, cycle.city_name)
    bucket.clientName = pickNonEmpty(bucket.clientName, cycle.CLIENT_NAME)
    return
  }

  bucket._sortDeploy = deployTs
  bucket.publicRiderId = pickNonEmpty(cycle.EV91_PublicRiderId, bucket.publicRiderId)
  bucket.clientRiderId = pickNonEmpty(cycle.Rider_ID, bucket.clientRiderId)
  bucket.riderName = pickNonEmpty(cycle.Rider_Name, bucket.riderName)
  bucket.phone = pickNonEmpty(cycle.Rider_Contact_Number, bucket.phone)
  bucket.city = pickNonEmpty(cycle.city_name, bucket.city)
  bucket.clientName = pickNonEmpty(cycle.CLIENT_NAME, bucket.clientName)
  bucket.vehicleNumber = pickNonEmpty(cycle.Vehiclenumber, bucket.vehicleNumber)
  bucket.vehicleStatus = pickNonEmpty(cycle.Vehicle_Status, bucket.vehicleStatus)
  bucket.deployDate = pickNonEmpty(cycle.Deployee_date, bucket.deployDate)
  bucket.returnDate = pickNonEmpty(cycle.Return_date, bucket.returnDate)
  bucket.daysWithRider =
    cycle.number_of_days_with_rider != null && cycle.number_of_days_with_rider !== ''
      ? cycle.number_of_days_with_rider
      : bucket.daysWithRider
  bucket.currentStatus = pickNonEmpty(cycle.vehicle_current_status, bucket.currentStatus)
  bucket.hub = pickNonEmpty(cycle.Hub_Location, bucket.hub)
  bucket.category = pickNonEmpty(cycle.Category, bucket.category)

  const cycleSrc = pickNonEmpty(cycle.Data_Source, 'Fleet')
  if (!bucket.dataSource || bucket.dataSource === 'EV91 Rider Details') {
    bucket.dataSource = cycleSrc
  } else if (bucket.dataSource !== cycleSrc && bucket.dataSource !== 'Merged') {
    bucket.dataSource = 'Merged'
  }
}

function enrichPublicRiderIds(rows, publicRiderIndex) {
  if (!rows?.length) return rows || []
  return rows.map((r) => {
    const existing = (r.EV91_PublicRiderId || '').toString().trim()
    if (existing) return r
    const mapped = lookupEv91PublicRiderId(publicRiderIndex, r.Rider_ID, r.Rider_Contact_Number)
    if (!mapped) return r
    return { ...r, EV91_PublicRiderId: mapped }
  })
}

/**
 * Build unique-rider insight rows by merging:
 * - EV91 rider-details API profiles
 * - Fleet + EV91 Overall deploy/return cycles (latest cycle per rider)
 * - EV91 Current Status (open deploy status)
 */
export function buildRiderVehicleInsightRows({
  riderDetails = [],
  deployCycles = [],
} = {}) {
  const buckets = []
  const byKey = new Map()

  for (const row of riderDetails || []) {
    const profile = {
      publicRiderId: (row.publicRiderID || row.publicRiderId || '').toString().trim(),
      clientRiderId: (row.clientRiderId ?? row.clientId ?? '').toString().trim(),
      riderName: (row.name || '').toString().trim(),
      phone: normalizePhone(row.phone) || (row.phone || '').toString().trim(),
      city: (row.city || '').toString().trim(),
      clientName: (row.clientName || '').toString().trim(),
      kycStatus: (row.kycStatus || '').toString().trim(),
      isActive: row.isActive,
      needEvRental: row.needEvRental,
      assignedVehicleId: (row.assignedVehicleId || '').toString().trim(),
      assignmentDate: row.assignmentDate,
      onboardedAt: row.createAt,
      referredBy: (row.referredById || '').toString().trim(),
    }
    const bucket = upsertBucket(buckets, byKey, profile)
    if (bucket) mergeProfileIntoBucket(bucket, profile)
  }

  for (const cycle of deployCycles || []) {
    const seed = {
      publicRiderId: (cycle.EV91_PublicRiderId || '').toString().trim(),
      clientRiderId: (cycle.Rider_ID || '').toString().trim(),
      phone: cycle.Rider_Contact_Number,
    }
    const bucket = upsertBucket(buckets, byKey, seed)
    if (bucket) mergeCycleIntoBucket(bucket, cycle)
  }

  // Finalize source labels when profile + cycle both contributed.
  for (const row of buckets) {
    const hasCycle = Boolean(row.deployDate || row.vehicleNumber)
    const hasProfile = Boolean(row.kycStatus || row.onboardedAt || row.isActive !== '')
    if (hasCycle && hasProfile && row.dataSource !== 'Merged') {
      if (row.dataSource === 'Fleet' || row.dataSource === 'EV91 API' || row.dataSource === 'Cutover') {
        row.dataSource = `${row.dataSource}+Details`
      }
    }
    if (!row.currentStatus && row.vehicleStatus) {
      const s = String(row.vehicleStatus).toLowerCase()
      if (s.includes('deploy')) row.currentStatus = 'Deployed'
      else if (s.includes('return')) row.currentStatus = 'Returned'
    }
    delete row._matchKeys
  }

  return buckets.sort((a, b) => {
    const da = b._sortDeploy - a._sortDeploy
    if (da) return da
    return String(a.riderName || '').localeCompare(String(b.riderName || ''))
  })
}

/**
 * Load all sources and return unique-rider insight rows.
 */
export async function fetchRiderVehicleInsightData({ force = false } = {}) {
  const [detailsRes, overallRes, currentRes, mappingRes, fleetRows] = await Promise.all([
    fetchAllEv91MisData('rider-details', {}).catch((err) => {
      console.warn('[insight] rider-details failed:', err)
      return { data: [] }
    }),
    fetchEv91OverallStatusAll({ force }),
    fetchEv91CurrentStatusAll({ force }).catch(() => ({ data: [] })),
    fetchEv91ClientMappingAll().catch(() => ({ data: [] })),
    fetchDeployReturnFleetRows().catch((err) => {
      console.warn('[insight] fleet DR failed:', err)
      return []
    }),
  ])

  const riderDetails = detailsRes?.data || []
  const overallRows = overallRes?.data || []
  const currentRows = currentRes?.data || []
  const mappingRows = mappingRes?.data || []
  const fleet = Array.isArray(fleetRows) ? fleetRows : []

  const publicRiderIndex = buildEv91PublicRiderIndex(overallRows, mappingRows)
  const baseCycles = buildMergedDeployReturnReport(fleet, overallRows, {
    maxRecentDeployReturnPerVehicle: 6,
    cutoverDate: EV91_WEBAPP_CUTOVER_DATE,
    fleetUntilDate: EV91_FLEET_DATA_UNTIL_DATE,
    mode: 'all',
  })
  const withCurrent = applyEv91CurrentStatusToDeployReturn(baseCycles, currentRows)
  const deployCycles = enrichPublicRiderIds(withCurrent, publicRiderIndex)

  const rows = buildRiderVehicleInsightRows({ riderDetails, deployCycles })

  return {
    rows,
    meta: {
      riderDetailsCount: riderDetails.length,
      deployCycleCount: deployCycles.length,
      fleetEventCount: fleet.length,
      overallEventCount: overallRows.length,
      uniqueRiders: rows.length,
      uniqueVehicles: new Set(
        rows.map((r) => vehiclePartitionKey(r.vehicleNumber)).filter(Boolean)
      ).size,
    },
  }
}

export function filterRiderVehicleInsightRows(
  rows,
  { search = '', city = '', status = '', source = '' } = {}
) {
  const q = search.trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (city && (r.city || '') !== city) return false
    if (status) {
      const cur = (r.currentStatus || r.vehicleStatus || '').toString()
      if (cur.toLowerCase() !== status.toLowerCase()) return false
    }
    if (source) {
      const src = (r.dataSource || '').toString()
      if (source === 'Merged') {
        if (!/merged|\+details/i.test(src)) return false
      } else if (!src.toLowerCase().includes(source.toLowerCase())) {
        return false
      }
    }
    if (!q) return true
    return (
      (r.publicRiderId || '').toLowerCase().includes(q) ||
      (r.clientRiderId || '').toLowerCase().includes(q) ||
      (r.riderName || '').toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q) ||
      (r.vehicleNumber || '').toLowerCase().includes(q) ||
      (r.clientName || '').toLowerCase().includes(q) ||
      (r.city || '').toLowerCase().includes(q) ||
      (r.dataSource || '').toLowerCase().includes(q)
    )
  })
}

export function summarizeRiderVehicleInsight(rows = []) {
  let deployed = 0
  let returned = 0
  let withVehicle = 0
  let withProfile = 0
  const cities = new Set()
  for (const r of rows) {
    const cur = String(r.currentStatus || r.vehicleStatus || '').toLowerCase()
    if (cur.includes('deploy')) deployed++
    else if (cur.includes('return')) returned++
    if (r.vehicleNumber) withVehicle++
    if (r.kycStatus || r.onboardedAt) withProfile++
    if (r.city) cities.add(r.city)
  }
  return {
    total: rows.length,
    deployed,
    returned,
    withVehicle,
    withProfile,
    cities: cities.size,
  }
}
