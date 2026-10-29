import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef, memo, startTransition } from 'react'
import { createPortal } from 'react-dom'
import { format, subDays, parseISO } from 'date-fns'
import {
  Users,
  Search,
  Download,
  Loader,
  Calendar,
  MapPin,
  Briefcase,
  Filter,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import { fetchOrderUploadMonths, fetchOrderUploadsForDateRange } from './lib/orderUploadDb'
import { fetchEv91OverallStatusAll, fetchEv91CurrentStatusAll } from './lib/ev91EvLookup'
import {
  buildFullDataSourceMonthRows,
  buildFullDataSourceRawOrderRows,
  buildFullDataSourceActiveSummary,
  buildSourceRiderCityIndex,
  SOURCE_RAW_ORDER_COLUMNS,
  filterSourceMonthRows,
  summarizeSourceMonthRows,
  collectFullDataFilterOptions,
  monthDaysFromLabel,
  trimOverallRowsForMonth,
  formatClientFilterLabel,
} from './lib/fullDataMonthReport'
import { fetchRiderOnboardingRows } from './lib/riderOnboardingDb'
import { fetchEv91ClientMappingAll } from './lib/ev91OnboardingPending'
import { dedupeCanonicalCities } from './lib/citySummaryAliases'
import { normalizeSummaryClient } from './lib/clientSummaryClients'
import { useSourceMaster } from './lib/useSourceMaster'
import { isListedSource } from './lib/sourceMaster'
import './source-wise-data.css'

const ROWS_PER_PAGE = 50
const DATE_LOAD_DEBOUNCE_MS = 350
const ACTIVE_LOOKBACK_DAYS = 4

function orderFetchStart(fromKey, toKey) {
  const start = fromKey || toKey
  if (!start) return ''
  // A delayed client's window can precede From, including the previous month.
  return format(subDays(parseISO(start), ACTIVE_LOOKBACK_DAYS), 'yyyy-MM-dd')
}

const TABLE_COLUMNS_BY_CLIENT = [
  'Source',
  'City',
  'Client',
  'Unique Rider Count',
  'Unique EV rider Count',
  'Unique Non-EV rider Count',
  'Active Rider Count (last 4 days)',
  'Active EV Rider Count',
  'Active Non-EV Rider Count',
  '0 Order Rider Count (last 4 days)',
  '0 Order EV Rider Count (last 4 days)',
  '0 Order Non-EV Rider Count (last 4 days)',
  'Active window end',
  'Active window dates',
  'Total Order',
  'EV Order',
  'Non-EV Order',
  'Earning',
  'EV Earning',
  'Non Earning',
  'MF Amount',
]

const TABLE_COLUMNS_BY_SOURCE = [
  'Source',
  'City',
  'Unique Rider Count',
  'Unique EV rider Count',
  'Unique Non-EV rider Count',
  'Active Rider Count (last 4 days)',
  'Active EV Rider Count',
  'Active Non-EV Rider Count',
  '0 Order Rider Count (last 4 days)',
  '0 Order EV Rider Count (last 4 days)',
  '0 Order Non-EV Rider Count (last 4 days)',
  'Active window end',
  'Active window dates',
  'Total Order',
  'EV Order',
  'Non-EV Order',
  'Earning',
  'EV Earning',
  'Non Earning',
  'MF Amount',
]

const MONEY_COLUMNS = new Set(['Earning', 'EV Earning', 'Non Earning', 'MF Amount'])

const TEXT_COLUMNS = new Set(['Source', 'City', 'Client', 'Active window end', 'Active window dates'])

const DEFAULT_SORT_KEY = 'Unique Rider Count'
const COUNT_FORMAT = new Intl.NumberFormat('en-IN')
const MONEY_FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function compareSourceRows(a, b, key, dir) {
  const av = a[key]
  const bv = b[key]
  const numeric =
    typeof av === 'number' ||
    typeof bv === 'number' ||
    (av !== '' && av != null && !Number.isNaN(Number(av))) ||
    (bv !== '' && bv != null && !Number.isNaN(Number(bv)))
  let cmp = 0
  if (numeric) {
    cmp = (Number(av) || 0) - (Number(bv) || 0)
  } else {
    cmp = String(av ?? '').localeCompare(String(bv ?? ''))
  }
  return dir === 'desc' ? -cmp : cmp
}

function formatCell(key, value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') {
    if (MONEY_COLUMNS.has(key)) {
      return MONEY_FORMAT.format(value)
    }
    return COUNT_FORMAT.format(value)
  }
  return String(value)
}

function formatMoney(value) {
  return MONEY_FORMAT.format(Number(value) || 0)
}

const selectStyle = {
  padding: '0.45rem 0.65rem',
  color: '#fff',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  minWidth: '140px',
}

const dateInputStyle = {
  ...selectStyle,
  colorScheme: 'dark',
  minWidth: '155px',
}

const SearchableSelect = memo(function SearchableSelect({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  minWidth = 180,
  searchPlaceholder = 'Search…',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuStyle, setMenuStyle] = useState(null)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const updateMenuPosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const menuWidth = Math.max(rect.width, minWidth)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove
    const maxHeight = Math.min(320, preferBelow ? spaceBelow - 4 : spaceAbove - 4)
    const top = preferBelow ? rect.bottom + 4 : Math.max(8, rect.top - maxHeight - 4)
    let left = rect.left
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }
    const nextStyle = {
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      maxHeight: Math.max(160, maxHeight),
      zIndex: 10050,
    }
    setMenuStyle((previous) => previous && Object.keys(nextStyle).every((key) => previous[key] === nextStyle[key])
      ? previous : nextStyle)
  }, [minWidth])

  useEffect(() => {
    if (!isOpen) return undefined
    updateMenuPosition()
    let frame = null
    const onScrollOrResize = (event) => {
      // Scrolling the menu or the report table cannot move this button.
      // Only scrolling an ancestor (or resizing) needs a new position.
      if (event.type === 'scroll' && event.target instanceof Node && !event.target.contains(buttonRef.current)) return
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        updateMenuPosition()
      })
    }
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleClickOutside = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setIsOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => opt.toString().toLowerCase().includes(q))
  }, [options, search])

  const pick = (opt) => {
    onChange(opt)
    setIsOpen(false)
    setSearch('')
  }

  const menu =
    isOpen && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...menuStyle,
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              padding: '0.5rem',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'rgba(255,255,255,0.05)',
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                marginBottom: '0.5rem',
                flexShrink: 0,
              }}
            >
              <Search size={12} color="#94a3b8" />
              <input
                autoFocus
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: '0.75rem',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {filteredOptions.map((opt) => {
                const selected = value === opt
                return (
                  <div
                    key={opt}
                    role="option"
                    aria-selected={selected}
                    style={{
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.75rem',
                      color: selected ? '#fff' : '#e2e8f0',
                      background: selected ? 'rgba(59,130,246,0.35)' : 'transparent',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: selected ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => pick(opt)}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {opt}
                  </div>
                )
              })}
              {!filteredOptions.length && (
                <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                  No matches
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        fontSize: '0.78rem',
        color: 'var(--text-dim)',
        minWidth,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        {Icon ? <Icon size={13} /> : null} {label}
      </span>
      <div ref={containerRef} style={{ position: 'relative', minWidth }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            ...selectStyle,
            minWidth,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#fff',
            }}
          >
            {value || 'All'}
          </span>
          <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        </button>
        {menu}
      </div>
    </label>
  )
})

export default function SourceWiseData({ onboardingData = [] }) {
  const { sourceIndex, sourcesLoading, sourceError, refreshSources } = useSourceMaster()
  const [months, setMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [sourceFilter, setSourceFilter] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewTab, setViewTab] = useState('byClient')
  const [showSummaryCards, setShowSummaryCards] = useState(false)
  const [useLatestClientData, setUseLatestClientData] = useState(true)
  const [sortKey, setSortKey] = useState(DEFAULT_SORT_KEY)
  const [sortDir, setSortDir] = useState('desc')

  const [orderRows, setOrderRows] = useState([])
  const [overallRows, setOverallRows] = useState([])
  const [currentRows, setCurrentRows] = useState([])
  const [onboardingRows, setOnboardingRows] = useState([])
  const [mappingRows, setMappingRows] = useState([])

  const overallAllRef = useRef([])

  const [staticLoading, setStaticLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const deferredCity = useDeferredValue(cityFilter)
  const deferredClient = useDeferredValue(clientFilter)
  const deferredSource = useDeferredValue(sourceFilter)
  const deferredSearch = useDeferredValue(searchTerm)
  const filtersPending =
    deferredCity !== cityFilter ||
    deferredClient !== clientFilter ||
    deferredSource !== sourceFilter ||
    deferredSearch !== searchTerm

  const loading = staticLoading || ordersLoading

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchOrderUploadMonths()
        if (cancelled) return
        setMonths(list)
        if (list.length) {
          setSelectedMonth(list[0])
          const { fromKey, toKey } = monthDaysFromLabel(list[0])
          if (fromKey && toKey) {
            setDateFrom(fromKey)
            setDateTo(toKey)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load months')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (onboardingData?.length) setOnboardingRows(onboardingData)
  }, [onboardingData])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setStaticLoading(true)
      try {
        const [overall, current, onboarding, mappingRes] = await Promise.all([
          fetchEv91OverallStatusAll({ force: false }),
          fetchEv91CurrentStatusAll({ force: false }).catch(() => ({ data: [] })),
          onboardingData?.length
            ? Promise.resolve(onboardingData)
            : fetchRiderOnboardingRows({ force: false, full: true }).catch(() => []),
          fetchEv91ClientMappingAll().catch(() => ({ data: [] })),
        ])
        if (cancelled) return
        overallAllRef.current = overall?.data || []
        setCurrentRows(current?.data || [])
        if (onboarding?.length) setOnboardingRows(onboarding)
        setMappingRows(mappingRes?.data || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load reference data')
      } finally {
        if (!cancelled) setStaticLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onboardingData])

  const onMonthChange = useCallback((monthLabel) => {
    if (!monthLabel) return
    setSelectedMonth(monthLabel)
    const { fromKey, toKey } = monthDaysFromLabel(monthLabel)
    if (fromKey && toKey) {
      setDateFrom(fromKey)
      setDateTo(toKey)
    }
  }, [])

  const loadOrdersForRange = useCallback(async (from, to, { force = false } = {}) => {
    if (!from || !to || from > to) {
      setError('Select a valid date range (From ≤ To).')
      setOrderRows([])
      return
    }
    setOrdersLoading(true)
    setError(null)
    try {
      const fetchFrom = orderFetchStart(from, to)
      const orders = await fetchOrderUploadsForDateRange(fetchFrom, to, { force })
      setOrderRows(orders || [])
      setOverallRows(trimOverallRowsForMonth(overallAllRef.current, fetchFrom, to))
    } catch (err) {
      setError(err.message || 'Failed to load orders for date range')
      setOrderRows([])
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (staticLoading || !dateFrom || !dateTo || dateFrom > dateTo) return undefined
    const timer = setTimeout(() => {
      loadOrdersForRange(dateFrom, dateTo)
    }, DATE_LOAD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [dateFrom, dateTo, staticLoading, loadOrdersForRange])

  const refreshAll = useCallback(() => {
    refreshSources()
    loadOrdersForRange(dateFrom, dateTo, { force: true })
  }, [dateFrom, dateTo, loadOrdersForRange, refreshSources])

  const clientOrderRows = useMemo(() => deferredClient === 'All'
    ? orderRows
    : orderRows.filter((row) => normalizeSummaryClient(row.client) === deferredClient),
  [orderRows, deferredClient])

  const riderCityIndex = useMemo(() => buildSourceRiderCityIndex(clientOrderRows, {
    fromKey: dateFrom, toKey: dateTo,
  }), [clientOrderRows, dateFrom, dateTo])

  const baseReport = useMemo(() => {
    if (!dateFrom || !dateTo || dateFrom > dateTo || !clientOrderRows.length) {
      return { month: [], activeSummary: [], windowEnd: '', windowDates: [] }
    }
    return buildFullDataSourceMonthRows(
      clientOrderRows,
      onboardingRows,
      overallRows,
      mappingRows,
      currentRows,
      { fromKey: dateFrom, toKey: dateTo, byClient: viewTab === 'byClient', useLatestClientData, riderCityIndex }
    )
  }, [clientOrderRows, onboardingRows, overallRows, mappingRows, currentRows, dateFrom, dateTo, viewTab, useLatestClientData, riderCityIndex])

  const exportMonthRows = useMemo(
    () =>
      filterSourceMonthRows(baseReport.month, {
        cityFilter: deferredCity,
        clientFilter: viewTab === 'bySource' || deferredClient === 'All' ? 'All' : [deferredClient],
      }),
    [baseReport.month, deferredCity, deferredClient, viewTab]
  )

  const monthRows = useMemo(() => exportMonthRows.filter((row) =>
    isListedSource(sourceIndex, row.City, row.Source)
  ), [exportMonthRows, sourceIndex])

  // Source visibility/search only affects the page. Exports retain every source
  // within the selected dates, city and client, including inactive/unknown ones.
  const exportRows = useMemo(() => [...exportMonthRows].sort((a, b) =>
    compareSourceRows(a, b, sortKey, sortDir)
  ), [exportMonthRows, sortKey, sortDir])

  const filterOptions = useMemo(
    () => collectFullDataFilterOptions(orderRows, overallRows),
    [orderRows, overallRows]
  )

  const cityOptions = useMemo(() => {
    const cities = dedupeCanonicalCities(filterOptions.cities || [])
    return ['All', ...cities]
  }, [filterOptions.cities])

  const clientOptions = useMemo(() => ['All', ...(filterOptions.clients || [])], [filterOptions.clients])

  const sourceOptions = useMemo(() => {
    const sources = new Set()
    for (const row of monthRows) {
      if (row.Source) sources.add(row.Source)
    }
    return ['All', ...[...sources].sort((a, b) => a.localeCompare(b))]
  }, [monthRows])

  useEffect(() => {
    if (cityFilter !== 'All' && cityOptions.length > 1 && !cityOptions.includes(cityFilter)) {
      startTransition(() => setCityFilter('All'))
    }
  }, [cityOptions, cityFilter])

  useEffect(() => {
    if (clientFilter !== 'All' && clientOptions.length > 1 && !clientOptions.includes(clientFilter)) {
      startTransition(() => setClientFilter('All'))
    }
  }, [clientOptions, clientFilter])

  useEffect(() => {
    if (sourceFilter !== 'All' && !sourceOptions.includes(sourceFilter)) {
      startTransition(() => setSourceFilter('All'))
    }
  }, [sourceOptions, sourceFilter])

  const filteredRows = useMemo(() => {
    let rows = monthRows
    if (deferredSource !== 'All') {
      rows = rows.filter((r) => r.Source === deferredSource)
    }
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        String(r.Source || '').toLowerCase().includes(q) ||
        String(r.City || '').toLowerCase().includes(q) ||
        (viewTab === 'byClient' && String(r.Client || '').toLowerCase().includes(q))
    )
  }, [monthRows, deferredSource, deferredSearch, viewTab])

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows]
    rows.sort((a, b) => compareSourceRows(a, b, sortKey, sortDir))
    return rows
  }, [filteredRows, sortKey, sortDir])

  const tableColumns = viewTab === 'byClient' ? TABLE_COLUMNS_BY_CLIENT : TABLE_COLUMNS_BY_SOURCE

  const stats = useMemo(
    () =>
      summarizeSourceMonthRows(sortedRows, {
        windowEnd: baseReport.windowEnd,
        windowDates: baseReport.windowDates,
      }),
    [sortedRows, baseReport.windowEnd, baseReport.windowDates]
  )

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ROWS_PER_PAGE))
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return sortedRows.slice(start, start + ROWS_PER_PAGE)
  }, [sortedRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, cityFilter, clientFilter, sourceFilter, dateFrom, dateTo, orderRows.length, viewTab, sortKey, sortDir, sourceIndex, useLatestClientData])

  const toggleSort = (col) => {
    if (TEXT_COLUMNS.has(col) && col !== 'Active window end') return
    startTransition(() => {
      if (sortKey === col) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
      } else {
        setSortKey(col)
        setSortDir('desc')
      }
    })
  }

  const exportExcel = async () => {
    if (exporting || !exportRows.length || sourcesLoading || sourceError) return
    setExporting(true)
    try {
      const { downloadSourceWiseExcel } = await import('./lib/sourceWiseExcelExport')
      // Build the other view only on download; scrolling/filtering the page
      // still calculates just the currently visible report.
      const reportForView = (byClient) => (byClient === (viewTab === 'byClient'))
        ? baseReport
        : buildFullDataSourceMonthRows(clientOrderRows, onboardingRows, overallRows, mappingRows, currentRows, {
          fromKey: dateFrom, toKey: dateTo, byClient, useLatestClientData, riderCityIndex,
        })
      const clientReport = reportForView(true)
      const sourceReport = reportForView(false)
      const prepareRows = (report) => [...filterSourceMonthRows(report.month, { cityFilter: deferredCity })]
        .sort((a, b) => compareSourceRows(a, b, sortKey, sortDir))
      const clientRows = viewTab === 'byClient' ? exportRows : prepareRows(clientReport)
      const sourceRows = viewTab === 'bySource' ? exportRows : prepareRows(sourceReport)
      const sheets = []
      const withSourceStatus = (rows) => rows.map((row) => ({
        ...row,
        'Source Status': isListedSource(sourceIndex, row.City, row.Source) ? 'Active' : 'In Active',
      }))
      const withStatusColumn = (columns) => columns.flatMap((column) =>
        column === 'City' ? [column, 'Source Status'] : [column]
      )
      for (const [sheetName, rows, columns] of [
        ['Source by Client', clientRows, TABLE_COLUMNS_BY_CLIENT],
        ['Source Total', sourceRows, TABLE_COLUMNS_BY_SOURCE],
      ]) {
        sheets.push({
          name: sheetName, rows: withSourceStatus(rows), headers: withStatusColumn(columns), highlightActiveRiders: true,
        })
      }
      const rawRows = buildFullDataSourceRawOrderRows(clientOrderRows, onboardingRows, overallRows, mappingRows, currentRows, {
        fromKey: dateFrom, toKey: dateTo, byClient: true, summaryRows: clientRows, riderCityIndex,
      })
      sheets.push({ name: 'Raw Orders', rows: withSourceStatus(rawRows), headers: withStatusColumn(SOURCE_RAW_ORDER_COLUMNS) })
      const activeSummary = buildFullDataSourceActiveSummary(sourceRows, {
        windowEnd: sourceReport.windowEnd, windowDates: sourceReport.windowDates, useLatestClientData,
      })
      sheets.push({ name: 'Active Summary', rows: activeSummary })
      const exportClients = new Set(clientRows.map((row) => row.Client))
      const clientWindows = (clientReport.clientWindows || []).filter((row) => exportClients.has(row.Client))
      if (useLatestClientData && clientWindows.length) {
        sheets.push({ name: 'Client Active Windows', rows: clientWindows })
      }
      const suffix = `${dateFrom}_${dateTo}_${cityFilter}_${clientFilter}_All_Sources`.replace(/\s+/g, '_')
      await downloadSourceWiseExcel(sheets, `Source_Wise_Data_${suffix}.xlsx`)
    } catch (err) {
      setError(err.message || 'Failed to export Excel')
    } finally {
      setExporting(false)
    }
  }

  const clientLabel = clientFilter === 'All' ? 'All' : formatClientFilterLabel([clientFilter])

  const onCityChange = (v) => startTransition(() => setCityFilter(v))
  const onClientChange = (v) => startTransition(() => setClientFilter(v))
  const onSourceChange = (v) => startTransition(() => setSourceFilter(v))
  const onSearchChange = (e) => startTransition(() => setSearchTerm(e.target.value))

  return (
    <div className="dashboard-container source-wise-data" style={{ paddingBottom: '2rem' }}>
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem', overflow: 'visible' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={28} style={{ color: 'var(--accent-blue)' }} />
              Source Wise Data
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '820px', fontSize: '0.9rem' }}>
              Source / city / client month summary with active rider counts (4 calendar days before the window end).
              {' '}Only active listed sources appear here. Excel includes all sources with their Source Status.
              {' '}City follows each rider/client’s latest working city in the selected dates.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="glass"
              onClick={refreshAll}
              disabled={loading}
              style={{ padding: '0.45rem 0.75rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {loading ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            <button
              type="button"
              className="glass"
              onClick={exportExcel}
              disabled={exporting || loading || filtersPending || sourcesLoading || !!sourceError || !exportRows.length}
              title={sourceError ? 'Refresh the source list before exporting source statuses' : 'Download both By Client and Source Total sheets for the selected dates, city and client, including all source statuses'}
              style={{ padding: '0.45rem 0.75rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {exporting ? <Loader size={14} className="spin" /> : <Download size={14} />}
              Download Excel
            </button>
          </div>
        </div>
      </header>

      {sourcesLoading && <p role="status">Loading source list...</p>}
      {sourceError && <p role="alert" style={{ color: '#f87171' }}>{sourceError}</p>}

      <div
        className="glass"
        style={{
          padding: '0.85rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'flex-end',
        }}
      >
        <SearchableSelect
          label="Month"
          icon={Calendar}
          options={months}
          value={selectedMonth}
          onChange={onMonthChange}
          minWidth={150}
          searchPlaceholder="Search months…"
        />

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={dateInputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={dateInputStyle}
          />
        </label>

        <SearchableSelect
          label="City"
          icon={MapPin}
          options={cityOptions}
          value={cityFilter}
          onChange={onCityChange}
          minWidth={140}
          searchPlaceholder="Search cities…"
        />

        <SearchableSelect
          label="Client"
          icon={Briefcase}
          options={clientOptions}
          value={clientFilter}
          onChange={onClientChange}
          minWidth={160}
          searchPlaceholder="Search clients…"
        />

        <SearchableSelect
          label="Source"
          icon={Filter}
          options={sourceOptions}
          value={sourceFilter}
          onChange={onSourceChange}
          minWidth={220}
          searchPlaceholder="Search sources…"
        />

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-dim)', flex: '1 1 220px', minWidth: '220px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Search size={13} /> Search
          </span>
          <input
            type="search"
            placeholder={viewTab === 'byClient' ? 'Source, city, client…' : 'Source, city…'}
            value={searchTerm}
            onChange={onSearchChange}
            style={{ ...selectStyle, width: '100%' }}
          />
        </label>
      </div>

      <div className="glass" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          type="button"
          role="switch"
          aria-checked={useLatestClientData}
          aria-label="Use latest available data per client"
          aria-describedby="source-wise-activity-help"
          onClick={() => setUseLatestClientData((enabled) => !enabled)}
          style={{
            width: '42px', height: '24px', borderRadius: '12px', padding: '3px', flexShrink: 0,
            border: '1px solid var(--border-color)', cursor: 'pointer',
            background: useLatestClientData ? '#2563eb' : '#475569',
          }}
        >
          <span aria-hidden="true" style={{
            display: 'block', width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
            transform: useLatestClientData ? 'translateX(18px)' : 'translateX(0)', transition: 'transform 0.15s',
          }} />
        </button>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Use latest available data per client: {useLatestClientData ? 'On' : 'Off'}
          </div>
          <p id="source-wise-activity-help" style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            {useLatestClientData
              ? 'Active and 0-order riders use the 4 days before each client’s latest uploaded order date, up to To / yesterday. Example: Amazon last date 23rd uses 19th–22nd. Order and earning totals follow From / To.'
              : 'Active and 0-order riders use the same 4 days before To (capped at yesterday) for all clients.'}
          </p>
        </div>
      </div>

      {error && (
        <div
          className="glass"
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            color: '#fca5a5',
            background: 'rgba(239,68,68,0.12)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {!loading && sortedRows.length > 0 && (
        <>
          <button
            type="button"
            className="glass"
            aria-expanded={showSummaryCards}
            aria-controls="source-wise-summary-cards"
            onClick={() => setShowSummaryCards((visible) => !visible)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', color: '#fff', cursor: 'pointer' }}
          >
            <ChevronDown size={16} aria-hidden="true" style={{ transform: showSummaryCards ? 'rotate(180deg)' : undefined }} />
            {showSummaryCards ? 'Hide summary cards' : 'Show summary cards'}
          </button>
          <div id="source-wise-summary-cards" hidden={!showSummaryCards}>
          {(useLatestClientData || (stats.windowEnd && stats.windowDates?.length > 0)) && (
            <div
              className="glass"
              style={{
                marginBottom: '0.75rem',
                padding: '0.55rem 0.85rem',
                fontSize: '0.78rem',
                color: 'var(--text-dim)',
              }}
            >
              {useLatestClientData ? (
                <>Active riders use each client’s latest available date. See <strong style={{ color: '#fff' }}>Active window end / dates</strong> in the table; Source Total combines the client windows.</>
              ) : (
                <>Active riders use the <strong style={{ color: '#fff' }}>4 days before To ({stats.windowEnd})</strong>: {stats.windowDates.join(', ')}</>
              )}
            </div>
          )}
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <div className="stat-card glass">
              <span className="label">Unique Riders (filtered)</span>
              <span className="value">{stats.uniqueRiders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">Active Riders (last 4 days)</span>
              <span className="value" style={{ color: '#4ade80' }}>
                {stats.activeRiders.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="stat-card glass">
              <span className="label">Active EV Riders</span>
              <span className="value">{stats.activeEvRiders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">Active Non-EV Riders</span>
              <span className="value">{stats.activeNonEvRiders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">0-order Riders (last 4 days)</span>
              <span className="value" style={{ color: '#fbbf24' }}>
                {stats.zeroOrderRiders.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="stat-card glass">
              <span className="label">Total Orders (filtered)</span>
              <span className="value">{stats.totalOrders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">EV Orders</span>
              <span className="value">{stats.evOrders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">Non-EV Orders</span>
              <span className="value">{stats.nonEvOrders.toLocaleString('en-IN')}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">Total Earning (filtered)</span>
              <span className="value" style={{ color: '#4ade80' }}>₹{formatMoney(stats.earning)}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">EV Earning</span>
              <span className="value">₹{formatMoney(stats.evEarning)}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">Non-EV Earning</span>
              <span className="value">₹{formatMoney(stats.nonEarning)}</span>
            </div>
            <div className="stat-card glass">
              <span className="label">MF Amount (filtered)</span>
              <span className="value" style={{ color: '#93c5fd' }}>₹{formatMoney(stats.mfAmount)}</span>
            </div>
          </div>
          </div>
        </>
      )}

      <div
        className="table-card glass rp-table-wrap"
        style={{ marginBottom: 0, opacity: filtersPending ? 0.72 : 1, transition: 'opacity 0.15s' }}
      >
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
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            {dateFrom && dateTo ? (
              <>
                {format(new Date(`${dateFrom}T12:00:00`), 'dd MMM yyyy')} –{' '}
                {format(new Date(`${dateTo}T12:00:00`), 'dd MMM yyyy')} · City: {cityFilter}
                {` · Client: ${clientLabel}`}
                {viewTab === 'bySource' ? ' · Rolled up by source' : ''}
                {' · Source: '}
                {sourceFilter} · {sortedRows.length.toLocaleString('en-IN')} rows
                {ordersLoading ? ' · Loading orders…' : ''}
              </>
            ) : (
              'Select a date range'
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="glass"
              onClick={() => setViewTab('byClient')}
              style={{
                padding: '0.4rem 0.7rem',
                color: '#fff',
                cursor: 'pointer',
                border:
                  viewTab === 'byClient'
                    ? '1px solid rgba(147,197,253,0.55)'
                    : '1px solid var(--border-color)',
                background: viewTab === 'byClient' ? 'rgba(59,130,246,0.2)' : undefined,
                fontSize: '0.78rem',
              }}
            >
              By Client
            </button>
            <button
              type="button"
              className="glass"
              onClick={() => setViewTab('bySource')}
              style={{
                padding: '0.4rem 0.7rem',
                color: '#fff',
                cursor: 'pointer',
                border:
                  viewTab === 'bySource'
                    ? '1px solid rgba(147,197,253,0.55)'
                    : '1px solid var(--border-color)',
                background: viewTab === 'bySource' ? 'rgba(59,130,246,0.2)' : undefined,
                fontSize: '0.78rem',
              }}
            >
              Source Total
            </button>
          </div>
        </div>

        {loading && !orderRows.length ? (
          <div className="loading-container" style={{ minHeight: '280px' }}>
            <span className="loader" />
          </div>
        ) : (
          <>
            <div
              className="rp-table-scroll full-data-sheet"
              style={{
                maxHeight: 'calc(100vh - 480px)',
                overflow: 'auto',
                background: '#ffffff',
              }}
            >
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
                    {tableColumns.map((col) => {
                      const isSortable = !TEXT_COLUMNS.has(col) || col === 'Active window end'
                      const isActive = sortKey === col
                      return (
                      <th
                        key={col}
                        onClick={isSortable ? () => toggleSort(col) : undefined}
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 2,
                          background: isActive ? '#cbd5e1' : '#e2e8f0',
                          color: '#0f172a',
                          padding: '0.45rem 0.55rem',
                          whiteSpace: 'nowrap',
                          textAlign: TEXT_COLUMNS.has(col) ? 'left' : 'right',
                          borderBottom: '1px solid #cbd5e1',
                          cursor: isSortable ? 'pointer' : 'default',
                          userSelect: 'none',
                        }}
                        title={isSortable ? 'Click to sort' : undefined}
                      >
                        {col}
                        {isActive ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                      </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, idx) => (
                    <tr key={`${row.Source}-${row.City}-${row.Client || ''}-${idx}`}>
                      {tableColumns.map((col) => (
                        <td
                          key={col}
                          style={{
                            padding: '0.4rem 0.55rem',
                            whiteSpace: 'nowrap',
                            textAlign: TEXT_COLUMNS.has(col) ? 'left' : 'right',
                            borderBottom: '1px solid #e2e8f0',
                            background: idx % 2 ? '#f8fafc' : '#ffffff',
                          }}
                        >
                          {formatCell(col, row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sortedRows.length && !ordersLoading && (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  No source-wise rows for this range / filters.
                </div>
              )}
            </div>

            {sortedRows.length > ROWS_PER_PAGE ? (
              <div className="rp-table-footer">
                <span style={{ color: 'var(--text-dim)' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="glass"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    style={{ padding: '0.35rem 0.65rem', color: '#fff' }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="glass"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    style={{ padding: '0.35rem 0.65rem', color: '#fff' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
