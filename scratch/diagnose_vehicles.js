import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
)

async function diagnose() {
  // Fetch ALL fleet data to understand the vehicle tracking
  let allFleet = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('fleet_data')
      .select('vehicle_number, vehicle_status, date_record, bike_deployed_date_sd_refund_request, bike_return_date_sd_refund_request, created_at')
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    allFleet.push(...data)
    if (data.length < 1000) break
    from += 1000
    if (from % 10000 === 0) console.log(`Fetched ${from} fleet rows...`)
  }
  console.log('Total fleet rows fetched:', allFleet.length)

  // Count ALL unique status values
  const statusCounts = {}
  allFleet.forEach(r => {
    const s = (r.vehicle_status || 'Unknown').trim()
    statusCounts[s] = (statusCounts[s] || 0) + 1
  })
  console.log('\nAll status counts (raw rows):')
  Object.entries(statusCounts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  "${k}": ${v}`))

  // Now compute what the manual count might expect:
  // Strategy A: Count distinct vehicle_numbers per each status category
  const deployStatuses = new Set()
  const returnStatuses = new Set()

  allFleet.forEach(r => {
    const s = (r.vehicle_status || '').toLowerCase().trim()
    if (s.includes('deploy') || s === 'deployee') deployStatuses.add(r.vehicle_number)
    if (s.includes('return') || s === 'return') returnStatuses.add(r.vehicle_number)
  })
  console.log('\nStrategy A - Distinct vehicles EVER deployed:', deployStatuses.size)
  console.log('Strategy A - Distinct vehicles EVER returned:', returnStatuses.size)

  // Strategy B: Current status (last record per vehicle)
  const latestPerVehicle = {}
  allFleet.forEach(r => {
    // Use created_at or date_record to determine "latest"
    const vn = r.vehicle_number
    if (!latestPerVehicle[vn]) {
      latestPerVehicle[vn] = r
    } else {
      // Compare by created_at
      const prevDate = new Date(latestPerVehicle[vn].created_at || 0)
      const currDate = new Date(r.created_at || 0)
      if (currDate > prevDate) latestPerVehicle[vn] = r
    }
  })
  let currentDeployed = 0, currentReturned = 0
  Object.values(latestPerVehicle).forEach(r => {
    const s = (r.vehicle_status || '').toLowerCase().trim()
    if (s.includes('deploy') || s === 'deployee') currentDeployed++
    if (s.includes('return') || s === 'return') currentReturned++
  })
  console.log('\nStrategy B - Vehicles with current status "deployed":', currentDeployed)
  console.log('Strategy B - Vehicles with current status "returned":', currentReturned)

  // Strategy C: Count every row that has a deploy/return status (raw row count)
  let rawDeploy = 0, rawReturn = 0
  allFleet.forEach(r => {
    const s = (r.vehicle_status || '').toLowerCase().trim()
    if (s.includes('deploy') || s === 'deployee') rawDeploy++
    if (s.includes('return') || s === 'return') rawReturn++
  })
  console.log('\nStrategy C - Raw rows with deploy status:', rawDeploy)
  console.log('Strategy C - Raw rows with return status:', rawReturn)
}

diagnose()
