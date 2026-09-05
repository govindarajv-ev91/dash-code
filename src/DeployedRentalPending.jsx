import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, startTransition } from 'react'
import {
  CircleDollarSign,
  Search,
  Download,
  Loader,
  RefreshCw,
  MapPin,
  Briefcase,
  Calendar,
  Bike,
  IndianRupee,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchAllRentalPending,
  filterDeployedRentalPendingRows,
  summarizeDeployedRentalPending,
  isMissingRentalPendingTable,
  getRentalPendingDbSetupMessage,
} from './lib/rentalPendingDb'
import { dedupeCanonicalCities, normalizeSummaryCity } from './lib/citySummaryAliases'
import { clientLookupKey, dedupeCanonicalClients } from './lib/clientSummaryClients'
import { parseRentalPendingAmount } from './lib/riderPerformanceReport'
import SearchableSelect from './components/SearchableSelect'

const ROWS_PER_PAGE = 50

const TABLE_COLUMNS = [
  { key: 'rider_name', label: 'Rider Name', align: 'left' },
  { key: 'rider_id', label: 'Rider ID', align: 'left' },
  { key: 'ev91_rider_id', label: 'EV91 Rider ID', align: 'left' },
  { key: 'contact_no', label: 'Contact', align: 'left' },
  { key: 'client_name', label: 'Client', align: 'left' },
  { key: 'city', label: 'City', align: 'left' },
  { key: 'vehicle_number', label: 'Vehicle', align: 'left' },
  { key: 'db_current_status', label: 'DB Status', align: 'left' },
  { key: 'vehicle_status', label: 'Vehicle Status', align: 'left' },
  { key: 'current_status', label: 'Current Status', align: 'left' },
  { key: 'source_name', label: 'Source', align: 'left' },
  { key: 'week_start_date', label: 'Week Start', align: 'left' },
  { key: 'week_end_date', label: 'Week End', align: 'left' },
  { key: 'rent_per_week', label: 'Rent / week', align: 'right', money: true },
  { key: 'total_rent_amount', label: 'Total Rent', align: 'right', money: true },
  { key: 'total_sd_amount', label: 'Total SD', align: 'right', money: true },
  { key: 'pending_amount', label: 'Pending Amount', align: 'right', money: true },
  { key: 'manual_payment_collection', label: 'Manual Collection', align: 'right', money: true },
  { key: 'actual_pending_for_week_after_sd', label: 'Actual Pending', align: 'right', money: true },
  { key: 'current_week_orders', label: 'Week Orders', align: 'right' },
  { key: 'inactive_days', label: 'Inactive Days', align: 'right' },
  { key: 'month', label: 'Month', align: 'left' },
  { key: 'remarks', label: 'Remarks', align: 'left' },
]

const selectStyle = {
  padding: '0.45rem 0.65rem',
  color: '#fff',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  minWidth: '140px',
}

function formatMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatCell(col, value) {
  if (value == null || value === '') return '—'
  if (col.money) return formatMoney(value)
  if (typeof value === 'number') return value.toLocaleString('en-IN')
  return String(value)
}

export default function DeployedRentalPending() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [monthFilter, setMonthFilter] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const deferredCity = useDeferredValue(cityFilter)
  const deferredClient = useDeferredValue(clientFilter)
  const deferredMonth = useDeferredValue(monthFilter)
  const deferredSearch = useDeferredValue(searchTerm)

  const loadData = useCallback(async ({ force = false } = {}) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAllRentalPending({ force })
      setRows(filterDeployedRentalPendingRows(data || []))
    } catch (err) {
      if (isMissingRentalPendingTable(err)) {
        setError(getRentalPendingDbSetupMessage())
      } else {
        setError(err.message || 'Failed to load rental pending data')
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const cityOptions = useMemo(() => {
    const cities = dedupeCanonicalCities(rows.map((r) => r.city))
    return ['All', ...cities]
  }, [rows])

  const clientOptions = useMemo(() => {
    const clients = dedupeCanonicalClients(rows.map((r) => r.client_name))
    return ['All', ...clients]
  }, [rows])

  const monthOptions = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      const m = (r.month || '').toString().trim()
      if (m) set.add(m)
    }
    return ['All', ...[...set].sort((a, b) => b.localeCompare(a))]
  }, [rows])

  const filteredRows = useMemo(() => {
    let list = rows
    if (deferredCity !== 'All') {
      list = list.filter((r) => normalizeSummaryCity(r.city) === deferredCity)
    }
    if (deferredClient !== 'All') {
      const clientKey = clientLookupKey(deferredClient)
      list = list.filter((r) => clientLookupKey(r.client_name) === clientKey)
    }
    if (deferredMonth !== 'All') {
      list = list.filter((r) => (r.month || '').toString().trim() === deferredMonth)
    }
    const q = deferredSearch.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        [
          r.rider_name,
          r.rider_id,
          r.ev91_rider_id,
          r.contact_no,
          r.client_name,
          r.city,
          r.vehicle_number,
          r.source_name,
        ]
          .map((v) => String(v || '').toLowerCase())
          .some((v) => v.includes(q))
      )
    }
    return [...list].sort((a, b) => {
      const pa = parseRentalPendingAmount(a.actual_pending_for_week_after_sd) || 0
      const pb = parseRentalPendingAmount(b.actual_pending_for_week_after_sd) || 0
      return pb - pa
    })
  }, [rows, deferredCity, deferredClient, deferredMonth, deferredSearch])

  const stats = useMemo(() => summarizeDeployedRentalPending(filteredRows), [filteredRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE))
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filteredRows.slice(start, start + ROWS_PER_PAGE)
  }, [filteredRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [cityFilter, clientFilter, monthFilter, searchTerm, rows.length])

  const exportExcel = () => {
    if (!filteredRows.length) return
    setExporting(true)
    try {
      const sheetRows = filteredRows.map((r) => {
        const out = {}
        for (const col of TABLE_COLUMNS) {
          out[col.label] = r[col.key] ?? ''
        }
        return out
      })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Deployed Rental')
      const suffix = `${cityFilter}_${clientFilter}_${monthFilter}`.replace(/\s+/g, '_')
      XLSX.writeFile(wb, `Deployed_Rental_Pending_${suffix}.xlsx`)
    } catch (err) {
      setError(err.message || 'Failed to export Excel')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dashboard-container" style={{ paddingBottom: '2rem' }}>
      <header
        className="header"
        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem', overflow: 'visible' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CircleDollarSign size={28} style={{ color: '#f59e0b' }} />
              Deployed Rental Pending
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '820px', fontSize: '0.9rem' }}>
              Rental Pending Amount rows where status is Deployed (DB / Vehicle / Current Status).
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="glass"
              onClick={() => loadData({ force: true })}
              disabled={loading}
              style={{ padding: '0.45rem 0.75rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {loading ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button
              type="button"
              className="glass"
              onClick={exportExcel}
              disabled={exporting || loading || !filteredRows.length}
              style={{ padding: '0.45rem 0.75rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {exporting ? <Loader size={14} className="spin" /> : <Download size={14} />}
              Download Excel
            </button>
          </div>
        </div>
      </header>

      <div
        className="glass"
        style={{
          padding: '0.85rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'flex-end',
        }}
      >
        <SearchableSelect
          label="City"
          icon={MapPin}
          options={cityOptions}
          value={cityFilter}
          onChange={(v) => startTransition(() => setCityFilter(v))}
          minWidth={140}
          searchPlaceholder="Search cities…"
        />

        <SearchableSelect
          label="Client"
          icon={Briefcase}
          options={clientOptions}
          value={clientFilter}
          onChange={(v) => startTransition(() => setClientFilter(v))}
          minWidth={160}
          searchPlaceholder="Search clients…"
        />

        <SearchableSelect
          label="Month"
          icon={Calendar}
          options={monthOptions}
          value={monthFilter}
          onChange={(v) => startTransition(() => setMonthFilter(v))}
          minWidth={140}
          searchPlaceholder="Search months…"
        />

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            fontSize: '0.78rem',
            color: 'var(--text-dim)',
            flex: '1 1 220px',
            minWidth: '220px',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Search size={13} /> Search
          </span>
          <input
            type="search"
            placeholder="Rider, ID, vehicle, phone…"
            value={searchTerm}
            onChange={(e) => startTransition(() => setSearchTerm(e.target.value))}
            style={{ ...selectStyle, width: '100%' }}
          />
        </label>
      </div>

      {error && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            color: '#fca5a5',
            background: 'rgba(239,68,68,0.12)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {!loading && (
        <div className="stats-grid" style={{ marginBottom: '1rem' }}>
          <div className="stat-card glass">
            <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Bike size={14} /> Deployed Riders
            </span>
            <span className="value">{stats.riders.toLocaleString('en-IN')}</span>
          </div>
          <div className="stat-card glass">
            <span className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <IndianRupee size={14} /> Actual Pending Total
            </span>
            <span className="value" style={{ color: '#f59e0b' }}>
              ₹{formatMoney(stats.totalPending)}
            </span>
          </div>
          <div className="stat-card glass">
            <span className="label">Positive Pending</span>
            <span className="value" style={{ color: '#fbbf24' }}>
              ₹{formatMoney(stats.positivePending)}
            </span>
          </div>
          <div className="stat-card glass">
            <span className="label">Total Rent Amount</span>
            <span className="value">₹{formatMoney(stats.totalRent)}</span>
          </div>
          <div className="stat-card glass">
            <span className="label">Total SD Amount</span>
            <span className="value">₹{formatMoney(stats.totalSd)}</span>
          </div>
          <div className="stat-card glass">
            <span className="label">Cities / Clients</span>
            <span className="value" style={{ fontSize: '1.25rem' }}>
              {stats.cityCount} / {stats.clientCount}
            </span>
          </div>
        </div>
      )}

      <div className="table-card glass rp-table-wrap" style={{ marginBottom: 0 }}>
        <div
          style={{
            padding: '0.75rem 0.9rem',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '0.78rem',
            color: 'var(--text-dim)',
            flexShrink: 0,
          }}
        >
          City: {cityFilter} · Client: {clientFilter} · Month: {monthFilter} ·{' '}
          {filteredRows.length.toLocaleString('en-IN')} deployed rows
          {loading ? ' · Loading…' : ''}
        </div>

        {loading && !rows.length ? (
          <div className="loading-container" style={{ minHeight: '280px' }}>
            <span className="loader" />
          </div>
        ) : (
          <>
            <div
              className="rp-table-scroll"
              style={{ maxHeight: 'calc(100vh - 420px)', overflow: 'auto', background: '#ffffff' }}
            >
              <table
                style={{
                  width: 'max-content',
                  minWidth: '100%',
                  borderCollapse: 'separate',
                  borderSpacing: 0,
                  fontSize: '0.78rem',
                  color: '#0f172a',
                  background: '#ffffff',
                }}
              >
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 2,
                          background: '#e2e8f0',
                          color: '#0f172a',
                          padding: '0.45rem 0.55rem',
                          whiteSpace: 'nowrap',
                          textAlign: col.align || 'left',
                          borderBottom: '1px solid #cbd5e1',
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, idx) => (
                    <tr key={`${row.id || idx}-${row.rider_id}-${row.vehicle_number}`}>
                      {TABLE_COLUMNS.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            padding: '0.4rem 0.55rem',
                            whiteSpace: 'nowrap',
                            textAlign: col.align || 'left',
                            borderBottom: '1px solid #e2e8f0',
                            background: idx % 2 ? '#f8fafc' : '#ffffff',
                            fontWeight:
                              col.key === 'actual_pending_for_week_after_sd' ? 600 : 400,
                            color:
                              col.key === 'actual_pending_for_week_after_sd' &&
                              Number(row[col.key]) > 0
                                ? '#b45309'
                                : '#0f172a',
                          }}
                        >
                          {formatCell(col, row[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredRows.length && !loading && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  No deployed rental pending rows for these filters. Upload data on Payment Upload →
                  Rental Pending Amount.
                </div>
              )}
            </div>

            {filteredRows.length > ROWS_PER_PAGE ? (
              <div className="rp-table-footer">
                <span style={{ color: 'var(--text-dim)' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="glass"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    style={{ padding: '0.35rem 0.65rem', color: '#fff' }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="glass"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    style={{ padding: '0.35rem 0.65rem', color: '#fff' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
