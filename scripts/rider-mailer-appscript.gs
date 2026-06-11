/**
 * FleetPro mailer — Google Apps Script
 *
 * Deploy: Extensions → Apps Script → paste this file → Deploy → New deployment
 *   Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set in .env:
 *   VITE_MAILER_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
 *
 * Handles:
 *   - isAttritionGrouped: true  → Rider Attrition Mailer (city-wise from dashboard)
 *   - isGrouped: true           → Inactive Rider Mailer (existing)
 *   - single rider (GET/POST)   → legacy inactive single mail
 */

var MAIL_FROM_NAME = 'FleetPro Alerts';
var TEST_MAIL_TO = 'govindaraj.v@ev91riderz.com';
var FIXED_CC =
  'sujithra.y@ev91riderz.com,murali.bharath@ev91riderz.com,govindaraj.v@ev91riderz.com,leadership@ev91riderz.com';
var ATTRITION_BUCKETS = [3, 5, 7, 10, 15];
var ATTRITION_BUCKET_COLORS = ['#c8b4e8', '#ffff99', '#f2c4e0', '#ffff99', '#f2c4e0'];
var ATTRITION_EV_NONEV_BG = '#92d050';
var ATTRITION_TOTAL_GROUP_BG = '#7030a0';
var ATTRITION_GRAND_TOTAL_BG = '#f4b183';

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: 'FleetPro Mailer', time: new Date().toISOString() })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = parseRequest_(e);
    if (!data) {
      return jsonResponse_({ ok: false, error: 'Empty or invalid JSON body' });
    }

    if (data.isAttritionGrouped === true) {
      return sendAttritionGroupedEmail_(data);
    }

    if (data.isGrouped === true) {
      return sendInactiveGroupedEmail_(data);
    }

    return sendInactiveSingleEmail_(data);
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// ─── Rider Attrition (city-wise) ───────────────────────────────────────────

function sendAttritionGroupedEmail_(data) {
  var city = safe_(data.city, 'Unknown');
  var asOfDate = formatAsOfLabel_(data.asOfDate);
  var minDays = Number(data.minDaysNotWorking) || 1;
  var riders = (Array.isArray(data.riders) ? data.riders : []).filter(function (r) {
    return String(r.deployStatus || '').toLowerCase() !== 'return';
  });
  var to = parseEmails_(data.email);
  var cc = mergeCcEmails_(data.ccEmail);

  // Fallback: leadership CC if dashboard sent empty TO (e.g. city sheet To = <Email>)
  if (!to.length) {
    to = parseEmails_(FIXED_CC);
  }
  if (!to.length) {
    return jsonResponse_({ ok: false, error: 'No recipient email for ' + city });
  }
  if (!riders.length) {
    return jsonResponse_({ ok: false, error: 'No mail-eligible riders for ' + city + ' (Return status excluded)' });
  }

  var stats = summarizeAttritionRiders_(riders);
  var subject =
    'Rider Attrition — ' +
    city +
    ' | ' +
    riders.length +
    ' riders | As of ' +
    asOfDate;

  var html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;">' +
    '<h2 style="margin:0 0 8px;color:#b91c1c;">Rider Attrition Report</h2>' +
    '<p style="margin:0 0 16px;color:#444;">' +
    '<strong>City:</strong> ' +
    esc_(city) +
    '<br>' +
    '<strong>Data as of:</strong> ' +
    esc_(asOfDate) +
    '<br>' +
    '<strong>Criteria:</strong> Riders not working for ' +
    minDays +
    '+ day(s) since last working date' +
    '</p>' +
    buildAttritionSummaryTable_(stats) +
    buildAttritionClientMatrixTable_(stats.matrix) +
    buildAttritionRiderDetailsNote_(riders, city, asOfDate) +
    '<p style="margin:24px 0 0;font-size:12px;color:#666;">Sent from FleetPro Rider Attrition Mailer.</p>' +
    '</div>';

  var attachmentName = attritionRiderAttachmentName_(city, asOfDate);
  var riderBlob = Utilities.newBlob(
    '\ufeff' + buildAttritionRiderCsv_(riders),
    'application/vnd.ms-excel;charset=utf-8',
    attachmentName
  );

  GmailApp.sendEmail(to.join(','), subject, plainAttritionBody_(city, asOfDate, minDays, riders, stats), {
    name: MAIL_FROM_NAME,
    htmlBody: html,
    cc: cc.length ? cc.join(',') : undefined,
    attachments: [riderBlob],
  });

  return jsonResponse_({ ok: true, city: city, sent: to.length, riders: riders.length });
}

function emptyBucketCounts_() {
  var buckets = {};
  ATTRITION_BUCKETS.forEach(function (days) {
    buckets[days] = { ev: 0, nonEv: 0 };
  });
  return buckets;
}

function isEvRider_(r) {
  return String(r.vType || '').toUpperCase() === 'EV';
}

function summarizeAttritionRiders_(riders) {
  var byClient = {};
  var ev = 0;
  var nonEv = 0;
  var matrixTotals = emptyBucketCounts_();

  riders.forEach(function (r) {
    var client = safe_(r.client, 'Unknown');
    var days = Number(r.daysNotWorking) || 0;
    var riderIsEv = isEvRider_(r);

    if (!byClient[client]) {
      byClient[client] = { client: client, count: 0, ev: 0, nonEv: 0, buckets: emptyBucketCounts_() };
    }
    byClient[client].count++;
    if (riderIsEv) {
      ev++;
      byClient[client].ev++;
    } else {
      nonEv++;
      byClient[client].nonEv++;
    }

    ATTRITION_BUCKETS.forEach(function (threshold) {
      if (days >= threshold) {
        if (riderIsEv) {
          byClient[client].buckets[threshold].ev++;
          matrixTotals[threshold].ev++;
        } else {
          byClient[client].buckets[threshold].nonEv++;
          matrixTotals[threshold].nonEv++;
        }
      }
    });
  });

  var clientRows = Object.keys(byClient)
    .map(function (k) {
      var row = byClient[k];
      row.grandTotal = row.ev + row.nonEv;
      return row;
    })
    .sort(function (a, b) {
      return b.grandTotal - a.grandTotal || a.client.localeCompare(b.client);
    });

  return {
    total: riders.length,
    ev: ev,
    nonEv: nonEv,
    byClient: clientRows,
    matrix: {
      clients: clientRows,
      totals: matrixTotals,
      overall: { ev: ev, nonEv: nonEv, grandTotal: riders.length },
    },
  };
}

function buildAttritionSummaryTable_(stats) {
  return (
    '<table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:16px;">' +
    '<tr>' +
    cell_('Total attrition', stats.total, '#fef2f2', '#b91c1c', true) +
    cell_('EV', stats.ev, '#ecfdf5', '#047857', true) +
    cell_('NON-EV', stats.nonEv, '#eff6ff', '#1d4ed8', true) +
    '</tr></table>'
  );
}

function buildAttritionClientMatrixTable_(matrix) {
  if (!matrix || !matrix.clients.length) return '';

  var border = 'border:1px solid #000;';
  var base =
    'padding:6px 8px;text-align:center;font-size:12px;font-weight:bold;color:#000;' + border;
  var h =
    '<h3 style="margin:16px 0 8px;">Client wise attrition</h3>' +
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1100px;">' +
    '<tr>' +
    '<th rowspan="2" style="' +
    base +
    'background:#fff;min-width:120px;">Client</th>';

  ATTRITION_BUCKETS.forEach(function (days, i) {
    h +=
      '<th colspan="2" style="' +
      base +
      'background:' +
      ATTRITION_BUCKET_COLORS[i] +
      ';">' +
      days +
      '+ days Attrition</th>';
  });

  h +=
    '<th colspan="2" style="' +
    base +
    'background:' +
    ATTRITION_TOTAL_GROUP_BG +
    ';color:#fff;">Total</th>' +
    '<th rowspan="2" style="' +
    base +
    'background:' +
    ATTRITION_GRAND_TOTAL_BG +
    ';min-width:56px;">Total</th>' +
    '</tr><tr>';

  ATTRITION_BUCKETS.forEach(function () {
    h +=
      '<th style="' +
      base +
      'background:' +
      ATTRITION_EV_NONEV_BG +
      ';">EV</th>' +
      '<th style="' +
      base +
      'background:' +
      ATTRITION_EV_NONEV_BG +
      ';">NON-EV</th>';
  });

  h +=
    '<th style="' +
    base +
    'background:' +
    ATTRITION_EV_NONEV_BG +
    ';">EV</th>' +
    '<th style="' +
    base +
    'background:' +
    ATTRITION_EV_NONEV_BG +
    ';">NON-EV</th>' +
    '</tr>';

  matrix.clients.forEach(function (row) {
    h += '<tr><td style="' + base + 'background:#fff;text-align:left;">' + esc_(row.client) + '</td>';
    ATTRITION_BUCKETS.forEach(function (days) {
      var bucket = row.buckets[days];
      h +=
        '<td style="' + base + 'background:#fff;">' + esc_(bucket.ev) + '</td>' +
        '<td style="' + base + 'background:#fff;">' + esc_(bucket.nonEv) + '</td>';
    });
    h +=
      '<td style="' + base + 'background:#fff;">' + esc_(row.ev) + '</td>' +
      '<td style="' + base + 'background:#fff;">' + esc_(row.nonEv) + '</td>' +
      '<td style="' + base + 'background:' + ATTRITION_GRAND_TOTAL_BG + ';">' + esc_(row.grandTotal) + '</td>';
    h += '</tr>';
  });

  var overall = matrix.overall || { ev: 0, nonEv: 0, grandTotal: 0 };
  h += '<tr><td style="' + base + 'background:#f3f4f6;text-align:left;">Total</td>';
  ATTRITION_BUCKETS.forEach(function (days) {
    var bucket = matrix.totals[days];
    h +=
      '<td style="' + base + 'background:#f3f4f6;">' + esc_(bucket.ev) + '</td>' +
      '<td style="' + base + 'background:#f3f4f6;">' + esc_(bucket.nonEv) + '</td>';
  });
  h +=
    '<td style="' + base + 'background:#f3f4f6;">' + esc_(overall.ev) + '</td>' +
    '<td style="' + base + 'background:#f3f4f6;">' + esc_(overall.nonEv) + '</td>' +
    '<td style="' + base + 'background:' + ATTRITION_GRAND_TOTAL_BG + ';">' + esc_(overall.grandTotal) + '</td>';
  h += '</tr></table>';
  return h;
}

function csvEscape_(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function sortAttritionRidersForExport_(riders) {
  return riders.slice().sort(function (a, b) {
    var src = safe_(a.source, 'N/A').localeCompare(safe_(b.source, 'N/A'), undefined, { sensitivity: 'base' });
    if (src !== 0) return src;
    var cli = safe_(a.client, '').localeCompare(safe_(b.client, ''), undefined, { sensitivity: 'base' });
    if (cli !== 0) return cli;
    return safe_(a.name, '').localeCompare(safe_(b.name, ''), undefined, { sensitivity: 'base' });
  });
}

function buildAttritionRiderCsv_(riders) {
  var headers = [
    'Rider Name',
    'Worker Code',
    'Mobile',
    'City',
    'City Key',
    'Client',
    'Hub',
    'Source',
    'V Type',
    'Deployee Vehicle',
    'Fleet Status',
    'Deploy Date',
    'First Order Date',
    'Last Working Date',
    'Days Not Working',
  ];
  var lines = [headers.join(',')];
  sortAttritionRidersForExport_(riders).forEach(function (r) {
    lines.push(
      [
        r.name,
        r.workerCode,
        r.phone,
        r.city,
        r.cityKey || '',
        r.client,
        r.hub,
        r.source,
        r.vType || 'NON-EV',
        r.deployVehicle || 'N/A',
        r.deployStatus || 'N/A',
        r.deployDate || '',
        r.firstOrderDate,
        r.lastWorkingDate,
        r.daysNotWorking,
      ]
        .map(csvEscape_)
        .join(',')
    );
  });
  return lines.join('\r\n');
}

function attritionRiderAttachmentName_(city, asOfDate) {
  var safeCity = String(city || 'City')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_');
  var safeDate = String(asOfDate || '').replace(/\//g, '-');
  return 'Rider_Attrition_' + safeCity + '_' + safeDate + '.csv';
}

function buildAttritionRiderDetailsNote_(riders, city, asOfDate) {
  var fileName = attritionRiderAttachmentName_(city, asOfDate);
  return (
    '<div style="margin:24px 0 12px;padding:14px 16px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">' +
    '<h3 style="margin:0 0 6px;color:#166534;">Rider details (' +
    riders.length +
    ' riders)</h3>' +
    '<p style="margin:0;color:#166534;font-size:13px;">Full rider list is attached as <strong>' +
    esc_(fileName) +
    '</strong>. Open in Excel (Source A→Z sorted).</p>' +
    '</div>'
  );
}

function buildAttritionRiderTable_(riders) {
  var sorted = riders.slice().sort(function (a, b) {
    var src = safe_(a.source, 'N/A').localeCompare(safe_(b.source, 'N/A'), undefined, { sensitivity: 'base' });
    if (src !== 0) return src;
    var cli = safe_(a.client, '').localeCompare(safe_(b.client, ''), undefined, { sensitivity: 'base' });
    if (cli !== 0) return cli;
    return safe_(a.name, '').localeCompare(safe_(b.name, ''), undefined, { sensitivity: 'base' });
  });

  var h =
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;font-size:12px;border-color:#ddd;">' +
    '<tr style="background:#f3f4f6;">' +
    th_('Rider') +
    th_('Worker code') +
    th_('Client') +
    th_('V type') +
    th_('Deployee vehicle') +
    th_('Fleet status') +
    th_('Deploy date') +
    th_('First order') +
    th_('Last working') +
    th_('Days not working') +
    th_('Hub') +
    th_('Source') +
    th_('Phone') +
    '</tr>';

  sorted.forEach(function (r) {
    var vType = String(r.vType || 'NON-EV').toUpperCase();
    var vColor = vType === 'EV' ? '#047857' : '#1d4ed8';
    h +=
      '<tr>' +
      td_(r.name) +
      td_(r.workerCode) +
      td_(r.client) +
      '<td style="padding:6px;border:1px solid #ddd;color:' +
      vColor +
      ';font-weight:bold;">' +
      esc_(vType) +
      '</td>' +
      td_(r.deployVehicle || 'N/A') +
      td_(r.deployStatus || 'N/A') +
      td_(r.deployDate || 'N/A') +
      td_(r.firstOrderDate) +
      td_(r.lastWorkingDate) +
      '<td style="padding:6px;border:1px solid #ddd;color:#b91c1c;font-weight:bold;">' +
      esc_(r.daysNotWorking) +
      '</td>' +
      td_(r.hub) +
      td_(r.source) +
      td_(r.phone) +
      '</tr>';
  });

  return h + '</table>';
}

function plainAttritionBody_(city, asOfDate, minDays, riders, stats) {
  var lines = [
    'Rider Attrition Report',
    'City: ' + city,
    'Data as of: ' + asOfDate,
    'Criteria: ' + minDays + '+ days not working since LWD',
    '',
    'Total: ' + stats.total + ' | EV: ' + stats.ev + ' | NON-EV: ' + stats.nonEv,
    '',
    '--- Client wise attrition matrix ---',
  ];
  stats.matrix.clients.forEach(function (r) {
    var parts = [r.client + ':'];
    ATTRITION_BUCKETS.forEach(function (days) {
      parts.push(days + '+ EV ' + r.buckets[days].ev + ' / NON-EV ' + r.buckets[days].nonEv);
    });
    lines.push(parts.join(' '));
  });
  lines.push('', '--- Rider details: see attached Excel file (' + riders.length + ' riders) ---');
  return lines.join('\n');
}

// ─── Inactive Rider (grouped) — keep if same web app URL ───────────────────

function sendInactiveGroupedEmail_(data) {
  var city = safe_(data.city, 'Unknown');
  var daysThreshold = Number(data.daysThreshold) || 5;
  var riders = Array.isArray(data.riders) ? data.riders : [];
  var to = parseEmails_(data.email);
  var cc = mergeCcEmails_(data.ccEmail);

  if (!to.length) {
    return jsonResponse_({ ok: false, error: 'No recipient email for ' + city });
  }

  var subject = 'Inactive Riders — ' + city + ' | ' + riders.length + ' riders | ' + daysThreshold + '+ days';
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;">' +
    '<h2>Inactive Rider Alert — ' +
    esc_(city) +
    '</h2>' +
    '<p><strong>Threshold:</strong> ' +
    daysThreshold +
    '+ days inactive</p>' +
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;font-size:12px;">' +
    '<tr style="background:#f3f4f6;"><th>Rider</th><th>Code</th><th>Client</th><th>Last active</th><th>Days</th><th>Phone</th></tr>';

  riders.forEach(function (r) {
    html +=
      '<tr><td>' +
      esc_(r.name) +
      '</td><td>' +
      esc_(r.workerCode) +
      '</td><td>' +
      esc_(r.client) +
      '</td><td>' +
      esc_(r.lastActive) +
      '</td><td>' +
      esc_(r.daysInactive) +
      '</td><td>' +
      esc_(r.phone) +
      '</td></tr>';
  });

  html += '</table></div>';

  GmailApp.sendEmail(to.join(','), subject, 'Inactive riders for ' + city + ': ' + riders.length, {
    name: MAIL_FROM_NAME,
    htmlBody: html,
    cc: cc.length ? cc.join(',') : undefined,
  });

  return jsonResponse_({ ok: true, city: city, riders: riders.length });
}

function sendInactiveSingleEmail_(data) {
  var to = parseEmails_(data.email);
  if (!to.length) return jsonResponse_({ ok: false, error: 'No email' });

  var subject = 'Inactive Rider Reminder — ' + safe_(data.name, 'Rider');
  var body =
    'Hi ' +
    safe_(data.name, 'Rider') +
    ',\n\nWe noticed you have not completed deliveries for ' +
    safe_(data.daysInactive, '?') +
    ' days.\nLast active: ' +
    safe_(data.lastActive, 'N/A') +
    '\nWorker code: ' +
    safe_(data.workerCode, '') +
    '\n\nPlease contact your hub if you need support.';

  var cc = mergeCcEmails_(data.ccEmail);
  GmailApp.sendEmail(to[0], subject, body, {
    name: MAIL_FROM_NAME,
    cc: cc.length ? cc.join(',') : undefined,
  });

  return jsonResponse_({ ok: true });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseRequest_(e) {
  if (e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  if (e.parameter && Object.keys(e.parameter).length) {
    return e.parameter;
  }
  return null;
}

function parseEmails_(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;]/)
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s && s.indexOf('@') > 0 && s !== '<Email>';
    });
}

/** Always CC leadership team; merges with optional extra CC from dashboard. */
function mergeCcEmails_(extra) {
  var seen = {};
  var merged = [];
  parseEmails_([FIXED_CC, extra].filter(Boolean).join(',')).forEach(function (email) {
    var key = email.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    merged.push(email);
  });
  return merged;
}

function formatAsOfLabel_(asOfDate) {
  if (!asOfDate) return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var parts = String(asOfDate).split('-');
  if (parts.length === 3) {
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  return String(asOfDate);
}

function safe_(v, fallback) {
  var s = v == null ? '' : String(v).trim();
  return s || fallback || '';
}

function esc_(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function th_(label) {
  return (
    '<th style="padding:6px;border:1px solid #ddd;text-align:left;background:#f3f4f6;">' +
    esc_(label) +
    '</th>'
  );
}

function td_(text) {
  return '<td style="padding:6px;border:1px solid #ddd;">' + esc_(text) + '</td>';
}

function cell_(label, value, bg, color, bold) {
  return (
    '<td style="padding:12px 16px;background:' +
    bg +
    ';border:1px solid #ddd;text-align:center;min-width:100px;">' +
    '<div style="font-size:12px;color:#555;">' +
    esc_(label) +
    '</div>' +
    '<div style="font-size:22px;color:' +
    color +
    ';' +
    (bold ? 'font-weight:bold;' : '') +
    '">' +
    esc_(value) +
    '</div></td>'
  );
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Manual test in Apps Script editor — Run → testAttritionMail */
function testAttritionMail() {
  sendAttritionGroupedEmail_({
    isAttritionGrouped: true,
    email: TEST_MAIL_TO,
    ccEmail: '',
    city: 'Bengaluru',
    asOfDate: '2026-06-09',
    minDaysNotWorking: 1,
    riders: [
      {
        name: 'Test Rider EV 16d',
        workerCode: 'BLR001',
        phone: '9876543210',
        city: 'Bengaluru',
        client: 'Flipkart-LMA',
        hub: 'Bommanahalli',
        source: 'Source A',
        firstOrderDate: '01/04/2026',
        lastWorkingDate: '24/05/2026',
        daysNotWorking: 16,
        vType: 'EV',
        deployVehicle: 'KA01AB1234',
        deployStatus: 'Deployee',
        deployDate: '24/05/2026',
      },
      {
        name: 'Test Rider NON-EV 8d',
        workerCode: 'BLR002',
        phone: '9876543211',
        city: 'Bengaluru',
        client: 'Zepto',
        hub: 'Koramangala',
        source: 'Source B',
        firstOrderDate: '15/05/2026',
        lastWorkingDate: '01/06/2026',
        daysNotWorking: 8,
        vType: 'NON-EV',
        deployVehicle: 'N/A',
        deployStatus: 'N/A',
        deployDate: '',
      },
      {
        name: 'Test Rider EV 4d',
        workerCode: 'BLR003',
        phone: '9876543212',
        city: 'Bengaluru',
        client: 'Flipkart-LMA',
        hub: 'Whitefield',
        source: 'Source A',
        firstOrderDate: '10/05/2026',
        lastWorkingDate: '05/06/2026',
        daysNotWorking: 4,
        vType: 'EV',
        deployVehicle: 'KA02CD5678',
        deployStatus: 'Deployee',
        deployDate: '05/06/2026',
      },
      {
        name: 'Test Rider NON-EV 11d',
        workerCode: 'BLR004',
        phone: '9876543213',
        city: 'Bengaluru',
        client: 'Swiggy',
        hub: 'HSR',
        source: 'Source C',
        firstOrderDate: '20/04/2026',
        lastWorkingDate: '29/05/2026',
        daysNotWorking: 11,
        vType: 'NON-EV',
        deployVehicle: 'N/A',
        deployStatus: 'N/A',
        deployDate: '',
      },
    ],
  });
}
