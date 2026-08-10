import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  MapPin,
  RefreshCw,
  Search,
  Users,
  Bike,
  RotateCcw,
  Database,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { EV91_CITIES, clearEv91AllCache, formatEv91Cell, statusBadgeClass } from './lib/ev91MisApi'
import {
  RIDER_VEHICLE_INSIGHT_COLUMNS,
  fetchRiderVehicleInsightData,
  filterRiderVehicleInsightRows,
  summarizeRiderVehicleInsight,
} from './lib/ev91RiderVehicleInsight'

const PAGE_SIZE = 50

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="rp-stat-card glass">
      <div
        className="rp-stat-icon"
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: `${color}22`,
          color,
        }}
      >
        <Icon size={15} />
      </div>
      <div className="rp-stat-body">
        <div className="rp-stat-label">{label}</div>
        <div className="rp-stat-value" style={{ fontSize: '1.05rem', color }}>
          {Number(value || 0).toLocaleString()}
        </div>
      </div>
    </div>
  )
}

function sourceBadge(source) {
  const s = String(source || '')
  if (/merged|\+details/i.test(s)) {
    return (
      <span className="status-badge" style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontSize: '0.7rem' }}>
        {s}
      </span>
    )
  }
  if (/EV91/i.test(s)) {
    return (
      <span className="status-badge" style={{ background: 'rgba(167,139,250,0.15)', color: '#c4b5fd', fontSize: '0.7rem' }}>
        {s}
      </span>
    )
  }
  if (/Fleet/i.test(s)) {
    return (
      <span className="status-badge" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', fontSize: '0.7rem' }}>
        {s}
      </span>
    )
  }
  return (
    <span className="status-badge ev91-badge-default" style={{ fontSize: '0.7rem' }}>
      {s || '—'}
    </span>
  )
}

export default function Ev91RiderVehicleInsight() {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    return fetchRiderVehicleInsightData({ force: reloadKey > 0 })
      .then((result) => {
        setRows(result.rows || [])
        setMeta(result.meta || null)
      })
      .catch((err) => {
        console.error('Rider & Vehicle Insight load failed:', err)
        setRows([])
        setMeta(null)
        setError(err?.message || 'Failed to load Rider & Vehicle Insight')
      })
      .finally(() => setLoading(false))
  }, [reloadKey])

  useEffect(() => {
    load()
  }, [load])

  const cityOptions = useMemo(() => {
    const fromRows = [...new Set(rows.map((r) => r.city).filter(Boolean))].sort()
    return fromRows.length ? fromRows : EV91_CITIES
  }, [rows])

  const filtered = useMemo(
    () =>
      filterRiderVehicleInsightRows(rows, {
        search: deferredSearch,
        city,
        status,
        source,
      }),
    [rows, deferredSearch, city, status, source]
  )

  const summary = useMemo(() => summarizeRiderVehicleInsight(filtered), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE) || 1)
  const pageSafe = Math.min(page, totalPages - 1)
  const pageRows = useMemo(() => {
    const start = pageSafe * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, pageSafe])

  useEffect(() => {
    setPage(0)
  }, [deferredSearch, city, status, source])

  const handleRefresh = () => {
    clearEv91AllCache('rider-details')
    clearEv91AllCache('overall-status')
    clearEv91AllCache('current-status')
    clearEv91AllCache('client-mapping-history')
    setReloadKey((k) => k + 1)
  }

  const handleExport = () => {
    if (exporting) return
    if (!filtered.length) {
      window.alert('No rows to export for the current filters.')
      return
    }
    setExporting(true)
    try {
      const sheet = filtered.map((row) => {
        const out = {}
        for (const col of RIDER_VEHICLE_INSIGHT_COLUMNS) {
          const raw = row[col.key]
          out[col.label] =
            typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : formatEv91Cell(raw === '' ? null : raw)
          if (out[col.label] === '—') out[col.label] = ''
        }
        return out
      })
      const ws = XLSX.utils.json_to_sheet(sheet)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Rider Vehicle Insight')
      XLSX.writeFile(wb, `ev91_rider_vehicle_insight_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
    } catch (err) {
      setError(err?.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  if (loading && !rows.length) {
    return (
      <div className="loading-container">
        <span className="loader" />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Merging Fleet + EV91 unique riders…
        </p>
      </div>
    )
  }

  return (
    <div className="dashboard-container ev91-root">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>Rider &amp; Vehicle Insight</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Unique riders from Fleet + EV91 APIs · latest Deployee / Return cycle per rider
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
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
            }}
          >
            <RefreshCw size={18} className={loading ? 'ev91-spin' : undefined} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            color: '#f87171',
            background: 'rgba(239,68,68,0.1)',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
          }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <StatCard label="Unique Riders" value={summary.total} icon={Users} color="#4ade80" />
        <StatCard label="Deployed" value={summary.deployed} icon={Bike} color="#38bdf8" />
        <StatCard label="Returned" value={summary.returned} icon={RotateCcw} color="#f59e0b" />
        <StatCard label="With Vehicle" value={summary.withVehicle} icon={Database} color="#a78bfa" />
        <StatCard label="With Profile" value={summary.withProfile} icon={Users} color="#c4b5fd" />
      </div>

      {meta && (
        <p style={{ margin: '0 0 0.85rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          Sources loaded · Rider Details {(meta.riderDetailsCount || 0).toLocaleString()} · Deploy
          cycles {(meta.deployCycleCount || 0).toLocaleString()} · Fleet events{' '}
          {(meta.fleetEventCount || 0).toLocaleString()} · Overall events{' '}
          {(meta.overallEventCount || 0).toLocaleString()}
        </p>
      )}

      <div className="glass ev91-filters" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
          <div className="ev91-search" style={{ flex: '1 1 220px', display: 'flex', gap: '0.4rem' }}>
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rider, vehicle, phone, client…"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
            <MapPin size={14} />
            <select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">All cities</option>
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
            <Filter size={14} />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All status</option>
              <option value="Deployed">Deployed</option>
              <option value="Returned">Returned</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
            <Database size={14} />
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              <option value="Fleet">Fleet</option>
              <option value="EV91">EV91</option>
              <option value="Merged">Merged</option>
            </select>
          </label>
        </div>
      </div>

      <section className="glass" style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: '0.9rem' }}>
            {filtered.length.toLocaleString()} unique rider
            {filtered.length === 1 ? '' : 's'}
            {loading ? ' · updating…' : ''}
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="glass-btn"
              disabled={pageSafe <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ padding: '0.35rem 0.55rem' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Page {pageSafe + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="glass-btn"
              disabled={pageSafe >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              style={{ padding: '0.35rem 0.55rem' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                {RIDER_VEHICLE_INSIGHT_COLUMNS.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={RIDER_VEHICLE_INSIGHT_COLUMNS.length}
                    style={{ textAlign: 'center', color: 'var(--text-dim)' }}
                  >
                    No unique riders found
                  </td>
                </tr>
              ) : (
                pageRows.map((row, idx) => (
                  <tr
                    key={`${row.publicRiderId || ''}-${row.clientRiderId || ''}-${row.phone || ''}-${idx}`}
                  >
                    {RIDER_VEHICLE_INSIGHT_COLUMNS.map((col) => {
                      const raw = row[col.key]
                      if (col.key === 'dataSource') {
                        return <td key={col.key}>{sourceBadge(raw)}</td>
                      }
                      if (col.key === 'currentStatus' || col.key === 'vehicleStatus' || col.key === 'kycStatus') {
                        return (
                          <td key={col.key}>
                            {raw ? (
                              <span className={`status-badge ${statusBadgeClass(raw)}`}>
                                {formatEv91Cell(raw)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        )
                      }
                      return <td key={col.key}>{formatEv91Cell(raw === '' ? null : raw)}</td>
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
