import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
)

async function diagnose() {
  // Fetch all delivered values in batches WITHOUT ordering (to avoid timeout)
  let totalOrders = 0
  let rowCount = 0
  let badValues = []
  let from = 0

  console.log('Fetching all rider_metrics...')
  while (true) {
    const { data, error } = await supabase
      .from('rider_metrics')
      .select('delivered')
      .range(from, from + 999)

    if (error) {
      console.error(`Error at range ${from}:`, error.message)
      break
    }
    if (!data || data.length === 0) break

    data.forEach(r => {
      const raw = r.delivered
      const parsed = parseInt(raw, 10)
      if (isNaN(parsed)) {
        // Non-parseable value - collect first 20
        if (badValues.length < 20) badValues.push(raw)
      } else {
        totalOrders += parsed
      }
    })

    rowCount += data.length
    if (data.length < 1000) break
    from += 1000

    if (from % 20000 === 0) console.log(`  Processed ${from} rows, sum so far: ${totalOrders}`)
  }

  console.log(`\nTotal rows processed: ${rowCount}`)
  console.log(`Total orders (parseInt sum): ${totalOrders.toLocaleString()}`)
  console.log(`Non-parseable delivered values:`, badValues)

  // Also try parseFloat in case some are like "32.0"
  console.log('\n--- Re-checking with parseFloat ---')
  let totalFloat = 0
  from = 0
  while (true) {
    const { data, error } = await supabase.from('rider_metrics').select('delivered').range(from, from + 999)
    if (error || !data || data.length === 0) break
    data.forEach(r => { totalFloat += parseFloat(r.delivered) || 0 })
    if (data.length < 1000) break
    from += 1000
  }
  console.log(`Total orders (parseFloat sum): ${totalFloat.toLocaleString()}`)
}

diagnose()
