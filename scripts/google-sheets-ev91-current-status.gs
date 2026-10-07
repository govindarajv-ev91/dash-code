/**
 * EV91 Current Vehicle Status (Deployed only) → Google Sheets
 *
 * Live app: https://main.d2y6lleakorn3s.amplifyapp.com/
 *
 * Setup:
 * 1. Paste into Apps Script on your main Google Sheet, save
 * 2. Run Import / Refresh once (writes to sheet "E91DB Data")
 * 3. Menu → EV91 Current Status → Install 5-hour trigger
 *    (or: Apps Script → Triggers → Add Trigger → importEv91CurrentStatus → Time-driven → Every 5 hours)
 *
 * Source: when EV91 source is "-" / blank, fill from rider_onboarding.source_name
 * (match by phone / rider_id_details / merge / FE id).
 */

var CONFIG = {
  EV91_BASE: 'https://main.d2y6lleakorn3s.amplifyapp.com/api/ev91/current-status',
  EV91_BASE_FALLBACK:
    'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/current-status',
  EV91_API_KEY: 'ev91-mis-public-2026',
  VEHICLES_BASE: 'https://dashboard.ev91riderz.com/api/v1/vehicles',
  // Same as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (publishable anon key)
  SUPABASE_URL: 'https://arnxvnkednpzyzyfculx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH',
  TARGET_SHEET_NAME: 'E91DB Data',
}

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
  // Prefer Script Properties override if set; otherwise use baked-in CONFIG
  var props = PropertiesService.getScriptProperties()
  return {
    url: String(
      props.getProperty('SUPABASE_URL') || CONFIG.SUPABASE_URL || ''
    ).trim(),
    key: String(
      props.getProperty('SUPABASE_ANON_KEY') || CONFIG.SUPABASE_ANON_KEY || ''
    ).trim(),
  }
}

function importEv91CurrentStatus() {
  var dayMeta = buildLast4DayMeta_()
  var columns = BASE_COLUMNS.concat(
    dayMeta.map(function (meta) {
      return meta.header
    })
  ).concat(['Vehicle Model'])
  var rows = fetchDeployedCurrentStatus_()
  var vehicleModelIndex = buildVehicleModelIndex_()
  var kmIndex = buildVehicleKmIndex_(dayMeta)
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

  var values = [columns]
  for (var r = 0; r < rows.length; r++) {
    values.push(rowToValues_(rows[r], dayMeta, kmIndex, vehicleModelIndex))
  }

  var sheet = getTargetSheet_()
  sheet.clearContents()
  sheet.getRange(1, 1, values.length, columns.length).setValues(values)
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold')
  sheet.setFrozenRows(1)

  Logger.log(
    'Deployed rows=' +
      rows.length +
      ' · onboarding keys riders=' +
      Object.keys(sourceIndex.byRider).length +
      ' phones=' +
      Object.keys(sourceIndex.byPhone).length +
      ' · vehicle models=' +
      Object.keys(vehicleModelIndex).length +
      ' · KM dates=' +
      dayMeta.map(function (meta) { return meta.header }).join(', ') +
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
    var url =
      baseUrl +
      '?limit=' +
      limit +
      '&offset=' +
      offset +
      '&status=Deployed'
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
        url =
          baseUrl +
          '?limit=' +
          limit +
          '&offset=' +
          offset +
          '&status=Deployed'
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
      var st = String(batch[i].currentStatus || '').toLowerCase()
      if (st.indexOf('deploy') !== -1) all.push(batch[i])
    }
    offset += batch.length
    if (!batch.length || !(body.pagination && body.pagination.hasMore)) break
  }
  return all
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

  // Real columns only (rider_id / worker_code do NOT exist on this table)
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
      // rider_id_details is often the phone itself
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

/** Same spirit as riderIdLookupKeys in the dashboard */
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

function normalizeVehicleNumber_(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s\-_/]+/g, '')
}

function buildLast4DayMeta_() {
  var timezone = 'Asia/Kolkata'
  var now = new Date()
  var out = []
  for (var offset = 1; offset <= 4; offset++) {
    var day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)
    var dateKey = Utilities.formatDate(day, timezone, 'yyyy-MM-dd')
    out.push({
      offset: offset,
      dateKey: dateKey,
      header: 'D-' + offset + ' (' + Utilities.formatDate(day, timezone, 'dd-MMM') + ')',
    })
  }
  return out
}

function buildVehicleKmIndex_(dayMeta) {
  var index = {}
  var config = getSupabaseConfig_()
  if (!config.url || !config.key) {
    Logger.log('Skip IoT KM: Supabase URL/key missing')
    return index
  }

  var fromKey = dayMeta[dayMeta.length - 1].dateKey
  var toKey = dayMeta[0].dateKey
  var select = 'id,vehicle_number,run_date,total_distance,raw_vehicle_id'
  var base =
    String(config.url).replace(/\/$/, '') +
    '/rest/v1/iot_data?select=' +
    encodeURIComponent(select) +
    '&run_date=gte.' +
    encodeURIComponent(fromKey) +
    '&run_date=lte.' +
    encodeURIComponent(toKey) +
    '&order=run_date.asc,id.asc'

  var lastRunDate = ''
  var lastId = 0
  var pageSize = 1000
  var total = 0
  for (var page = 0; page < 200; page++) {
    var url = base + '&limit=' + pageSize
    if (lastRunDate && lastId) {
      var cursor =
        '(run_date.gt.' +
        lastRunDate +
        ',and(run_date.eq.' +
        lastRunDate +
        ',id.gt.' +
        lastId +
        '))'
      url += '&or=' + encodeURIComponent(cursor)
    }

    var batch = fetchJsonArray_(url, {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      Accept: 'application/json',
    })
    if (!batch.length) break

    for (var i = 0; i < batch.length; i++) {
      var row = batch[i]
      var vehicleKey = normalizeVehicleNumber_(row.vehicle_number || row.raw_vehicle_id)
      var dateKey = normalizeRunDate_(row.run_date)
      var km = Number(row.total_distance)
      if (!vehicleKey || !dateKey || !isFinite(km)) continue
      var key = vehicleKey + '|' + dateKey
      if (index[key] == null || km > index[key]) index[key] = km
    }

    var lastRow = batch[batch.length - 1]
    lastRunDate = String(lastRow.run_date || '')
    lastId = Number(lastRow.id) || 0
    total += batch.length
    if (batch.length < pageSize) break
  }

  Logger.log('Loaded iot_data rows=' + total + ' for ' + fromKey + ' to ' + toKey)
  return index
}

function normalizeRunDate_(value) {
  if (value == null || value === '') return ''
  var text = String(value).trim()
  var match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  var date = new Date(text)
  if (isNaN(date.getTime())) return ''
  return Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd')
}

function lookupVehicleKm_(kmIndex, vehicleNumber, dateKey) {
  if (!kmIndex || !dateKey) return ''
  var key = normalizeVehicleNumber_(vehicleNumber) + '|' + dateKey
  if (kmIndex[key] == null) return ''
  var km = Number(kmIndex[key])
  return isFinite(km) ? Math.round(km * 100) / 100 : ''
}

function buildVehicleModelIndex_() {
  var index = {}
  var page = 1
  var limit = 100

  for (var i = 0; i < 50; i++) {
    var url =
      CONFIG.VEHICLES_BASE +
      '?page=' +
      page +
      '&limit=' +
      limit
    var body = fetchJson_(url, { Accept: 'application/json' })
    var vehicles = body.vehicles || []

    for (var j = 0; j < vehicles.length; j++) {
      var vehicleKey = normalizeVehicleNumber_(vehicles[j].registrationNumber)
      var modelName = vehicles[j].model && vehicles[j].model.displayName
      if (vehicleKey && modelName) index[vehicleKey] = modelName
    }

    if (!vehicles.length || !(body.pagination && body.pagination.hasNextPage)) break
    page++
  }

  Logger.log('Loaded vehicle model mappings=' + Object.keys(index).length)
  return index
}

function rowToValues_(row, dayMeta, kmIndex, vehicleModelIndex) {
  var vehicleKey = normalizeVehicleNumber_(row.vehicleNumber)
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
  values.push(cell_(vehicleModelIndex[vehicleKey] || ''))
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

function installFiveHourTrigger() {
  removeFiveHourTrigger()
  ScriptApp.newTrigger('importEv91CurrentStatus')
    .timeBased()
    .everyHours(5)
    .create()
  SpreadsheetApp.getUi().alert(
    'Trigger installed',
    'importEv91CurrentStatus will run every 5 hours and refresh sheet "E91DB Data".',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}

function removeFiveHourTrigger() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importEv91CurrentStatus') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EV91 Current Status')
    .addItem('Import / Refresh (Deployed)', 'importEv91CurrentStatus')
    .addSeparator()
    .addItem('Install 5-hour trigger', 'installFiveHourTrigger')
    .addItem('Remove trigger', 'removeFiveHourTrigger')
    .addToUi()
}
