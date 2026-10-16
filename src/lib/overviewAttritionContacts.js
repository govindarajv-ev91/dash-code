import { parseFleetDate } from './fleetDeployReturnExport.js'

function riderKey(value) {
  let text = String(value ?? '').trim().toUpperCase()
  if (!text || /^(?:N\/?A|NULL|NONE|UNKNOWN|[-–—]+)$/.test(text)) return ''
  if (/^\d+\.0+$/.test(text)) text = text.split('.')[0]
  return text.replace(/[\s_-]+/g, '')
}

export function normalizeOverviewAttritionPhone(value) {
  const text = String(value ?? '').trim()
  if (!/^\+?[\d\s().-]+$/.test(text)) return ''
  let digits = text.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  return /^\d{10}$/.test(digits) && !/^0+$/.test(digits) ? digits : ''
}

function modifiedAt(row) {
  return Date.parse(row.updated_at) || Date.parse(row.created_at) || 0
}

function riderName(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return /^(?:N\/?A|NULL|NONE|UNKNOWN|NOT AVAILABLE|[-–—]+)$/i.test(text) ? '' : text
}

function addContact(index, ids, value, date, modified) {
  if (!value) return
  for (const id of ids) {
    const key = riderKey(id)
    if (!key) continue
    const previous = index.get(key)
    if (!previous || date > previous.date || (date === previous.date && modified > previous.modified)) {
      index.set(key, { value, date, modified })
    } else if (date === previous.date && modified === previous.modified && value !== previous.value) {
      // Conflicting contacts with no newer record cannot identify a safe winner.
      previous.value = ''
    }
  }
}

function buildContactIndex({ onboardingRows = [], fleetRows = [], newFleetRows = [], kycRows = [] }, selectValue) {
  const onboarding = new Map()
  for (const row of onboardingRows) {
    addContact(onboarding, [row.rider_id_details, String(row.merge || '').trim().replace(/^voice/i, '')],
      selectValue(row, 'onboarding'), modifiedAt(row), 0)
  }
  const fleet = new Map()
  for (const row of [...fleetRows, ...newFleetRows]) {
    addContact(fleet, [row.rider_id], selectValue(row, 'fleet'),
      parseFleetDate(row.date_record)?.getTime() || 0, modifiedAt(row))
  }
  const kyc = new Map()
  for (const row of kycRows) {
    addContact(kyc, [row.rider_id], selectValue(row, 'kyc'), modifiedAt(row), 0)
  }
  const values = new Map()
  // Resolve each field independently so a missing phone never hides a valid name.
  for (const source of [onboarding, fleet, kyc]) {
    for (const [key, contact] of source) {
      if (contact.value && !values.has(key)) values.set(key, contact.value)
    }
  }
  return values
}

/** Current contacts for export only; chart cohorts and activity remain unchanged. */
export function buildOverviewAttritionPhoneIndex(sources = {}) {
  return buildContactIndex(sources, (row, source) =>
    normalizeOverviewAttritionPhone(source === 'fleet' ? row.rider_contact_number : row.rider_mobile_number))
}

export function buildOverviewAttritionNameIndex(sources = {}) {
  return buildContactIndex(sources, (row) => riderName(row.rider_name))
}

export function lookupOverviewAttritionPhone(index, workerCode) {
  return index?.get(riderKey(workerCode)) || ''
}

export function lookupOverviewAttritionName(index, workerCode, fallback = '') {
  return index?.get(riderKey(workerCode)) || riderName(fallback)
}
