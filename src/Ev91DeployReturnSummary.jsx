import React, { useCallback, useEffect, useMemo, useState, startTransition, useDeferredValue } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Target,
  Upload,
} from 'lucide-react'
import { format } from 'date-fns'
import { fetchEv91OverallStatusAll } from './lib/ev91EvLookup'
import { EV91_CITIES } from './lib/ev91MisApi'
import {
  buildEv91ClientWiseSummary,
  buildEv91SummaryRawDetails,
  buildEv91TargetTotalsByEvType,
  buildFirstOrderIndex,
  compareEv91SummaryClients,
  getCitiesFromEv91Rows,
  mergeEv91SummaryWithTargets,
  SUMMARY_METRICS,
  splitSummaryClients,
  weekKeyToEv91SummaryDateRange,
} from './lib/ev91DeployReturnSummary'
import { isHiddenSummaryClient } from './lib/clientSummaryClients'
import {
  buildWeekOptions,
  dateToWeekKey,
  getDbSetupMessage,
  getTargetsForWeek,
  isMissingClientTargetsTable,
  loadClientTargets,
  parseTargetsExcelArrayBuffer,
  persistClientTargets,
} from './lib/fleetClientTargets'

function escapeCsv(value) {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

export default function Ev91DeployReturnSummary({ riderData = [], loading: riderLoading = false }) {
  const initialWeek = dateToWeekKey(new Date()) || ''
  const initialRange = weekKeyToEv91SummaryDateRange(initialWeek)

  const [startDate, setStartDate] = useState(() => initialRange?.startDate || format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(() => initialRange?.endDate || format(new Date(), 'yyyy-MM-dd'))
  const [selectedCity, setSelectedCity] = useState('All')
  const [selectedWeek, setSelectedWeek] = useState(initialWeek)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [allTargets, setAllTargets] = useState({})
  const [storedWeekKeys, setStoredWeekKeys] = useState([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [uploadMessage, setUploadMessage] = useState('')
  const [showHiddenClients, setShowHiddenClients] = useState(false)
  const [showRawData, setShowRawData] = useState(false)
  const [rawKind, setRawKind] = useState('EV') // EV | IC | Return
  const [rawClientFilter, setRawClientFilter] = useState('All')

  const load = useCallback((force = false) => {
    setLoading(true)
    setError('')
    return fetchEv91OverallStatusAll({ force })
      .then((result) => setRows(result.data || []))
      .catch((err) => {
        console.warn('EV91 summary load failed:', err)
        setRows([])
        setError(err?.message || 'Failed to load Overall Vehicle Status')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    let cancelled = false
    loadClientTargets()
      .then(({ byWeek, weekKeys, source }) => {
        if (cancelled) return
        setAllTargets(byWeek)
        setStoredWeekKeys(weekKeys)
        if (source === 'database') setUploadMessage('Targets loaded from database.')
      })
      .catch(() => {
        if (!cancelled) setUploadMessage('Could not load saved targets.')
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const range = weekKeyToEv91SummaryDateRange(selectedWeek)
    if (!range) return
    startTransition(() => {
      setStartDate(range.startDate)
      setEndDate(range.endDate)
    })
  }, [selectedWeek])

  // IC Deployed: order_upload_data only (never rider_metrics)
  const uploadOrderRows = useMemo(() => {
    const uploads = (riderData || []).filter(
      (r) => r?._data_source === 'order_upload' && !r?._ic_only
    )
    if (uploads.length) return uploads
    // Do not fall back to rider_metrics — empty means no IC from uploads
    return []
  }, [riderData])

  const firstOrderIndex = useMemo(() => buildFirstOrderIndex(uploadOrderRows), [uploadOrderRows])

  const deferredCity = useDeferredValue(selectedCity)
  const deferredStart = useDeferredValue(startDate)
  const deferredEnd = useDeferredValue(endDate)

  const cities = useMemo(() => {
    const fromApi = getCitiesFromEv91Rows(rows)
    return fromApi.length ? fromApi : [...EV91_CITIES]
  }, [rows])

  const weekOptions = useMemo(
    () => buildWeekOptions({ storedWeekKeys, anchorDate: new Date() }),
    [storedWeekKeys]
  )

  const summary = useMemo(
    () =>
      buildEv91ClientWiseSummary(rows, firstOrderIndex, {
        city: deferredCity,
        startDate: deferredStart,
        endDate: deferredEnd,
        includeDetails: false,
      }),
    [rows, firstOrderIndex, deferredCity, deferredStart, deferredEnd]
  )

  // Only build raw audit rows when the panel is open
  const rawDetails = useMemo(() => {
    if (!showRawData) return { evRows: [], returnRows: [], icRows: [] }
    return buildEv91SummaryRawDetails(rows, firstOrderIndex, {
      city: deferredCity,
      startDate: deferredStart,
      endDate: deferredEnd,
    })
  }, [showRawData, rows, firstOrderIndex, deferredCity, deferredStart, deferredEnd])

  const weekTargetRows = useMemo(
    () => getTargetsForWeek(allTargets, selectedWeek),
    [allTargets, selectedWeek]
  )

  const targetMaps = useMemo(
    () => buildEv91TargetTotalsByEvType(weekTargetRows, selectedCity),
    [weekTargetRows, selectedCity]
  )

  const displaySummary = useMemo(
    () => mergeEv91SummaryWithTargets(summary, targetMaps),
    [summary, targetMaps]
  )

  const weekRangeLabel = useMemo(() => weekKeyToEv91SummaryDateRange(selectedWeek)?.label || '', [selectedWeek])

  const { visibleClients, hiddenClients } = useMemo(
    () => splitSummaryClients(displaySummary.clients),
    [displaySummary.clients]
  )

  const tableClients = useMemo(() => {
    const visible = visibleClients || []
    const hidden = hiddenClients || []
    const list = showHiddenClients ? [...visible, ...hidden] : [...visible]
    return list.sort(compareEv91SummaryClients)
  }, [visibleClients, hiddenClients, showHiddenClients])

  const tableTotals = useMemo(() => {
    // Total column always includes hidden clients so Ev Deployed matches Overall Status.
    const all = displaySummary.clients || []
    const totals = { targetEv: 0, targetNonEv: 0 }
    for (const metric of SUMMARY_METRICS) totals[metric.key] = 0
    for (const c of all) {
      totals.targetEv += Number(c.targetEv || 0)
      totals.targetNonEv += Number(c.targetNonEv || 0)
      for (const metric of SUMMARY_METRICS) {
        totals[metric.key] += Number(c[metric.key] || 0)
      }
    }
    return totals
  }, [displaySummary.clients])

  const rawSourceRows = useMemo(() => {
    if (rawKind === 'IC') return rawDetails.icRows || []
    if (rawKind === 'Return') return rawDetails.returnRows || []
    return rawDetails.evRows || []
  }, [rawDetails, rawKind])

  const rawClientOptions = useMemo(() => {
    const set = new Set(rawSourceRows.map((r) => r.client).filter(Boolean))
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [rawSourceRows])

  const filteredRawRows = useMemo(() => {
    if (rawClientFilter === 'All') return rawSourceRows
    return rawSourceRows.filter((r) => r.client === rawClientFilter)
  }, [rawSourceRows, rawClientFilter])

  const RAW_PAGE_SIZE = 300
  const visibleRawRows = useMemo(
    () => filteredRawRows.slice(0, RAW_PAGE_SIZE),
    [filteredRawRows]
  )

  useEffect(() => {
    if (rawClientFilter !== 'All' && !rawClientOptions.includes(rawClientFilter)) {
      setRawClientFilter('All')
    }
  }, [rawClientOptions, rawClientFilter])

  const handleTargetUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      try {
        const buffer = await file.arrayBuffer()
        const { parsedRows, byWeek } = parseTargetsExcelArrayBuffer(buffer, selectedWeek)
        if (!parsedRows.length) {
          setUploadMessage(
            'No valid rows found. Use Week, City, Client, Type (EV or NON-EV), Target. Week like 22_2026.'
          )
          return
        }

        const { byWeek: saved, dbSaved, dbError } = await persistClientTargets(byWeek, true)
        setAllTargets(saved)
        setStoredWeekKeys(Object.keys(saved))

        const weeks = Object.keys(byWeek)
        if (dbSaved) {
          setUploadMessage(`Saved ${parsedRows.length} target row(s) to database for week(s): ${weeks.join(', ')}`)
        } else if (isMissingClientTargetsTable(dbError)) {
          setUploadMessage(`Saved locally only. ${getDbSetupMessage()}`)
        } else {
          setUploadMessage(
            `Saved locally (${parsedRows.length} rows). Database save failed: ${dbError?.message || 'Unknown error'}`
          )
        }
      } catch (err) {
        setUploadMessage(`Upload failed: ${err.message || 'Invalid file'}`)
      }
    },
    [selectedWeek]
  )

  const exportSummaryCsv = () => {
    const clientCols = tableClients.map((c) => c.client)
    const header = ['Metric', ...clientCols, 'Total']
    const lines = [header.map(escapeCsv).join(',')]

    const evTargetValues = tableClients.map((c) => c.targetEv || 0)
    evTargetValues.push(tableTotals.targetEv || 0)
    lines.push(['Target EV', ...evTargetValues].map(escapeCsv).join(','))

    for (const metric of SUMMARY_METRICS) {
      const values = tableClients.map((c) => c[metric.key])
      values.push(tableTotals[metric.key])
      lines.push([metric.label, ...values].map(escapeCsv).join(','))
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ev91_client_summary_${selectedWeek}_${selectedCity}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportRawCsv = () => {
    const lines = []
    if (rawKind === 'IC') {
      lines.push(['Kind', 'Date', 'City', 'Client', 'Client Raw', 'WorkerCode', 'Delivered', 'Type1', 'Source'].map(escapeCsv).join(','))
      for (const r of filteredRawRows) {
        lines.push(
          [r.kind, r.date, r.city, r.client, r.clientRaw, r.workerCode, r.delivered, r.fl, r.type1, r.source]
            .map(escapeCsv)
            .join(',')
        )
      }
    } else {
      lines.push(
        ['Kind', 'Status', 'Date', 'City', 'Client', 'Client Raw', 'Vehicle', 'Rider ID', 'EV91 Rider ID', 'Rider Name', 'Contact']
          .map(escapeCsv)
          .join(',')
      )
      for (const r of filteredRawRows) {
        lines.push(
          [r.kind, r.status, r.date, r.city, r.client, r.clientRaw, r.vehicle, r.riderId, r.ev91RiderId, r.riderName, r.contact]
            .map(escapeCsv)
            .join(',')
        )
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ev91_raw_${rawKind.toLowerCase()}_${selectedWeek}_${selectedCity}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderMetricRow = (label, rowClass, getValue, totalValue) => (
    <tr className={rowClass}>
      <td className="fdv-pivot-metric-col">{label}</td>
      {tableClients.map((c) => {
        const hiddenCol = showHiddenClients && isHiddenSummaryClient(c.client)
        return (
          <td key={c.client} className={hiddenCol ? 'fdv-pivot-hidden-client-col' : undefined}>
            {getValue(c)}
          </td>
        )
      })}
      {!showHiddenClients && hiddenClients.length > 0 && (
        <td className="fdv-pivot-expand-col fdv-pivot-expand-col-sticky" aria-hidden="true" />
      )}
      {showHiddenClients && hiddenClients.length > 0 && (
        <td className="fdv-pivot-expand-col fdv-pivot-expand-col-sticky" aria-hidden="true" />
      )}
      <td className="fdv-pivot-total-col fdv-pivot-total-col-sticky">
        <strong>{totalValue}</strong>
      </td>
    </tr>
  )

  const busy = loading || riderLoading

  if (loading && !rows.length && !error) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container fdv-root fdv-summary-root ev91-root ev91-summary-page">
      <div className="fdv-summary-page">
      {busy && rows.length > 0 && (
        <div className="fdv-loading-banner glass rp-update-banner">
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span>{loading ? 'Loading EV91 Overall Status…' : 'Updating rider metrics for IC…'}</span>
        </div>
      )}

      <div className="fdv-summary-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart3 size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>City / Client Summary</h1>
            <p className="fdv-summary-subtitle">
              EV91 Overall Status · Ev Deployed = Deployed rows · IC Deployed = first order-upload day
              (NON-EV only; order_upload_data — not rider_metrics) · week Sun–Sat · Net = Total − Return
            </p>
          </div>
        </div>
        <div className="fdv-summary-actions">
          <button type="button" className="fsr-export-btn" onClick={exportSummaryCsv}>
            <Download size={16} /> Export Summary
          </button>
          <button
            type="button"
            className="fsr-export-btn"
            onClick={() => load(true)}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'ev91-spin' : undefined} /> Refresh EV91
          </button>
        </div>
      </div>

      {error && (
        <div className="ev91-error glass" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="fdv-summary-filters glass">
        <div className="fdv-summary-filter">
          <label>
            <MapPin size={14} /> City
          </label>
          <select
            value={selectedCity}
            onChange={(e) => startTransition(() => setSelectedCity(e.target.value))}
          >
            <option value="All">All Cities</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>
        <div className="fdv-summary-filter">
          <label>
            <Calendar size={14} /> Week
          </label>
          <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
            {weekOptions.map((week) => (
              <option key={week} value={week}>
                {week}
              </option>
            ))}
          </select>
        </div>
        <div className="fdv-summary-filter">
          <label>
            <Calendar size={14} /> From
          </label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="fdv-summary-filter">
          <label>
            <Calendar size={14} /> To
          </label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="fdv-summary-target-upload glass">
        <div className="fdv-summary-target-upload-info">
          <Target size={18} style={{ color: '#c084fc' }} />
          <div>
            <strong>Upload targets (Excel)</strong>
            <p>
              Columns: <code>Week</code>, <code>City</code>, <code>Client</code>, <code>Type</code> (
              <strong>EV</strong> or <strong>NON-EV</strong>), <code>Target</code> · week <code>22_2026</code>
            </p>
          </div>
        </div>
        <label className="fsr-export-btn fdv-summary-upload-btn">
          <Upload size={16} /> Upload Excel
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleTargetUpload}
            disabled={targetsLoading}
            hidden
          />
        </label>
        <span className="fdv-summary-target-meta">
          Week <strong>{selectedWeek}</strong>
          {weekRangeLabel ? ` · ${weekRangeLabel}` : ''}
          · {weekTargetRows.length} target row(s)
          {targetsLoading ? ' · loading…' : ''}
        </span>
        {uploadMessage && <span className="fdv-summary-upload-msg">{uploadMessage}</span>}
      </div>

      <div className="fdv-summary-meta glass">
        <span>
          <strong>{(summary.eventCount || 0).toLocaleString()}</strong> EV91 deploy/return events
        </span>
        <span>
          {format(new Date(startDate), 'dd/MM/yyyy')} – {format(new Date(endDate), 'dd/MM/yyyy')}
        </span>
        {selectedCity !== 'All' && <span>{selectedCity}</span>}
        <span>
          <strong>{visibleClients.length}</strong> clients shown
        </span>
        {hiddenClients.length > 0 && (
          <span>
            <strong>{hiddenClients.length}</strong> hidden · click + to expand
          </span>
        )}
        <span>
          <strong>{rows.length.toLocaleString()}</strong> overall rows loaded
        </span>
      </div>

      <div className="fdv-summary-pivot-wrap glass">
        {hiddenClients.length > 0 && (
          <div className="fdv-summary-hidden-bar">
            <button
              type="button"
              className="fdv-summary-hidden-toggle-btn"
              onClick={() => setShowHiddenClients((v) => !v)}
              title={showHiddenClients ? 'Hide extra clients' : `Show ${hiddenClients.length} hidden client(s)`}
            >
              {showHiddenClients ? <Eye size={16} /> : <EyeOff size={16} />}
              <span>
                {showHiddenClients ? 'Hide' : 'Show'} {hiddenClients.length} hidden client(s)
              </span>
              {showHiddenClients ? <Minus size={14} /> : <Plus size={14} />}
            </button>
            <span className="fdv-summary-hidden-hint">{hiddenClients.map((c) => c.client).join(', ')}</span>
          </div>
        )}
        <div className="fdv-summary-pivot-scroll">
          <table className="fdv-summary-pivot">
            <thead>
              <tr>
                <th className="fdv-pivot-metric-col">Metric</th>
                {tableClients.map((c) => {
                  const hiddenCol = isHiddenSummaryClient(c.client)
                  return (
                    <th
                      key={c.client}
                      className={hiddenCol && showHiddenClients ? 'fdv-pivot-hidden-client-col' : undefined}
                      title={hiddenCol ? 'Hidden client' : undefined}
                    >
                      {hiddenCol && showHiddenClients && (
                        <EyeOff size={12} className="fdv-pivot-hidden-client-icon" aria-hidden />
                      )}
                      {c.client}
                    </th>
                  )
                })}
                {!showHiddenClients && hiddenClients.length > 0 && (
                  <th className="fdv-pivot-expand-col fdv-pivot-expand-col-sticky">
                    <button
                      type="button"
                      className="fdv-pivot-expand-btn fdv-pivot-hidden-expand-btn"
                      onClick={() => setShowHiddenClients(true)}
                      title={`Show ${hiddenClients.length} hidden client(s)`}
                    >
                      <EyeOff size={14} />
                      <Plus size={14} />
                    </button>
                  </th>
                )}
                {showHiddenClients && hiddenClients.length > 0 && (
                  <th className="fdv-pivot-expand-col fdv-pivot-expand-col-sticky">
                    <button
                      type="button"
                      className="fdv-pivot-expand-btn fdv-pivot-hidden-expand-btn"
                      onClick={() => setShowHiddenClients(false)}
                      title="Hide extra clients"
                    >
                      <Eye size={14} />
                      <Minus size={14} />
                    </button>
                  </th>
                )}
                <th className="fdv-pivot-total-col fdv-pivot-total-col-sticky">Total</th>
              </tr>
            </thead>
            <tbody>
              {displaySummary.clients.length === 0 ? (
                <tr>
                  <td colSpan={2} className="fdv-pivot-empty">
                    No data for the selected city and date range
                  </td>
                </tr>
              ) : (
                <>
                  {renderMetricRow(
                    'Target EV',
                    'fsr-metric-target fsr-metric-target-ev',
                    (c) => (c.targetEv ? c.targetEv : '—'),
                    tableTotals.targetEv || '—'
                  )}
                  {SUMMARY_METRICS.map((metric) =>
                    renderMetricRow(
                      metric.label,
                      metric.rowClass,
                      (c) => c[metric.key],
                      tableTotals[metric.key]
                    )
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <button
        type="button"
        className="fdv-summary-preview-toggle glass"
        onClick={() => setShowRawData((v) => !v)}
      >
        {showRawData ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Raw data (EV / IC / Return) — audit counts
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginLeft: 8 }}>
          EV {rawDetails.evRows?.length || 0} · IC {rawDetails.icRows?.length || 0} · Return{' '}
          {rawDetails.returnRows?.length || 0}
        </span>
      </button>

      {showRawData && (
        <div className="fdv-summary-preview glass ev91-raw-preview">
          <div className="fdv-summary-filters" style={{ marginBottom: '0.75rem' }}>
            <div className="fdv-summary-filter">
              <label>Type</label>
              <select value={rawKind} onChange={(e) => setRawKind(e.target.value)}>
                <option value="EV">EV Deployed ({rawDetails.evRows?.length || 0})</option>
                <option value="IC">IC Deployed / New NON-EV ({rawDetails.icRows?.length || 0})</option>
                <option value="Return">Return ({rawDetails.returnRows?.length || 0})</option>
              </select>
            </div>
            <div className="fdv-summary-filter">
              <label>Client</label>
              <select value={rawClientFilter} onChange={(e) => setRawClientFilter(e.target.value)}>
                {rawClientOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="fdv-summary-filter" style={{ justifyContent: 'flex-end' }}>
              <label>&nbsp;</label>
              <button type="button" className="fsr-export-btn" onClick={exportRawCsv} disabled={!filteredRawRows.length}>
                <Download size={16} /> Export raw CSV
              </button>
            </div>
          </div>

          <p className="fdv-summary-preview-note" style={{ marginTop: 0 }}>
            Showing <strong>{visibleRawRows.length}</strong>
            {filteredRawRows.length > RAW_PAGE_SIZE
              ? ` of ${filteredRawRows.length.toLocaleString()}`
              : ''}{' '}
            {rawKind} row(s) for the same city/date filters as the summary
            {filteredRawRows.length > RAW_PAGE_SIZE ? ' (first 300 — export CSV for full list)' : ''}.
          </p>

          <div className="fdv-summary-preview-scroll">
            {rawKind === 'IC' ? (
              <table className="fdv-summary-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>City</th>
                    <th>Client</th>
                    <th>Client Raw</th>
                    <th>WorkerCode</th>
                    <th>Delivered</th>
                    <th>FL</th>
                    <th>Type1</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRawRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                        No IC rows for this filter
                      </td>
                    </tr>
                  ) : (
                    visibleRawRows.map((r, idx) => (
                      <tr key={`${r.workerCode}-${r.client}-${r.date}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>{r.date}</td>
                        <td>{r.city}</td>
                        <td>{r.client}</td>
                        <td>{r.clientRaw || '—'}</td>
                        <td>{r.workerCode}</td>
                        <td>{r.delivered}</td>
                        <td>{r.fl ?? '1'}</td>
                        <td>{r.type1}</td>
                        <td>{r.source}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="fdv-summary-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>City</th>
                    <th>Client</th>
                    <th>Client Raw</th>
                    <th>Vehicle</th>
                    <th>Rider ID</th>
                    <th>EV91 Rider ID</th>
                    <th>Rider Name</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRawRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                        No {rawKind} rows for this filter
                      </td>
                    </tr>
                  ) : (
                    visibleRawRows.map((r, idx) => (
                      <tr key={`${r.vehicle}-${r.date}-${r.client}-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>{r.status}</td>
                        <td>{r.date}</td>
                        <td>{r.city}</td>
                        <td>{r.client}</td>
                        <td>{r.clientRaw || '—'}</td>
                        <td>{r.vehicle}</td>
                        <td>{r.riderId || '—'}</td>
                        <td>{r.ev91RiderId || '—'}</td>
                        <td>{r.riderName || '—'}</td>
                        <td>{r.contact || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
