import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import {
  Radio,
  Search,
  Download,
  Upload,
  Loader,
  Calendar,
  Truck,
  Briefcase,
  Database,
  AlertTriangle,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { parseIotDataFile, IOT_HEADER_LABELS } from './lib/iotDataParse'
import {
  fetchIotDataInRange,
  loadIotSummary,
  saveIotRows,
  getIotDbSetupMessage,
  isMissingIotTable,
} from './lib/iotDataDb'
import { buildIotVehicleReport, summarizeIotReport } from './lib/iotDataReport'
import { formatLastUploadAt } from './lib/paymentMonthList'

const ROWS_PER_PAGE = 50

export default function IotData({ fleetData, loading: appLoading }) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(today)
  const [iotRows, setIotRows] = useState([])
  const [iotLoading, setIotLoading] = useState(false)
  const [iotError, setIotError] = useState(null)
  const [missingTable, setMissingTable] = useState(false)
  const [dbCount, setDbCount] = useState(0)
  const [lastUploadAt, setLastUploadAt] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState(null)

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

  const loadRangeData = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setIotError('Select a valid date range (From ≤ To).')
      setIotRows([])
      return
    }

    setIotLoading(true)
    setIotError(null)
    try {
      const rows = await fetchIotDataInRange(dateFrom, dateTo)
      setIotRows(rows)
      if (!rows.length) setIotError('No IoT records for this date range in iot_data. Widen the range or check run_date values.')
    } catch (err) {
      if (isMissingIotTable(err)) {
        setMissingTable(true)
        setIotError(getIotDbSetupMessage())
      } else {
        setIotError(err.message || 'Failed to load IoT data')
      }
      setIotRows([])
    } finally {
      setIotLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    if (!missingTable) loadRangeData()
  }, [loadRangeData, missingTable])

  const reportRows = useMemo(
    () => buildIotVehicleReport(iotRows, fleetData, { dateFrom, dateTo }),
    [iotRows, fleetData, dateFrom, dateTo]
  )

  const stats = useMemo(() => summarizeIotReport(reportRows), [reportRows])

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return reportRows
    return reportRows.filter(
      (r) =>
        r.vehicleNumber.toLowerCase().includes(q) ||
        r.riderId.toLowerCase().includes(q) ||
        r.riderName.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q)
    )
  }, [reportRows, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, dateFrom, dateTo, reportRows.length])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)
    setUploadMessage(null)
    try {
      const { rows, errors } = await parseIotDataFile(file)
      if (!rows.length) {
        setUploadMessage({ type: 'error', text: errors[0] || 'No valid rows found in file.' })
        return
      }
      const saved = await saveIotRows(rows)
      await loadSummary()
      await loadRangeData()
      const errNote = errors.length ? ` (${errors.length} row(s) skipped)` : ''
      setUploadMessage({ type: 'success', text: `Uploaded ${saved.toLocaleString()} IoT row(s)${errNote}.` })
    } catch (err) {
      setUploadMessage({
        type: 'error',
        text: isMissingIotTable(err) ? getIotDbSetupMessage() : err.message || 'Upload failed',
      })
    } finally {
      setUploading(false)
    }
  }

  const exportExcel = () => {
    if (!filtered.length) return
    const rows = filtered.map((r) => ({
      'Vehicle Number': r.vehicleNumber,
      'Rider ID': r.riderId,
      'Rider Name': r.riderName,
      Client: r.client,
      City: r.city,
      Hub: r.hub,
      'Deploy Status': r.deployStatus,
      'Running Distance (KM)': r.runningDistanceKm,
      'Data Source': r.dataSource,
      'Days With Data': r.daysWithData,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'IoT Data')
    XLSX.writeFile(wb, `IoT_Data_${dateFrom}_to_${dateTo}.xlsx`)
  }

  if (appLoading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

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
              Reads from Supabase <code style={{ color: '#fff' }}>iot_data</code> (Alt Mobility). Shows running distance by vehicle for the selected date range, with deployed rider and client from fleet data.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label className="fsr-export-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? <Loader size={16} className="spin" /> : <Upload size={16} />}
              Upload IoT file
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} disabled={uploading} hidden />
            </label>
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
              {lastUploadAt && (
                <span style={{ color: 'var(--accent-blue)' }}>· Last upload: {formatLastUploadAt(lastUploadAt)}</span>
              )}
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
        <button type="button" className="btn-primary" onClick={loadRangeData} disabled={iotLoading} style={{ padding: '0.5rem 1rem' }}>
          {iotLoading ? <Loader size={16} className="spin" /> : 'Apply range'}
        </button>
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search vehicle, rider, client, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '10px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      {uploadMessage && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            fontSize: '0.85rem',
            color: uploadMessage.type === 'error' ? '#f87171' : '#4ade80',
            background: uploadMessage.type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
          }}
        >
          {uploadMessage.text}
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
          <div className="label">Vehicles</div>
          <div className="value">{stats.vehicles.toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Total running distance</div>
          <div className="value">{stats.totalKm.toLocaleString('en-IN')} km</div>
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

      <details className="glass" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
          Upload file format ({IOT_HEADER_LABELS.length} columns)
        </summary>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          {IOT_HEADER_LABELS.join(' · ')} — maps to <code style={{ color: '#fff' }}>iot_data</code> columns: vehicle_number, run_date, total_distance.
        </p>
      </details>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          {iotLoading ? (
            <div className="loading-container" style={{ minHeight: '200px' }}>
              <span className="loader" />
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vehicle</th>
                  <th>Rider</th>
                  <th>Client</th>
                  <th>City / Hub</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Running distance (km)</th>
                  <th style={{ textAlign: 'center' }}>Days</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length ? (
                  paginated.map((r, i) => (
                    <tr key={r.vehicleNumber}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                          <Truck size={14} />
                          {r.vehicleNumber}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.riderName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.riderId}</div>
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
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                        {r.runningDistanceKm.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'center', color: 'var(--text-dim)' }}>{r.daysWithData}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)' }}>
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
