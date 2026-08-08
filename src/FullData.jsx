import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, startTransition, useRef } from 'react'
import { Table2, Calendar, MapPin, Briefcase, Loader, RefreshCw, Download, MessageCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchOrderUploadsForHistory,
  fetchOrderUploadMonths,
} from './lib/orderUploadDb'
import { fetchEv91OverallStatusAll, fetchEv91CurrentStatusAll } from './lib/ev91EvLookup'
import { fetchIotDataInRange } from './lib/iotDataDb'
import {
  buildFullDataMonthBaseAsync,
  fillZeroOrderIntoBaseAsync,
  materializeFullDataReport,
  collectFullDataFilterOptions,
  formatFullDataCell,
  monthDaysFromLabel,
  trimOverallRowsForMonth,
} from './lib/fullDataMonthReport'
import { shareFullDataScreenshot } from './lib/fullDataShareScreenshot'

const selectStyle = {
  padding: '0.45rem 0.65rem',
  color: '#fff',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  minWidth: '140px',
}

export default function FullData() {
  const [months, setMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')

  const [orderRows, setOrderRows] = useState([])
  const [overallRows, setOverallRows] = useState([])
  const [currentRows, setCurrentRows] = useState([])
  const [iotRows, setIotRows] = useState([])

  const [monthsLoading, setMonthsLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reportBase, setReportBase] = useState(null)
  const [building, setBuilding] = useState(false)
  const [buildStep, setBuildStep] = useState('')
  const [sharing, setSharing] = useState(false)
  const [shareHint, setShareHint] = useState('')
  const captureRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setMonthsLoading(true)
      try {
        const list = await fetchOrderUploadMonths()
        if (cancelled) return
        setMonths(list)
        if (list.length && !selectedMonth) setSelectedMonth(list[0])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load months')
      } finally {
        if (!cancelled) setMonthsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init months once
  }, [])

  const loadMonth = useCallback(async (monthLabel) => {
    if (!monthLabel) return
    const { fromKey, toKey } = monthDaysFromLabel(monthLabel)
    if (!fromKey || !toKey) {
      setError('Invalid month label')
      return
    }

    setLoading(true)
    setError(null)
    setReportBase(null)
    try {
      const [orders, overall, current, iot] = await Promise.all([
        fetchOrderUploadsForHistory(monthLabel),
        fetchEv91OverallStatusAll({ force: false }),
        fetchEv91CurrentStatusAll({ force: false }).catch(() => ({ data: [] })),
        fetchIotDataInRange(fromKey, toKey),
      ])
      setOrderRows(orders || [])
      // Trim before state so we never hold/process years of EV91 history on this page
      setOverallRows(trimOverallRowsForMonth(overall?.data || [], fromKey, toKey))
      setCurrentRows(current?.data || [])
      setIotRows(iot || [])
    } catch (err) {
      setError(err.message || 'Failed to load Full Data')
      setOrderRows([])
      setOverallRows([])
      setCurrentRows([])
      setIotRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedMonth) loadMonth(selectedMonth)
  }, [selectedMonth, loadMonth])

  const filterOptions = useMemo(
    () => collectFullDataFilterOptions(orderRows, overallRows),
    [orderRows, overallRows]
  )

  useEffect(() => {
    if (cityFilter !== 'All' && filterOptions.cities.length && !filterOptions.cities.includes(cityFilter)) {
      setCityFilter('All')
    }
  }, [filterOptions.cities, cityFilter])

  useEffect(() => {
    if (
      clientFilter !== 'All' &&
      filterOptions.clients.length &&
      !filterOptions.clients.includes(clientFilter)
    ) {
      setClientFilter('All')
    }
  }, [filterOptions.clients, clientFilter])

  // Chunked async build — show table ASAP, then fill 0-order in background
  useEffect(() => {
    if (!selectedMonth || loading) {
      setReportBase(null)
      setBuildStep('')
      return undefined
    }

    let cancelled = false
    setBuilding(true)
    setBuildStep('starting')

    ;(async () => {
      try {
        const base = await buildFullDataMonthBaseAsync(
          {
            monthLabel: selectedMonth,
            orderRows,
            overallRows,
            currentRows,
            iotRows,
          },
          {
            shouldCancel: () => cancelled,
            skipZeroOrder: true,
            onProgress: (step) => {
              if (!cancelled) setBuildStep(step)
            },
            onReady: (partial) => {
              if (cancelled) return
              // Show table before 0-order finishes
              setReportBase(partial)
              setBuilding(false)
              setBuildStep('zero-order')
            },
          }
        )
        if (cancelled) return

        setBuilding(false)
        setBuildStep('zero-order')
        await fillZeroOrderIntoBaseAsync(base, {
          shouldCancel: () => cancelled,
          orderRows,
          flatIntervals: base._flatIntervals,
        })
        if (cancelled) return
        // New object so React re-materializes totals including 0-order
        setReportBase({ ...base, slices: base.slices })
        setBuildStep('')
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to build Full Data matrix')
          setReportBase(null)
          setBuilding(false)
          setBuildStep('')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedMonth, loading, orderRows, overallRows, currentRows, iotRows])

  const deferredCity = useDeferredValue(cityFilter)
  const deferredClient = useDeferredValue(clientFilter)
  const filtersPending = deferredCity !== cityFilter || deferredClient !== clientFilter

  const report = useMemo(() => {
    if (!reportBase) {
      return {
        monthLabel: selectedMonth || '',
        fromKey: '',
        toKey: '',
        days: [],
        byDate: {},
        totals: {},
        metrics: [],
      }
    }
    return materializeFullDataReport(reportBase, deferredCity, deferredClient)
  }, [reportBase, deferredCity, deferredClient, selectedMonth])

  const onCityChange = (value) => {
    startTransition(() => setCityFilter(value))
  }
  const onClientChange = (value) => {
    startTransition(() => setClientFilter(value))
  }

  const exportExcel = () => {
    if (!report.days.length) return
    const rows = report.metrics.map((metric) => {
      const out = {
        Section: metric.section,
        List: metric.label,
        Total: metric.hold ? '' : report.totals[metric.key] ?? '',
      }
      for (const d of report.days) {
        const v = report.byDate[d.dateKey]?.[metric.key]
        out[d.label] = metric.hold || v == null ? '' : v
      }
      return out
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Full Data')
    XLSX.writeFile(wb, `Full_Data_${selectedMonth || 'month'}.xlsx`)
  }

  const shareWhatsAppScreenshot = async () => {
    if (!captureRef.current || !report.days.length || sharing) return
    setSharing(true)
    setError(null)
    setShareHint('')
    try {
      const caption = [
        'FleetPro — Full Data',
        `Month: ${selectedMonth || '—'}`,
        `City: ${cityFilter}`,
        `Client: ${clientFilter}`,
        report.fromKey && report.toKey ? `Range: ${report.fromKey} → ${report.toKey}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const result = await shareFullDataScreenshot({
        node: captureRef.current,
        filename: `Full_Data_${selectedMonth || 'month'}_${cityFilter}_${clientFilter}.png`.replace(
          /\s+/g,
          '_'
        ),
        caption,
      })
      if (result.mode === 'share') {
        setShareHint('Opened share — choose WhatsApp to send the screenshot.')
      } else if (result.mode === 'clipboard') {
        setShareHint('Screenshot copied. In WhatsApp chat press Ctrl+V (or long-press → Paste) to send the image.')
      } else if (result.mode === 'whatsapp-text') {
        setShareHint('WhatsApp opened. This browser blocked image share — try Chrome/Edge on phone, or Paste if image was copied.')
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setShareHint('')
        return
      }
      setError(err.message || 'Screenshot share failed')
    } finally {
      setSharing(false)
    }
  }

  const stickyCol = {
    position: 'sticky',
    left: 0,
    zIndex: 2,
    background: '#0f172a',
    textAlign: 'left',
    padding: '0.4rem 0.65rem',
    whiteSpace: 'nowrap',
    minWidth: 180,
    maxWidth: 220,
    boxShadow: '4px 0 8px rgba(0,0,0,0.2)',
  }

  const stickyTotal = {
    position: 'sticky',
    left: 180,
    zIndex: 2,
    background: '#111827',
    textAlign: 'right',
    padding: '0.4rem 0.5rem',
    whiteSpace: 'nowrap',
    minWidth: 72,
    fontWeight: 600,
    boxShadow: '4px 0 8px rgba(0,0,0,0.15)',
  }

  const metricRows = useMemo(() => {
    let prev = ''
    return report.metrics.map((metric) => {
      const showSection = metric.section !== prev
      prev = metric.section
      return { metric, showSection }
    })
  }, [report.metrics])

  return (
    <div className="dashboard-container">
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Table2 size={28} style={{ color: 'var(--accent-blue)' }} />
              Full Data
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '760px' }}>
              Month-wise Supply + Ev matrix. 0-order riders match Rider Performance (4-day window).
              Ev KM buckets only use dates/vehicles with uploaded IoT data (KM &gt; 0).
              Earnings / MF / Revenue rows are held for later.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="glass"
              onClick={() => selectedMonth && loadMonth(selectedMonth)}
              disabled={loading || !selectedMonth}
              style={{
                padding: '0.55rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="glass"
              onClick={exportExcel}
              disabled={!report.days.length || loading || building}
              style={{
                padding: '0.55rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#fff',
                cursor: report.days.length ? 'pointer' : 'not-allowed',
              }}
            >
              <Download size={16} />
              Export
            </button>
            <button
              type="button"
              className="glass"
              onClick={shareWhatsAppScreenshot}
              disabled={!report.days.length || loading || building || sharing}
              title="Capture Full Data table screenshot and share on WhatsApp"
              style={{
                padding: '0.55rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#22c55e',
                cursor: report.days.length && !sharing ? 'pointer' : 'not-allowed',
                border: '1px solid rgba(34,197,94,0.35)',
                background: 'rgba(34,197,94,0.1)',
                opacity: sharing ? 0.7 : 1,
              }}
            >
              {sharing ? <Loader size={16} className="spin" /> : <MessageCircle size={16} />}
              {sharing ? 'Capturing…' : 'Share WhatsApp'}
            </button>
          </div>
        </div>

        <div
          className="glass"
          style={{
            padding: '0.85rem 1rem',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            width: '100%',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Calendar size={14} /> Month
            </span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={monthsLoading}
              style={selectStyle}
            >
              {!months.length && <option value="">No months</option>}
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <MapPin size={14} /> City
            </span>
            <select value={cityFilter} onChange={(e) => onCityChange(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Briefcase size={14} /> Clients
            </span>
            <select value={clientFilter} onChange={(e) => onClientChange(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', paddingBottom: '0.35rem' }}>
            {loading || building
              ? loading
                ? 'Loading orders, EV91 & IoT…'
                : `Building matrix${buildStep ? ` · ${buildStep}` : ''}…`
              : report.fromKey
                ? `${report.fromKey} → ${report.toKey}${
                    buildStep === 'zero-order'
                      ? ' · Filling 0-order…'
                      : filtersPending
                        ? ' · Updating filter…'
                        : ''
                  }`
                : 'Select a month'}
          </div>
        </div>
      </header>

      {error && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            color: '#f87171',
            background: 'rgba(239,68,68,0.12)',
          }}
        >
          {error}
        </div>
      )}
      {shareHint && !error && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            color: '#4ade80',
            background: 'rgba(34,197,94,0.12)',
            fontSize: '0.85rem',
          }}
        >
          {shareHint}
        </div>
      )}

      <div
        className="table-card glass"
        style={{ padding: 0, overflow: 'hidden', opacity: filtersPending ? 0.72 : 1, transition: 'opacity 0.15s' }}
      >
        <div style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto' }}>
          {loading || building || (!report.days.length && selectedMonth) ? (
            <div className="loading-container" style={{ minHeight: '240px' }}>
              <span className="loader" />
            </div>
          ) : !report.days.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              {monthsLoading ? 'Loading months…' : 'No month selected or invalid month.'}
            </div>
          ) : (
            <div ref={captureRef} style={{ background: '#0f172a', color: '#e2e8f0', width: 'max-content', minWidth: '100%' }}>
              <div
                style={{
                  padding: '0.65rem 0.75rem',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  fontSize: '0.8rem',
                  background: '#1e293b',
                }}
              >
                <strong>FleetPro Full Data</strong>
                <span style={{ color: 'var(--text-dim)', marginLeft: '0.5rem' }}>
                  {selectedMonth} · City: {cityFilter} · Client: {clientFilter}
                  {report.fromKey && report.toKey ? ` · ${report.fromKey} → ${report.toKey}` : ''}
                </span>
              </div>
            <table
              style={{
                width: 'max-content',
                minWidth: '100%',
                borderCollapse: 'separate',
                borderSpacing: 0,
                fontSize: '0.78rem',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      ...stickyCol,
                      top: 0,
                      zIndex: 4,
                      background: '#1e293b',
                      fontWeight: 700,
                    }}
                  >
                    List
                  </th>
                  <th
                    style={{
                      ...stickyTotal,
                      top: 0,
                      zIndex: 4,
                      background: '#1e293b',
                      textAlign: 'center',
                    }}
                  >
                    Total
                  </th>
                  {report.days.map((d) => (
                    <th
                      key={d.dateKey}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        background: '#1e293b',
                        padding: '0.45rem 0.35rem',
                        whiteSpace: 'nowrap',
                        minWidth: 56,
                        textAlign: 'center',
                      }}
                    >
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricRows.map(({ metric, showSection }) => (
                    <React.Fragment key={metric.key}>
                      {showSection && (
                        <tr>
                          <td
                            colSpan={report.days.length + 2}
                            style={{
                              background: 'rgba(59,130,246,0.12)',
                              color: 'var(--accent-blue)',
                              fontWeight: 700,
                              padding: '0.45rem 0.65rem',
                              position: 'sticky',
                              left: 0,
                            }}
                          >
                            {metric.section === 'Supply' ? 'Supply' : 'Ev'}
                          </td>
                        </tr>
                      )}
                      <tr style={{ opacity: metric.hold ? 0.55 : 1 }}>
                        <td style={{ ...stickyCol, background: '#111827' }}>
                          {metric.label}
                          {metric.hold ? (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-dim)' }}>
                              (hold)
                            </span>
                          ) : null}
                        </td>
                        <td style={stickyTotal}>
                          {formatFullDataCell(report.totals[metric.key], metric.hold)}
                        </td>
                        {report.days.map((d) => (
                          <td
                            key={`${metric.key}-${d.dateKey}`}
                            style={{
                              textAlign: 'right',
                              padding: '0.35rem 0.4rem',
                              whiteSpace: 'nowrap',
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                            }}
                          >
                            {formatFullDataCell(report.byDate[d.dateKey]?.[metric.key], metric.hold)}
                          </td>
                        ))}
                      </tr>
                    </React.Fragment>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
        {loading && report.days.length > 0 && (
          <div
            style={{
              padding: '0.5rem 0.85rem',
              fontSize: '0.75rem',
              color: 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Loader size={14} className="spin" /> Refreshing…
          </div>
        )}
      </div>
    </div>
  )
}
