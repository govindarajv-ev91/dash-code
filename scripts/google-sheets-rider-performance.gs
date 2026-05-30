/**
 * Rider Performance → Google Sheets
 *
 * JSON API works reliably on Vercel. IMPORTDATA often returns #N/A for large/slow CSV feeds.
 *
 * Setup:
 * 1. Open your Google Sheet
 * 2. Extensions → Apps Script
 * 3. Paste this file, save
 * 4. Run importRiderPerformance once (approve permissions)
 * 5. Optional: Triggers → add time-driven trigger for importRiderPerformance (hourly)
 */

const API_BASE = 'https://dash-code-rose.vercel.app/api/rider-performance-csv?format=json'

function importRiderPerformance() {
  const first = fetchJson(API_BASE + '&page=1')
  const columns = first.columns
  const totalPages = first.totalPages
  const values = [columns]

  appendRows(values, columns, first.rows)

  for (let page = 2; page <= totalPages; page++) {
    const batch = fetchJson(API_BASE + '&page=' + page)
    appendRows(values, columns, batch.rows)
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()
  sheet.clearContents()
  sheet.getRange(1, 1, values.length, columns.length).setValues(values)
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold')
}

function appendRows(values, columns, rows) {
  rows.forEach((row) => {
    values.push(columns.map((col) => row[col]))
  })
}

function fetchJson(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true })
  const code = response.getResponseCode()
  const text = response.getContentText()
  if (code !== 200) {
    throw new Error('API error ' + code + ': ' + text.slice(0, 200))
  }
  return JSON.parse(text)
}

/** Optional: refresh only — call from a custom menu or time trigger */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Rider Performance')
    .addItem('Import / Refresh', 'importRiderPerformance')
    .addToUi()
}
