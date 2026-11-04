/**
 * EV91 Client Mapping History → Google Sheets
 * Sheet name: "EV91 Client Hister"
 *
 * Adds Rider Name + Client Name by matching against EV91 Rider Details
 * (publicRiderID / clientRiderId / phone).
 *
 * Live app: https://main.d2y6lleakorn3s.amplifyapp.com/
 *
 * Setup:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this file, save
 * 3. Run Import / Refresh once (writes to sheet "EV91 Client Hister")
 * 4. Menu → EV91 Client History → Install 5-hour trigger (optional)
 *
 * API sources:
 * - Client Mapping History: …/client-mapping-history
 * - Rider Details (for name / client): …/mis-public-api/rider-details
 */

var CONFIG = {
  // Amplify same-origin rewrite (preferred)
  MAPPING_BASE:
    'https://main.d2y6lleakorn3s.amplifyapp.com/api/ev91/client-mapping-history',
  RIDER_DETAILS_BASE:
    'https://main.d2y6lleakorn3s.amplifyapp.com/api/ev91/mis-public-api/rider-details',
  // Upstream fallbacks if Amplify rewrite fails
  MAPPING_FALLBACK:
    'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/client-mapping-history',
  RIDER_DETAILS_FALLBACK:
    'https://dashboard.ev91riderz.com/api/v1/public/mis/rider-vehicle-analytics/mis-public-api/rider-details',
  EV91_API_KEY: 'ev91-mis-public-2026',
  SUPABASE_URL: 'https://arnxvnkednpzyzyfculx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH',
  TARGET_SHEET_NAME: 'EV91 Client Hister',
  PAGE_LIMIT: 500,
  MAX_PAGES: 80,
}

var COLUMNS = [
  'City',
  'EV91 Rider ID',
  'Client ID',
  'Rider Name',
  'Client Name',
  'Phone',
  'Source',
  'Last Updated',
]

function importEv91ClientMappingHistory() {
  var mappingRows = fetchAllPaged_(CONFIG.MAPPING_BASE, CONFIG.MAPPING_FALLBACK)
  var riderDetails = fetchAllPaged_(CONFIG.RIDER_DETAILS_BASE, CONFIG.RIDER_DETAILS_FALLBACK)
  var detailIndex = buildRiderDetailIndex_(riderDetails)
  var sourceIndex = buildSourceMasterEmailIndex_()

  var values = [COLUMNS]
  var named = 0
  var clientNamed = 0
  var sourceNamed = 0

  for (var i = 0; i < mappingRows.length; i++) {
    var row = mappingRows[i]
    var hit = lookupRiderDetail_(detailIndex, row)
    var riderName = hit ? cell_(hit.name || hit.riderName) : ''
    // Prefer Client Name from mapping API; fall back to Rider Details
    var clientName = cell_(row.clientName || row.ClientName)
    if (!clientName && hit) clientName = cell_(hit.clientName)
    var sourceName =
      lookupSourceMasterNameByEmail_(sourceIndex, row.source, row.city) ||
      lookupSourceMasterNameByEmail_(sourceIndex, row.sourceName, row.city) ||
      lookupSourceMasterNameByEmail_(sourceIndex, row.sourceEmail, row.city) ||
      lookupSourceMasterNameByEmail_(sourceIndex, row.mailId, row.city) ||
      lookupSourceMasterNameByEmail_(sourceIndex, row.emailId, row.city)
    if (sourceName) sourceNamed++
    if (riderName) named++
    if (clientName) clientNamed++

    values.push([
      cell_(row.city),
      cell_(row.ev91RiderId),
      cell_(row.clientId),
      riderName,
      clientName,
      cell_(row.phoneNumber),
      sourceName || cell_(row.source),
      dateTime_(row.lastUpdated),
    ])
  }

  var sheet = getTargetSheet_()
  sheet.clearContents()
  sheet.getRange(1, 1, values.length, COLUMNS.length).setValues(values)
  sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold')
  sheet.setFrozenRows(1)
  try {
    sheet.autoResizeColumns(1, COLUMNS.length)
  } catch (e) {
    // ignore resize errors
  }

  Logger.log(
    'Client Mapping rows=' +
      mappingRows.length +
      ' · Rider Details=' +
      riderDetails.length +
      ' · Source names filled=' +
      sourceNamed +
      ' · Rider Name filled=' +
      named +
      ' · Client Name filled=' +
      clientNamed +
      ' · sheet="' +
      CONFIG.TARGET_SHEET_NAME +
      '"'
  )
}

/** Fetch all pages from primary URL; on first-page failure try fallback. */
function fetchAllPaged_(primaryBase, fallbackBase) {
  var all = []
  var offset = 0
  var limit = CONFIG.PAGE_LIMIT
  var baseUrl = primaryBase
  var usedFallback = false

  for (var page = 0; page < CONFIG.MAX_PAGES; page++) {
    var url = baseUrl + '?limit=' + limit + '&offset=' + offset
    var body
    try {
      body = fetchJson_(url, {
        Accept: 'application/json',
        'x-api-key': CONFIG.EV91_API_KEY,
      })
    } catch (err) {
      if (page === 0 && !usedFallback && fallbackBase) {
        Logger.log('Primary failed (' + primaryBase + '): ' + err.message + ' → using fallback')
        baseUrl = fallbackBase
        usedFallback = true
        url = baseUrl + '?limit=' + limit + '&offset=' + offset
        body = fetchJson_(url, {
          Accept: 'application/json',
          'x-api-key': CONFIG.EV91_API_KEY,
        })
      } else {
        throw err
      }
    }

    var batch = body.data || []
    for (var i = 0; i < batch.length; i++) all.push(batch[i])
    offset += batch.length
    if (!batch.length || !(body.pagination && body.pagination.hasMore)) break
  }
  return all
}

/**
 * Index rider-details by EV91 ID / client rider ID / phone
 * so Client Mapping rows can resolve Rider Name + Client Name.
 */
function buildRiderDetailIndex_(rows) {
  var byEv91 = {}
  var byClientId = {}
  var byPhone = {}

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i] || {}
    var detail = {
      name: String(row.name || row.riderName || '').trim(),
      riderName: String(row.name || row.riderName || '').trim(),
      clientName: String(row.clientName || '').trim(),
      phone: String(row.phone || '').trim(),
      publicRiderID: String(row.publicRiderID || row.publicRiderId || '').trim(),
      clientRiderId: String(row.clientRiderId || row.clientId || '').trim(),
    }

    var ev91 = detail.publicRiderID
    if (ev91) {
      var evKeys = riderKeys_(ev91)
      for (var e = 0; e < evKeys.length; e++) {
        if (evKeys[e] && !byEv91[evKeys[e]]) byEv91[evKeys[e]] = detail
      }
    }

    var clientId = detail.clientRiderId
    if (clientId) {
      var cKeys = riderKeys_(clientId)
      for (var c = 0; c < cKeys.length; c++) {
        if (cKeys[c] && !byClientId[cKeys[c]]) byClientId[cKeys[c]] = detail
      }
    }

    var phone = normalizePhone_(detail.phone)
    if (phone && !byPhone[phone]) byPhone[phone] = detail
  }

  return { byEv91: byEv91, byClientId: byClientId, byPhone: byPhone }
}

function lookupRiderDetail_(index, mappingRow) {
  if (!index || !mappingRow) return null
  return (
    lookupAllKeys_(index.byEv91, mappingRow.ev91RiderId) ||
    lookupAllKeys_(index.byClientId, mappingRow.clientId) ||
    index.byPhone[normalizePhone_(mappingRow.phoneNumber)] ||
    index.byPhone[normalizePhone_(mappingRow.clientId)] ||
    null
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

function lookupAllKeys_(map, raw) {
  var keys = riderKeys_(raw)
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] && map[keys[i]]) return map[keys[i]]
  }
  return null
}

function normalizePhone_(value) {
  var digits = String(value || '').replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits.length >= 6 ? digits : ''
}

function getSupabaseConfig_() {
  var props = PropertiesService.getScriptProperties()
  return {
    url: String(props.getProperty('SUPABASE_URL') || CONFIG.SUPABASE_URL || '').trim(),
    key: String(props.getProperty('SUPABASE_ANON_KEY') || CONFIG.SUPABASE_ANON_KEY || '').trim(),
  }
}

/** Map Source List mail IDs to Source names, using city when available. */
function buildSourceMasterEmailIndex_() {
  var byEmailAndCity = Object.create(null)
  var byEmail = Object.create(null)
  var cfg = getSupabaseConfig_()
  if (!cfg.url || !cfg.key) {
    Logger.log('Source List skipped: Supabase URL / anon key is missing')
    return { byEmailAndCity: byEmailAndCity, byEmail: byEmail }
  }

  var select = 'id,city,source_name,email_id'
  var base =
    String(cfg.url).replace(/\/$/, '') +
    '/rest/v1/source_master?select=' +
    encodeURIComponent(select) +
    '&order=id.asc'
  var lastId = 0
  var total = 0

  for (var page = 0; page < 200; page++) {
    var url = base + '&limit=1000'
    if (lastId) url += '&id=gt.' + encodeURIComponent(lastId)
    var rows = fetchJsonArray_(url, {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      Accept: 'application/json',
    })
    if (!rows.length) break

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}
      var email = normalizeEmail_(row.email_id)
      var name = String(row.source_name || '').trim()
      if (!email || !name) continue
      addSourceEmailMatch_(byEmailAndCity, normalizeSourceCity_(row.city) + '\t' + email, name)
      addSourceEmailMatch_(byEmail, email, name)
    }

    lastId = rows[rows.length - 1].id
    total += rows.length
    if (rows.length < 1000) break
  }

  Logger.log('Loaded Source List rows=' + total)
  return { byEmailAndCity: byEmailAndCity, byEmail: byEmail }
}

function addSourceEmailMatch_(map, key, name) {
  if (!key || !name) return
  if (!Object.prototype.hasOwnProperty.call(map, key)) {
    map[key] = name
  } else if (String(map[key]).replace(/\s+/g, '').toLowerCase() !== name.replace(/\s+/g, '').toLowerCase()) {
    map[key] = ''
  }
}

function lookupSourceMasterNameByEmail_(index, emailValue, cityValue) {
  if (!index || !emailValue) return ''
  var email = normalizeEmail_(emailValue)
  if (!email) return ''
  var cityName = normalizeSourceCity_(cityValue)
  if (cityName) {
    var cityMatch = index.byEmailAndCity[cityName + '\t' + email]
    if (cityMatch) return cityMatch
  }
  return index.byEmail[email] || ''
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeSourceCity_(value) {
  var city = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (city === 'bengaluru') return 'bangalore'
  if (city === 'mysuru') return 'mysore'
  return city
}

function cell_(v) {
  return v == null ? '' : String(v)
}

/** Prefer ISO date / datetime string for Last Updated */
function dateTime_(value) {
  if (value == null || value === '') return ''
  var s = String(value).trim()
  var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}))?/)
  if (m) {
    if (m[2]) return m[1] + ' ' + m[2]
    return m[1]
  }
  var d = new Date(s)
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')
  }
  return s
}

function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var existing = ss.getSheetByName(CONFIG.TARGET_SHEET_NAME)
  if (existing) return existing
  return ss.insertSheet(CONFIG.TARGET_SHEET_NAME)
}

function fetchJsonArray_(url, headers) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: headers || {},
  })
  var code = response.getResponseCode()
  var text = response.getContentText()
  if (code < 200 || code >= 300) {
    throw new Error('Supabase API error ' + code + ': ' + text.slice(0, 300))
  }
  var body = JSON.parse(text)
  return Array.isArray(body) ? body : []
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
  var body = JSON.parse(text)
  if (body && body.success === false) {
    throw new Error(body.message || 'EV91 API returned success=false')
  }
  return body
}

function installFiveHourTrigger() {
  removeFiveHourTrigger()
  ScriptApp.newTrigger('importEv91ClientMappingHistory')
    .timeBased()
    .everyHours(5)
    .create()
  SpreadsheetApp.getUi().alert(
    'Trigger installed',
    'importEv91ClientMappingHistory will run every 5 hours and refresh sheet "' +
      CONFIG.TARGET_SHEET_NAME +
      '".',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}

function removeFiveHourTrigger() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importEv91ClientMappingHistory') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EV91 Client History')
    .addItem('Import / Refresh', 'importEv91ClientMappingHistory')
    .addSeparator()
    .addItem('Install 5-hour trigger', 'installFiveHourTrigger')
    .addItem('Remove trigger', 'removeFiveHourTrigger')
    .addToUi()
}
