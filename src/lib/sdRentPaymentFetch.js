import { fetchAllData, readSupabasePage } from './supabaseFetch'

const TABLE = 'rider_payment_data'
const CONCURRENCY = 4
const PAGE_SIZE = 1000
const REQUEST_TIMEOUT_MS = 15000

async function readInitialPage(build, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await readSupabasePage(build(), TABLE, REQUEST_TIMEOUT_MS, signal)
      if (result.error) throw result.error
      return result
    } catch (error) {
      if (signal.aborted || error?.code === '42703' || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
}

function rowId(row) {
  const id = String(row?.id ?? '')
  if (!/^\d+$/.test(id)) throw new Error('Unable to read complete payment history: invalid payment ID.')
  return BigInt(id)
}

/** Disjoint primary-key ranges avoid both OFFSET scans and a serial full-table download. */
export function createSdRentPaymentScan(client, columns) {
  let firstRows = null
  let ranges = null
  let estimatedRows = null
  let loadedRows = 0
  let complete = false

  return {
    get complete() { return complete },
    async load(onProgress = () => {}) {
      const controller = new AbortController()
      const report = () => onProgress({ loadedRows, estimatedRows, complete })
      report()

      if (!ranges) {
        // A maximum ID bounds this scan while new uploads are arriving. Reuse
        // the first batch rather than probing and then downloading it twice.
        let first, last
        try {
          ;[first, last] = await Promise.all([
            readInitialPage(() => client.from(TABLE).select(columns, { count: 'planned' })
              .order('id', { ascending: true }).limit(PAGE_SIZE), controller.signal),
            readInitialPage(() => client.from(TABLE).select('id')
              .order('id', { ascending: false }).limit(1), controller.signal),
          ])
          if (first.error || last.error) throw first.error || last.error
        } catch (error) {
          controller.abort(error)
          throw error
        }
        estimatedRows = first.count ?? null
        if (!last.data?.length) {
          if (first.data?.length) throw new Error('Payment history changed during loading. Please retry.')
          firstRows = []
          ranges = []
        } else {
          const maxId = rowId(last.data[0])
          firstRows = (first.data || []).filter((row) => rowId(row) <= maxId)
          if (!firstRows.length) throw new Error('Payment history changed during loading. Please retry.')
          const start = rowId(firstRows.at(-1)) + 1n
          const remaining = maxId - start + 1n
          const width = remaining > 0n ? (remaining + BigInt(CONCURRENCY) - 1n) / BigInt(CONCURRENCY) : 0n
          ranges = []
          for (let from = start; width && from <= maxId; from += width) {
            ranges.push({ from: String(from), to: String(from + width - 1n < maxId ? from + width - 1n : maxId),
              rows: [], cursor: null, complete: false })
          }
        }
        loadedRows = firstRows.length
        report()
      }

      let failure
      await Promise.allSettled(ranges.filter((range) => !range.complete).map(async (range) => {
        try {
          await fetchAllData(TABLE, columns, 'id', {
            pageSize: PAGE_SIZE, useKeyset: true, untilEmpty: true, throwOnError: true,
            maxRetries: 2, requestTimeoutMs: REQUEST_TIMEOUT_MS, signal: controller.signal,
            initialCursor: range.cursor,
            queryModifier: (query) => query.gte('id', range.from).lte('id', range.to),
            onPage: (rows) => {
              range.rows.push(...rows)
              range.cursor = rows.at(-1).id
              loadedRows += rows.length
              report()
            },
          })
          range.complete = true
        } catch (error) {
          if (!failure) failure = error
          controller.abort(error)
        }
      }))
      if (failure) throw failure
      // Keep checkpoints on failure so Retry continues rather than downloading
      // completed batches again. Callers discard this scan after an upload.
      complete = true
      report()
      return [...firstRows, ...ranges.flatMap((range) => range.rows)]
    },
  }
}
