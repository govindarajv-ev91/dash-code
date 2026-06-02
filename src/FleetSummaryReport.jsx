import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Calendar, MapPin, Download, BarChart3, ChevronDown, ChevronUp, Upload, Target, Plus, Minus, EyeOff, Eye } from 'lucide-react'
import { format } from 'date-fns'
import {
  MASTER_SHEET_HEADERS,
  buildMasterSheetRows,
  filterMasterSheetRows,
  buildClientWiseSummary,
  getCitiesFromMasterRows,
  masterRowToCsvRecord,
  SUMMARY_METRICS,
} from './lib/fleetMasterSheet'
import {
  buildTargetTotalsByEvType,
  buildWeekOptions,
  dateToWeekKey,
  getDbSetupMessage,
  getTargetsForWeek,
  isMissingClientTargetsTable,
  loadClientTargets,
  mergeSummaryWithTargets,
  parseTargetsExcelArrayBuffer,
  persistClientTargets,
  weekKeyToDateRange,
} from './lib/fleetClientTargets'
import { splitSummaryClients, isHiddenSummaryClient } from './lib/clientSummaryClients'

function escapeCsv(value) {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

export default function FleetSummaryReport({ fleetData, riderData, loading }) {
  const initialWeek = dateToWeekKey(new Date()) || ''
  const initialRange = weekKeyToDateRange(initialWeek)

  const [startDate, setStartDate] = useState(() => initialRange?.startDate || format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(() => initialRange?.endDate || format(new Date(), 'yyyy-MM-dd'))
  const [selectedCity, setSelectedCity] = useState('All')
  const [selectedWeek, setSelectedWeek] = useState(initialWeek)
  const [showMasterPreview, setShowMasterPreview] = useState(false)
  const [allTargets, setAllTargets] = useState({})
  const [storedWeekKeys, setStoredWeekKeys] = useState([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [uploadMessage, setUploadMessage] = useState('')
  const [showHiddenClients, setShowHiddenClients] = useState(false)

  const masterRows = useMemo(() => buildMasterSheetRows(fleetData), [fleetData])
  const cities = useMemo(() => getCitiesFromMasterRows(masterRows), [masterRows])

  const weekOptions = useMemo(
    () => buildWeekOptions({ storedWeekKeys, anchorDate: new Date() }),
    [storedWeekKeys]
  )

  useEffect(() => {
    let cancelled = false

    loadClientTargets()
      .then(({ byWeek, weekKeys, source }) => {
        if (cancelled) return
        setAllTargets(byWeek)
        setStoredWeekKeys(weekKeys)
        if (source === 'database') {
          setUploadMessage('Targets loaded from database.')
        }
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
    const range = weekKeyToDateRange(selectedWeek)
    if (!range) return
    setStartDate(range.startDate)
    setEndDate(range.endDate)
  }, [selectedWeek])

  const filteredMasterRows = useMemo(
    () => filterMasterSheetRows(masterRows, { city: selectedCity, startDate, endDate }),
    [masterRows, selectedCity, startDate, endDate]
  )

  const summary = useMemo(
    () =>
      buildClientWiseSummary(filteredMasterRows, riderData, {
        city: selectedCity,
        startDate,
        endDate,
      }),
    [filteredMasterRows, riderData, selectedCity, startDate, endDate]
  )

  const weekTargetRows = useMemo(
    () => getTargetsForWeek(allTargets, selectedWeek),
    [allTargets, selectedWeek]
  )

  const targetMaps = useMemo(
    () => buildTargetTotalsByEvType(weekTargetRows, selectedCity),
    [weekTargetRows, selectedCity]
  )

  const displaySummary = useMemo(
    () => mergeSummaryWithTargets(summary, targetMaps),
    [summary, targetMaps]
  )

  const weekRangeLabel = useMemo(() => weekKeyToDateRange(selectedWeek)?.label || '', [selectedWeek])

  const { visibleClients, hiddenClients } = useMemo(
    () => splitSummaryClients(displaySummary.clients),
    [displaySummary.clients]
  )

  const tableClients = useMemo(() => {
    const visible = visibleClients || []
    const hidden = hiddenClients || []
    return showHiddenClients ? [...visible, ...hidden] : visible
  }, [visibleClients, hiddenClients, showHiddenClients])

  const tableTotals = useMemo(() => {
    const totals = {
      targetEv: 0,
      targetNonEv: 0,
    }
    for (const metric of SUMMARY_METRICS) {
      totals[metric.key] = 0
    }
    for (const c of tableClients) {
      totals.targetEv += Number(c.targetEv || 0)
      totals.targetNonEv += Number(c.targetNonEv || 0)
      for (const metric of SUMMARY_METRICS) {
        totals[metric.key] += Number(c[metric.key] || 0)
      }
    }
    return totals
  }, [tableClients])

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

  const handleTargetUpload = useCallback(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const { parsedRows, byWeek } = parseTargetsExcelArrayBuffer(buffer, selectedWeek)
      if (!parsedRows.length) {
        setUploadMessage('No valid rows found. Use Week, City, Client, Type (EV or NON-EV), Target. Week like 22_2026.')
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
        setUploadMessage(`Saved locally (${parsedRows.length} rows). Database save failed: ${dbError?.message || 'Unknown error'}`)
      }
    } catch (err) {
      setUploadMessage(`Upload failed: ${err.message || 'Invalid file'}`)
    }
  }, [selectedWeek])

  const exportMasterCsv = () => {
    const lines = [MASTER_SHEET_HEADERS.join(',')]
    for (const row of filteredMasterRows) {
      const rec = masterRowToCsvRecord(row)
      lines.push(MASTER_SHEET_HEADERS.map((h) => escapeCsv(rec[h])).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_master_${selectedCity}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportSummaryCsv = () => {
    const clientCols = displaySummary.clients.map((c) => c.client)
    const header = ['Metric', ...clientCols, 'Total']
    const lines = [header.map(escapeCsv).join(',')]

    const evTargetValues = displaySummary.clients.map((c) => c.targetEv || 0)
    evTargetValues.push(displaySummary.totals.targetEv || 0)
    lines.push(['Target EV', ...evTargetValues].map(escapeCsv).join(','))

    const nonEvTargetValues = displaySummary.clients.map((c) => c.targetNonEv || 0)
    nonEvTargetValues.push(displaySummary.totals.targetNonEv || 0)
    lines.push(['Target NON-EV', ...nonEvTargetValues].map(escapeCsv).join(','))

    for (const metric of SUMMARY_METRICS) {
      const values = displaySummary.clients.map((c) => c[metric.key])
      values.push(displaySummary.totals[metric.key])
      lines.push([metric.label, ...values].map(escapeCsv).join(','))
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_client_summary_${selectedWeek}_${selectedCity}_${startDate}_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fdv-summary-page">
      <div className="fdv-summary-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart3 size={28} style={{ color: 'var(--primary)' }} />
          <div>
            <h1>Client Summary</h1>
            <p className="fdv-summary-subtitle">
              Deployee / Return master data · EV = fleet Deployee (deduped) · IC = unique own-bike riders (fl=1, NON-EV, no fleet deploy in week) · targets in database
            </p>
          </div>
        </div>
        <div className="fdv-summary-actions">
          <button type="button" className="fsr-export-btn" onClick={exportSummaryCsv}>
            <Download size={16} /> Export Summary
          </button>
          <button type="button" className="fsr-export-btn" onClick={exportMasterCsv}>
            <Download size={16} /> Export Master
          </button>
        </div>
      </div>

      <div className="fdv-summary-filters glass">
        <div className="fdv-summary-filter">
          <label><MapPin size={14} /> City</label>
          <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
            <option value="All">All Cities</option>
            {cities.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>
        <div className="fdv-summary-filter">
          <label><Calendar size={14} /> Week</label>
          <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
            {weekOptions.map((week) => (
              <option key={week} value={week}>{week}</option>
            ))}
          </select>
        </div>
        <div className="fdv-summary-filter">
          <label><Calendar size={14} /> From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="fdv-summary-filter">
          <label><Calendar size={14} /> To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="fdv-summary-target-upload glass">
        <div className="fdv-summary-target-upload-info">
          <Target size={18} style={{ color: '#c084fc' }} />
          <div>
            <strong>Upload targets (Excel)</strong>
            <p>Columns: <code>Week</code>, <code>City</code>, <code>Client</code>, <code>Type</code> (<strong>EV</strong> or <strong>NON-EV</strong>), <code>Target</code> · week <code>22_2026</code></p>
          </div>
        </div>
        <label className="fsr-export-btn fdv-summary-upload-btn">
          <Upload size={16} /> Upload Excel
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleTargetUpload} disabled={targetsLoading} hidden />
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
        <span><strong>{filteredMasterRows.length.toLocaleString()}</strong> master rows</span>
        <span>{format(new Date(startDate), 'dd/MM/yyyy')} – {format(new Date(endDate), 'dd/MM/yyyy')}</span>
        {selectedCity !== 'All' && <span>{selectedCity}</span>}
        <span><strong>{visibleClients.length}</strong> clients shown</span>
        {hiddenClients.length > 0 && (
          <span><strong>{hiddenClients.length}</strong> hidden · click + to expand</span>
        )}
      </div>

      {loading ? (
        <div className="fdv-summary-loading glass">
          <span className="loader" />
          <span>Loading fleet data…</span>
        </div>
      ) : (
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
              <span className="fdv-summary-hidden-hint">
                {hiddenClients.map((c) => c.client).join(', ')}
              </span>
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
                    {renderMetricRow(
                      'Target NON-EV',
                      'fsr-metric-target fsr-metric-target-non-ev',
                      (c) => (c.targetNonEv ? c.targetNonEv : '—'),
                      tableTotals.targetNonEv || '—'
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
      )}

      <button
        type="button"
        className="fdv-summary-preview-toggle glass"
        onClick={() => setShowMasterPreview((v) => !v)}
      >
        {showMasterPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        Master sheet preview ({filteredMasterRows.length} rows)
      </button>

      {showMasterPreview && (
        <div className="fdv-summary-preview glass">
          <div className="fdv-summary-preview-scroll">
            <table className="fdv-summary-preview-table">
              <thead>
                <tr>
                  {MASTER_SHEET_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMasterRows.slice(0, 250).map((row, idx) => {
                  const rec = masterRowToCsvRecord(row)
                  return (
                    <tr key={idx}>
                      {MASTER_SHEET_HEADERS.map((h) => (
                        <td key={h}>{rec[h]}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredMasterRows.length > 250 && (
            <p className="fdv-summary-preview-note">Showing first 250 of {filteredMasterRows.length} rows</p>
          )}
        </div>
      )}
    </div>
  )
}
