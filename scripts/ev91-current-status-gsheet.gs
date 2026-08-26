/**
 * EV91 Current Vehicle Status (Deployed only) → Google Sheets
 * + last 4 days vehicle KM from Supabase iot_data (D-1 … D-4)
 *
 * Live app: https://main.d2y6lleakorn3s.amplifyapp.com/
 *
 * Setup:
 * 1. Paste into Apps Script on your main Google Sheet, save
 * 2. Run importEv91CurrentStatus (writes to sheet "E91DB Data"; creates it if missing)
 * 3. Triggers → every 5 hours → importEv91CurrentStatus
 *
 * Source: when EV91 source is "-" / blank, fill from rider_onboarding.source_name
 * KM: D-1 = yesterday … D-4 = 4 days ago (vehicle total_distance from iot_data)
 */

var CONFIG = {
  EV91_BASE: 'https://main.d2y6lleakorn3s.amplifyapp.com/api/ev91/current-status',
  EV91_BASE_FALLBACK:
    'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/current-status',
  EV91_API_KEY: 'ev91-mis-public-2026',
  // Same as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (publishable anon key)
  SUPABASE_URL: 'https://arnxvnkednpzyzyfculx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH',
  TARGET_SHEET_NAME: 'E91DB Data',
}

/** Fixed columns (KM headers are added dynamically with dates). */
var BASE_COLUMNS = [
  'City',
  'Vehicle No.',
  'EV91 Rider ID',
  'Client Rider ID',
  'Rider Name',
  'Contact',
  'Status',
  'Operational',
  'Client',
  'Aging',
  'Last Status',
  'Source',
]

function getSupabaseConfig_() {
  var props = PropertiesService.getScriptProperties()
  return {
    url: String(props.getProperty('SUPABASE_URL') || CONFIG.SUPABASE_URL || '').trim(),
    key: String(props.getProperty('SUPABASE_ANON_KEY') || CONFIG.SUPABASE_ANON_KEY || '').trim(),
  }
}

/**
 * D-1 = yesterday, D-2 = 2 days ago, … D-4 = 4 days ago (Asia/Kolkata calendar).
 * Returns [{ offset: 1, dateKey: 'yyyy-MM-dd', header: 'D-1 (26-Aug)' }, ...]
 */
function buildLast4DayMeta_() {
  var tz = 'Asia/Kolkata'
  var now = new Date()
  var out = []
  for (var d = 1; d <= 4; d++) {
    var day = new Date(now.getTime() - d * 24 * 60 * 60 * 1000)
    var dateKey = Utilities.formatDate(day, tz, 'yyyy-MM-dd')
    var label = Utilities.formatDate(day, tz, 'dd-MMM')
    out.push({
      offset: d,
      dateKey: dateKey,
      header: 'D-' + d + ' (' + label + ')',
    })
  }
  return out
}

function importEv91CurrentStatus() {
  var dayMeta = buildLast4DayMeta_()
  var columns = BASE_COLUMNS.concat(
    dayMeta.map(function (m) {
      return m.header
    })
  )

  var rows = fetchDeployedCurrentStatus_()
  var sourceIndex = buildOnboardingSourceIndex_()
  var beforeMissing = 0
  for (var i = 0; i < rows.length; i++) {
    if (isMissingSource_(rows[i].source)) beforeMissing++
  }
  rows = fillMissingSources_(rows, sourceIndex)
  var afterMissing = 0
  for (var j = 0; j < rows.length; j++) {
    if (isMissingSource_(rows[j].source)) afterMissing++
  }

  var kmIndex = buildVehicleKmIndex_(dayMeta)

  var values = [columns]
  for (var r = 0; r < rows.length; r++) {
    values.push(rowToValues_(rows[r], dayMeta, kmIndex))
  }

  var sheet = getTargetSheet_()
  sheet.clearContents()
  sheet.getRange(1, 1, values.length, columns.length).setValues(values)
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold')
  sheet.setFrozenRows(1)

  Logger.log(
    'Deployed rows=' +
      rows.length +
      ' · KM dates=' +
      dayMeta
        .map(function (m) {
          return m.header
        })
        .join(', ') +
      ' · IoT vehicle-days=' +
      Object.keys(kmIndex).length +
      ' · Source missing before=' +
      beforeMissing +
      ' after=' +
      afterMissing +
      ' filled=' +
      (beforeMissing - afterMissing)
  )
}

function fetchDeployedCurrentStatus_() {
  var all = []
  var offset = 0
  var limit = 500
  var baseUrl = CONFIG.EV91_BASE
  for (var page = 0; page < 50; page++) {
    var url = baseUrl + '?limit=' + limit + '&offset=' + offset + '&status=Deployed'
    var body
    try {
      body = fetchJson_(url, {
        Accept: 'application/json',
        'x-api-key': CONFIG.EV91_API_KEY,
      })
    } catch (err) {
      if (page === 0 && CONFIG.EV91_BASE_FALLBACK) {
        Logger.log('Amplify proxy failed, using upstream: ' + err.message)
        baseUrl = CONFIG.EV91_BASE_FALLBACK
        url = baseUrl + '?limit=' + limit + '&offset=' + offset + '&status=Deployed'
        body = fetchJson_(url, {
          Accept: 'application/json',
          'x-api-key': CONFIG.EV91_API_KEY,
        })
      } else {
        throw err
      }
    }
    var batch = body.data || []
    for (var i = 0; i < batch.length; i++) {
      // Do not treat "Yet not deployed" / "Not deployed" as Deployed
      if (isStrictDeployedStatus_(batch[i].currentStatus)) all.push(batch[i])
    }
    offset += batch.length
    if (!batch.length || !(body.pagination && body.pagination.hasMore)) break
  }
  return all
}

/** True only for real Deployed / on-road (not "Yet not deployed"). */
function isStrictDeployedStatus_(status) {
  var s = String(status || '')
    .trim()
    .toLowerCase()
  if (!s) return false
  if (
    s.indexOf('yet') !== -1 ||
    s.indexOf('not yet') !== -1 ||
    (s.indexOf('not') !== -1 && s.indexOf('deploy') !== -1) ||
    s.indexOf('pending') !== -1 ||
    s.indexOf('return') !== -1
  ) {
    return false
  }
  return s.indexOf('deploy') !== -1 || s.indexOf('on road') !== -1 || s.indexOf('on-road') !== -1
}

/**
 * Load iot_data KM for D-1…D-4 into map:
 *   vehicleKey|yyyy-MM-dd → total_distance (number)
 */
function buildVehicleKmIndex_(dayMeta) {
  var index = {}
  var cfg = getSupabaseConfig_()
  if (!cfg.url || !cfg.key) {
    Logger.log('Skip IoT KM: Supabase URL/key missing')
    return index
  }

  var fromKey = dayMeta[dayMeta.length - 1].dateKey // D-4 (oldest)
  var toKey = dayMeta[0].dateKey // D-1 (newest)

  var select = 'id,vehicle_number,run_date,total_distance,raw_vehicle_id'
  var base =
    String(cfg.url).replace(/\/$/, '') +
    '/rest/v1/iot_data?select=' +
    encodeURIComponent(select) +
    '&run_date=gte.' +
    encodeURIComponent(fromKey) +
    '&run_date=lte.' +
    encodeURIComponent(toKey) +
    '&order=id.asc'

  var lastId = 0
  var pageSize = 1000
  var total = 0
  for (var p = 0; p < 200; p++) {
    var url = base + '&limit=' + pageSize
    if (lastId) url += '&id=gt.' + lastId
    var batch = fetchJsonArray_(url, {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      Accept: 'application/json',
    })
    if (!batch.length) break
    for (var i = 0; i < batch.length; i++) {
      var row = batch[i]
      var vKey = vehicleKey_(row.vehicle_number || row.raw_vehicle_id)
      var dateKey = normalizeRunDate_(row.run_date)
      var km = Number(row.total_distance)
      if (!vKey || !dateKey || !isFinite(km)) continue
      var mapKey = vKey + '|' + dateKey
      // If multiple rows same vehicle+day, keep max KM
      if (index[mapKey] == null || km > index[mapKey]) index[mapKey] = km
      if (row.id != null) lastId = row.id
    }
    total += batch.length
    if (batch.length < pageSize) break
  }
  Logger.log('Loaded iot_data rows=' + total + ' for ' + fromKey + ' → ' + toKey)
  return index
}

function lookupVehicleKm_(kmIndex, vehicleNumber, dateKey) {
  if (!kmIndex || !dateKey) return ''
  var key = vehicleKey_(vehicleNumber) + '|' + dateKey
  if (kmIndex[key] == null) return ''
  var n = Number(kmIndex[key])
  if (!isFinite(n)) return ''
  // Round to 2 decimals for sheet readability
  return Math.round(n * 100) / 100
}

/** Normalize plate for matching (TN10CC4547 / tn-10-cc-4547 → TN10CC4547). */
function vehicleKey_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]+/g, '')
}

function normalizeRunDate_(value) {
  if (value == null || value === '') return ''
  var s = String(value).trim()
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  var d = new Date(s)
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd')
  }
  return ''
}

function buildOnboardingSourceIndex_() {
  var byRider = {}
  var byPhone = {}
  var cfg = getSupabaseConfig_()
  if (!cfg.url || !cfg.key) {
    throw new Error(
      'Supabase URL / anon key missing in CONFIG.SUPABASE_URL and CONFIG.SUPABASE_ANON_KEY.'
    )
  }

  var select =
    'id,rider_id_details,source_name,rider_mobile_number,merge,rider_name,email_address'
  var base =
    String(cfg.url).replace(/\/$/, '') +
    '/rest/v1/rider_onboarding?select=' +
    encodeURIComponent(select) +
    '&order=id.asc'

  var lastId = 0
  var pageSize = 1000
  var total = 0
  for (var p = 0; p < 200; p++) {
    var url = base + '&limit=' + pageSize
    if (lastId) url += '&id=gt.' + lastId
    var batch = fetchJsonArray_(url, {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      Accept: 'application/json',
      Prefer: 'count=exact',
    })
    if (!batch.length) break
    for (var i = 0; i < batch.length; i++) {
      var row = batch[i]
      var src = String(row.source_name || '').trim()
      if (!src || isMissingSource_(src)) continue
      addAllRiderKeys_(byRider, row.rider_id_details, src)
      addAllRiderKeys_(byRider, row.merge, src)
      addAllRiderKeys_(byRider, row.rider_name, src)
      var phone = normalizePhone_(row.rider_mobile_number)
      if (phone && !byPhone[phone]) byPhone[phone] = src
      var detailsPhone = normalizePhone_(row.rider_id_details)
      if (detailsPhone && !byPhone[detailsPhone]) byPhone[detailsPhone] = src
      if (row.id != null) lastId = row.id
    }
    total += batch.length
    if (batch.length < pageSize) break
  }
  Logger.log('Loaded onboarding rows=' + total)
  return { byRider: byRider, byPhone: byPhone }
}

function fillMissingSources_(rows, index) {
  return rows.map(function (row) {
    if (!isMissingSource_(row.source)) return row
    var hit =
      lookupAllKeys_(index.byRider, row.clientRiderId) ||
      lookupAllKeys_(index.byRider, row.ev91RiderId) ||
      lookupAllKeys_(index.byRider, row.riderName) ||
      index.byPhone[normalizePhone_(row.riderContact)] ||
      index.byPhone[normalizePhone_(row.clientRiderId)] ||
      ''
    if (!hit) return row
    var copy = {}
    for (var k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k)) copy[k] = row[k]
    }
    copy.source = hit
    return copy
  })
}

function isMissingSource_(value) {
  var s = String(value || '')
    .trim()
    .toLowerCase()
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

function riderKeys_(raw) {
  var out = {}
  var text = String(raw || '').trim()
  if (!text) return []
  var upper = text.toUpperCase().replace(/[\s_-]+/g, '')
  out[upper] = true
  out[text.toUpperCase()] = true
  var fe = text.match(/FE\d{5,}/i)
  if (fe) {
    out[fe[0].toUpperCase()] = true
    out[String(fe[0].replace(/FE/i, ''))] = true
  }
  var digits = text.replace(/\D/g, '')
  if (digits.length >= 5) out[digits] = true
  if (digits.length >= 10) out[digits.slice(-10)] = true
  return Object.keys(out)
}

function addAllRiderKeys_(map, raw, source) {
  var keys = riderKeys_(raw)
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] && !map[keys[i]]) map[keys[i]] = source
  }
}

function lookupAllKeys_(map, raw) {
  var keys = riderKeys_(raw)
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] && map[keys[i]]) return map[keys[i]]
  }
  return ''
}

function normalizePhone_(value) {
  var digits = String(value || '').replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function rowToValues_(row, dayMeta, kmIndex) {
  var values = [
    cell_(row.city),
    cell_(row.vehicleNumber),
    cell_(row.ev91RiderId),
    cell_(row.clientRiderId),
    cell_(row.riderName),
    cell_(row.riderContact),
    cell_(row.currentStatus),
    cell_(row.operationalStatus),
    cell_(row.clientName),
    cell_(row.aging),
    dateOnly_(row.lastStatusDate),
    cell_(row.source),
  ]
  for (var i = 0; i < dayMeta.length; i++) {
    values.push(lookupVehicleKm_(kmIndex, row.vehicleNumber, dayMeta[i].dateKey))
  }
  return values
}

function cell_(v) {
  return v == null ? '' : String(v)
}

/** "2026-08-05T12:00:00.000Z" → "2026-08-05" */
function dateOnly_(value) {
  if (value == null || value === '') return ''
  var s = String(value).trim()
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  var d = new Date(s)
  if (!isNaN(d.getTime())) {
    var y = d.getFullYear()
    var mo = String(d.getMonth() + 1)
    if (mo.length < 2) mo = '0' + mo
    var day = String(d.getDate())
    if (day.length < 2) day = '0' + day
    return y + '-' + mo + '-' + day
  }
  return s
}

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  if (CONFIG.TARGET_SHEET_NAME) {
    var existing = ss.getSheetByName(CONFIG.TARGET_SHEET_NAME)
    if (existing) return existing
    return ss.insertSheet(CONFIG.TARGET_SHEET_NAME)
  }
  return ss.getActiveSheet()
}

function fetchJson_(url, headers) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: headers || {},
  })
  var code = response.getResponseCode()
  var text = response.getContentText()
  if (code < 200 || code >= 300) {
    throw new Error('API error ' + code + ': ' + text.slice(0, 300))
  }
  return JSON.parse(text)
}

function fetchJsonArray_(url, headers) {
  var data = fetchJson_(url, headers)
  return Object.prototype.toString.call(data) === '[object Array]' ? data : []
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EV91 Current Status')
    .addItem('Import / Refresh (Deployed + D-1…D-4 KM)', 'importEv91CurrentStatus')
    .addToUi()
}
