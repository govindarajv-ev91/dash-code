import React, { useMemo, useState, useCallback, useEffect, useDeferredValue } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Briefcase,
  Calendar,
  Download,
  MapPin,
  Search,
  User,
  Bike,
  Zap,
  Filter,
  X,
} from 'lucide-react'
import {
  buildActiveRiderRows,
  buildActiveRiderFilterOptions,
  filterActiveRiderRows,
  summarizeActiveRiders,
  activeRidersToCsv,
  parseIsoWeekKey,
} from './lib/fleetActiveRiders'

const PAGE_SIZES = [25, 50, 100, 250]

export default function FleetActiveRiders({ fleetData, riderData = [], loading }) {
  const [asOfDate, setAsOfDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [fleetTypeFilter, setFleetTypeFilter] = useState('All')
  const [deployWeekFilter, setDeployWeekFilter] = useState('All')
  const [deployDateFrom, setDeployDateFrom] = useState('')
  const [deployDateTo, setDeployDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 280)
    return () => clearTimeout(timer)
  }, [search])

  const deferredSearch = useDeferredValue(searchDebounced)

  const asOf = useMemo(() => {
    try {
      return parseISO(asOfDate)
    } catch {
      return new Date()
    }
  }, [asOfDate])

  const allRows = useMemo(
    () => buildActiveRiderRows(fleetData, riderData, asOf),
    [fleetData, riderData, asOf]
  )

  const filterOptions = useMemo(() => buildActiveRiderFilterOptions(allRows), [allRows])

  const filteredRows = useMemo(
    () =>
      filterActiveRiderRows(allRows, {
        city: cityFilter,
        client: clientFilter,
        fleetType: fleetTypeFilter,
        deployWeek: deployWeekFilter,
        deployDateFrom,
        deployDateTo,
        search: deferredSearch,
      }),
    [
      allRows,
      cityFilter,
      clientFilter,
      fleetTypeFilter,
      deployWeekFilter,
      deployDateFrom,
      deployDateTo,
      deferredSearch,
    ]
  )

  const stats = useMemo(() => summarizeActiveRiders(filteredRows), [filteredRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const weekLabel =
    deployWeekFilter !== 'All' ? parseIsoWeekKey(deployWeekFilter) : null

  const clearFilters = useCallback(() => {
    setCityFilter('All')
    setClientFilter('All')
    setFleetTypeFilter('All')
    setDeployWeekFilter('All')
    setDeployDateFrom('')
    setDeployDateTo('')
    setSearch('')
    setPage(0)
  }, [])

  const exportCsv = () => {
    const csv = activeRidersToCsv(filteredRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `active_riders_${asOfDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasFilters =
    cityFilter !== 'All' ||
    clientFilter !== 'All' ||
    fleetTypeFilter !== 'All' ||
    deployWeekFilter !== 'All' ||
    deployDateFrom ||
    deployDateTo ||
    search

  if (loading && (!fleetData || fleetData.length === 0)) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="fsr-container far-container">
      <div className="fsr-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <User size={28} style={{ color: 'var(--primary)' }} />
          <div>
            <h1>Active Riders</h1>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              EV = rider matched to a fleet vehicle · NON-EV = active rider with no vehicle · as of{' '}
              {format(asOf, 'dd/MM/yyyy')}
            </p>
          </div>
        </div>
      </div>

      <div className="fsr-filters glass far-filters-grid">
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} /> As of date
          </label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => {
              setAsOfDate(e.target.value)
              setPage(0)
            }}
            className="fsr-date-input"
          />
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <MapPin size={16} /> City
          </label>
          <select
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value)
              setPage(0)
            }}
            className="fsr-select"
          >
            <option value="All">All cities</option>
            {filterOptions.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Briefcase size={16} /> Client
          </label>
          <select
            value={clientFilter}
            onChange={(e) => {
              setClientFilter(e.target.value)
              setPage(0)
            }}
            className="fsr-select"
          >
            <option value="All">All clients</option>
            {filterOptions.clients.map((client) => (
              <option key={client} value={client}>
                {client}
              </option>
            ))}
          </select>
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Zap size={16} /> Fleet type
          </label>
          <select
            value={fleetTypeFilter}
            onChange={(e) => {
              setFleetTypeFilter(e.target.value)
              setPage(0)
            }}
            className="fsr-select"
          >
            <option value="All">All (EV + NON-EV)</option>
            <option value="EV">EV</option>
            <option value="NON-EV">NON-EV</option>
          </select>
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} /> Deploy week
          </label>
          <select
            value={deployWeekFilter}
            onChange={(e) => {
              setDeployWeekFilter(e.target.value)
              setPage(0)
            }}
            className="fsr-select"
          >
            <option value="All">All weeks</option>
            {filterOptions.weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} /> Deploy from
          </label>
          <input
            type="date"
            value={deployDateFrom}
            onChange={(e) => {
              setDeployDateFrom(e.target.value)
              setPage(0)
            }}
            className="fsr-date-input"
          />
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} /> Deploy to
          </label>
          <input
            type="date"
            value={deployDateTo}
            onChange={(e) => {
              setDeployDateTo(e.target.value)
              setPage(0)
            }}
            className="fsr-date-input"
          />
        </div>

        <div className="fsr-filter-group" style={{ flex: 1, minWidth: '200px' }}>
          <label className="fsr-filter-label">
            <Search size={16} /> Search
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="fsr-date-input"
            placeholder="Rider, vehicle, mobile…"
          />
        </div>

        <div className="far-filter-actions">
          {hasFilters && (
            <button type="button" className="far-clear-btn" onClick={clearFilters} title="Clear filters">
              <X size={16} /> Clear
            </button>
          )}
          <button
            type="button"
            className="fsr-export-btn"
            onClick={exportCsv}
            disabled={!filteredRows.length}
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {weekLabel && deployWeekFilter !== 'All' && (
        <p className="far-week-hint">
          <Filter size={14} /> Deploy week {deployWeekFilter}:{' '}
          {format(weekLabel.start, 'dd/MM/yyyy')} – {format(weekLabel.end, 'dd/MM/yyyy')}
        </p>
      )}

      <div className="fsr-stats-grid">
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-deployed">
            <User size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Active riders</span>
            <span className="fsr-stat-value">{stats.total.toLocaleString()}</span>
            {stats.total !== allRows.length && (
              <span className="far-stat-sub">of {allRows.length.toLocaleString()} total</span>
            )}
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-positive">
            <Zap size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">EV (vehicle match)</span>
            <span className="fsr-stat-value">{stats.ev.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total">
            <Bike size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">NON-EV (no vehicle)</span>
            <span className="fsr-stat-value">{stats.nonEv.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total">
            <MapPin size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Cities / Clients</span>
            <span className="fsr-stat-value">
              {filterOptions.cities.length} / {filterOptions.clients.length}
            </span>
          </div>
        </div>
      </div>

      <div className="fsr-table-wrap glass">
        <div className="fsr-table-header">
          <h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <User size={20} />
              <span>Currently active riders</span>
            </span>
          </h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {stats.ev.toLocaleString()} with vehicle · {stats.nonEv.toLocaleString()} without
          </span>
        </div>

        <div className="fsr-table-scroll far-table-scroll">
          <table className="fsr-table far-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="fsr-th-name">Rider ID</th>
                <th className="fsr-th-name">Rider Name</th>
                <th>Mobile</th>
                <th>Vehicle</th>
                <th className="fsr-th-name">City</th>
                <th className="fsr-th-name">Client</th>
                <th>Source</th>
                <th>Hub</th>
                <th>Fleet</th>
                <th>Deploy / Active</th>
                <th>Week</th>
                <th className="fsr-th-deployed">{/* EV: days on road · NON-EV: days since active */}Days</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No active riders match the selected filters
                  </td>
                </tr>
              ) : (
                pageRows.map((row, i) => (
                  <tr key={`${row.riderId}-${row.vehicleNumber}-${i}`} className="fsr-row">
                    <td className="far-row-num">{safePage * pageSize + i + 1}</td>
                    <td className="fsr-td-name">
                      <span className="fsr-name-badge">{row.riderId || '—'}</span>
                    </td>
                    <td className="fsr-td-name">{row.riderName || '—'}</td>
                    <td>{row.mobile || '—'}</td>
                    <td>
                      {row.vehicleNumber ? (
                        <span className="fsr-name-badge">{row.vehicleNumber}</span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </td>
                    <td className="fsr-td-name">{row.city}</td>
                    <td className="fsr-td-name">{row.client}</td>
                    <td>{row.source || '—'}</td>
                    <td>{row.hub || '—'}</td>
                    <td>
                      <span
                        className={`far-fleet-badge ${row.fleetType === 'EV' ? 'far-fleet-ev' : 'far-fleet-nonev'}`}
                      >
                        {row.fleetType}
                      </span>
                    </td>
                    <td>{row.deployDateDisplay}</td>
                    <td>{row.deployWeek}</td>
                    <td className="fsr-td-deployed">
                      <span className="fsr-badge fsr-badge-deployed">{row.allotmentDays}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 && (
          <div className="fdv-pagination far-pagination">
            <div className="fdv-page-size">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <span className="fdv-page-info">
              {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filteredRows.length)} of{' '}
              {filteredRows.length.toLocaleString()}
            </span>
            <div className="fdv-page-btns">
              <button type="button" disabled={safePage === 0} onClick={() => setPage(0)}>
                «
              </button>
              <button type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                ‹
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                ›
              </button>
              <button type="button" disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
