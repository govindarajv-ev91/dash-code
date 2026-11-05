import { createClient } from 'npm:@supabase/supabase-js@2.102.1'
import { createRiderPaymentsHandler } from './handler.js'
import { fetchRiderPaymentFeed } from './lib/riderPaymentFeed.js'
import { asDenoHandler } from './serve.js'

Deno.serve(asDenoHandler(createRiderPaymentsHandler({
  getApiKey: () => Deno.env.get('RIDER_PAYMENT_API_KEY'),
  // Match local API permissions; never use the service role for payment reads.
  getClient: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  load: (options) => fetchRiderPaymentFeed({
    ...options,
    misApiKey: Deno.env.get('EV91_MIS_API_KEY') || 'ev91-mis-public-2026',
  }),
})))
