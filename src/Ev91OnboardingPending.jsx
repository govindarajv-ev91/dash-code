import React, { useCallback, useEffect, useMemo, useState, useDeferredValue } from 'react'
import {
  UserPlus,
  RefreshCw,
  Search,
  MapPin,
  Download,
  AlertTriangle,
  Users,
  Link2,
  UserX,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import {
  selectOverviewOrderRows,
  fetchEv91ClientMappingAll,
  buildEv91OnboardingPendingRows,
  EV91_ONBOARDING_PENDING_COLUMNS,
  rowsToOnboardingExport,
} from './lib/ev91OnboardingPending'
import { EV91_CITIES, formatEv91Cell } from './lib/ev91MisApi'

const ROWS_PER_PAGE = 80

export default function Ev91OnboardingPending({
  riderData,
  loading,
  refreshing = false,
  dataUpdatedAt = null,
  refreshData,
}) {
  const [mappingRows, setMappingRows] = useState([])
  const [mappingLoading, setMappingLoading] = useState(true)
  const [mappingError, setMappingError] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [cityFilter, setCityFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [viewTab, setViewTab] = useState('all') // all | pending | mapped
  const [currentPage, setCurrentPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const orderRows = useMemo(() => selectOverviewOrderRows(riderData), [riderData])

  const loadMapping = useCallback(() => {
    setMappingLoading(true)
    setMappingError('')
    return fetchEv91ClientMappingAll()
      .then((result) => setMappingRows(result.data || []))
      .catch((err) => {
        console.warn('Client mapping load failed:', err)
        setMappingRows([])
        setMappingError(err?.message || 'Failed to load Client Mapping History')
      })
      .finally(() => setMappingLoading(false))
  }, [])

  useEffect(() => {
    loadMapping()
  }, [loadMapping, reloadKey])

  const report = useMemo(
    () => buildEv91OnboardingPendingRows(orderRows, mappingRows),
    [orderRows, mappingRows]
  )

  const cities = useMemo(() => {
    const set = new Set([
      ...EV91_CITIES,
      ...report.rows.map((r) => r.city).filter((c) => c && c !== '—'),
    ])
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [report.rows])

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return report.rows.filter((row) => {
      if (viewTab === 'pending' && row.status === 'Mapped with EV91 ID') return false
      if (viewTab === 'mapped' && row.status !== 'Mapped with EV91 ID') return false
      if (cityFilter !== 'All' && row.city !== cityFilter) return false
      if (statusFilter !== 'All' && row.status !== statusFilter) return false
      if (!q) return true
      const blob = [
        row.clientId,
        row.ev91RiderId,
        row.workerName,
        row.city,
        row.client,
        row.mobile,
        row.status,
        row.mappingPhone,
        row.mappingSource,
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [report.rows, deferredSearch, cityFilter, statusFilter, viewTab])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE))
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filteredRows.slice(start, start + ROWS_PER_PAGE)
  }, [filteredRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [deferredSearch, cityFilter, statusFilter, viewTab])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const handleRefresh = () => {
    setReloadKey((k) => k + 1)
    if (refreshData && !refreshing) refreshData()
  }

  const handleExport = () => {
    if (exporting || !filteredRows.length) return
    setExporting(true)
    try {
      const sheetRows = rowsToOnboardingExport(filteredRows)
      const ws = XLSX.utils.json_to_sheet(sheetRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Order Mapping')
      XLSX.writeFile(wb, `ev91_order_client_mapping_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
    } catch (err) {
      window.alert(err?.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const isBusy = mappingLoading || (loading && !orderRows.length)

  if (isBusy && !report.rows.length && !mappingError) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  const summary = report.summary

  return (
    <div className="dashboard-container ev91-root">
      {(mappingLoading || refreshing) && (
        <div className="fdv-loading-banner glass rp-update-banner">
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span>
            {mappingLoading
              ? 'Loading Client Mapping History & matching order Client IDs…'
              : 'Refreshing order data…'}
          </span>
        </div>
      )}

      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <UserPlus size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>Onboarding Pending</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Order Client IDs ↔ Client Mapping History · show pending + mapped EV91 Rider IDs
              {orderRows.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {orderRows.length.toLocaleString()} order rows
                </span>
              )}
              {mappingRows.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {mappingRows.length.toLocaleString()} mapping rows
                </span>
              )}
              {dataUpdatedAt && (
                <span style={{ marginLeft: 8 }}>
                  · Orders updated {format(dataUpdatedAt, 'dd/MM/yyyy HH:mm')}
                </span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="glass"
            type="button"
            onClick={handleExport}
            disabled={!filteredRows.length || exporting}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
              cursor: exporting ? 'wait' : 'pointer',
            }}
          >
            <Download size={18} />
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            className="glass"
            type="button"
            onClick={handleRefresh}
            disabled={mappingLoading || refreshing}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
              cursor: mappingLoading ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={18} className={mappingLoading ? 'ev91-spin' : undefined} />
            Refresh
          </button>
        </div>
      </header>

      {mappingError && (
        <div className="ev91-error glass" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={18} />
          <span>{mappingError}</span>
        </div>
      )}

      <section className="stats-grid">
        <div className="stat-card glass">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <Users size={18} style={{ color: 'var(--accent-blue)' }} />
            <div className="label">Unique Order Riders</div>
          </div>
          <div className="value">{(summary.uniqueOrderRiders || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <Link2 size={18} style={{ color: 'var(--accent-green)' }} />
            <div className="label">Mapped with EV91 ID</div>
          </div>
          <div className="value">{(summary.mappedWithEv91 || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <UserX size={18} style={{ color: '#fb7185' }} />
            <div className="label">Onboarding Pending</div>
          </div>
          <div className="value">{(summary.pendingCount || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Not in Client Mapping</div>
          <div className="value">{(summary.notInMapping || 0).toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Mapping w/o EV91 ID</div>
          <div className="value">{(summary.missingEv91Id || 0).toLocaleString()}</div>
        </div>
      </section>

      <div className="fdv-tab-bar glass" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`fdv-tab ${viewTab === 'all' ? 'fdv-tab-active' : ''}`}
          onClick={() => {
            setViewTab('all')
            setStatusFilter('All')
          }}
        >
          <Users size={16} />
          All Riders
          <span className="rp-tab-count">{(summary.uniqueOrderRiders || 0).toLocaleString()}</span>
        </button>
        <button
          type="button"
          className={`fdv-tab ${viewTab === 'pending' ? 'fdv-tab-active' : ''}`}
          onClick={() => {
            setViewTab('pending')
            setStatusFilter('All')
          }}
        >
          <UserX size={16} />
          Onboarding Pending
          <span className="rp-tab-count">{(summary.pendingCount || 0).toLocaleString()}</span>
        </button>
        <button
          type="button"
          className={`fdv-tab ${viewTab === 'mapped' ? 'fdv-tab-active' : ''}`}
          onClick={() => {
            setViewTab('mapped')
            setStatusFilter('All')
          }}
        >
          <Link2 size={16} />
          Mapped with EV91 ID
          <span className="rp-tab-count">{(summary.mappedWithEv91 || 0).toLocaleString()}</span>
        </button>
      </div>

      <section className="table-card glass" style={{ marginBottom: '1rem' }}>
        <div className="ev91-filters">
          <div className="ev91-filter-field">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search Client ID, EV91 ID, name, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ev91-filter-field">
            <MapPin size={16} />
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
              {cities.map((c) => (
                <option key={c} value={c}>{c === 'All' ? 'All cities' : c}</option>
              ))}
            </select>
          </div>
          {viewTab !== 'mapped' && (
            <div className="ev91-filter-field">
              <UserPlus size={16} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="All">
                  {viewTab === 'pending' ? 'All pending statuses' : 'All statuses'}
                </option>
                {viewTab === 'all' && (
                  <option value="Mapped with EV91 ID">Mapped with EV91 ID</option>
                )}
                <option value="Not in Client Mapping">Not in Client Mapping</option>
                <option value="Missing EV91 ID">Missing EV91 ID</option>
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="table-card glass">
        <div className="table-header">
          <h3 style={{ fontSize: '1.1rem', margin: 0 }}>
            {filteredRows.length.toLocaleString()} riders
            {filteredRows.length !== report.rows.length && (
              <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 8 }}>
                (of {report.rows.length.toLocaleString()})
              </span>
            )}
          </h3>
          <div className="ev91-pager">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span>
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                {EV91_ONBOARDING_PENDING_COLUMNS.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!mappingLoading && paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={EV91_ONBOARDING_PENDING_COLUMNS.length}
                    style={{ textAlign: 'center', color: 'var(--text-dim)' }}
                  >
                    {report.rows.length === 0
                      ? 'No order Client IDs found'
                      : 'No rows match the current filters'}
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => (
                  <tr key={`${row.clientId}-${row.ev91RiderId}-${idx}`}>
                    {EV91_ONBOARDING_PENDING_COLUMNS.map((col) => {
                      const raw = row[col.key]
                      if (col.key === 'status') {
                        const badgeClass =
                          row.status === 'Mapped with EV91 ID'
                            ? 'ev91-badge-deployed'
                            : row.status === 'Missing EV91 ID'
                              ? 'ev91-badge-pending'
                              : 'ev91-badge-returned'
                        return (
                          <td key={col.key}>
                            <span className={`status-badge ${badgeClass}`}>{raw}</span>
                          </td>
                        )
                      }
                      if (col.key === 'ev91RiderId') {
                        return (
                          <td
                            key={col.key}
                            style={{
                              fontWeight: raw ? 600 : 400,
                              color: raw ? 'var(--accent-green)' : 'var(--text-dim)',
                            }}
                          >
                            {raw || '—'}
                          </td>
                        )
                      }
                      if (col.key === 'mappingLastUpdated') {
                        return <td key={col.key}>{raw ? formatEv91Cell(raw) : '—'}</td>
                      }
                      if (col.key === 'totalOrders') {
                        return (
                          <td key={col.key} style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>
                            {Number(raw || 0).toLocaleString()}
                          </td>
                        )
                      }
                      return <td key={col.key}>{raw == null || raw === '' ? '—' : String(raw)}</td>
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
