import { supabase } from './lib/supabaseClient.js'

async function test() {
  console.log('Testing connection...')
  try {
    const { data: riderData, error: riderError } = await supabase
      .from('rider_metrics')
      .select('*')
      .limit(1)
    
    if (riderError) {
      console.error('Error fetching rider_metrics:', riderError)
    } else {
      console.log('rider_metrics columns:', Object.keys(riderData[0] || {}))
      console.log('rider_metrics sample:', riderData[0])
    }

    const { data: fleetData, error: fleetError } = await supabase
      .from('fleet_data')
      .select('*')
      .limit(1)

    if (fleetError) {
      console.error('Error fetching fleet_data:', fleetError)
    } else {
      console.log('fleet_data columns:', Object.keys(fleetData[0] || {}))
      console.log('fleet_data sample:', fleetData[0])
    }
  } catch (err) {
    console.error('Unexpected error:', err)
  }
}

test()
