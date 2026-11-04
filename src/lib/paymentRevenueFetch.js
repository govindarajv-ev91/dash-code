import { supabase } from './supabaseClient'
import { readSupabasePage } from './supabaseFetch'

const RPC = 'rider_payment_revenue_overview'
const PAGE_SIZE = 1000
const TIMEOUT_MS = 15000

function incomplete() {
  return new Error('Payment summary changed or returned an incomplete page. Please retry.')
}

export function canUseRawPaymentFallback(error) {
  return ['PGRST202', '42883', '57014', 'REQUEST_TIMEOUT'].includes(error?.code) ||
    error?.name === 'TimeoutError' || /could not find the function|function .* does not exist/i.test(error?.message || '')
}

/** PostgREST caps function results too. Fetch every group before publishing totals. */
export async function fetchCompletePaymentRevenue(onProgress = () => {}) {
  const controller = new AbortController()
  const page = async (from, to, count = false) => {
    const query = supabase.rpc(RPC, {}, count ? { count: 'exact' } : {})
      .order('month', { ascending: true }).order('client_name', { ascending: true })
      .order('rider_id', { ascending: true }).order('id', { ascending: true })
      .range(from, to)
    const result = await readSupabasePage(query, 'payment summary', TIMEOUT_MS, controller.signal)
    if (result.error) throw result.error
    if (!Array.isArray(result.data) || result.data.length > to - from + 1) throw incomplete()
    return result
  }

  const first = await page(0, PAGE_SIZE - 1, true)
  const total = Number.isSafeInteger(first.count) && first.count >= 0 ? first.count : null
  let loadedRows = first.data.length
  onProgress({ loadedRows, total })
  if (total !== null && (loadedRows > total || (!loadedRows && total))) throw incomplete()
  if (!loadedRows) return []

  // With an exact grouped count, fetch disjoint ranges concurrently. The first
  // response tells us the actual server cap, which can be below PAGE_SIZE.
  if (total !== null) {
    const stride = first.data.length
    const parts = [first.data]
    let nextOffset = stride
    let failure
    await Promise.allSettled(Array.from({ length: Math.min(4, Math.ceil((total - stride) / stride)) }, async () => {
      try {
        while (nextOffset < total) {
          const start = nextOffset
          nextOffset += stride
          const end = Math.min(start + stride, total)
          const rows = []
          while (start + rows.length < end) {
            const result = await page(start + rows.length, end - 1)
            if (!result.data.length) throw incomplete()
            rows.push(...result.data)
            loadedRows += result.data.length
            onProgress({ loadedRows, total })
          }
          parts[start / stride] = rows
        }
      } catch (error) {
        if (!failure) failure = error
        controller.abort(error)
      }
    }))
    if (failure) throw failure
    if (loadedRows !== total) throw incomplete()
    return parts.flat()
  }

  // Some gateways omit count metadata. A short response alone does not prove
  // completeness; continue by the actual returned length until an empty page.
  const rows = [...first.data]
  while (true) {
    const result = await page(rows.length, rows.length + PAGE_SIZE - 1)
    if (!result.data.length) return rows
    rows.push(...result.data)
    onProgress({ loadedRows: rows.length, total: null })
  }
}
