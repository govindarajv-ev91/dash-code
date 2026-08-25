import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, startTransition, useRef } from 'react'
import { Table2, Calendar, MapPin, Briefcase, Loader, RefreshCw, Download, MessageCircle, Info, X, Users, ArrowLeft } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchOrderUploadsForHistory,
  fetchOrderUploadMonths,
  fetchAllOrderUploads,
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
  todayDateKey,
  sliceFullDataReportThroughYesterday,
  buildFullDataSummaryExportRows,
  buildFullDataOrderDetailRows,
  buildFullDataOrderRiderDetailRows,
  buildFullDataZeroOrderDetailRows,
  buildFullDataDeployDetailRows,
  buildFullDataIotDetailRows,
  buildFullDataSourceWiseDailyRows,
} from './lib/fullDataMonthReport'
import { fetchRiderOnboardingRows } from './lib/riderOnboardingDb'
import { fetchEv91ClientMappingAll } from './lib/ev91OnboardingPending'
import { shareFullDataScreenshot } from './lib/fullDataShareScreenshot'
import { FULL_DATA_RATE_INFO, EV_DAILY_RENT } from './lib/fullDataCommercialRates'

const SOURCE_DAILY_COLUMNS = [
  'Source',
  'City',
  'Client',
  'Date',
  'Rider Count',
  'EV rider Count',
  'Non-EV rider Count',
  'Total Order',
  'EV Order',
  'Non-EV Order',
  'Earning',
  'EV Earning',
  'Non Earning',
  'MF Amount',
]

const SOURCE_MONTH_COLUMNS = [
  'Source',
  'City',
  'Client',
  'Unique Rider Count',
  'Unique EV rider Count',
  'Unique Non-EV rider Count',
  'Total Order',
  'EV Order',
  'Non-EV Order',
  'Earning',
  'EV Earning',
  'Non Earning',
  'MF Amount',
]

const SOURCE_MONEY_KEYS = new Set(['Earning', 'EV Earning', 'Non Earning', 'MF Amount'])

function formatSourceCell(key, value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') {
    if (SOURCE_MONEY_KEYS.has(key)) {
      return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    return value.toLocaleString('en-IN')
  }
  return String(value)
}

const selectStyle = {
  padding: '0.45rem 0.65rem',
  color: '#fff',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  minWidth: '140px',
}

export default function FullData({ onboardingData = [] }) {
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
  const [ratesInfoOpen, setRatesInfoOpen] = useState(false)
  const [exportingSource, setExportingSource] = useState(false)
  const [sourceViewOpen, setSourceViewOpen] = useState(false)
  const [sourceTab, setSourceTab] = useState('daily')
  const [localOnboarding, setLocalOnboarding] = useState([])
  const [mappingRows, setMappingRows] = useState([])
  const [allOrderRows, setAllOrderRows] = useState([])
  const [sourceLoading, setSourceLoading] = useState(false)
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
      const [orders, overall, current, iot, onboardingRows, mappingRes] = await Promise.all([
        fetchOrderUploadsForHistory(monthLabel),
        fetchEv91OverallStatusAll({ force: false }),
        fetchEv91CurrentStatusAll({ force: false }).catch(() => ({ data: [] })),
        fetchIotDataInRange(fromKey, toKey),
        fetchRiderOnboardingRows({ force: true, full: true }).catch(() => []),
        fetchEv91ClientMappingAll().catch(() => ({ data: [] })),
      ])
      setOrderRows(orders || [])
      // Trim before state so we never hold/process years of EV91 history on this page
      setOverallRows(trimOverallRowsForMonth(overall?.data || [], fromKey, toKey))
      setCurrentRows(current?.data || [])
      setIotRows(iot || [])
      if (onboardingRows?.length) setLocalOnboarding(onboardingRows)
      setMappingRows(mappingRes?.data || [])
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

  useEffect(() => {
    if (onboardingData?.length) setLocalOnboarding(onboardingData)
  }, [onboardingData])

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

  const resolvedOnboarding = localOnboarding.length ? localOnboarding : onboardingData

  const refreshOnboarding = useCallback(async () => {
    const rows = await fetchRiderOnboardingRows({ force: true, full: true })
    setLocalOnboarding(rows)
    return rows
  }, [])

  const sourceReport = useMemo(() => {
    if (!sourceViewOpen || !report.fromKey) return { daily: [], month: [], riders: [] }
    return buildFullDataSourceWiseDailyRows(
      orderRows,
      resolvedOnboarding,
      overallRows,
      mappingRows,
      allOrderRows,
      currentRows,
      {
      fromKey: report.fromKey,
      toKey: report.toKey,
      cityFilter: deferredCity,
      clientFilter: deferredClient,
    })
  }, [
    sourceViewOpen,
    orderRows,
    resolvedOnboarding,
    overallRows,
    mappingRows,
    allOrderRows,
    currentRows,
    report.fromKey,
    report.toKey,
    deferredCity,
    deferredClient,
  ])

  const openSourceView = async () => {
    if (!report.days.length) return
    setSourceViewOpen(true)
    setError(null)
    setSourceLoading(true)
    try {
      const [, mappingRes, historyRows] = await Promise.all([
        refreshOnboarding(),
        fetchEv91ClientMappingAll().catch(() => ({ data: [] })),
        fetchAllOrderUploads({ force: false }).catch(() => []),
      ])
      setMappingRows(mappingRes?.data || [])
      setAllOrderRows(historyRows || [])
    } catch (err) {
      setError(err.message || 'Failed to load rider onboarding for source names')
    } finally {
      setSourceLoading(false)
    }
  }

  const onCityChange = (value) => {
    startTransition(() => setCityFilter(value))
  }
  const onClientChange = (value) => {
    startTransition(() => setClientFilter(value))
  }

  const exportExcel = () => {
    if (!report.days.length) return
    const rows = buildFullDataSummaryExportRows(report)
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Full Data')
    XLSX.writeFile(wb, `Full_Data_${selectedMonth || 'month'}.xlsx`)
  }

  const exportDetailExcel = () => {
    if (!report.days.length) return
    const filters = {
      fromKey: report.fromKey,
      toKey: report.toKey,
      cityFilter,
      clientFilter,
      days: report.days,
      flatIntervals: reportBase?._flatIntervals || [],
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildFullDataSummaryExportRows(report)), 'Summary')
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildFullDataOrderDetailRows(orderRows, filters)),
      'Orders'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildFullDataOrderRiderDetailRows(orderRows, overallRows, filters)),
      'Order Riders'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildFullDataZeroOrderDetailRows(orderRows, overallRows, filters)),
      '0 Order'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildFullDataDeployDetailRows(overallRows, filters)),
      'Deploy Return'
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildFullDataIotDetailRows(iotRows, filters)),
      'IoT KM'
    )
    const suffix = `${selectedMonth || 'month'}_${cityFilter}_${clientFilter}`.replace(/\s+/g, '_')
    XLSX.writeFile(wb, `Full_Data_Detail_${suffix}.xlsx`)
  }

  const exportSourceWiseDailyExcel = () => {
    if (!sourceReport.daily.length && !sourceReport.month.length && !sourceReport.riders.length) return
    setExportingSource(true)
    try {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sourceReport.daily), 'Source Daily')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sourceReport.month), 'Source Month')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sourceReport.riders), 'Rider Wise')
      const suffix = `${selectedMonth || 'month'}_${cityFilter}_${clientFilter}`.replace(/\s+/g, '_')
      XLSX.writeFile(wb, `Full_Data_Source_Daily_${suffix}.xlsx`)
    } catch (err) {
      setError(err.message || 'Failed to export source-wise daily data')
    } finally {
      setExportingSource(false)
    }
  }

  const shareWhatsAppScreenshot = async () => {
    if (!captureRef.current || !report.days.length || sharing) return
    setSharing(true)
    setError(null)
    setShareHint('')

    // Open blank tab immediately (same click) so WhatsApp is not blocked after capture
    let waWin = null
    try {
      waWin = window.open('about:blank', '_blank')
    } catch {
      waWin = null
    }

    try {
      const shareReport = sliceFullDataReportThroughYesterday(report)
      const hideDateKey =
        report.days.some((d) => d.dateKey === todayDateKey()) ? todayDateKey() : ''
      const caption = [
        'FleetPro — Full Data',
        `Month: ${selectedMonth || '—'}`,
        `City: ${cityFilter}`,
        `Client: ${clientFilter}`,
        shareReport.fromKey && shareReport.toKey
          ? `Range: ${shareReport.fromKey} → ${shareReport.toKey} (through yesterday)`
          : '',
      ]
        .filter(Boolean)
        .join('\n')

      const totalsByMetric = {}
      for (const metric of shareReport.metrics || []) {
        totalsByMetric[metric.key] = formatFullDataCell(shareReport.totals?.[metric.key], metric.hold)
      }

      const result = await shareFullDataScreenshot({
        node: captureRef.current,
        filename: `Full_Data_${selectedMonth || 'month'}_${cityFilter}_${clientFilter}.png`.replace(
          /\s+/g,
          '_'
        ),
        caption,
        waWin,
        sharePrep: hideDateKey
          ? {
              hideDateKey,
              headerText: `${selectedMonth} · City: ${cityFilter} · Client: ${clientFilter}${
                shareReport.fromKey && shareReport.toKey
                  ? ` · ${shareReport.fromKey} → ${shareReport.toKey}`
                  : ''
              }`,
              totalsByMetric,
              colSpan: (shareReport.days?.length || 0) + 2,
            }
          : null,
      })
      if (result.mode === 'share') {
        setShareHint('Share sheet opened — choose WhatsApp to send the screenshot.')
      } else if (result.mode === 'clipboard') {
        setShareHint('Screenshot copied. In WhatsApp press Ctrl+V (or long-press → Paste) to send the image.')
      } else if (result.mode === 'download') {
        setShareHint('Screenshot downloaded. Attach that PNG file in the WhatsApp chat that opened.')
      }
    } catch (err) {
      if (waWin && !waWin.closed) {
        try {
          waWin.close()
        } catch {
          // ignore
        }
      }
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
    background: '#f8fafc',
    color: '#0f172a',
    textAlign: 'center',
    padding: '0.4rem 0.65rem',
    whiteSpace: 'nowrap',
    minWidth: 180,
    maxWidth: 220,
    boxShadow: '4px 0 8px rgba(15,23,42,0.08)',
  }

  const stickyTotal = {
    position: 'sticky',
    left: 180,
    zIndex: 2,
    background: '#eef2ff',
    color: '#0f172a',
    textAlign: 'center',
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
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '820px' }}>
              Month-wise Supply + Ev matrix through yesterday. Earnings = orders × client rate;
              MF = earning × client margin (BB 6% in BLR/CHN/HYD/MUM); Rent = on-road vehicles × ₹230;
              Revenue = Earning + MF + Rent.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="glass"
              onClick={() => setRatesInfoOpen(true)}
              title="View earning rates, MF % and rent"
              style={{
                padding: '0.55rem 0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#93c5fd',
                cursor: 'pointer',
                border: '1px solid rgba(147,197,253,0.35)',
                background: 'rgba(59,130,246,0.12)',
              }}
            >
              <Info size={16} />
              Rates
            </button>
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
              title="Download the Full Data summary table"
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
              onClick={exportDetailExcel}
              disabled={!report.days.length || loading || building}
              title="Download raw detail: orders, deploy/return, IoT KM"
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
              Export Detail
            </button>
            <button
              type="button"
              className="glass"
              onClick={() => (sourceViewOpen ? setSourceViewOpen(false) : openSourceView())}
              disabled={!report.days.length || loading || building}
              title="Open source-wise rider, order and earning (source from rider onboarding)"
              style={{
                padding: '0.55rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#fff',
                cursor: report.days.length ? 'pointer' : 'not-allowed',
                border: sourceViewOpen ? '1px solid rgba(147,197,253,0.5)' : undefined,
                background: sourceViewOpen ? 'rgba(59,130,246,0.18)' : undefined,
              }}
            >
              <Users size={16} />
              {sourceViewOpen ? 'Back to Full Data' : 'Source Detail'}
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

      {ratesInfoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Earning, MF and Rent rates"
          onClick={() => setRatesInfoOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(2,6,23,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            className="glass"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(920px, 100%)',
              maxHeight: '85vh',
              overflow: 'auto',
              padding: '1rem 1.15rem 1.25rem',
              background: '#0f172a',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.85rem' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.05rem' }}>
                <Info size={18} style={{ color: '#93c5fd' }} />
                Earning / MF / Rent rates
              </h3>
              <button
                type="button"
                className="glass"
                onClick={() => setRatesInfoOpen(false)}
                style={{ padding: '0.35rem 0.5rem', color: '#fff', cursor: 'pointer' }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: '0 0 0.85rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Earning = Orders × Per-order rate · MF = Earning × MF% · Rent = On-road vehicles × ₹{EV_DAILY_RENT}/day ·
              Revenue = Earning + MF + Rent
            </p>

            <div
              style={{
                marginBottom: '1rem',
                padding: '0.65rem 0.75rem',
                borderRadius: 8,
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.25)',
                fontSize: '0.85rem',
              }}
            >
              <strong>Rent (per day):</strong> ₹{FULL_DATA_RATE_INFO.rentPerDay.toLocaleString('en-IN')} per on-road
              deployed vehicle
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
              }}
            >
              <div>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Per-order rate (₹)</h4>
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: '#1e293b' }}>
                        <th style={{ textAlign: 'left', padding: '0.45rem 0.6rem' }}>Client</th>
                        <th style={{ textAlign: 'right', padding: '0.45rem 0.6rem' }}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FULL_DATA_RATE_INFO.perOrderRates.map((row) => (
                        <tr key={row.client} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <td style={{ padding: '0.4rem 0.6rem' }}>{row.client}</td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>₹{row.rate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>MF %</h4>
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ background: '#1e293b' }}>
                        <th style={{ textAlign: 'left', padding: '0.45rem 0.6rem' }}>Client</th>
                        <th style={{ textAlign: 'right', padding: '0.45rem 0.6rem' }}>MF %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FULL_DATA_RATE_INFO.mfMargins.map((row) => (
                        <tr key={row.client} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            {row.client}
                            {row.note ? (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>{row.note}</div>
                            ) : null}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{row.marginPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                  {FULL_DATA_RATE_INFO.bbMfNote}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
        {sourceViewOpen ? (
          <div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.65rem',
                padding: '0.75rem 0.9rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                  <Users size={16} style={{ color: 'var(--accent-blue)' }} />
                  Source Detail
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  Source from rider onboarding · {selectedMonth} · City: {cityFilter} · Client:{' '}
                  {clientFilter}
                  {sourceTab === 'daily'
                    ? ` · ${sourceReport.daily.length.toLocaleString('en-IN')} rows`
                    : ` · ${sourceReport.month.length.toLocaleString('en-IN')} rows`}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="glass"
                  onClick={() => setSourceTab('daily')}
                  style={{
                    padding: '0.4rem 0.7rem',
                    color: '#fff',
                    cursor: 'pointer',
                    border:
                      sourceTab === 'daily'
                        ? '1px solid rgba(147,197,253,0.55)'
                        : '1px solid var(--border-color)',
                    background: sourceTab === 'daily' ? 'rgba(59,130,246,0.2)' : undefined,
                  }}
                >
                  Daily
                </button>
                <button
                  type="button"
                  className="glass"
                  onClick={() => setSourceTab('month')}
                  style={{
                    padding: '0.4rem 0.7rem',
                    color: '#fff',
                    cursor: 'pointer',
                    border:
                      sourceTab === 'month'
                        ? '1px solid rgba(147,197,253,0.55)'
                        : '1px solid var(--border-color)',
                    background: sourceTab === 'month' ? 'rgba(59,130,246,0.2)' : undefined,
                  }}
                >
                  Month unique
                </button>
                <button
                  type="button"
                  className="glass"
                  onClick={exportSourceWiseDailyExcel}
                  disabled={exportingSource || sourceLoading || (!sourceReport.daily.length && !sourceReport.month.length && !sourceReport.riders.length)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {exportingSource ? <Loader size={14} className="spin" /> : <Download size={14} />}
                  Download
                </button>
                <button
                  type="button"
                  className="glass"
                  onClick={() => setSourceViewOpen(false)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <ArrowLeft size={14} />
                  Full Data
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto', background: '#ffffff' }}>
              {sourceLoading ? (
                <div className="loading-container" style={{ minHeight: '240px' }}>
                  <span className="loader" />
                </div>
              ) : (
                <div className="full-data-sheet" style={{ background: '#ffffff', color: '#0f172a' }}>
                  <table
                    style={{
                      width: 'max-content',
                      minWidth: '100%',
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                      fontSize: '0.78rem',
                      color: '#0f172a',
                      background: '#ffffff',
                    }}
                  >
                    <thead>
                      <tr>
                        {(sourceTab === 'daily' ? SOURCE_DAILY_COLUMNS : SOURCE_MONTH_COLUMNS).map((col) => (
                          <th
                            key={col}
                            style={{
                              position: 'sticky',
                              top: 0,
                              zIndex: 2,
                              background: '#e2e8f0',
                              color: '#0f172a',
                              padding: '0.45rem 0.55rem',
                              whiteSpace: 'nowrap',
                              textAlign: col === 'Source' || col === 'City' || col === 'Client' || col === 'Date' ? 'left' : 'right',
                              borderBottom: '1px solid #cbd5e1',
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(sourceTab === 'daily' ? sourceReport.daily : sourceReport.month).map((row, idx) => {
                        const cols = sourceTab === 'daily' ? SOURCE_DAILY_COLUMNS : SOURCE_MONTH_COLUMNS
                        return (
                          <tr key={`${row.Source}-${row.City}-${row.Client}-${row.Date || ''}-${idx}`}>
                            {cols.map((col) => (
                              <td
                                key={col}
                                style={{
                                  padding: '0.4rem 0.55rem',
                                  whiteSpace: 'nowrap',
                                  textAlign:
                                    col === 'Source' || col === 'City' || col === 'Client' || col === 'Date'
                                      ? 'left'
                                      : 'right',
                                  borderBottom: '1px solid #e2e8f0',
                                  background: idx % 2 ? '#f8fafc' : '#ffffff',
                                }}
                              >
                                {formatSourceCell(col, row[col])}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {!(sourceTab === 'daily' ? sourceReport.daily : sourceReport.month).length && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      No source-wise rows for this month / city / client.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
        <div style={{ maxHeight: 'calc(100vh - 260px)', overflow: 'auto', paddingRight: 4, background: '#ffffff' }}>
          {loading || building || (!report.days.length && selectedMonth) ? (
            <div className="loading-container" style={{ minHeight: '240px' }}>
              <span className="loader" />
            </div>
          ) : !report.days.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              {monthsLoading ? 'Loading months…' : 'No month selected or invalid month.'}
            </div>
          ) : (
            <div
              ref={captureRef}
              className="full-data-sheet"
              style={{
                background: '#ffffff',
                color: '#0f172a',
                width: 'max-content',
                minWidth: '100%',
                paddingRight: 64,
                paddingBottom: 8,
                boxSizing: 'content-box',
              }}
            >
              <div
                style={{
                  padding: '0.65rem 0.75rem',
                  borderBottom: '1px solid #dbe3ee',
                  fontSize: '0.8rem',
                  background: '#f1f5f9',
                  color: '#0f172a',
                }}
              >
                <strong>FleetPro Full Data</strong>
                <span data-share-header style={{ color: '#475569', marginLeft: '0.5rem' }}>
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
                color: '#0f172a',
                background: '#ffffff',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      ...stickyCol,
                      top: 0,
                      zIndex: 4,
                      background: '#e2e8f0',
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  >
                    List
                  </th>
                  <th
                    style={{
                      ...stickyTotal,
                      top: 0,
                      zIndex: 4,
                      background: '#dbeafe',
                      textAlign: 'center',
                      color: '#0f172a',
                    }}
                  >
                    Total
                  </th>
                  {report.days.map((d, di) => (
                    <th
                      key={d.dateKey}
                      data-date-key={d.dateKey}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        background: d.dateKey === todayDateKey() ? '#fde68a' : '#e2e8f0',
                        color: '#0f172a',
                        padding: di === report.days.length - 1 ? '0.45rem 1.25rem 0.45rem 0.5rem' : '0.45rem 0.5rem',
                        whiteSpace: 'nowrap',
                        minWidth: di === report.days.length - 1 ? 112 : 96,
                        textAlign: 'center',
                        borderBottom: '1px solid #cbd5e1',
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
                            data-share-colspan
                            colSpan={report.days.length + 2}
                            style={{
                              background: '#dbeafe',
                              color: '#1d4ed8',
                              fontWeight: 700,
                              padding: '0.45rem 0.65rem',
                              position: 'sticky',
                              left: 0,
                              textAlign: 'center',
                            }}
                          >
                            {metric.section === 'Supply' ? 'Supply' : 'Ev'}
                          </td>
                        </tr>
                      )}
                      <tr style={{ opacity: metric.hold ? 0.55 : 1 }}>
                        <td
                          style={{ ...stickyCol, background: '#f8fafc' }}
                          title={metric.hint || undefined}
                        >
                          {metric.label}
                          {metric.hold ? (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#64748b' }}>
                              (hold)
                            </span>
                          ) : null}
                        </td>
                        <td style={stickyTotal} data-metric-total={metric.key}>
                          {formatFullDataCell(report.totals[metric.key], metric.hold)}
                        </td>
                        {report.days.map((d, di) => (
                          <td
                            key={`${metric.key}-${d.dateKey}`}
                            data-date-key={d.dateKey}
                            style={{
                              textAlign: 'center',
                              padding: di === report.days.length - 1 ? '0.35rem 1.25rem 0.35rem 0.5rem' : '0.35rem 0.5rem',
                              whiteSpace: 'nowrap',
                              minWidth: di === report.days.length - 1 ? 112 : 96,
                              color: '#0f172a',
                              borderBottom: '1px solid #e2e8f0',
                              background: d.dateKey === todayDateKey() ? '#fef9c3' : '#ffffff',
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
        )}
        {loading && report.days.length > 0 && !sourceViewOpen && (
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
