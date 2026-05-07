import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
)

async function diagnose() {

  // ── 1. TOTAL ORDERS ──────────────────────────────────────────────────────────
  // Get the total delivered count using Postgres aggregate (exact, single query)
  const { data: sumData, error: sumErr } = await supabase.rpc('sum_delivered')
  if (sumErr) {
    // If RPC doesn't exist, fall back to counting rows
    console.log('RPC not available, using count fallback...')
    const { count: rowCount } = await supabase.from('rider_metrics').select('*', { count: 'exact', head: true })
    console.log('Total rows in rider_metrics:', rowCount)
  } else {
    console.log('DB sum of delivered (via RPC):', sumData)
  }

  // Get a sample of delivered values to check types
  const { data: sample } = await supabase.from('rider_metrics').select('delivered').limit(5)
  console.log('\nSample delivered values (type check):', sample)

  // ── 2. DEPLOYED VEHICLES ─────────────────────────────────────────────────────
  // Count rows where vehicle_status contains 'deploy' (case-insensitive)
  const { count: deployCount } = await supabase
    .from('fleet_data')
    .select('*', { count: 'exact', head: true })
    .ilike('vehicle_status', '%deploy%')
  console.log('\nDB Deployed count (ilike deploy):', deployCount)

  // Count DISTINCT vehicle_numbers with deploy status
  const { data: deployedVehicles } = await supabase
    .from('fleet_data')
    .select('vehicle_number, vehicle_status')
    .ilike('vehicle_status', '%deploy%')
  const distinctDeployed = new Set(deployedVehicles?.map(r => r.vehicle_number)).size
  console.log('Distinct deployed vehicle_numbers:', distinctDeployed)

  // Sample of status values to see what formats exist
  const { data: statusSamples } = await supabase
    .from('fleet_data')
    .select('vehicle_status')
    .limit(20)
  const uniqueStatuses = [...new Set(statusSamples?.map(r => r.vehicle_status))]
  console.log('\nSample vehicle_status values:', uniqueStatuses)

  // ── 3. RETURNED UNITS ────────────────────────────────────────────────────────
  const { count: returnCount } = await supabase
    .from('fleet_data')
    .select('*', { count: 'exact', head: true })
    .ilike('vehicle_status', '%return%')
  console.log('\nDB Returned count (ilike return):', returnCount)

  // Count DISTINCT returned vehicle_numbers
  const { data: returnedVehicles } = await supabase
    .from('fleet_data')
    .select('vehicle_number, vehicle_status')
    .ilike('vehicle_status', '%return%')
  const distinctReturned = new Set(returnedVehicles?.map(r => r.vehicle_number)).size
  console.log('Distinct returned vehicle_numbers:', distinctReturned)

  // ── 4. TOTAL FLEET_DATA ROWS ─────────────────────────────────────────────────
  const { count: fleetTotal } = await supabase.from('fleet_data').select('*', { count: 'exact', head: true })
  console.log('\nTotal rows in fleet_data:', fleetTotal)

  // ── 5. Distinct vehicle_number count in fleet_data ───────────────────────────
  const { data: allFleet } = await supabase.from('fleet_data').select('vehicle_number, vehicle_status')
  const uniqueVehicles = new Set(allFleet?.map(r => r.vehicle_number)).size
  console.log('Distinct vehicle_numbers in fleet_data:', uniqueVehicles)

  // Group by last known status per vehicle
  const latestStatusPerVehicle = {}
  allFleet?.forEach(r => {
    latestStatusPerVehicle[r.vehicle_number] = r.vehicle_status
  })
  const statusGroups = {}
  Object.values(latestStatusPerVehicle).forEach(s => {
    const k = (s || 'Unknown').toLowerCase().trim()
    statusGroups[k] = (statusGroups[k] || 0) + 1
  })
  console.log('\nVehicle status group counts (by last record):', statusGroups)
}

diagnose()
