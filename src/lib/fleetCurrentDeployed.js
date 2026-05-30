import { getCurrentlyDeployedAssignments } from './riderPerformanceReport'
import { dedupeCanonicalCities, normalizeCityKey, normalizeSummaryCity } from './citySummaryAliases'

export function buildCurrentDeployedClientCitySummary(fleetRows, asOfDate = new Date()) {
  const assignments = getCurrentlyDeployedAssignments(fleetRows, asOfDate)

  const rows = []
  const citySet = new Set()
  const clientSet = new Set()
  const countByCityClient = new Map()

  for (const assignment of assignments) {
    const city = normalizeSummaryCity(assignment.city) || 'Unknown'
    const client = (assignment.client || '').trim() || 'Unknown'
    const key = `${city}\0${client}`

    citySet.add(city)
    clientSet.add(client)
    countByCityClient.set(key, (countByCityClient.get(key) || 0) + 1)
  }

  for (const [key, count] of countByCityClient) {
    const [city, client] = key.split('\0')
    rows.push({ city, client, count })
  }

  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const clientCmp = a.client.localeCompare(b.client)
    if (clientCmp !== 0) return clientCmp
    return a.city.localeCompare(b.city)
  })

  const totalDeployed = assignments.length

  return {
    rows,
    totalDeployed,
    cities: dedupeCanonicalCities([...citySet]),
    clients: [...clientSet].sort((a, b) => a.localeCompare(b)),
  }
}

export function filterCurrentDeployedRows(rows, { city = 'All', client = 'All', clientSearch = '' }) {
  const q = clientSearch.trim().toLowerCase()
  return rows.filter((row) => {
    if (city !== 'All' && normalizeCityKey(row.city) !== normalizeCityKey(city)) return false
    if (client !== 'All' && row.client !== client) return false
    if (q && !row.client.toLowerCase().includes(q) && !row.city.toLowerCase().includes(q)) return false
    return true
  })
}

export function currentDeployedToCsv(rows, totalDeployed) {
  const escapeCsv = (val) => {
    const str = (val ?? '').toString()
    return `"${str.replace(/"/g, '""')}"`
  }

  const lines = ['Client,City,Currently Deployed']
  for (const row of rows) {
    lines.push([row.client, row.city, row.count].map(escapeCsv).join(','))
  }
  lines.push(['TOTAL', '', totalDeployed].map(escapeCsv).join(','))
  return lines.join('\n')
}
