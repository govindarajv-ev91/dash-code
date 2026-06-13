const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export function normalizeMonthLabel(value) {
  return (value ?? '').toString().trim()
}

export function monthSortKey(label) {
  const text = normalizeMonthLabel(label)
  const m = text.match(/^([A-Za-z]{3})-(\d{4})$/)
  if (m) {
    const monthIndex = MONTH_ABBR[m[1].toLowerCase()]
    const year = Number(m[2])
    if (monthIndex != null && Number.isFinite(year)) return year * 12 + monthIndex
  }
  return text.toLowerCase()
}

export function sortMonthLabels(months) {
  return [...new Set(months.map(normalizeMonthLabel).filter(Boolean))]
    .sort((a, b) => monthSortKey(b) - monthSortKey(a))
}

export function collectMonthsFromRows(rows, field = 'month') {
  const months = []
  for (const row of rows || []) {
    const label = normalizeMonthLabel(row?.[field])
    if (label) months.push(label)
  }
  return sortMonthLabels(months)
}

export function mergeMonthLists(...lists) {
  return sortMonthLabels(lists.flat())
}
