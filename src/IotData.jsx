import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react'
import { format, subDays } from 'date-fns'
import {
  Radio,
  Search,
  Download,
  Loader,
  Calendar,
  Truck,
  Briefcase,
  Database,
  AlertTriangle,
  MapPin,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchIotDataInRange,
  loadIotSummary,
  fetchRiderOrdersForIot,
  getIotDbSetupMessage,
  isMissingIotTable,
} from './lib/iotDataDb'
import { buildIotVehicleReport, summarizeIotReport } from './lib/iotDataReport'
import { dedupeCanonicalCities, normalizeSummaryCity } from './lib/citySummaryAliases'
import { formatLastUploadAt } from './lib/paymentMonthList'
import {
  fetchEv91OverallStatusAll,
  fetchEv91CurrentStatusAll,
} from './lib/ev91EvLookup'
import { fetchEv91RiderDetails } from './lib/ev91RiderPerformance'

const ROWS_PER_PAGE = 50

export default function IotData({ fleetData, riderData, vehicleInventoryData = [], loading: appLoading }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(today)
  const [iotRows, setIotRows] = useState([])
  const [iotLoading, setIotLoading] = useState(true)
  const [iotError, setIotError] = useState(null)
  const [missingTable, setMissingTable] = useState(false)
  const [dbCount, setDbCount] = useState(0)
  const [lastUploadAt, setLastUploadAt] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [cityFilter, setCityFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)
  const [riderOrderRows, setRiderOrderRows] = useState([])
  const [riderOrdersLoading, setRiderOrdersLoading] = useState(true)
  const [riderOrdersError, setRiderOrdersError] = useState(null)
  const [ev91OverallRows, setEv91OverallRows] = useState([])
  const [ev91CurrentRows, setEv91CurrentRows] = useState([])
  const [ev91RiderDetails, setEv91RiderDetails] = useState(() => new Map())
  const [ev91Loading, setEv91Loading] = useState(true)
  const riderDataRef = useRef(riderData)
  riderDataRef.current = riderData

  const deferredFleet = useDeferredValue(fleetData)
  const deferredInventory = useDeferredValue(vehicleInventoryData)

  const loadSummary = useCallback(async () => {
    try {
      const summary = await loadIotSummary()
      setDbCount(summary.count)
      setLastUploadAt(summary.lastUploadAt)
      setMissingTable(Boolean(summary.missingTable))
    } catch (err) {
      console.warn('IoT summary load failed:', err)
    }
  }, [])

  const loadEv91DeployStatus = useCallback(async () => {
    setEv91Loading(true)
    try {
      const [overall, current, details] = await Promise.all([
        fetchEv91OverallStatusAll({ force: false }),
        fetchEv91CurrentStatusAll({ force: false }).catch(() => ({ data: [] })),
        fetchEv91RiderDetails().catch(() => new Map()),
      ])
      setEv91OverallRows(overall?.data || [])
      setEv91CurrentRows(current?.data || [])
      setEv91RiderDetails(details instanceof Map ? details : new Map())
    } catch (err) {
      console.warn('IoT EV91 deploy status load failed:', err)
      setEv91OverallRows([])
      setEv91CurrentRows([])
      setEv91RiderDetails(new Map())
    } finally {
      setEv91Loading(false)
    }
  }, [])

  const loadRangeData = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setIotError('Select a valid date range (From ≤ To).')
      setIotRows([])
      setRiderOrderRows([])
      setIotLoading(false)
      setRiderOrdersLoading(false)
      return
    }

    setIotLoading(true)
    setRiderOrdersLoading(true)
    setIotError(null)
    setRiderOrdersError(null)

    try {
      const [rows, orders] = await Promise.all([
        fetchIotDataInRange(dateFrom, dateTo),
        fetchRiderOrdersForIot(dateFrom, dateTo, {
          fallbackRows: riderDataRef.current,
        }),
      ])
      setIotRows(rows)
      setRiderOrderRows(orders)
      if (!rows.length) {
        setIotError('No IoT records for this date range in iot_data. Widen the range or check run_date values.')
      }
      if (!orders.length) {
        setRiderOrdersError('No order_upload_data rows for this date range. Orders will show as 0.')
      }
    } catch (err) {
      if (isMissingIotTable(err)) {
        setMissingTable(true)
        setIotError(getIotDbSetupMessage())
      } else {
        setIotError(err.message || 'Failed to load IoT data')
      }
      setIotRows([])
      setRiderOrderRows([])
    } finally {
      setIotLoading(false)
      setRiderOrdersLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    loadSummary()
    loadEv91DeployStatus()
  }, [loadSummary, loadEv91DeployStatus])

  const applyRange = useCallback(() => {
    loadRangeData()
  }, [loadRangeData])

  useEffect(() => {
    if (!missingTable) {
      loadRangeData()
    }
    // Only reload when date range or table availability changes — not on every App riderData update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, missingTable])

  const deferredSearch = useDeferredValue(searchTerm)

  const reportRows = useMemo(
    () =>
      buildIotVehicleReport(iotRows, deferredFleet, riderOrderRows, {
        dateFrom,
        dateTo,
        ev91OverallRows,
        ev91CurrentRows,
        vehicleInventoryRows: deferredInventory,
        ev91RiderDetails,
      }),
    [iotRows, deferredFleet, riderOrderRows, dateFrom, dateTo, ev91OverallRows, ev91CurrentRows, deferredInventory, ev91RiderDetails]
  )

  const reportPending = iotRows.length > 0 && (deferredFleet !== fleetData || deferredInventory !== vehicleInventoryData)

  const cityOptions = useMemo(() => {
    const cities = dedupeCanonicalCities(reportRows.map((r) => r.city))
    return ['All', ...cities]
  }, [reportRows])

  const filtered = useMemo(() => {
    let rows = reportRows
    if (cityFilter && cityFilter !== 'All') {
      rows = rows.filter((r) => normalizeSummaryCity(r.city) === cityFilter)
    }
    const q = deferredSearch.trim().toLowerCase()
    const phoneQ = deferredSearch.replace(/\D/g, '')
    if (!q && !phoneQ) return rows
    return rows.filter(
      (r) =>
        r.runDate.includes(q) ||
        r.vehicleNumber.toLowerCase().includes(q) ||
        String(r.ev91RiderId || '').toLowerCase().includes(q) ||
        r.riderId.toLowerCase().includes(q) ||
        r.riderName.toLowerCase().includes(q) ||
        (phoneQ && String(r.riderPhone || '').replace(/\D/g, '').includes(phoneQ)) ||
        r.client.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        String(r.orderCount).includes(q)
    )
  }, [reportRows, deferredSearch, cityFilter])

  // Stats follow city + search + date-range filter (e.g. one vehicle → that vehicle's KM only)
  const stats = useMemo(() => summarizeIotReport(filtered), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, cityFilter, dateFrom, dateTo, reportRows.length])

  const exportExcel = () => {
    if (!filtered.length) return
    const rows = filtered.map((r) => ({
      Date: r.runDate,
      'Vehicle Number': r.vehicleNumber,
      'EV91 ID': r.ev91RiderId === '—' ? '' : r.ev91RiderId,
      'Rider ID': r.riderId,
      'Rider Name': r.riderName,
      'Rider Phone': r.riderPhone === '—' ? '' : r.riderPhone,
      Client: r.client,
      City: r.city,
      Hub: r.hub,
      'Deploy Status': r.deployStatus,
      Orders: r.orderCount,
      'Running Distance (KM)': r.runningDistanceKm,
      'Data Source': r.dataSource,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'IoT Data')
    XLSX.writeFile(wb, `IoT_Data_${dateFrom}_to_${dateTo}.xlsx`)
  }

  if (appLoading && !fleetData?.length) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  const tableLoading = iotLoading || reportPending

  return (
    <div className="dashboard-container">
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Radio size={28} style={{ color: 'var(--accent-blue)' }} />
              IoT Data
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '720px' }}>
              Reads from Supabase <code style={{ color: '#fff' }}>iot_data</code> (Alt Mobility). Shows running distance by vehicle and date, with deployed rider, client from fleet, and order count from rider metrics for that date.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={exportExcel}
              disabled={!filtered.length}
              className="glass"
              style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: filtered.length ? 'pointer' : 'not-allowed' }}
            >
              <Download size={18} />
              Export
            </button>
          </div>
        </div>

        <div className="glass" style={{ padding: '0.85rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
          <Database size={16} />
          {missingTable ? (
            <span style={{ color: '#f87171' }}>{getIotDbSetupMessage()}</span>
          ) : (
            <>
              <span><strong>{dbCount.toLocaleString()}</strong> rows in <code style={{ color: '#fff' }}>iot_data</code></span>
              <span>· Orders from <code style={{ color: '#fff' }}>order_upload_data</code> only</span>
              <span>· Deploy Status from EV91 Overall / Current API</span>
              <span>· Phone from EV91 Rider Details</span>
              {lastUploadAt && (
                <span style={{ color: 'var(--accent-blue)' }}>· Last upload: {formatLastUploadAt(lastUploadAt)}</span>
              )}
              {ev91Loading && <span>· Loading EV91 deploy status…</span>}
            </>
          )}
        </div>
      </header>

      <div
        className="filter-bar glass"
        style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem', marginBottom: '1rem', alignItems: 'flex-end' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} /> From date
          </span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} /> To date
          </span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={(e) => setDateTo(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={applyRange} disabled={iotLoading || riderOrdersLoading} style={{ padding: '0.5rem 1rem' }}>
          {iotLoading || riderOrdersLoading ? <Loader size={16} className="spin" /> : 'Apply range'}
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <MapPin size={14} /> City
          </span>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', minWidth: '140px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          >
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search vehicle, rider, phone, client, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '10px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      {riderOrdersError && !riderOrdersLoading && (
        <div className="glass" style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', fontSize: '0.85rem', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)' }}>
          <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
          {riderOrdersError}
        </div>
      )}

      {iotError && !iotLoading && (
        <div className="glass" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#fbbf24' }}>
          <AlertTriangle size={18} />
          {iotError}
        </div>
      )}

      <section className="stats-grid" style={{ marginBottom: '1.25rem' }}>
        <div className="stat-card glass">
          <div className="label">Unique vehicles</div>
          <div className="value">{stats.vehicles.toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">IoT rows</div>
          <div className="value">{stats.rows.toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Total running distance</div>
          <div className="value">{stats.totalKm.toLocaleString('en-IN')} km</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Total orders</div>
          <div className="value">
            {riderOrdersLoading ? '…' : stats.totalOrders.toLocaleString('en-IN')}
          </div>
        </div>
        <div className="stat-card glass">
          <div className="label">Deployed riders matched</div>
          <div className="value">{stats.deployed.toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Date range</div>
          <div className="value" style={{ fontSize: '1rem' }}>{dateFrom} → {dateTo}</div>
        </div>
      </section>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          {tableLoading ? (
            <div className="loading-container" style={{ minHeight: '200px' }}>
              <span className="loader" />
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Vehicle</th>
                  <th>EV91 ID</th>
                  <th>Rider</th>
                  <th>Client</th>
                  <th>City / Hub</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Orders</th>
                  <th style={{ textAlign: 'right' }}>Running distance (km)</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length ? (
                  paginated.map((r, i) => (
                    <tr key={r.rowKey}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{r.runDate}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                          <Truck size={14} />
                          {r.vehicleNumber}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {r.ev91RiderId || '—'}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.riderName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.riderId}</div>
                        {r.riderPhone && r.riderPhone !== '—' && (
                          <div style={{ fontSize: '0.75rem', color: '#93c5fd' }}>{r.riderPhone}</div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Briefcase size={13} style={{ color: 'var(--text-dim)' }} />
                          {r.client}
                        </div>
                      </td>
                      <td>
                        <div>{r.city}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.hub}</div>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.dataSource}</td>
                      <td>
                        <span
                          className="status-badge"
                          style={{
                            background: r.deployStatus === 'Deployed' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                            color: r.deployStatus === 'Deployed' ? '#22c55e' : 'var(--text-dim)',
                          }}
                        >
                          {r.deployStatus}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: r.orderCount > 0 ? '#4ade80' : 'var(--text-dim)' }}>
                        {riderOrdersLoading ? '…' : r.orderCount.toLocaleString('en-IN')}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                        {r.runningDistanceKm.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)' }}>
                      No IoT data for this range
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Showing {((currentPage - 1) * ROWS_PER_PAGE) + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="glass-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className="glass-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
