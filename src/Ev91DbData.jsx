import React, { useEffect, useMemo, useState } from 'react'
import {
  Database,
  RefreshCw,
  Search,
  MapPin,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Calendar,
  Download,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import {
  EV91_MIS_ENDPOINTS,
  EV91_CITIES,
  fetchEv91MisData,
  fetchAllEv91MisData,
  filterRowsByDateRange,
  summarizeOverallRows,
  formatEv91Cell,
  statusBadgeClass,
  rowsToExportSheet,
} from './lib/ev91MisApi'

const PAGE_SIZE = 50

const STATUS_OPTIONS = {
  'current-status': ['', 'Deployed', 'Returned', 'Yet Not Deployed'],
  'overall-status': ['', 'Deployed', 'Returned', 'Client Swap'],
  'client-mapping-history': [''],
}

export default function Ev91DbData({ endpoint = 'current-status' }) {
  const meta = EV91_MIS_ENDPOINTS[endpoint] || EV91_MIS_ENDPOINTS['current-status']
  const isOverall = endpoint === 'overall-status'

  const [rows, setRows] = useState([])
  const [fullRows, setFullRows] = useState(null)
  const [pagination, setPagination] = useState({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [appliedSearch, setAppliedSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [appliedStartDate, setAppliedStartDate] = useState('')
  const [appliedEndDate, setAppliedEndDate] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const filterFrom = appliedStartDate || appliedEndDate || ''
  const filterTo = appliedEndDate || appliedStartDate || ''
  const dateFilterActive = isOverall && !!(filterFrom || filterTo)

  const baseParams = useMemo(
    () => ({
      search: appliedSearch,
      city,
      status,
    }),
    [appliedSearch, city, status]
  )

  // Server-paginated load (no overall date filter).
  useEffect(() => {
    if (dateFilterActive) return

    let cancelled = false
    setLoading(true)
    setError('')
    setFullRows(null)

    fetchEv91MisData(endpoint, {
      ...baseParams,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((result) => {
        if (cancelled) return
        setRows(result.data)
        setPagination(result.pagination || {})
        setSummary(result.summary || {})
      })
      .catch((err) => {
        if (cancelled) return
        setRows([])
        setPagination({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
        setSummary({})
        setError(err?.message || 'Failed to load EV91 data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint, baseParams, page, dateFilterActive, reloadKey])

  // Overall date-range: fetch all matching rows, filter by statusDate, paginate locally.
  useEffect(() => {
    if (!dateFilterActive) return

    let cancelled = false
    setLoading(true)
    setError('')
    setPage(0)

    fetchAllEv91MisData(endpoint, baseParams)
      .then((result) => {
        if (cancelled) return
        const filtered = filterRowsByDateRange(result.data, meta.dateKey, filterFrom, filterTo)
        setFullRows(filtered)
        setSummary(summarizeOverallRows(filtered))
        setPagination({
          total: filtered.length,
          limit: PAGE_SIZE,
          offset: 0,
          hasMore: filtered.length > PAGE_SIZE,
        })
        setRows(filtered.slice(0, PAGE_SIZE))
      })
      .catch((err) => {
        if (cancelled) return
        setFullRows(null)
        setRows([])
        setPagination({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
        setSummary({})
        setError(err?.message || 'Failed to load EV91 data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [endpoint, baseParams, dateFilterActive, filterFrom, filterTo, meta.dateKey, reloadKey])

  // Local page slice for date-filtered overall data.
  useEffect(() => {
    if (!dateFilterActive || !fullRows) return
    const start = page * PAGE_SIZE
    setRows(fullRows.slice(start, start + PAGE_SIZE))
    setPagination({
      total: fullRows.length,
      limit: PAGE_SIZE,
      offset: start,
      hasMore: start + PAGE_SIZE < fullRows.length,
    })
  }, [dateFilterActive, fullRows, page])

  useEffect(() => {
    setPage(0)
    setSearch('')
    setAppliedSearch('')
    setCity('')
    setStatus('')
    setStartDate('')
    setEndDate('')
    setAppliedStartDate('')
    setAppliedEndDate('')
    setFullRows(null)
  }, [endpoint])

  const total = Number(pagination.total) || (fullRows ? fullRows.length : 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1)
  const statusOptions = STATUS_OPTIONS[endpoint] || ['']

  const summaryCards = useMemo(() => {
    const cards = [{ label: 'Total Records', value: summary.total ?? total }]
    if (summary.deployed != null) cards.push({ label: 'Deployed', value: summary.deployed })
    if (summary.returned != null) cards.push({ label: 'Returned', value: summary.returned })
    if (summary.yetNotDeployed != null) cards.push({ label: 'Yet Not Deployed', value: summary.yetNotDeployed })
    if (summary.clientSwap != null) cards.push({ label: 'Client Swap', value: summary.clientSwap })
    return cards
  }, [summary, total])

  const applyFilters = () => {
    setPage(0)
    setAppliedSearch(search.trim())
    if (isOverall) {
      setAppliedStartDate(startDate)
      setAppliedEndDate(endDate)
    }
  }

  const clearDates = () => {
    setStartDate('')
    setEndDate('')
    setAppliedStartDate('')
    setAppliedEndDate('')
    setPage(0)
    setFullRows(null)
  }

  const handleCityChange = (value) => {
    setCity(value)
    setPage(0)
  }

  const handleStatusChange = (value) => {
    setStatus(value)
    setPage(0)
  }

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setError('')
    try {
      let exportRows = []

      if (fullRows) {
        exportRows = fullRows
      } else {
        const result = await fetchAllEv91MisData(endpoint, baseParams)
        exportRows = result.data
        if (isOverall && (filterFrom || filterTo)) {
          exportRows = filterRowsByDateRange(exportRows, meta.dateKey, filterFrom, filterTo)
        }
      }

      if (!exportRows.length) {
        window.alert('No rows to export for the current filters.')
        return
      }

      const sheetRows = rowsToExportSheet(exportRows, meta.columns)
      const ws = XLSX.utils.json_to_sheet(sheetRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'EV91 Data')
      const suffix = [
        endpoint,
        city || 'all-cities',
        filterFrom && filterTo ? `${filterFrom}_to_${filterTo}` : null,
        format(new Date(), 'yyyy-MM-dd'),
      ]
        .filter(Boolean)
        .join('_')
      XLSX.writeFile(wb, `ev91_${suffix}.xlsx`)
    } catch (err) {
      setError(err?.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dashboard-container ev91-root">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Database size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>{meta.title}</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              EV91 DB Data · {meta.description}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="glass"
            type="button"
            onClick={handleExport}
            disabled={loading || exporting}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
              cursor: exporting ? 'wait' : 'pointer',
            }}
          >
            <Download size={18} className={exporting ? 'ev91-spin' : undefined} />
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            className="glass"
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={18} className={loading ? 'ev91-spin' : undefined} />
            Refresh
          </button>
        </div>
      </header>

      <section className="stats-grid">
        {summaryCards.map((card) => (
          <div key={card.label} className="stat-card glass">
            <div className="label">{card.label}</div>
            <div className="value">{Number(card.value || 0).toLocaleString()}</div>
          </div>
        ))}
      </section>

      <section className="table-card glass" style={{ marginBottom: '1rem' }}>
        <div className="ev91-filters">
          <div className="ev91-filter-field">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search rider, vehicle, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <button type="button" className="ev91-filter-btn" onClick={applyFilters}>
              Apply
            </button>
          </div>

          <div className="ev91-filter-field">
            <MapPin size={16} />
            <select value={city} onChange={(e) => handleCityChange(e.target.value)}>
              <option value="">All cities</option>
              {EV91_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {statusOptions.length > 1 && (
            <div className="ev91-filter-field">
              <Filter size={16} />
              <select value={status} onChange={(e) => handleStatusChange(e.target.value)}>
                {statusOptions.map((opt) => (
                  <option key={opt || 'all'} value={opt}>
                    {opt || 'All statuses'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isOverall && (
            <div className="ev91-filter-field ev91-date-range">
              <Calendar size={16} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                title="From date"
              />
              <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                title="To date"
              />
              {(startDate || endDate || appliedStartDate || appliedEndDate) && (
                <button
                  type="button"
                  onClick={clearDates}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-red)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    padding: 0,
                  }}
                  title="Clear dates"
                >
                  <X size={16} />
                </button>
              )}
              <button type="button" className="ev91-filter-btn" onClick={applyFilters}>
                Apply dates
              </button>
            </div>
          )}
        </div>
        {dateFilterActive && (
          <p style={{ margin: '0 1rem 1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Showing Overall Status for{' '}
            <strong style={{ color: '#fff' }}>
              {filterFrom === filterTo ? filterFrom : `${filterFrom} → ${filterTo}`}
            </strong>{' '}
            (filtered by status date)
          </p>
        )}
      </section>

      {error && (
        <div className="ev91-error glass">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="table-card glass">
        <div className="table-header">
          <h3 style={{ fontSize: '1.1rem', margin: 0 }}>
            {loading ? 'Loading…' : `${rows.length.toLocaleString()} rows`}
            {total > 0 && (
              <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 8 }}>
                of {total.toLocaleString()}
              </span>
            )}
          </h3>
          <div className="ev91-pager">
            <button
              type="button"
              disabled={loading || page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Page {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={loading || page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                {meta.columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={meta.columns.length} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                    No records found
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={`${row.ev91RiderId || ''}-${row.vehicleNumber || ''}-${row.clientId || row.clientRiderId || ''}-${idx}`}
                  >
                    {meta.columns.map((col) => {
                      const raw = row[col.key]
                      const isStatus = meta.statusKey === col.key
                      return (
                        <td key={col.key}>
                          {isStatus ? (
                            <span className={`status-badge ${statusBadgeClass(raw)}`}>
                              {formatEv91Cell(raw)}
                            </span>
                          ) : (
                            formatEv91Cell(raw)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
