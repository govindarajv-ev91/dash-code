import { riderIdLookupKeys } from './riderPerformanceReport'

function pickText(...values) {
  for (const v of values) {
    const s = (v ?? '').toString().trim()
    if (s && s.toLowerCase() !== 'n/a') return s
  }
  return ''
}

/** Group key so "Zuha" and "zuha" count as one source. */
export function sourceNameGroupKey(value) {
  return (value ?? '').toString().trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Display one casing: first letter of each word uppercase. */
export function canonicalSourceName(value) {
  const trimmed = (value ?? '').toString().trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  if (lower === 'unknown' || isMissingSourceName(trimmed)) return trimmed
  return trimmed.replace(/(\S)(\S*)/g, (_, first, rest) => first.toUpperCase() + rest.toLowerCase())
}

function normalizePhoneDigits(value) {
  const digits = (value ?? '').toString().replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

/** True when EV91 / UI Source should be replaced from onboarding. */
export function isMissingSourceName(value) {
  const s = (value ?? '').toString().trim().toLowerCase()
  return (
    !s ||
    s === '-' ||
    s === '—' ||
    s === '–' ||
    s === 'n/a' ||
    s === 'na' ||
    s === 'null' ||
    s === 'none' ||
    s === 'unknown' ||
    s === 'not available' ||
    s === 'notapplicable'
  )
}

function addRiderKeys(keys, raw) {
  const text = pickText(raw)
  if (!text) return
  for (const alias of riderIdLookupKeys(text)) keys.add(alias)
  keys.add(text.toUpperCase())
  // merge fields like voiceFE10318673
  const embeddedFe = text.match(/FE\d{5,}/i)
  if (embeddedFe) {
    for (const alias of riderIdLookupKeys(embeddedFe[0])) keys.add(alias)
  }
}

/**
 * Index rider_onboarding → source_name by rider_id_details / rider_id / phone / merge.
 */
export function buildOnboardingSourceLookupIndex(onboardingRows = []) {
  const byRider = new Map()
  const byPhone = new Map()

  for (const row of onboardingRows || []) {
    const source = canonicalSourceName(pickText(row.source_name))
    if (!source || source === '-') continue

    const keys = new Set()
    addRiderKeys(keys, row.rider_id_details)
    addRiderKeys(keys, row.rider_id)
    addRiderKeys(keys, row.worker_code)
    addRiderKeys(keys, row.client_rider_id)
    addRiderKeys(keys, row.merge)
    addRiderKeys(keys, row.rider_name)

    for (const key of keys) {
      if (key && !byRider.has(key)) byRider.set(key, source)
    }

    const phone = normalizePhoneDigits(row.rider_mobile_number || row.mobile || row.phone)
    if (phone && !byPhone.has(phone)) byPhone.set(phone, source)
  }

  return { byRider, byPhone }
}

export function lookupOnboardingSource(index, { riderIds = [], phone = '' } = {}) {
  if (!index) return ''

  for (const riderId of riderIds) {
    if (!riderId) continue
    for (const alias of riderIdLookupKeys(riderId)) {
      const hit = index.byRider.get(alias)
      if (hit) return hit
    }
    const upper = String(riderId).trim().toUpperCase()
    if (upper && index.byRider.has(upper)) return index.byRider.get(upper)
  }

  const digits = normalizePhoneDigits(phone)
  if (digits && index.byPhone.has(digits)) return index.byPhone.get(digits)

  return ''
}

/** Fill blank assignment.source from rider_onboarding. */
export function fillAssignmentSourceFromOnboarding(assignments, onboardingRows) {
  if (!assignments?.length || !onboardingRows?.length) return assignments || []
  const index = buildOnboardingSourceLookupIndex(onboardingRows)
  if (!index.byRider.size && !index.byPhone.size) return assignments

  return assignments.map((a) => {
    if (!isMissingSourceName(a.source)) return a
    const source = lookupOnboardingSource(index, {
      riderIds: [a.clientRiderId, a.riderId, a.ev91RiderId, a.ID],
      phone: a.mobile || a.riderContact,
    })
    if (!source) return a
    return { ...a, source }
  })
}

/** Fill blank report row.Source from rider_onboarding (post-build safety net). */
export function fillPerformanceRowSourceFromOnboarding(rows, onboardingRows) {
  if (!rows?.length || !onboardingRows?.length) return rows || []
  const index = buildOnboardingSourceLookupIndex(onboardingRows)
  if (!index.byRider.size && !index.byPhone.size) return rows

  return rows.map((row) => {
    if (!isMissingSourceName(row.Source)) return row
    const source = lookupOnboardingSource(index, {
      riderIds: [row.ID, row['Client Rider ID'], row['EV91 ID']],
      phone: row['mobile no'],
    })
    if (!source) return row
    return { ...row, Source: source }
  })
}

/**
 * Fill blank EV91 Current Vehicle Status `source` from rider_onboarding.
 * Lookup: clientRiderId, ev91RiderId, riderContact phone.
 */
export function fillEv91CurrentStatusSourceFromOnboarding(rows, onboardingRows) {
  if (!rows?.length || !onboardingRows?.length) return rows || []
  const index = buildOnboardingSourceLookupIndex(onboardingRows)
  if (!index.byRider.size && !index.byPhone.size) return rows

  return rows.map((row) => {
    if (!isMissingSourceName(row.source)) return row
    const source = lookupOnboardingSource(index, {
      riderIds: [row.clientRiderId, row.clientId, row.ev91RiderId],
      phone: row.riderContact,
    })
    if (!source) return row
    return { ...row, source }
  })
}
