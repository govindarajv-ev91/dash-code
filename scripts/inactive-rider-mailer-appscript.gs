/**
 * Inactive Rider Mailer — separate Google Apps Script deployment
 *
 * Deploy: Extensions → Apps Script → paste this file → Deploy → New deployment
 *   Type: Web app | Execute as: Me | Who has access: Anyone
 *
 * Set in .env:
 *   VITE_INACTIVE_MAILER_SCRIPT_URL=https://script.google.com/macros/s/YOUR_INACTIVE_ID/exec
 *
 * Rider Attrition uses scripts/rider-mailer-appscript.gs (different URL).
 */

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function formatRentalPending_(value) {
  if (value === '' || value == null || value === '-') return '-';
  var n = Number(value);
  if (isNaN(n)) return value;
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseRentalAmount_(value) {
  if (value === '' || value == null || value === '-') return 0;
  var n = Number(value);
  return isNaN(n) ? 0 : n;
}

function sumRentalPending_(riders) {
  var total = 0;
  for (var i = 0; i < riders.length; i++) {
    total += parseRentalAmount_(riders[i].rentalPendingAmount);
  }
  return total;
}

function sortRidersByRental_(riders) {
  return riders.slice().sort(function (a, b) {
    return parseRentalAmount_(b.rentalPendingAmount) - parseRentalAmount_(a.rentalPendingAmount);
  });
}

function buildSortedSourceGroups_(groups) {
  var entries = [];
  for (var sourceName in groups) {
    var groupRiders = groups[sourceName];
    entries.push({
      sourceName: sourceName,
      riders: sortRidersByRental_(groupRiders),
      total: sumRentalPending_(groupRiders),
    });
  }
  entries.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    if (b.riders.length !== a.riders.length) return b.riders.length - a.riders.length;
    return a.sourceName > b.sourceName ? 1 : a.sourceName < b.sourceName ? -1 : 0;
  });
  return entries;
}

function handleRequest(e) {
  try {
    var p = e.parameter;
    var data = null;

    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = p;
    }

    // --- LIVE SETTINGS ---
    var toEmail = data.email;
    var ccEmail =
      'sujithra.y@ev91riderz.com,murali.bharath@ev91riderz.com,govindaraj.v@ev91riderz.com,deepika.c@ev91riderz.com,rajeshwari.n@ev91riderz.com';

    if (data.ccEmail && data.ccEmail.trim() !== '') {
      ccEmail = ccEmail + ',' + data.ccEmail.trim();
    }

    var cityName = data.city || 'Various Cities';
    var subject = '';
    var htmlBody = '';

    if (data.isGrouped && data.htmlBody) {
      subject = data.subject || ('Action Required: Inactive Riders Summary - ' + cityName);
      htmlBody = data.htmlBody;
    } else if (data.isGrouped && data.riders) {
      subject =
        'Action Required: Inactive Riders Summary - ' +
        cityName +
        ' (' +
        data.riders.length +
        ' Riders)';

      htmlBody =
        "<div style='font-family: sans-serif; color: #333;'>" +
        '<h3>Hi Team,</h3>' +
        '<p>We noticed that the following riders in <b>' +
        cityName +
        '</b> have been inactive for more than ' +
        (data.daysThreshold || 5) +
        ' days.</p>' +
        '<p>Please investigate and help these riders get back on the road. Sources are sorted by <b>Rental Pending Total</b> (highest first), and riders within each source are listed the same way.</p>';

      // Grouping riders by Source Name
      var groups = {};
      for (var i = 0; i < data.riders.length; i++) {
        var r = data.riders[i];
        var s = r.source || 'Other Team';
        if (!groups[s]) groups[s] = [];
        groups[s].push(r);
      }

      // Source-wise rental pending summary (sorted: largest → smallest)
      var sortedSources = buildSortedSourceGroups_(groups);
      var grandRentalTotal = 0;
      htmlBody +=
        "<div style='margin-top: 20px; margin-bottom: 10px;'>" +
        "<span style='font-weight: bold; font-size: 0.95rem; color: #334155;'>Rental Pending — Source-wise Summary</span>" +
        '</div>' +
        "<table border='1' cellpadding='8' style='border-collapse: collapse; width: 100%; max-width: 520px; border: 1px solid #ddd; margin-bottom: 10px;'>" +
        "<tr style='background-color: #f8fafc; color: #64748b; font-size: 0.85rem;'>" +
        '<th style="text-align: left;">Source</th><th style="text-align: center;">Riders</th><th style="text-align: right;">Rental Pending Total</th>' +
        '</tr>';

      for (var si = 0; si < sortedSources.length; si++) {
        var summaryEntry = sortedSources[si];
        var sourceName = summaryEntry.sourceName;
        var groupRiders = summaryEntry.riders;
        var sourceTotal = summaryEntry.total;
        grandRentalTotal += sourceTotal;
        htmlBody +=
          "<tr style='font-size: 0.85rem;'>" +
          '<td style="font-weight: 600;">' +
          sourceName +
          '</td>' +
          '<td style="text-align: center;">' +
          groupRiders.length +
          '</td>' +
          "<td style='text-align: right; font-weight: bold; color: #b45309;'>" +
          formatRentalPending_(sourceTotal) +
          '</td>' +
          '</tr>';
      }

      htmlBody +=
        "<tr style='background-color: #fef3c7; font-size: 0.9rem;'>" +
        '<td style="font-weight: bold;">Grand Total</td>' +
        '<td style="text-align: center; font-weight: bold;">' +
        data.riders.length +
        '</td>' +
        "<td style='text-align: right; font-weight: bold; color: #b45309;'>" +
        formatRentalPending_(grandRentalTotal) +
        '</td>' +
        '</tr></table>';

      // Generate Tables: One table per Source (same sort order)
      for (var di = 0; di < sortedSources.length; di++) {
        var detailEntry = sortedSources[di];
        var source = detailEntry.sourceName;
        var sourceRiders = detailEntry.riders;
        var sourceRentalTotal = detailEntry.total;

        htmlBody +=
          "<div style='margin-top: 25px; margin-bottom: 10px;'>" +
          "<span style='background-color: #4f46e5; color: white; padding: 5px 12px; border-radius: 4px; font-weight: bold; font-size: 0.9rem;'>" +
          source +
          ' (' +
          sourceRiders.length +
          ' Riders)</span>' +
          "<span style='margin-left: 10px; font-size: 0.85rem; color: #b45309; font-weight: bold;'>Rental Pending Total: " +
          formatRentalPending_(sourceRentalTotal) +
          '</span>' +
          '</div>' +
          "<table border='1' cellpadding='8' style='border-collapse: collapse; width: 100%; border: 1px solid #ddd;'>" +
          "<tr style='background-color: #f8fafc; color: #64748b; font-size: 0.85rem;'>" +
          '<th>Rider Name</th><th>Rider ID</th><th>Phone</th><th>Model</th><th>Client</th><th>Last Active</th><th>Days Inactive</th><th>Rental Pending</th>' +
          '</tr>';

        for (var j = 0; j < sourceRiders.length; j++) {
          var rider = sourceRiders[j];
          htmlBody +=
            "<tr style='font-size: 0.85rem;'>" +
            '<td>' +
            (rider.name || '-') +
            '</td>' +
            '<td>' +
            (rider.riderId || rider.workerCode || '-') +
            '</td>' +
            '<td>' +
            (rider.phone || '-') +
            '</td>' +
            '<td>' +
            (rider.vehicle || '-') +
            ' ' +
            (rider.model || '') +
            '</td>' +
            '<td>' +
            (rider.client || '-') +
            '</td>' +
            '<td>' +
            (rider.lastActive || 'Never') +
            '</td>' +
            "<td style='text-align: center; color: #ef4444; font-weight: bold;'>" +
            (rider.daysInactive || '-') +
            '</td>' +
            "<td style='text-align: right; font-weight: bold;'>" +
            formatRentalPending_(rider.rentalPendingAmount) +
            '</td>' +
            '</tr>';
        }

        htmlBody +=
          "<tr style='background-color: #fffbeb; font-size: 0.85rem; font-weight: bold;'>" +
          '<td colspan="7" style="text-align: right; color: #334155;">Source Rental Pending Total</td>' +
          "<td style='text-align: right; color: #b45309;'>" +
          formatRentalPending_(sourceRentalTotal) +
          '</td>' +
          '</tr>';

        htmlBody += '</table>';
      }

      htmlBody +=
        '<br><p>It is Auto Mail, If you have any updates regarding these riders, please reply to this email.</p>' +
        '<p>Best regards,<br><b>The Central Team</b></p></div>';
    } else {
      subject = 'Action Required: No Recent Deliveries (' + (data.riderId || data.workerCode) + ')';
      htmlBody =
        "<div style='font-family: sans-serif;'>" +
        '<h3>Hi ' +
        data.name +
        ',</h3>' +
        "<p>We noticed you haven't completed any deliveries in the past " +
        data.daysInactive +
        ' days.</p>' +
        (data.rentalPendingAmount !== '' && data.rentalPendingAmount != null
          ? '<p>Your <b>rental pending amount</b> is <b>' +
            formatRentalPending_(data.rentalPendingAmount) +
            '</b>.</p>'
          : '') +
        '<p>If you are facing any issues with your vehicle or the app, please contact support immediately.</p>' +
        '<br><p>Best regards,<br>The Central Team</p></div>';
    }

    if (toEmail && toEmail !== 'null') {
      MailApp.sendEmail({
        to: toEmail,
        cc: ccEmail,
        subject: subject,
        htmlBody: htmlBody,
      });
      return ContentService.createTextOutput('Success').setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput('Error: No recipient').setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    return ContentService.createTextOutput('Error: ' + error.toString()).setMimeType(
      ContentService.MimeType.TEXT
    );
  }
}
