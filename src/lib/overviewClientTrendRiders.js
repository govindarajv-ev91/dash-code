/** Choose one city, client and type for each rider in an activity period. */
export function preferTrendRiderRecord(candidate, current) {
  if (!current) return true
  if (candidate.date !== current.date) return candidate.date > current.date
  if (candidate.orders !== current.orders) return candidate.orders > current.orders
  const cityOrder = candidate.cityName.localeCompare(current.cityName)
  if (cityOrder) return cityOrder < 0
  const clientOrder = candidate.clientName.localeCompare(current.clientName)
  if (clientOrder) return clientOrder < 0
  // Resolve conflicting types on otherwise identical records consistently.
  return candidate.isEv && !current.isEv
}

export function addTrendRider(riders, row) {
  if (!row.rider) return
  if (preferTrendRiderRecord(row, riders.get(row.rider))) riders.set(row.rider, row)
}

export function countTrendRiders(riders) {
  let evRiders = 0
  for (const row of riders.values()) if (row.isEv) evRiders += 1
  return { riders: riders.size, evRiders, nonEvRiders: riders.size - evRiders }
}
