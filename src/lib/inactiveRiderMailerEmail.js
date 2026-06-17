/** Build grouped inactive-rider email HTML (dashboard → Apps Script). */

export function parseInactiveMailRentalAmount(value) {
  if (value === '' || value == null || value === '-') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatInactiveMailRental(value) {
  if (value === '' || value == null || value === '-') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sumRentalPending(riders) {
  return (riders || []).reduce(
    (sum, rider) => sum + parseInactiveMailRentalAmount(rider.rentalPendingAmount),
    0
  )
}

/** Sources and riders sorted by rental pending — largest to smallest. */
function buildSortedSourceGroups(groups) {
  return Object.entries(groups)
    .map(([sourceName, groupRiders]) => {
      const riders = [...groupRiders].sort(
        (a, b) =>
          parseInactiveMailRentalAmount(b.rentalPendingAmount) -
          parseInactiveMailRentalAmount(a.rentalPendingAmount)
      )
      return {
        sourceName,
        riders,
        total: sumRentalPending(groupRiders),
      }
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      if (b.riders.length !== a.riders.length) return b.riders.length - a.riders.length
      return a.sourceName.localeCompare(b.sourceName)
    })
}

export function mapRidersToMailPayload(riders) {
  return (riders || []).map((r) => ({
    name: r.worker_name,
    riderId: r.riderId,
    workerCode: r.worker_code,
    phone: r.mob_number,
    lastActive: r.lastActiveDate,
    client: r.client,
    daysInactive: r.daysSinceActive,
    vehicle: r.vehicle,
    model: r.model,
    source: r.source || 'Team',
    rentalPendingAmount: r.rentalPendingAmount ?? '',
  }))
}

export function buildInactiveGroupedMail({ city, daysThreshold, riders }) {
  const cityName = city || 'Various Cities'
  const threshold = daysThreshold || 5
  const list = riders || []

  const groups = {}
  for (const rider of list) {
    const source = rider.source || 'Other Team'
    if (!groups[source]) groups[source] = []
    groups[source].push(rider)
  }

  const sortedSources = buildSortedSourceGroups(groups)
  let grandRentalTotal = 0

  let htmlBody =
    "<div style='font-family: sans-serif; color: #333;'>" +
    '<h3>Hi Team,</h3>' +
    '<p>We noticed that the following riders in <b>' +
    esc(cityName) +
    '</b> have been inactive for more than ' +
    threshold +
    ' days.</p>' +
    '<p>Please investigate and help these riders get back on the road. Sources are sorted by <b>Rental Pending Total</b> (highest first), and riders within each source are listed the same way.</p>' +
    "<div style='margin-top: 20px; margin-bottom: 10px;'>" +
    "<span style='font-weight: bold; font-size: 0.95rem; color: #334155;'>Rental Pending — Source-wise Summary</span>" +
    '</div>' +
    "<table border='1' cellpadding='8' style='border-collapse: collapse; width: 100%; max-width: 520px; border: 1px solid #ddd; margin-bottom: 10px;'>" +
    "<tr style='background-color: #f8fafc; color: #64748b; font-size: 0.85rem;'>" +
    '<th style="text-align: left;">Source</th><th style="text-align: center;">Riders</th><th style="text-align: right;">Rental Pending Total</th>' +
    '</tr>'

  for (const { sourceName, riders: groupRiders, total: sourceTotal } of sortedSources) {
    grandRentalTotal += sourceTotal
    htmlBody +=
      "<tr style='font-size: 0.85rem;'>" +
      '<td style="font-weight: 600;">' +
      esc(sourceName) +
      '</td>' +
      '<td style="text-align: center;">' +
      groupRiders.length +
      '</td>' +
      "<td style='text-align: right; font-weight: bold; color: #b45309;'>" +
      formatInactiveMailRental(sourceTotal) +
      '</td>' +
      '</tr>'
  }

  htmlBody +=
    "<tr style='background-color: #fef3c7; font-size: 0.9rem;'>" +
    '<td style="font-weight: bold;">Grand Total</td>' +
    '<td style="text-align: center; font-weight: bold;">' +
    list.length +
    '</td>' +
    "<td style='text-align: right; font-weight: bold; color: #b45309;'>" +
    formatInactiveMailRental(grandRentalTotal) +
    '</td>' +
    '</tr></table>'

  for (const { sourceName: source, riders: sourceRiders, total: sourceRentalTotal } of sortedSources) {
    htmlBody +=
      "<div style='margin-top: 25px; margin-bottom: 10px;'>" +
      "<span style='background-color: #4f46e5; color: white; padding: 5px 12px; border-radius: 4px; font-weight: bold; font-size: 0.9rem;'>" +
      esc(source) +
      ' (' +
      sourceRiders.length +
      ' Riders)</span>' +
      "<span style='margin-left: 10px; font-size: 0.85rem; color: #b45309; font-weight: bold;'>Rental Pending Total: " +
      formatInactiveMailRental(sourceRentalTotal) +
      '</span>' +
      '</div>' +
      "<table border='1' cellpadding='8' style='border-collapse: collapse; width: 100%; border: 1px solid #ddd;'>" +
      "<tr style='background-color: #f8fafc; color: #64748b; font-size: 0.85rem;'>" +
      '<th>Rider Name</th><th>Rider ID</th><th>Phone</th><th>Model</th><th>Client</th><th>Last Active</th><th>Days Inactive</th><th>Rental Pending</th>' +
      '</tr>'

    for (const rider of sourceRiders) {
      htmlBody +=
        "<tr style='font-size: 0.85rem;'>" +
        '<td>' +
        esc(rider.name || '-') +
        '</td>' +
        '<td>' +
        esc(rider.riderId || rider.workerCode || '-') +
        '</td>' +
        '<td>' +
        esc(rider.phone || '-') +
        '</td>' +
        '<td>' +
        esc((rider.vehicle || '-') + ' ' + (rider.model || '')) +
        '</td>' +
        '<td>' +
        esc(rider.client || '-') +
        '</td>' +
        '<td>' +
        esc(rider.lastActive || 'Never') +
        '</td>' +
        "<td style='text-align: center; color: #ef4444; font-weight: bold;'>" +
        esc(rider.daysInactive ?? '-') +
        '</td>' +
        "<td style='text-align: right; font-weight: bold;'>" +
        formatInactiveMailRental(rider.rentalPendingAmount) +
        '</td>' +
        '</tr>'
    }

    htmlBody +=
      "<tr style='background-color: #fffbeb; font-size: 0.85rem; font-weight: bold;'>" +
      '<td colspan="7" style="text-align: right; color: #334155;">Source Rental Pending Total</td>' +
      "<td style='text-align: right; color: #b45309;'>" +
      formatInactiveMailRental(sourceRentalTotal) +
      '</td>' +
      '</tr></table>'
  }

  htmlBody +=
    '<br><p>It is Auto Mail, If you have any updates regarding these riders, please reply to this email.</p>' +
    '<p>Best regards,<br><b>The Central Team</b></p></div>'

  const subject =
    'Action Required: Inactive Riders Summary - ' + cityName + ' (' + list.length + ' Riders)'

  return { subject, htmlBody }
}
