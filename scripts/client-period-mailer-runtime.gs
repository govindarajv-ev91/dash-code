/** Deploy this as a SEPARATE Apps Script web app. No schedule is installed. */
var CLIENT_PERIOD_MAIL_TO = 'govindaraj.v@ev91riderz.com'

/** Run once to authorize email. No access key or schedule is required. */
function setupClientPeriodMailer() {
  MailApp.getRemainingDailyQuota()
  Logger.log('Manual test recipient: ' + CLIENT_PERIOD_MAIL_TO + '. No access key is required. Maximum 5 test emails per day; no automation is installed.')
}

function clientPeriodMailerJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON)
}

function doGet(e) {
  var params = e && e.parameter || {}
  if (params.action !== 'status') return clientPeriodMailerJson_({ service: 'EV91 Client Period Mailer', mode: 'manual-test', version: 2, requiresKey: false })
  if (!/^[a-f0-9-]{36}$/.test(params.requestId || '') || !/^ev91MailStatus_[a-f0-9]{32}$/.test(params.callback || '')) {
    return clientPeriodMailerJson_({ status: 'failed', message: 'Invalid status request.' })
  }
  // A random request ID reveals only submission status, never payment data.
  var status = CacheService.getScriptCache().get('client-period:' + params.requestId)
  var result = status ? JSON.parse(status) : { requestId: params.requestId, status: 'pending' }
  var json = JSON.stringify(result).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return ContentService.createTextOutput(params.callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT)
}

function doPost(e) {
  var requestId, lock, mailAttempted = false, cache = CacheService.getScriptCache()
  try {
    var text = e && e.postData && e.postData.contents || ''
    if (!text || text.length > 250000) throw new Error('Invalid or oversized mail request.')
    var body = JSON.parse(text)
    requestId = String(body.requestId || '')
    if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error('Invalid mail request ID.')
    if (body.action !== 'sendClientPeriodTest') throw new Error('Unsupported mail request.')
    var report = ClientPeriodMailCore.validateClientPeriodMailReport(body.report)
    var content = clientPeriodMailContent_(report)
    lock = LockService.getScriptLock()
    if (!lock.tryLock(5000)) throw new Error('Another email is being submitted. Please wait.')
    var previous = cache.get('client-period:' + requestId)
    if (previous) return clientPeriodMailerJson_(JSON.parse(previous))
    var properties = PropertiesService.getScriptProperties()
    var day = new Date(Date.now() + 19800000).toISOString().slice(0, 10)
    var usage = JSON.parse(properties.getProperty('CLIENT_PERIOD_MAIL_USAGE') || '{}')
    if (usage.day !== day) usage = { day: day, count: 0 }
    if (usage.count >= 5) throw new Error('The manual test limit of 5 emails per day has been reached. Try tomorrow.')
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Daily mail quota exhausted. Nothing was sent.')
    cache.put('client-period:' + requestId, JSON.stringify({ requestId: requestId, status: 'sending' }), 21600)
    // Recipients and HTML are controlled here. Incoming to/cc/html fields are ignored.
    properties.setProperty('CLIENT_PERIOD_MAIL_USAGE', JSON.stringify({ day: day, count: usage.count + 1 }))
    mailAttempted = true
    MailApp.sendEmail({ to: CLIENT_PERIOD_MAIL_TO,
      subject: ClientPeriodMailCore.clientPeriodMailSubject(report),
      body: content.body || 'EV91 ' + report.city + ' ' + report.mode + ' report, ' + report.fromDate + ' through ' + report.toDate + '. View the HTML email for all four tables.',
      htmlBody: content.html, inlineImages: content.inlineImages, attachments: content.attachments || [], name: 'EV91 City Reports' })
    var result = { requestId: requestId, status: 'sent', acceptedAt: new Date().toISOString(), to: CLIENT_PERIOD_MAIL_TO,
      message: 'MailApp accepted the email. Check the inbox for delivery.' }
    cache.put('client-period:' + requestId, JSON.stringify(result), 21600)
    return clientPeriodMailerJson_(result)
  } catch (error) {
    var failure = { requestId: requestId || '', status: 'failed', message: (mailAttempted ? 'Mail acceptance was not confirmed. Check the inbox before retrying. ' : '') + String(error.message || 'Mail request failed.') }
    if (/^[a-f0-9-]{36}$/.test(requestId || '') && (mailAttempted || !cache.get('client-period:' + requestId))) {
      cache.put('client-period:' + requestId, JSON.stringify(failure), 300)
    }
    return clientPeriodMailerJson_(failure)
  } finally { if (lock && lock.hasLock()) lock.releaseLock() }
}

function clientPeriodMailContent_(report) {
    var html = ClientPeriodMailCore.renderClientPeriodMailHtml(report)
    var inlineImages = {}
    if (report.logo) {
      var logoParts = report.logo.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/)
      inlineImages.companyLogo = Utilities.newBlob(Utilities.base64Decode(logoParts[2]), logoParts[1], 'company-logo')
      html = html.replace(report.logo, 'cid:companyLogo')
    }
    var sparkIndex = 0, sparkImages = {}
    html = html.replace(/src="(data:image\/png;base64,([A-Za-z0-9+/=]+))"/g, function (_, dataUrl, encoded) {
      var name = sparkImages[dataUrl]
      if (!name) {
        name = 'trend' + sparkIndex++
        sparkImages[dataUrl] = name
        inlineImages[name] = Utilities.newBlob(Utilities.base64Decode(encoded), 'image/png', name + '.png')
      }
      return 'src="cid:' + name + '"'
    })
    if (Utilities.newBlob(html).getBytes().length > 180000) {
      // Keep one email and every table when an unusually large city exceeds
      // the conservative inline-body limit. The standalone attachment embeds
      // its own images and does not need the separate cid image attachments.
      var completeHtml = ClientPeriodMailCore.renderClientPeriodMailHtml(report)
      if (Utilities.newBlob(completeHtml).getBytes().length > 8000000) throw new Error('The complete report exceeds the 8 MB attachment limit. Nothing was truncated or sent.')
      var filename = 'EV91-' + report.city.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + report.toDate + '.html'
      var body = 'EV91 ' + report.city + ' report for ' + report.toDate + '. The full report is attached as ' + filename + ' because it exceeds the inline email size limit. Download and open the HTML file in your browser to view every table, value and sparkline. No report data was truncated.'
      var logoHtml = report.logo ? '<img src="cid:companyLogo" alt="Company logo" width="220" style="max-width:220px;height:auto;display:block;margin-bottom:20px;">' : ''
      return { html: '<div style="font-family:Arial,sans-serif;padding:24px;background:#182337;color:#f8fafc;">' + logoHtml + '<h1>EV91 city report</h1><p>' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p></div>',
        body: body, inlineImages: report.logo ? { companyLogo: inlineImages.companyLogo } : {}, attachments: [Utilities.newBlob(completeHtml, 'text/html', filename)], attachedReport: true }
    }
    return { html: html, inlineImages: inlineImages }
}

/** Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Script Properties,
 * then run this ONCE in the Apps Script editor (never from the public web app).
 * Saving a dashboard schedule does not grant Google trigger authorization. */
function setupClientPeriodAutoSend() {
  clientPeriodDbConfig_()
  MailApp.getRemainingDailyQuota()
  // Check schema/credentials before installing. This does not send any mail.
  clientPeriodDbRequest_('city_mail_contacts?select=id&limit=1')
  if (!ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'runClientPeriodSchedules' })) {
    ScriptApp.newTrigger('runClientPeriodSchedules').timeBased().everyMinutes(1).create()
  }
  Logger.log('Auto send scheduler installed. Schedule times use IST. Manage recipients in Source List > City List.')
}

function stopClientPeriodAutoSend() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runClientPeriodSchedules') ScriptApp.deleteTrigger(trigger)
  })
}

function clientPeriodDbConfig_() {
  var props = PropertiesService.getScriptProperties()
  var url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/$/, '')
  var key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY')
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Apps Script Properties. Never put the service key in the dashboard.')
  return { url: url, key: key }
}

function clientPeriodDbRequest_(path, method, payload, allowDuplicate) {
  var config = clientPeriodDbConfig_()
  var options = { method: method || 'get', muteHttpExceptions: true, headers: {
    apikey: config.key, Authorization: 'Bearer ' + config.key, Prefer: 'return=representation'
  } }
  if (payload !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload) }
  var response = UrlFetchApp.fetch(config.url + '/rest/v1/' + path, options)
  var status = response.getResponseCode(), text = response.getContentText()
  if (status === 409 && allowDuplicate && /23505/.test(text)) return null
  // Report only resource names, error codes and missing column identifiers.
  // Other database messages may contain row values; never log the raw response.
  if (status < 200 || status >= 300) {
    var resource = path.split('?')[0].replace(/[^a-zA-Z0-9_/]/g, '').slice(0, 100)
    var detail = '', databaseError
    try { databaseError = JSON.parse(text) || {} } catch (_) { databaseError = {} }
    if (/^[a-zA-Z0-9]{1,12}$/.test(databaseError.code || '')) detail = ' [' + databaseError.code + ']'
    var missingColumn = String(databaseError.message || '').match(/^column ([a-zA-Z_][a-zA-Z0-9_.]{0,120}) does not exist$/)
    if (missingColumn) detail += ': column ' + missingColumn[1] + ' does not exist'
    var failure = new Error('Database request failed (' + status + ') for ' + resource + detail + '. Check schema, service credentials and Apps Script Executions.')
    failure.code = databaseError.code
    throw failure
  }
  return text ? JSON.parse(text) : []
}

function clientPeriodDbRows_(table, columns, filter, deadline, periodRange) {
  var rows = [], cursor = null, pageSize = 500
  while (true) {
    if (Date.now() > deadline) throw new Error('Data preparation exceeded the execution budget while reading ' + table + ' (' + rows.length + ' rows loaded). No email was sent.')
    // A date range sorted by id forces scans of unrelated payment dates.
    // Match the dashboard's (period_start, id) index and composite cursor.
    var path = table + '?select=' + encodeURIComponent(columns) + '&order=' + (periodRange ? 'period_start.asc,id.asc' : 'id.asc') + '&limit=' + pageSize + (filter ? '&' + filter : '')
    if (periodRange) {
      path += '&period_start=gte.' + (cursor ? cursor.period_start : periodRange.fromDate) + '&period_start=lte.' + periodRange.toDate
      if (cursor) path += '&or=' + encodeURIComponent('(period_start.gt.' + cursor.period_start + ',and(period_start.eq.' + cursor.period_start + ',id.gt.' + cursor.id + '))')
    } else if (cursor !== null) path += '&id=gt.' + encodeURIComponent(cursor)
    var page
    try { page = clientPeriodDbRequest_(path) } catch (error) {
      if (error.code === '57014' && pageSize > 100) {
        pageSize = Math.max(100, Math.floor(pageSize / 2))
        continue
      }
      throw error
    }
    if (!Array.isArray(page)) throw new Error('Invalid database page.')
    if (!page.length) return rows
    var last = page[page.length - 1], next = last.id
    if (periodRange) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(last.period_start) || !/^\d+$/.test(String(next)) ||
          (cursor && !(last.period_start > cursor.period_start || last.period_start === cursor.period_start && BigInt(next) > BigInt(cursor.id)))) throw new Error('Incomplete payment date scan. Nothing was sent.')
      next = { period_start: last.period_start, id: String(next) }
    } else if (next == null || String(next) === String(cursor)) throw new Error('Incomplete database scan. Nothing was sent.')
    rows = rows.concat(page); cursor = next
  }
}

function clientPeriodCityPayments_(city, columns, params, deadline) {
  var rows = [], cursor = null, pageSize = 500
  while (true) {
    if (Date.now() > deadline) throw new Error('City payment preparation exceeded the execution budget. Nothing was sent.')
    var body = { p_city_keys: ClientPeriodMailCore.summaryCityLookupKeys(city), p_limit: pageSize,
      p_from: params.fromDate || null, p_to: params.toDate || null, p_month: params.month || null,
      p_after_period: cursor && !params.month ? cursor.period_start : null, p_after_id: cursor ? String(cursor.id) : null }
    var page
    try { page = clientPeriodDbRequest_('rpc/client_period_mail_payment_page?select=' + encodeURIComponent(columns), 'post', body) }
    catch (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Run sql/create_client_period_mail_payment_page.sql in Supabase SQL Editor, then retry. The city-scoped mail query is not installed.')
      if (error.code === '57014' && pageSize > 100) { pageSize = Math.max(100, Math.floor(pageSize / 2)); continue }
      throw error
    }
    if (!Array.isArray(page)) throw new Error('Invalid city payment page. Nothing was sent.')
    if (!page.length) return rows
    var last = page[page.length - 1]
    if (!/^\d+$/.test(String(last.id)) || (!params.month && !/^\d{4}-\d{2}-\d{2}$/.test(last.period_start)) ||
        cursor && !(params.month ? BigInt(last.id) > BigInt(cursor.id) : last.period_start > cursor.period_start || last.period_start === cursor.period_start && BigInt(last.id) > BigInt(cursor.id))) throw new Error('Incomplete city payment page. Nothing was sent.')
    rows = rows.concat(page); cursor = { id: String(last.id), period_start: last.period_start }
  }
}

function clientPeriodScheduledReport_(city, today, deadline, shared) {
  shared = shared || {}
  var columns = 'id,client_name,week,month,rider_id,rider_name,city,orders,gross_payout,period_start,period_label,rider_key,source_name'
  var range = ClientPeriodMailCore.clientPeriodMailRange('weekly', today)
  var weekly = clientPeriodCityPayments_(city, columns, { fromDate: range.fromDate, toDate: today }, deadline)
  var monthRows = shared.months || clientPeriodDbRequest_('rpc/distinct_rider_payment_months', 'post', {})
  if (!Array.isArray(monthRows)) throw new Error('Unable to load accounting months.')
  shared.months = monthRows
  var monthly = [], seen = {}
  var names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  monthRows.forEach(function (row) {
    var month = typeof row === 'string' ? row : row.month
    var match = String(month || '').trim().match(/^([A-Za-z]{3,9})[-\s/]?(\d{2}|\d{4})$/)
    // Fail closed rather than silently drop unrecognized accounting months.
    if (!match || names.indexOf(match[1].slice(0, 3).toLowerCase()) < 0) throw new Error('Unrecognized accounting month. Normalize month labels before scheduling.')
    var year = Number(match[2]); if (year < 100) year += year >= 70 ? 1900 : 2000
    var start = year + '-' + String(names.indexOf(match[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0') + '-01'
    if (start < '2026-03-01' || start > today || seen[month]) return
    seen[month] = true
    monthly = monthly.concat(clientPeriodCityPayments_(city, columns, { month: month }, deadline))
  })
  var sources = shared.sources || clientPeriodDbRows_('source_master', 'id,city,source_name,is_active', 'is_active=eq.true', deadline)
  shared.sources = sources
  // Discover actual columns from one row. Pull only lookup fields thereafter,
  // preserving optional schema support without downloading wide uploads.
  var onboarding = shared.onboarding
  if (!onboarding) {
    var sample = clientPeriodDbRequest_('rider_onboarding?select=*&order=id.asc&limit=1')
    var fields = ['id', 'rider_id_details', 'rider_id', 'worker_code', 'client_rider_id', 'merge', 'rider_name', 'source_name', 'rider_mobile_number', 'mobile', 'phone']
    onboarding = sample.length ? clientPeriodDbRows_('rider_onboarding', fields.filter(function (key) { return Object.prototype.hasOwnProperty.call(sample[0], key) }).join(','), '', deadline) : []
    shared.onboarding = onboarding
  }
  var sourceIndex = ClientPeriodMailCore.buildSourceMasterIndex(sources)
  var reports = ['weekly', 'monthly'].map(function (mode, index) {
    return ClientPeriodMailCore.buildClientPeriodMailReport({ payments: index === 0 ? weekly : monthly, onboarding: onboarding, sourceIndex: sourceIndex, city: city, mode: mode, today: today })
  })
  if (!reports.some(function (report) { return report.paymentRowCount > 0 })) throw new Error('No payment data for this city. Nothing was sent.')
  var report = { version: 1, mode: 'both', city: reports[0].city, fromDate: '2026-03-30', toDate: today, reports: reports }
  var logo = PropertiesService.getScriptProperties().getProperty('CLIENT_PERIOD_LOGO_DATA_URL') || CLIENT_PERIOD_DEFAULT_LOGO
  if (logo) report.logo = logo
  return report
}

/** Runs independently of the browser. Durable unique daily claims prevent
 * duplicate sends after retries, concurrent executions or cache expiration. */
function runClientPeriodSchedules() {
  return clientPeriodRunSchedules_(false)
}

/** Run manually in the editor after fixing a preparation failure. Retries only
 * today's due runs marked failed BEFORE MailApp submission. Never retries sent,
 * sending, preparing or uncertain runs. Existing history is preserved. */
function retryFailedClientPeriodSchedules() {
  return clientPeriodRunSchedules_(true)
}

function clientPeriodRunSchedules_(retryFailed) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(1000)) return
  var deadline = Date.now() + 240000
  try {
    var now = new Date(), today = new Date(now.getTime() + 19800000).toISOString().slice(0, 10)
    var schedules = clientPeriodDbRows_('client_period_mail_schedules', '*', 'is_active=eq.true', deadline)
    var contacts = null
    for (var i = 0; i < schedules.length; i++) {
      var schedule = schedules[i]
      if (!ClientPeriodMailCore.scheduleDue(schedule, now)) continue
      if (Date.now() > deadline - 30000) break
      var claim = clientPeriodDbRequest_('client_period_mail_runs', 'post', { schedule_id: schedule.id, run_date: today, status: 'preparing' }, true)
      if (!claim && retryFailed) {
        // Conditional update is atomic, including across separate deployments.
        claim = clientPeriodDbRequest_('client_period_mail_runs?schedule_id=eq.' + schedule.id + '&run_date=eq.' + today + '&status=eq.failed', 'patch', { status: 'preparing', message: 'Manual retry after preparation failure.' })
      }
      if (!claim || !claim.length) continue
      var attempted = false, runId = claim[0].id
      try {
        if (!contacts) contacts = clientPeriodDbRows_('city_mail_contacts', '*', '', deadline)
        var contact = contacts.find(function (row) { return row.id === schedule.contact_id })
        if (!contact) throw new Error('City contact missing.')
        var to = ClientPeriodMailCore.emailList(contact.email_id, true), cc = ClientPeriodMailCore.emailList(contact.cc)
        var recipients = new Set((to + ',' + cc).split(',').filter(Boolean)).size
        if (recipients > 50) throw new Error('Use at most 50 total recipients per email.')
        if (MailApp.getRemainingDailyQuota() < recipients) throw new Error('Insufficient daily email quota. Nothing was sent.')
        var report = clientPeriodScheduledReport_(contact.city, today, deadline)
        var content = clientPeriodMailContent_(report)
        if (Date.now() > deadline) throw new Error('Preparation exceeded the execution budget. Nothing was sent.')
        // Re-read settings immediately before sending so pauses and recipient
        // edits during a long preparation apply before any mail is accepted.
        var fresh = clientPeriodDbRequest_('client_period_mail_schedules?id=eq.' + schedule.id + '&select=*')[0]
        var freshContact = clientPeriodDbRequest_('city_mail_contacts?id=eq.' + contact.id + '&select=*')[0]
        if (!fresh || !fresh.is_active || fresh.updated_at !== schedule.updated_at || JSON.stringify(freshContact) !== JSON.stringify(contact)) throw new Error('Settings changed during preparation. Nothing was sent; check the schedule.')
        clientPeriodDbRequest_('client_period_mail_runs?id=eq.' + runId, 'patch', { status: 'sending', message: 'Submission started. If this remains, check the inbox before retrying.' })
        attempted = true
        var message = { to: to, subject: ClientPeriodMailCore.clientPeriodMailSubject(report), body: content.body || 'EV91 ' + report.city + ' Weekly and Monthly reports. View the HTML email for all eight tables.', htmlBody: content.html, inlineImages: content.inlineImages, attachments: content.attachments || [], name: 'EV91 City Reports' }
        if (cc) message.cc = cc
        MailApp.sendEmail(message)
        clientPeriodDbRequest_('client_period_mail_runs?id=eq.' + runId, 'patch', { status: 'sent', accepted_at: new Date().toISOString(), message: content.attachedReport ? 'Accepted by Google. Full report is in the HTML attachment; no rows were truncated.' : 'Accepted by Google. Check inbox/spam for delivery.' })
      } catch (error) {
        clientPeriodDbRequest_('client_period_mail_runs?id=eq.' + runId, 'patch', { status: attempted ? 'uncertain' : 'failed', message: (attempted ? 'Check inbox before retrying. ' : '') + String(error.message || 'Scheduled email failed.') })
      }
      // Give every city its own preparation budget. Later due schedules are
      // handled on the next one-minute tick, skipping durable existing claims.
      break
    }
  } finally { lock.releaseLock() }
}
