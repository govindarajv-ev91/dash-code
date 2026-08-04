import React, { useMemo, useState, useDeferredValue, useCallback, useEffect, startTransition } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import {
  Download,
  Search,
  MapPin,
  Briefcase,
  RefreshCw,
  Tag,
  UserCheck,
  UserX,
  AlertTriangle,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  IndianRupee,
  Receipt,
  Calendar,
  Database,
} from 'lucide-react'
import {
  getZeroOrderAsOfFromEndDate,
  getZeroOrderWindowDates,
  buildRiderMetricsIndex,
  rowsToPerformanceCsv,
  getCellValue,
  filterRiderPerformanceRows,
  summarizeRiderPerformanceRows,
  summarizeRentalPendingRows,
  hasZeroOrdersLast4Days,
} from './lib/riderPerformanceReport'
import {
  fetchAllRentalPending,
  buildRentalPendingByRiderIndex,
} from './lib/rentalPendingDb'
import { fetchIotDataInRange } from './lib/iotDataDb'
import {
  enrichPerformanceRowsWithIotKm,
  buildVehicleDayKmIndex,
  getIotKmDateRange,
} from './lib/riderPerformanceIotKm'
import { selectOverviewOrderRows } from './lib/mergeRiderMetrics'
import { EV91_CITIES } from './lib/ev91MisApi'
import {
  fetchEv91DeployedRiders,
  fetchEv91RiderDetails,
  buildEv91RiderPerformanceReport,
  getEv91RiderPerformanceHeaders,
  getEv91ZeroOrderRiderPerformanceHeaders,
  lookupEv91RentalPending,
} from './lib/ev91RiderPerformance'
import { fillPerformanceRowSourceFromOnboarding } from './lib/onboardingSourceLookup'
import { fetchAllData } from './lib/supabaseFetch'

const ROWS_PER_PAGE = 80

export default function Ev91RiderPerformance({
  riderData,
  onboardingData = [],
  loading,
  refreshing = false,
  dataUpdatedAt = null,
  refreshData,
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [sourceFilter, setSourceFilter] = useState('All')
  const [rentalPendingRows, setRentalPendingRows] = useState([])
  const [rentalPendingLoading, setRentalPendingLoading] = useState(true)
  const [includeNegativeRental, setIncludeNegativeRental] = useState(false)
  const [activeViewTab, setActiveViewTab] = useState('all')
  const [iotRows, setIotRows] = useState([])
  const [iotLoading, setIotLoading] = useState(true)
  const [ev91Rows, setEv91Rows] = useState([])
  const [ev91Loading, setEv91Loading] = useState(true)
  const [ev91Error, setEv91Error] = useState('')
  const [riderDetailsById, setRiderDetailsById] = useState(new Map())
  const [localOnboarding, setLocalOnboarding] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const today = useMemo(() => new Date(), [])

  const [zeroOrderEndDate, setZeroOrderEndDate] = useState(() =>
    format(subDays(new Date(), 1), 'yyyy-MM-dd')
  )
  const zeroOrderAsOf = useMemo(() => {
    const parsed = parseISO(zeroOrderEndDate)
    if (Number.isNaN(parsed.getTime())) return getZeroOrderAsOfFromEndDate(subDays(today, 1))
    return getZeroOrderAsOfFromEndDate(parsed)
  }, [zeroOrderEndDate, today])
  const zeroOrderWindowDates = useMemo(() => {
    const parsed = parseISO(zeroOrderEndDate)
    return getZeroOrderWindowDates(Number.isNaN(parsed.getTime()) ? subDays(today, 1) : parsed)
  }, [zeroOrderEndDate, today])
  const zeroOrderWindowLabel = useMemo(
    () => zeroOrderWindowDates.map((d) => format(d, 'dd/MM')).join(', '),
    [zeroOrderWindowDates]
  )
  const reportDate = format(today, 'yyyy-MM-dd')
  const maxZeroOrderEndDate = format(today, 'yyyy-MM-dd')
  const reportAsOf = activeViewTab === 'zero_orders' ? zeroOrderAsOf : today
  const allTableHeaders = useMemo(() => getEv91RiderPerformanceHeaders(today), [today])
  const zeroOrderTableHeaders = useMemo(
    () => getEv91ZeroOrderRiderPerformanceHeaders(zeroOrderAsOf),
    [zeroOrderAsOf]
  )
  const tableHeaders = activeViewTab === 'zero_orders' ? zeroOrderTableHeaders : allTableHeaders

  const isDataPending = ev91Loading || refreshing
  const deferredRider = useDeferredValue(riderData)

  const loadEv91Deployed = useCallback(() => {
    setEv91Loading(true)
    setEv91Error('')
    return Promise.all([
      fetchEv91DeployedRiders(),
      fetchEv91RiderDetails().catch(() => new Map()),
    ])
      .then(([deployed, details]) => {
        setEv91Rows(deployed.rows || [])
        setRiderDetailsById(details || new Map())
      })
      .catch((err) => {
        console.warn('EV91 deployed riders load failed:', err)
        setEv91Rows([])
        setEv91Error(err?.message || 'Failed to load EV91 deployed riders')
      })
      .finally(() => setEv91Loading(false))
  }, [])

  useEffect(() => {
    loadEv91Deployed()
  }, [loadEv91Deployed])

  // Ensure rider_onboarding is available for Source lookup (App secondary load can lag / miss cache)
  useEffect(() => {
    if (onboardingData?.length) {
      setLocalOnboarding([])
      return
    }
    let cancelled = false
    fetchAllData('rider_onboarding', 'rider_id_details,rider_id,worker_code,source_name,rider_mobile_number,merge', 'id', {
      pageSize: 1000,
      useKeyset: true,
    })
      .then((res) => {
        if (!cancelled) setLocalOnboarding(res?.data || [])
      })
      .catch((err) => {
        console.warn('rider_onboarding source lookup load failed:', err)
        if (!cancelled) setLocalOnboarding([])
      })
    return () => {
      cancelled = true
    }
  }, [onboardingData])

  const resolvedOnboarding = onboardingData?.length ? onboardingData : localOnboarding

  const loadRentalPending = useCallback((force = false) => {
    setRentalPendingLoading(true)
    return fetchAllRentalPending({ force })
      .then((data) => setRentalPendingRows(data || []))
      .catch((err) => {
        console.warn('Rental pending load failed:', err)
        setRentalPendingRows([])
      })
      .finally(() => setRentalPendingLoading(false))
  }, [])

  useEffect(() => {
    loadRentalPending()
  }, [loadRentalPending])

  const orderRowsForMetrics = useMemo(
    () => selectOverviewOrderRows(deferredRider),
    [deferredRider]
  )

  const iotKmDateRange = useMemo(() => getIotKmDateRange(reportAsOf), [reportAsOf])

  const loadIotKm = useCallback(() => {
    setIotLoading(true)
    return fetchIotDataInRange(iotKmDateRange.from, iotKmDateRange.to)
      .then((data) => setIotRows(data || []))
      .catch((err) => {
        console.warn('IoT KM load failed:', err)
        setIotRows([])
      })
      .finally(() => setIotLoading(false))
  }, [iotKmDateRange])

  useEffect(() => {
    loadIotKm()
  }, [loadIotKm])

  const rentalPendingIndex = useMemo(
    () => buildRentalPendingByRiderIndex(rentalPendingRows),
    [rentalPendingRows]
  )

  const metricsIndex = useMemo(
    () => buildRiderMetricsIndex(orderRowsForMetrics),
    [orderRowsForMetrics]
  )

  const iotKmIndex = useMemo(() => buildVehicleDayKmIndex(iotRows), [iotRows])

  const reportRows = useMemo(() => {
    if (!ev91Rows.length) return []
    const base = buildEv91RiderPerformanceReport(ev91Rows, orderRowsForMetrics, reportAsOf, {
      metricsIndex,
      riderDetailsById,
      onboardingRows: resolvedOnboarding,
    })
    const withSource = fillPerformanceRowSourceFromOnboarding(base, resolvedOnboarding)
    const withRental = withSource.map((row) => ({
      ...row,
      'Rental Pending Amount': lookupEv91RentalPending(rentalPendingIndex, row) ?? '',
    }))
    return enrichPerformanceRowsWithIotKm(withRental, iotKmIndex, reportAsOf)
  }, [
    ev91Rows,
    orderRowsForMetrics,
    reportAsOf,
    metricsIndex,
    rentalPendingIndex,
    iotKmIndex,
    riderDetailsById,
    resolvedOnboarding,
  ])

  const cities = useMemo(() => {
    const set = new Set([
      ...EV91_CITIES,
      ...reportRows.map((r) => r.City).filter(Boolean),
    ])
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [reportRows])

  const clients = useMemo(() => {
    const set = new Set(reportRows.map((r) => r.Client).filter(Boolean))
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [reportRows])

  const sources = useMemo(() => {
    const set = new Set(reportRows.map((r) => r.Source).filter((s) => s && s.trim()))
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [reportRows])

  const filteredRows = useMemo(
    () =>
      filterRiderPerformanceRows(reportRows, {
        city: cityFilter,
        client: clientFilter,
        source: sourceFilter,
        search: deferredSearch,
        view: activeViewTab === 'zero_orders' ? 'zero_orders' : 'all',
        asOfDate: reportAsOf,
      }),
    [reportRows, deferredSearch, cityFilter, clientFilter, sourceFilter, activeViewTab, reportAsOf]
  )

  const stats = useMemo(() => summarizeRiderPerformanceRows(filteredRows), [filteredRows])
  const zeroOrderCount = useMemo(
    () => reportRows.filter((row) => hasZeroOrdersLast4Days(row, reportAsOf)).length,
    [reportRows, reportAsOf]
  )
  const rentalStats = useMemo(
    () => summarizeRentalPendingRows(filteredRows, { includeNegative: includeNegativeRental }),
    [filteredRows, includeNegativeRental]
  )

  const rentalTotalDisplay = useMemo(
    () =>
      rentalStats.totalDue.toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }),
    [rentalStats.totalDue]
  )

  const displayRows = useDeferredValue(filteredRows)
  const isReportStale = displayRows !== filteredRows || search !== deferredSearch

  const totalPages = Math.max(1, Math.ceil(displayRows.length / ROWS_PER_PAGE))
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return displayRows.slice(start, start + ROWS_PER_PAGE)
  }, [displayRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [activeViewTab, deferredSearch, cityFilter, clientFilter, sourceFilter, zeroOrderEndDate])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const handleRefresh = useCallback(() => {
    loadEv91Deployed()
    loadRentalPending(true)
    loadIotKm()
    if (refreshData && !refreshing) refreshData()
  }, [loadEv91Deployed, loadRentalPending, loadIotKm, refreshData, refreshing])

  const exportCsv = () => {
    const csv = rowsToPerformanceCsv(filteredRows, tableHeaders)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const suffix = activeViewTab === 'zero_orders' ? `_0orders_${zeroOrderEndDate}` : `_${reportDate}`
    a.download = `ev91_rider_performance${suffix}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !riderData?.length && ev91Loading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container rp-root">
      {(ev91Loading || refreshing) && (
        <div className="fdv-loading-banner glass rp-update-banner">
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span>
            {refreshing
              ? 'Refreshing EV91 deployed riders, orders, IoT & rental…'
              : 'Loading EV91 deployed riders…'}
          </span>
        </div>
      )}

      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Database size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>EV91 Rider Performance</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Deployed riders from EV91 DB · orders + IoT KM + rental pending
              {ev91Rows.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {ev91Rows.length.toLocaleString()} EV91 deployed
                </span>
              )}
              {orderRowsForMetrics.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {orderRowsForMetrics.length.toLocaleString()} order rows
                </span>
              )}
              {rentalPendingLoading && <span style={{ marginLeft: 8 }}>· Loading rental…</span>}
              {iotLoading && <span style={{ marginLeft: 8 }}>· Loading IoT KM…</span>}
              {dataUpdatedAt && !refreshing && (
                <span style={{ marginLeft: 8 }}>
                  · Orders updated {format(dataUpdatedAt, 'dd/MM/yyyy HH:mm')}
                </span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fdv-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing || ev91Loading}
          >
            {ev91Loading || refreshing ? (
              <>
                <span className="loader fdv-btn-loader" />
                Refreshing…
              </>
            ) : (
              <>
                <RefreshCw size={16} /> Refresh data
              </>
            )}
          </button>
          <button
            type="button"
            className="fsr-export-btn"
            onClick={exportCsv}
            disabled={!filteredRows.length || isDataPending}
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      </header>

      {ev91Error && (
        <div className="ev91-error glass" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={18} />
          <span>{ev91Error}</span>
        </div>
      )}

      <div className="rp-filters glass">
        <div className="rp-filter">
          <label><MapPin size={14} /> City</label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="rp-filter">
          <label><Briefcase size={14} /> Client</label>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            {clients.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="rp-filter">
          <label><Tag size={14} /> Source</label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {activeViewTab === 'zero_orders' && (
          <div className="rp-filter">
            <label><Calendar size={14} /> End date (4 days)</label>
            <input
              type="date"
              value={zeroOrderEndDate}
              max={maxZeroOrderEndDate}
              onChange={(e) => {
                const next = e.target.value
                if (!next) return
                startTransition(() => setZeroOrderEndDate(next))
              }}
            />
          </div>
        )}
        <div className="rp-filter rp-filter-search">
          <label><Search size={14} /> Search</label>
          <input
            type="text"
            placeholder="Vehicle, ID, EV91 ID, name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="rp-filter rp-filter-toggle">
          <label>Rental pending stats</label>
          <label className="rp-toggle-check">
            <input
              type="checkbox"
              checked={includeNegativeRental}
              onChange={(e) => setIncludeNegativeRental(e.target.checked)}
            />
            Include -ve amount
          </label>
        </div>
      </div>

      <div className="rp-stats-grid">
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-active"><UserCheck size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Active</span>
            <span className="rp-stat-value">{stats.active.toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-inactive"><UserX size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Inactive</span>
            <span className="rp-stat-value">{stats.inactive.toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-error"><AlertTriangle size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">ID/Tag Error</span>
            <span className="rp-stat-value">{stats.idTagError.toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass rp-stat-eff-card">
          <div className="rp-stat-icon rp-stat-eff"><Zap size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Eff / Ineff</span>
            <span className="rp-stat-value">
              {stats.efficient.toLocaleString()}
              <span className="rp-stat-sep">/</span>
              {stats.inefficient.toLocaleString()}
            </span>
            <span className="rp-stat-sub">
              High {stats.effHigh} · Mid {stats.effMid} · Low {stats.effLow} · 0 {stats.effZero}
            </span>
          </div>
        </div>
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-high"><TrendingUp size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">High frequency</span>
            <span className="rp-stat-value">{stats.effHigh.toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-mid"><Minus size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Mid frequency</span>
            <span className="rp-stat-value">{stats.effMid.toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass">
          <div className="rp-stat-icon rp-stat-low"><TrendingDown size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Low / 0 Orders</span>
            <span className="rp-stat-value">{(stats.effLow + stats.effZero).toLocaleString()}</span>
          </div>
        </div>
        <div className="rp-stat-card glass rp-stat-rental-card">
          <div className="rp-stat-icon rp-stat-rental"><Receipt size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Rental due riders</span>
            <span className="rp-stat-value">
              {rentalPendingLoading ? '…' : rentalStats.dueRiders.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="rp-stat-card glass rp-stat-rental-card">
          <div className="rp-stat-icon rp-stat-rental-total"><IndianRupee size={22} /></div>
          <div className="rp-stat-body">
            <span className="rp-stat-label">Rental pending total</span>
            <span className="rp-stat-value rp-stat-value-currency">
              {rentalPendingLoading ? '…' : rentalTotalDisplay}
            </span>
          </div>
        </div>
      </div>

      <div className="fdv-tab-bar glass" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`fdv-tab ${activeViewTab === 'all' ? 'fdv-tab-active' : ''}`}
          onClick={() => startTransition(() => setActiveViewTab('all'))}
        >
          <UserCheck size={16} />
          All Deployed
        </button>
        <button
          type="button"
          className={`fdv-tab ${activeViewTab === 'zero_orders' ? 'fdv-tab-active' : ''}`}
          onClick={() => startTransition(() => setActiveViewTab('zero_orders'))}
        >
          <TrendingDown size={16} />
          0 Order Riders (4 days)
          <span className="rp-tab-count">
            {activeViewTab === 'zero_orders' ? zeroOrderCount.toLocaleString() : stats.effZero.toLocaleString()}
          </span>
        </button>
      </div>

      <div className="rp-meta glass">
        <span>
          <strong>{displayRows.length.toLocaleString()}</strong> riders
          {activeViewTab === 'zero_orders' && (
            <span> · 0 orders on {zeroOrderWindowLabel}</span>
          )}
          {stats.total !== reportRows.length && (
            <span> (filtered from {reportRows.length.toLocaleString()})</span>
          )}
          {isReportStale && <span className="rp-recalculating"> · updating…</span>}
        </span>
        <span>
          {activeViewTab === 'zero_orders'
            ? `Window end: ${format(parseISO(zeroOrderEndDate), 'dd/MM/yyyy')}`
            : `Report date: ${format(today, 'dd/MM/yyyy')} (today)`}
        </span>
      </div>

      <div className={`glass rp-table-wrap ${isReportStale ? 'rp-table-pending' : ''}`}>
        <div className="rp-table-scroll">
          <table className="rp-table">
            <thead>
              <tr>
                {tableHeaders.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isDataPending && !paginatedRows.length ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="rp-empty">
                    <span className="loader" style={{ width: 28, height: 28, marginRight: 12, verticalAlign: 'middle' }} />
                    Loading EV91 deployed riders…
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="rp-empty">
                    {activeViewTab === 'zero_orders'
                      ? `No riders with 0 orders on ${zeroOrderWindowLabel}`
                      : 'No EV91 deployed riders found'}
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => (
                  <tr key={`${row.ID}-${row['EV91 ID']}-${row['V no']}-${idx}`}>
                    {tableHeaders.map((h) => (
                      <td key={h}>{getCellValue(row, h, reportAsOf) ?? ''}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="rp-table-footer">
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            Showing {paginatedRows.length ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0}
            –{Math.min(currentPage * ROWS_PER_PAGE, displayRows.length)} of {displayRows.length.toLocaleString()}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="glass-btn"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              Prev
            </button>
            <span style={{ fontSize: '0.85rem' }}>{currentPage} / {totalPages}</span>
            <button
              type="button"
              className="glass-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
