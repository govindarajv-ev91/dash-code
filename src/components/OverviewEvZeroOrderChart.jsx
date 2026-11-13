import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export default function OverviewEvZeroOrderChart({ orderRows, overallRows, currentRows, dateFrom, dateTo, loading, error }) {
  const [preparedReport, setPreparedReport] = useState({ series: [], loading: true, error: '' })
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [options, setOptions] = useState({ cities: [], clients: [] })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const report = useMemo(() => preparedReport.withFilters
    ? { ...preparedReport.withFilters(cityFilter, clientFilter), loading: preparedReport.loading, error: preparedReport.error }
    : preparedReport, [preparedReport, cityFilter, clientFilter])

  useEffect(() => {
    let cancelled = false
    if (loading || error) return () => { cancelled = true }
    setPreparedReport({ series: [], loading: true, error: '' })
    setExportError('')
    async function load() {
      try {
        const { buildOverviewEvZeroOrderReport, collectOverviewEvZeroOrderFilterOptions } = await import('../lib/overviewEvZeroOrder')
        if (cancelled) return
        setOptions(collectOverviewEvZeroOrderFilterOptions(orderRows, overallRows, currentRows))
        let riderDetailsById = null
        if (overallRows.length || currentRows.length) {
          const { fetchEv91RiderDetails } = await import('../lib/ev91RiderPerformance')
          riderDetailsById = await fetchEv91RiderDetails()
        }
        if (cancelled) return
        const result = await buildOverviewEvZeroOrderReport({
          orderRows, overallRows, currentRows, riderDetailsById, dateFrom, dateTo,
          shouldCancel: () => cancelled,
        })
        if (!cancelled) setPreparedReport({ ...result, loading: false, error: '' })
      } catch (err) {
        if (!cancelled) setPreparedReport({ series: [], loading: false, error: err?.message || 'Could not load EV zero-order counts.' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [orderRows, overallRows, currentRows, dateFrom, dateTo, loading, error])

  const busy = loading || report.loading
  const message = error || report.error
  async function exportDetails() {
    setExporting(true)
    setExportError('')
    try {
      const { downloadOverviewEvZeroOrderExcel } = await import('../lib/overviewEvZeroOrderExcelExport')
      downloadOverviewEvZeroOrderExcel(report, { cityFilter, clientFilter })
    } catch (err) {
      setExportError(err?.message || 'Could not export rider details. Please try again.')
    } finally {
      setExporting(false)
    }
  }
  return (
    <section className="glass" aria-label="EV D-1 zero-order rider count chart" style={{ marginTop: '1.25rem', padding: '1.5rem', minWidth: 0 }}>
      <h3 style={{ marginTop: 0 }}>EV · D-1 0 order rider count</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', alignItems: 'start' }}>
        <label style={{ display: 'grid', gap: 6, fontSize: '0.8rem' }}>
          City
          <select aria-label="EV zero-order city" className="fsr-select" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} style={{ minWidth: 180, padding: '0.5rem', borderRadius: 8, background: '#0f172a', color: '#fff', border: '1px solid var(--border-color)' }}>
            <option value="All">All cities</option>
            {options.cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gap: 6, fontSize: '0.8rem' }}>
          <span id="ev-zero-order-client-label">Clients</span>
          <details style={{ position: 'relative', minWidth: 220 }}>
            <summary aria-labelledby="ev-zero-order-client-label ev-zero-order-client-selection" style={{ padding: '0.5rem', borderRadius: 8, background: '#0f172a', border: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <span id="ev-zero-order-client-selection">{clientFilter.length ? `${clientFilter.length} client${clientFilter.length === 1 ? '' : 's'} selected` : 'All clients'}</span>
            </summary>
            <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: 280, maxWidth: '70vw', padding: 12, background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              <input aria-label="Search EV zero-order clients" placeholder="Search clients…" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 8, background: '#1e293b', color: '#fff', border: '1px solid var(--border-color)', borderRadius: 6 }} />
              <button type="button" onClick={() => setClientFilter([])} style={{ margin: '8px 0', cursor: 'pointer' }}>Reset to all clients</button>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {options.clients.filter((client) => client.toLowerCase().includes(clientSearch.trim().toLowerCase())).map((client) => (
                  <label key={client} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={clientFilter.includes(client)} onChange={() => setClientFilter((selected) => selected.includes(client) ? selected.filter((value) => value !== client) : [...selected, client])} />
                    {client}
                  </label>
                ))}
              </div>
              <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', fontSize: '0.72rem' }}>Select one or more clients. Empty selection shows all clients.</p>
            </div>
          </details>
        </div>
        <button type="button" className="glass" onClick={exportDetails} disabled={busy || !!message || exporting || !report.series.length}
          style={{ alignSelf: 'end', padding: '0.6rem 0.9rem', color: '#fff', cursor: 'pointer' }}>
          {exporting ? 'Exporting…' : 'Export Rider Details'}
        </button>
      </div>
      {exportError && <p role="alert" style={{ color: '#fb7185' }}>{exportError}</p>}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        Day-wise count · {dateFrom || dateTo ? 'Selected dates through yesterday' : 'Last 30 days through yesterday'}.
        {' '}Same calculation as Full Data: no orders in the four-day window; excludes riders deployed on that date or the previous 3 days.
        {' '}BB, Blinkit, Zepto, Porter 2W, Flipkart-LMA, Amazon and Swiggy.
      </p>
      <div style={{ height: 300, width: '100%' }}>
        {message || busy || !report.series.length ? (
          <div role={message ? 'alert' : 'status'} style={{ padding: '2rem', color: 'var(--text-dim)' }}>
            {message || (busy ? 'Loading EV zero-order counts…' : 'No completed days in the selected range.')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={report.series} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tickFormatter={(value) => format(parseISO(value), 'dd MMM')} stroke="var(--text-dim)" fontSize={12} />
              <YAxis allowDecimals={false} stroke="var(--text-dim)" fontSize={12} />
              <Tooltip isAnimationActive={false} labelFormatter={(value) => format(parseISO(value), 'dd MMM yyyy')} contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="count" name="D-1 0 order rider count" stroke="#fb7185" strokeWidth={2} dot={report.series.length === 1 ? { r: 4 } : false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
