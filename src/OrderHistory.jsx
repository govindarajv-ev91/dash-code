import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, memo } from 'react'
import {
  History,
  Search,
  Download,
  Package,
  Users,
  MapPin,
  Briefcase,
  Calendar,
  Zap,
  Bike,
  RefreshCw,
  Loader,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchAllOrderUploads, clearOrderUploadCache } from './lib/orderUploadDb'
import {
  buildOrderHistoryRows,
  filterOrderHistory,
  summarizeOrderHistory,
  summarizeOrderHistoryTotals,
} from './lib/orderHistoryReport'

const ROWS_PER_PAGE = 100

const OrderHistoryRow = memo(function OrderHistoryRow({ row }) {
  return (
    <tr>
      <td>{row.dateDisplay}</td>
      <td style={{ fontWeight: 600 }}>{row.workerCode || '—'}</td>
      <td>{row.client}</td>
      <td>{row.city}</td>
      <td>
        <span
          className="status-badge"
          style={{
            fontSize: '0.7rem',
            background: row.isEv ? 'rgba(74, 222, 128, 0.12)' : 'rgba(148, 163, 184, 0.12)',
            color: row.isEv ? '#4ade80' : 'var(--text-dim)',
          }}
        >
          {row.type1}
        </span>
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent-blue)' }}>
        {(row.delivered || 0).toLocaleString('en-IN')}
      </td>
      <td>{row.month || '—'}</td>
    </tr>
  )
})

function StatCard({ label, value, icon: Icon, color = 'var(--accent-blue)', iconBg = 'rgba(56, 189, 248, 0.12)' }) {
  return (
    <div className="rp-stat-card glass">
      <div className="rp-stat-icon" style={{ width: 34, height: 34, borderRadius: 8, background: iconBg, color }}>
        <Icon size={15} />
      </div>
      <div className="rp-stat-body">
        <div className="rp-stat-label">{label}</div>
        <div className="rp-stat-value" style={{ fontSize: '1.05rem', color }}>{value}</div>
      </div>
    </div>
  )
}

function SummaryTable({ title, rows, icon: Icon }) {
  return (
    <div className="glass" style={{ padding: '1rem', flex: 1, minWidth: '300px' }}>
      <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
        <Icon size={18} />
        {title}
        <span className="status-badge" style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </h3>
      <div className="table-container" style={{ maxHeight: '280px' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Rows</th>
              <th>Riders</th>
              <th style={{ textAlign: 'right' }}>Orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.rows.toLocaleString('en-IN')}</td>
                  <td>{row.riders.toLocaleString('en-IN')}</td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 600 }}>
                    {row.orders.toLocaleString('en-IN')}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MultiSelect({ label, options, selected, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)', minWidth: '150px' }}>
      <span>{label}</span>
      <select
        multiple
        value={selected}
        onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        className="fsr-select"
        style={{
          minHeight: '72px',
          padding: '0.35rem',
          color: '#fff',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>
  )
}

export default function OrderHistory() {
  const [rawRows, setRawRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selectedCities, setSelectedCities] = useState([])
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedMonths, setSelectedMonths] = useState([])
  const [type1Filter, setType1Filter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const deferredCities = useDeferredValue(selectedCities)
  const deferredClients = useDeferredValue(selectedClients)
  const deferredMonths = useDeferredValue(selectedMonths)

  const loadRows = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      if (force) clearOrderUploadCache()
      const rows = await fetchAllOrderUploads({ force })
      setRawRows(rows || [])
    } catch (err) {
      console.error(err)
      setRawRows([])
      setError(err?.message || 'Failed to load order history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRows(false)
  }, [loadRows])

  const historyRows = useMemo(() => buildOrderHistoryRows(rawRows), [rawRows])

  const filterOptions = useMemo(() => {
    const cities = new Set()
    const clients = new Set()
    const months = new Set()
    for (const r of historyRows) {
      if (r.city && r.city !== '—') cities.add(r.city)
      if (r.client && r.client !== '—') clients.add(r.client)
      if (r.month) months.add(r.month)
    }
    return {
      cities: [...cities].sort((a, b) => a.localeCompare(b)),
      clients: [...clients].sort((a, b) => a.localeCompare(b)),
      months: [...months].sort().reverse(),
    }
  }, [historyRows])

  const filtered = useMemo(
    () =>
      filterOrderHistory(historyRows, {
        search: deferredSearch,
        cities: deferredCities,
        clients: deferredClients,
        months: deferredMonths,
        type1: type1Filter,
        dateFrom,
        dateTo,
      }),
    [historyRows, deferredSearch, deferredCities, deferredClients, deferredMonths, type1Filter, dateFrom, dateTo]
  )

  const totals = useMemo(() => summarizeOrderHistoryTotals(filtered), [filtered])
  const citySummary = useMemo(() => summarizeOrderHistory(filtered, 'city'), [filtered])
  const clientSummary = useMemo(() => summarizeOrderHistory(filtered, 'client'), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedCities, selectedClients, selectedMonths, type1Filter, dateFrom, dateTo])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const exportExcel = useCallback(() => {
    const rows = filtered.map((r) => ({
      Date: r.dateDisplay,
      WorkerCode: r.workerCode,
      Client: r.client,
      City: r.city,
      Type1: r.type1,
      delivered: r.delivered,
      Month: r.month,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Order History')
    XLSX.writeFile(wb, `Order_History_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filtered])

  const clearFilters = () => {
    setSearch('')
    setSelectedCities([])
    setSelectedClients([])
    setSelectedMonths([])
    setType1Filter('')
    setDateFrom('')
    setDateTo('')
  }

  return (
    <div className="dashboard-container">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <History size={28} style={{ color: '#38bdf8' }} />
          <div>
            <h1 style={{ margin: 0 }}>Order History</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Browse uploaded orders from <code style={{ color: '#fff' }}>order_upload_data</code>
              {!loading && (
                <span> · {rawRows.length.toLocaleString('en-IN')} rows in database</span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="fsr-export-btn" onClick={() => loadRows(true)} disabled={loading}>
            {loading ? <Loader size={16} className="spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
          <button type="button" className="fsr-export-btn" onClick={exportExcel} disabled={!filtered.length}>
            <Download size={16} />
            Export Excel
          </button>
        </div>
      </header>

      {error && (
        <div className="glass" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div
        className="filter-bar glass"
        style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem', marginBottom: '1rem', alignItems: 'flex-end' }}
      >
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search worker, client, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem 0.55rem 2.25rem',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              color: '#fff',
              outline: 'none',
            }}
          />
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} /> From
          </span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} /> To
          </span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span>Type1</span>
          <select
            value={type1Filter}
            onChange={(e) => setType1Filter(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          >
            <option value="">All</option>
            <option value="EV">EV</option>
            <option value="NON-EV">NON-EV</option>
          </select>
        </label>

        <MultiSelect label="City" options={filterOptions.cities} selected={selectedCities} onChange={setSelectedCities} />
        <MultiSelect label="Client" options={filterOptions.clients} selected={selectedClients} onChange={setSelectedClients} />
        <MultiSelect label="Month" options={filterOptions.months} selected={selectedMonths} onChange={setSelectedMonths} />

        <button type="button" className="glass-btn" onClick={clearFilters} style={{ padding: '0.5rem 0.85rem' }}>
          Clear filters
        </button>
      </div>

      <div className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="Total orders" value={loading ? '…' : totals.orders.toLocaleString('en-IN')} icon={Package} />
        <StatCard label="Active riders" value={loading ? '…' : totals.riders.toLocaleString('en-IN')} icon={Users} color="#a78bfa" iconBg="rgba(167,139,250,0.12)" />
        <StatCard label="EV orders" value={loading ? '…' : totals.evOrders.toLocaleString('en-IN')} icon={Zap} color="#4ade80" iconBg="rgba(74,222,128,0.12)" />
        <StatCard label="NON-EV orders" value={loading ? '…' : totals.nonEvOrders.toLocaleString('en-IN')} icon={Bike} color="#fb7185" iconBg="rgba(251,113,133,0.12)" />
        <StatCard label="Rows" value={loading ? '…' : totals.rows.toLocaleString('en-IN')} icon={History} color="#38bdf8" iconBg="rgba(56,189,248,0.12)" />
        <StatCard label="Dates" value={loading ? '…' : totals.dates.toLocaleString('en-IN')} icon={Calendar} color="#fbbf24" iconBg="rgba(251,191,36,0.12)" />
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <SummaryTable title="By city" rows={citySummary} icon={MapPin} />
        <SummaryTable title="By client" rows={clientSummary} icon={Briefcase} />
      </div>

      <div className="glass" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            Order rows
            <span className="status-badge" style={{ marginLeft: '0.5rem' }}>
              {filtered.length.toLocaleString('en-IN')}
            </span>
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <button
              type="button"
              className="glass-btn"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              style={{ padding: '0.35rem 0.65rem' }}
            >
              Prev
            </button>
            <span>
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="glass-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              style={{ padding: '0.35rem 0.65rem' }}
            >
              Next
            </button>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>WorkerCode</th>
                <th>Client</th>
                <th>City</th>
                <th>Type1</th>
                <th style={{ textAlign: 'right' }}>Orders</th>
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                    <Loader size={18} className="spin" style={{ marginRight: 8 }} />
                    Loading order history…
                  </td>
                </tr>
              ) : paginated.length ? (
                paginated.map((row) => (
                  <OrderHistoryRow key={row.id != null ? row.id : `${row.workerCode}|${row.dateKey}|${row.client}|${row.delivered}`} row={row} />
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                    No order rows match the current filters. Upload data from Order Upload first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
