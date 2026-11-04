import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatInr } from '../lib/paymentHistoryReport'

const METRICS = [
  ['clientRevenue', 'Client payout revenue'], ['clientRiders', 'Client rider count'],
  ['sourceRiders', 'Source rider count'], ['sourceRevenue', 'Source payout revenue'],
]
const controlStyle = { padding: '0.45rem 0.65rem', color: '#fff', background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 8, minWidth: 150 }

export default function Ev91ClientPeriodChart({ revenue, riders, sources, options, filters, setFromDate, setToDate, setCity, setClient, viewMode, setViewMode, loading, error }) {
  const [metric, setMetric] = useState('clientRevenue')
  const label = METRICS.find(([key]) => key === metric)[1]
  const isRevenue = metric === 'clientRevenue' || metric === 'sourceRevenue'
  const sourceRiderTotals = Object.fromEntries(revenue.periods.map((period) => [period,
    sources.riderRows.reduce((sum, row) => sum + (row.values[period] || 0), 0),
  ]))
  const totals = { clientRevenue: revenue.totals, clientRiders: riders.totals, sourceRiders: sourceRiderTotals, sourceRevenue: sources.revenueTotals }[metric]
  const data = revenue.periods.map((period) => ({ period, value: totals[period] || 0,
    start: revenue.periodStarts[period] || '',
  }))
  return (
    <section className="glass" aria-label="EV91 client period trend graph" style={{ marginTop: '1.25rem', padding: '1.5rem', minWidth: 0 }}>
      <h3 style={{ marginTop: 0 }}>EV91 Client Period Trend</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end' }}>
        <label className="filter-label">From<input aria-label="Period graph From" type="date" value={filters.fromDate} onChange={(event) => setFromDate(event.target.value)} style={controlStyle} /></label>
        <label className="filter-label">To<input aria-label="Period graph To" type="date" value={filters.toDate} onChange={(event) => setToDate(event.target.value)} style={controlStyle} /></label>
        <label className="filter-label">City<select aria-label="Period graph City" value={filters.city} onChange={(event) => setCity(event.target.value)} style={controlStyle}><option value="All">All cities</option>{options.cities.map((city) => <option key={city}>{city}</option>)}</select></label>
        <label className="filter-label">Client<select aria-label="Period graph Client" value={filters.client} onChange={(event) => setClient(event.target.value)} style={controlStyle}><option value="All">All clients</option>{options.clients.map((client) => <option key={client}>{client}</option>)}</select></label>
        <label className="filter-label">Period<select aria-label="Period graph frequency" value={viewMode} onChange={(event) => setViewMode(event.target.value)} style={controlStyle}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="filter-label">Metric<select aria-label="Period graph metric" value={metric} onChange={(event) => setMetric(event.target.value)} style={controlStyle}>{METRICS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
        {label} · {viewMode === 'monthly' ? 'Monthly' : 'Weekly'} · Same calculations as EV91 Client Period Trend tables.
        {' '}Client revenue includes all sources; rider counts and source revenue use active listed sources.
        {viewMode === 'monthly' ? ' Monthly dates include the full payment months that overlap the selected range.' : ''}
      </p>
      {!loading && !error && <p aria-label="Period graph total" style={{ fontWeight: 600 }}>
        {label}: {isRevenue ? formatInr(data.reduce((sum, point) => sum + point.value, 0)) : data.reduce((sum, point) => sum + point.value, 0).toLocaleString('en-IN')}
      </p>}
      <div style={{ height: 320, width: '100%' }}>
        {error || loading || !data.length ? <p role={error ? 'alert' : 'status'} style={{ padding: '2rem', color: 'var(--text-dim)' }}>{error || (loading ? 'Loading period trend…' : 'No data for the selected filters.')}</p> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 20, left: 12, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="period" stroke="var(--text-dim)" fontSize={12} />
              <YAxis stroke="var(--text-dim)" allowDecimals={false} fontSize={11} tickFormatter={(value) => isRevenue ? formatInr(value) : Number(value).toLocaleString('en-IN')} width={90} />
              <Tooltip formatter={(value) => [isRevenue ? formatInr(value) : Number(value).toLocaleString('en-IN'), label]} labelFormatter={(value, payload) => `${value}${payload?.[0]?.payload?.start ? ` · ${payload[0].payload.start}` : ''}`} contentStyle={{ background: '#0f172a', border: '1px solid var(--border-color)', borderRadius: 8 }} />
              <Line name={label} dataKey="value" type="monotone" stroke={isRevenue ? '#38bdf8' : '#c084fc'} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
