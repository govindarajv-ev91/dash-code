import React, { useEffect, useMemo, useState, useCallback, useDeferredValue, startTransition } from 'react'
import { Layers, Search, Download, Truck, RotateCcw, Calendar, Bike, RefreshCw, Database, Cloud } from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchEv91OverallStatusAll, fetchEv91CurrentStatusAll } from './lib/ev91EvLookup'
import { EV91_WEBAPP_CUTOVER_DATE, EV91_FLEET_DATA_UNTIL_DATE, clearEv91AllCache } from './lib/ev91MisApi'
import {
  buildMergedDeployReturnReport,
  applyEv91CurrentStatusToDeployReturn,
  vehiclePartitionKey,
} from './lib/fleetDeployReturnExport'
import { fetchDeployReturnFleetRows } from './lib/supabaseFetch'
import {
  fetchEv91ClientMappingAll,
  buildEv91PublicRiderIndex,
  lookupEv91PublicRiderId,
} from './lib/ev91OnboardingPending'

const ROWS_PER_PAGE = 100
/** Keep last N deploy cycles per vehicle (after full timeline pairing) */
const MAX_RECENT_PER_VEHICLE = 6

/** Bump to invalidate stale in-memory caches after fetch logic changes. */
const BQ_CACHE_VERSION = 4

/** In-memory cache so leaving/returning to BigQuery Data stays fast. */
let bqPageCache = {
  version: 0,
  overallRows: null,
  currentRows: null,
  mappingRows: null,
  fleetRows: null,
  at: 0,
}
const BQ_PAGE_CACHE_TTL_MS = 30 * 60 * 1000
/** Reject incomplete fleet caches (full DR set is ~25k rows). */
const MIN_FLEET_DR_ROWS = 15000

const TABLE_HEADERS = [
  { key: 'Data_Source', label: 'Source' },
  { key: 'city_name', label: 'City' },
  { key: 'Vehiclenumber', label: 'Vehicle' },
  { key: 'Vehicle_Status', label: 'Status' },
  { key: 'Rider_ID', label: 'Rider ID' },
  { key: 'EV91_PublicRiderId', label: 'EV91 PublicRiderId' },
  { key: 'Rider_Name', label: 'Rider Name' },
  { key: 'Rider_Contact_Number', label: 'Contact' },
  { key: 'CLIENT_NAME', label: 'Client' },
  { key: 'Hub_Location', label: 'Hub' },
  { key: 'Category', label: 'Category' },
  { key: 'Deployee_date', label: 'Deployee Date' },
  { key: 'Return_date', label: 'Return Date' },
  { key: 'number_of_days_with_rider', label: 'Days with Rider' },
  { key: 'vehicle_current_status', label: 'Current Status' },
]

function StatCard({ label, value, icon: Icon, color, iconBg }) {
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

function sourceBadge(source) {
  if (source === 'EV91 API') {
    return (
      <span className="status-badge" style={{ background: 'rgba(167,139,250,0.15)', color: '#c4b5fd', fontSize: '0.7rem' }}>
        EV91 API
      </span>
    )
  }
  if (source === 'Cutover') {
    return (
      <span className="status-badge" style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontSize: '0.7rem' }}>
        Cutover
      </span>
    )
  }
  return (
    <span className="status-badge" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', fontSize: '0.7rem' }}>
      Fleet
    </span>
  )
}

function enrichPublicRiderIds(rows, publicRiderIndex) {
  if (!rows?.length) return rows || []
  return rows.map((r) => {
    const existing = (r.EV91_PublicRiderId || '').toString().trim()
    if (existing) return r
    const mapped = lookupEv91PublicRiderId(
      publicRiderIndex,
      r.Rider_ID,
      r.Rider_Contact_Number
    )
    if (!mapped) return r
    return { ...r, EV91_PublicRiderId: mapped }
  })
}

function filterDeployReturnRows(
  rows,
  { search = '', city = '', currentStatus = '', source = '', startDate = '', endDate = '' } = {}
) {
  // Support pasting many plates (newline / comma / space separated)
  const tokens = search
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const multiPlate = tokens.length > 1
  const plateSet = multiPlate
    ? new Set(tokens.map((t) => t.replace(/[^a-z0-9]/gi, '').toUpperCase()))
    : null

  return (rows || []).filter((r) => {
    if (city && (r.city_name || '') !== city) return false
    if (currentStatus && (r.vehicle_current_status || '') !== currentStatus) return false
    if (source && (r.Data_Source || '') !== source) return false
    if (startDate && (!r.Deployee_date || r.Deployee_date < startDate)) return false
    if (endDate && (!r.Deployee_date || r.Deployee_date > endDate)) return false
    if (!tokens.length) return true

    if (multiPlate) {
      const plate = (r.Vehiclenumber || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
      return plateSet.has(plate)
    }

    const q = tokens[0]
    return (
      (r.Vehiclenumber || '').toLowerCase().includes(q) ||
      (r.Rider_ID || '').toLowerCase().includes(q) ||
      (r.EV91_PublicRiderId || '').toLowerCase().includes(q) ||
      (r.Rider_Name || '').toLowerCase().includes(q) ||
      (r.Rider_Contact_Number || '').toLowerCase().includes(q) ||
      (r.CLIENT_NAME || '').toLowerCase().includes(q) ||
      (r.city_name || '').toLowerCase().includes(q) ||
      (r.Hub_Location || '').toLowerCase().includes(q) ||
      (r.Category || '').toLowerCase().includes(q) ||
      (r.Data_Source || '').toLowerCase().includes(q)
    )
  })
}

export default function BigQueryDeployReturn({
  fleetData = [],
  loading = false,
  fleetFullLoading = false,
  fleetIsSlim = false,
  loadFullFleet,
}) {
  const [overallRows, setOverallRows] = useState(() => bqPageCache.overallRows || [])
  const [currentRows, setCurrentRows] = useState(() => bqPageCache.currentRows || [])
  const [mappingRows, setMappingRows] = useState(() => bqPageCache.mappingRows || [])
  const [bqFleetRows, setBqFleetRows] = useState(() => bqPageCache.fleetRows || [])
  const [apiLoading, setApiLoading] = useState(() => !bqPageCache.overallRows)
  const [fleetBqLoading, setFleetBqLoading] = useState(() => !bqPageCache.fleetRows)
  const [apiError, setApiError] = useState('')
  const [fromCache, setFromCache] = useState(
    () => Boolean(bqPageCache.version === BQ_CACHE_VERSION && bqPageCache.overallRows && bqPageCache.fleetRows)
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [mergeMode, setMergeMode] = useState('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [city, setCity] = useState('')
  const [currentStatus, setCurrentStatus] = useState('')
  const [source, setSource] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(0)

  // Do NOT call loadFullFleet here — that re-downloads all fleet columns and doubles wait time.
  // BigQuery uses its own narrow Deploy/Return fetch instead.

  const loadPageData = useCallback(async () => {
    const force = reloadKey > 0
    const cacheFresh =
      !force &&
      bqPageCache.version === BQ_CACHE_VERSION &&
      bqPageCache.overallRows &&
      bqPageCache.currentRows &&
      bqPageCache.mappingRows &&
      Array.isArray(bqPageCache.fleetRows) &&
      bqPageCache.fleetRows.length >= MIN_FLEET_DR_ROWS &&
      Date.now() - bqPageCache.at < BQ_PAGE_CACHE_TTL_MS

    if (cacheFresh) {
      setOverallRows(bqPageCache.overallRows)
      setCurrentRows(bqPageCache.currentRows)
      setMappingRows(bqPageCache.mappingRows)
      setBqFleetRows(bqPageCache.fleetRows)
      setFromCache(true)
      setApiLoading(false)
      setFleetBqLoading(false)
      setApiError('')
      return
    }

    setApiLoading(true)
    setFleetBqLoading(true)
    setApiError('')
    setFromCache(false)

    let overall = bqPageCache.overallRows || []
    let current = bqPageCache.currentRows || []
    let mapping = bqPageCache.mappingRows || []
    let fleet = bqPageCache.fleetRows || []

    // Progressive: API (small) and fleet (large) update UI independently
    const apiTask = Promise.all([
      fetchEv91OverallStatusAll({ force }),
      fetchEv91CurrentStatusAll({ force }).catch(() => ({ data: [] })),
    ])
      .then(([overallResult, currentResult]) => {
        overall = overallResult?.data || []
        current = currentResult?.data || []
        startTransition(() => {
          setOverallRows(overall)
          setCurrentRows(current)
        })
        setApiLoading(false)
      })
      .catch((err) => {
        console.warn('BigQuery EV91 load failed:', err)
        setApiError(err?.message || 'Failed to load EV91 Overall / Current Status')
        setApiLoading(false)
      })

    const fleetTask = fetchDeployReturnFleetRows()
      .then((rows) => {
        fleet = Array.isArray(rows) ? rows : []
        startTransition(() => setBqFleetRows(fleet))
        setFleetBqLoading(false)
      })
      .catch((err) => {
        console.warn('BigQuery fleet DR fetch failed:', err)
        setApiError((prev) => prev || err?.message || 'Failed to load Fleet Deploy/Return')
        setFleetBqLoading(false)
      })

    // Mapping is only for PublicRiderId enrichment — load after / in parallel, don't block
    const mappingTask = fetchEv91ClientMappingAll()
      .catch(() => ({ data: [] }))
      .then((mappingResult) => {
        mapping = mappingResult?.data || []
        startTransition(() => setMappingRows(mapping))
      })

    await Promise.allSettled([apiTask, fleetTask, mappingTask])

    bqPageCache = {
      version: BQ_CACHE_VERSION,
      overallRows: overall,
      currentRows: current,
      mappingRows: mapping,
      fleetRows: fleet,
      at: Date.now(),
    }
  }, [reloadKey])

  useEffect(() => {
    loadPageData()
  }, [loadPageData])

  const publicRiderIndex = useMemo(
    () => buildEv91PublicRiderIndex(overallRows, mappingRows),
    [overallRows, mappingRows]
  )

  const apiDeployReturnCount = useMemo(
    () =>
      (overallRows || []).filter((row) => {
        const s = String(row.vehicleStatus || '').toLowerCase()
        return s.includes('deploy') || s.includes('return') || s.includes('swap')
      }).length,
    [overallRows]
  )

  // Prefer dedicated BQ fleet; fall back to app slim fleet so the page isn't empty while loading
  const fleetForReport = bqFleetRows.length ? bqFleetRows : fleetData || []
  const deferredFleet = useDeferredValue(fleetForReport)
  const deferredOverall = useDeferredValue(overallRows)
  const deferredCurrent = useDeferredValue(currentRows)

  const reportRows = useMemo(() => {
    const base = buildMergedDeployReturnReport(deferredFleet, deferredOverall, {
      maxRecentDeployReturnPerVehicle: MAX_RECENT_PER_VEHICLE,
      cutoverDate: EV91_WEBAPP_CUTOVER_DATE,
      fleetUntilDate: EV91_FLEET_DATA_UNTIL_DATE,
      mode: mergeMode,
    })
    const withCurrent = applyEv91CurrentStatusToDeployReturn(base, deferredCurrent)
    return enrichPublicRiderIds(withCurrent, publicRiderIndex)
  }, [deferredFleet, deferredOverall, deferredCurrent, mergeMode, publicRiderIndex])

  const cityOptions = useMemo(
    () => [...new Set(reportRows.map((r) => r.city_name).filter(Boolean))].sort(),
    [reportRows]
  )

  const filtered = useMemo(
    () =>
      filterDeployReturnRows(reportRows, {
        search: deferredSearch,
        city,
        currentStatus,
        source,
        startDate,
        endDate,
      }),
    [reportRows, deferredSearch, city, currentStatus, source, startDate, endDate]
  )

  const plateSearchInfo = useMemo(() => {
    const tokens = deferredSearch
      .split(/[\s,;|]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length <= 1) return null
    const wanted = [...new Set(tokens.map((t) => t.replace(/[^a-z0-9]/gi, '').toUpperCase()))]
    const found = new Set(
      reportRows.map((r) => (r.Vehiclenumber || '').replace(/[^a-z0-9]/gi, '').toUpperCase())
    )
    const missingPlates = wanted.filter((p) => !found.has(p))
    return {
      wanted: wanted.length,
      found: wanted.length - missingPlates.length,
      missingPlates,
    }
  }, [deferredSearch, reportRows])

  const summary = useMemo(() => {
    let deployed = 0
    let returned = 0
    let fleet = 0
    let api = 0
    let withPublicId = 0
    const vehicles = new Set()
    const deployedVehicles = new Set()
    for (const r of filtered) {
      if (r.Vehiclenumber) vehicles.add(vehiclePartitionKey(r.Vehiclenumber))
      if (r.vehicle_current_status === 'Deployed') {
        deployed++
        if (r.Vehiclenumber) deployedVehicles.add(vehiclePartitionKey(r.Vehiclenumber))
      } else if (r.vehicle_current_status === 'Returned') {
        returned++
      }
      if (r.Data_Source === 'EV91 API') api++
      else fleet++
      if (r.EV91_PublicRiderId) withPublicId++
    }
    return {
      total: filtered.length,
      deployed: deployedVehicles.size || deployed,
      returned,
      fleet,
      api,
      withPublicId,
      vehicles: vehicles.size,
    }
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const pageSafe = Math.min(page, totalPages - 1)
  const paginated = useMemo(() => {
    const start = pageSafe * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, pageSafe])

  useEffect(() => {
    setPage(0)
  }, [deferredSearch, city, currentStatus, source, startDate, endDate, mergeMode])

  const exportExcel = () => {
    const sheet = filtered.map((r) => {
      const out = {}
      for (const col of TABLE_HEADERS) out[col.label] = r[col.key]
      return out
    })
    const ws = XLSX.utils.json_to_sheet(sheet)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Deploy Return')
    XLSX.writeFile(wb, `BigQuery_Deploy_Return_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const hasSeedData =
    reportRows.length > 0 ||
    bqFleetRows.length > 0 ||
    overallRows.length > 0 ||
    (fleetData?.length || 0) > 0
  const busy = (apiLoading || fleetBqLoading) && !hasSeedData

  if (busy) {
    return (
      <div className="loading-container">
        <span className="loader" />
        <p style={{ marginTop: '0.75rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Loading BigQuery Deploy/Return…
        </p>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <header style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Layers size={28} style={{ color: '#38bdf8' }} />
            <div>
              <h1 style={{ margin: 0 }}>BigQuery Data</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Deploy/Return · Fleet + EV91 Overall · PublicRiderId from Client Mapping · rn ≤ {MAX_RECENT_PER_VEHICLE}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="glass"
              onClick={() => {
                bqPageCache = {
                  version: 0,
                  overallRows: null,
                  currentRows: null,
                  mappingRows: null,
                  fleetRows: null,
                  at: 0,
                }
                clearEv91AllCache('overall-status')
                clearEv91AllCache('current-status')
                clearEv91AllCache('client-mapping-history')
                setReloadKey((k) => k + 1)
              }}
              style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}
            >
              <RefreshCw size={16} className={apiLoading || fleetBqLoading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="glass"
              onClick={exportExcel}
              disabled={!filtered.length}
              style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}
            >
              <Download size={16} />
              Export Excel
            </button>
          </div>
        </div>
      </header>

      {apiError ? (
        <div className="glass" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', color: '#f87171', fontSize: '0.85rem' }}>
          {apiError}
        </div>
      ) : null}

      <div className="fdv-tab-bar glass" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`fdv-tab ${mergeMode === 'all' ? 'fdv-tab-active' : ''}`}
          onClick={() => setMergeMode('all')}
        >
          <Layers size={16} />
          Fleet + EV91 Overall
        </button>
        <button
          type="button"
          className={`fdv-tab ${mergeMode === 'cutover' ? 'fdv-tab-active' : ''}`}
          onClick={() => setMergeMode('cutover')}
        >
          <Calendar size={16} />
          Cutover merge
        </button>
      </div>

      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
        {mergeMode === 'all' ? (
          <>
            Full Fleet + EV91 Overall in one timeline · same vehicle / client / rider / deploy date → one merged row
          </>
        ) : (
          <>
            Fleet through <strong style={{ color: '#fff' }}>{EV91_FLEET_DATA_UNTIL_DATE}</strong>
            {' + '}EV91 Overall from <strong style={{ color: '#fff' }}>{EV91_WEBAPP_CUTOVER_DATE}</strong>
            {' · '}same vehicle / client / rider / deploy date → one merged row
          </>
        )}
      </p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--accent-blue)' }}>
        EV91 Overall: {(overallRows || []).length.toLocaleString('en-IN')}
        {' · '}Current Status: {(currentRows || []).length.toLocaleString('en-IN')}
        {' · '}Deploy/Return events: {apiDeployReturnCount.toLocaleString('en-IN')}
        {' · '}Fleet DR rows: {(fleetForReport || []).length.toLocaleString('en-IN')}
        {' · '}Client Mapping: {(mappingRows || []).length.toLocaleString('en-IN')}
        {' · '}PublicRiderId filled: {summary.withPublicId.toLocaleString('en-IN')}
        {fromCache && !apiLoading && !fleetBqLoading ? ' · cached' : ''}
      </p>

      <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="Deploy cycles" value={summary.total.toLocaleString('en-IN')} icon={Layers} color="#38bdf8" iconBg="rgba(56,189,248,0.12)" />
        <StatCard label="Currently Deployed" value={summary.deployed.toLocaleString('en-IN')} icon={Truck} color="#4ade80" iconBg="rgba(74,222,128,0.12)" />
        <StatCard label="Returned" value={summary.returned.toLocaleString('en-IN')} icon={RotateCcw} color="#fb923c" iconBg="rgba(251,146,60,0.12)" />
        <StatCard label="From Fleet" value={summary.fleet.toLocaleString('en-IN')} icon={Database} color="#4ade80" iconBg="rgba(74,222,128,0.12)" />
        <StatCard label="From EV91 API" value={summary.api.toLocaleString('en-IN')} icon={Cloud} color="#a78bfa" iconBg="rgba(167,139,250,0.12)" />
        <StatCard label="Vehicles" value={summary.vehicles.toLocaleString('en-IN')} icon={Bike} color="#c4b5fd" iconBg="rgba(196,181,253,0.12)" />
      </section>

      {(fleetBqLoading || apiLoading) && (
        <div className="status-badge" style={{ marginBottom: '0.75rem', padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
          {fleetBqLoading && apiLoading
            ? 'Loading Fleet Deploy/Return + EV91 APIs…'
            : fleetBqLoading
              ? 'Loading Fleet Deploy/Return rows…'
              : 'Loading EV91 Overall / Current Status…'}
        </div>
      )}

      <div className="filter-bar glass" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={currentStatus}
          onChange={(e) => setCurrentStatus(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All current status</option>
          <option value="Deployed">Deployed</option>
          <option value="Returned">Returned</option>
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All sources</option>
          <option value="Fleet">Fleet</option>
          <option value="EV91 API">EV91 API</option>
          <option value="Cutover">Cutover</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <Calendar size={14} />
          Deployee from
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.45rem' }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          to
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.45rem' }}
          />
        </label>
        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '0.7rem', color: 'var(--text-dim)' }} />
          <textarea
            rows={2}
            placeholder="Paste many vehicle numbers (one per line)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', outline: 'none', resize: 'vertical', minHeight: '2.6rem' }}
          />
        </div>
      </div>

      {plateSearchInfo ? (
        <div className="glass" style={{ marginBottom: '0.75rem', padding: '0.65rem 0.9rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          Plate search: found <strong style={{ color: '#4ade80' }}>{plateSearchInfo.found}</strong>
          {' / '}
          {plateSearchInfo.wanted}
          {plateSearchInfo.missingPlates.length ? (
            <>
              {' · '}not in data ({plateSearchInfo.missingPlates.length}):{' '}
              <span style={{ color: '#fb923c' }}>{plateSearchInfo.missingPlates.slice(0, 12).join(', ')}</span>
              {plateSearchInfo.missingPlates.length > 12 ? '…' : ''}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          <table>
            <thead>
              <tr>
                {TABLE_HEADERS.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length ? (
                paginated.map((r, idx) => (
                  <tr key={`${r.Data_Source}-${r.Vehiclenumber}-${r.Deployee_date}-${r.Rider_ID}-${idx}`}>
                    <td>{sourceBadge(r.Data_Source)}</td>
                    <td>{r.city_name || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{r.Vehiclenumber}</td>
                    <td>{r.Vehicle_Status}</td>
                    <td style={{ fontSize: '0.8rem' }}>
                      <div>{r.Rider_ID || '—'}</div>
                      {r.EV91_PublicRiderId ? (
                        <div
                          style={{ fontSize: '0.7rem', color: '#c4b5fd', marginTop: 2 }}
                          title="EV91 PublicRiderId (Client Mapping / Overall)"
                        >
                          {r.EV91_PublicRiderId}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: '#c4b5fd' }}>{r.EV91_PublicRiderId || '—'}</td>
                    <td>{r.Rider_Name || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.Rider_Contact_Number || '—'}</td>
                    <td>{r.CLIENT_NAME || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.Hub_Location || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{r.Category || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{r.Deployee_date}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{r.Return_date}</td>
                    <td style={{ fontWeight: 600 }}>{r.number_of_days_with_rider}</td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          fontSize: '0.7rem',
                          color: r.vehicle_current_status === 'Deployed' ? '#4ade80' : '#fb923c',
                          background:
                            r.vehicle_current_status === 'Deployed'
                              ? 'rgba(74,222,128,0.12)'
                              : 'rgba(251,146,60,0.12)',
                        }}
                      >
                        {r.vehicle_current_status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={TABLE_HEADERS.length} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                    No Deploy/Return cycles for current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            {filtered.length.toLocaleString('en-IN')} rows · page {pageSafe + 1}/{totalPages}
            {' · '}rn ≤ {MAX_RECENT_PER_VEHICLE} per source
            {mergeMode === 'cutover'
              ? ` · fleet ≤ ${EV91_FLEET_DATA_UNTIL_DATE} / API ≥ ${EV91_WEBAPP_CUTOVER_DATE}`
              : ' · full Fleet + full EV91 Overall'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="glass-btn"
              disabled={pageSafe <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ padding: '0.4rem 0.75rem' }}
            >
              Prev
            </button>
            <button
              type="button"
              className="glass-btn"
              disabled={pageSafe >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              style={{ padding: '0.4rem 0.75rem' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
