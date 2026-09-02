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
import * as XLSX from 'xlsx'
import { fetchOrderUploadMonths, fetchOrderUploadsForDateRange } from './lib/orderUploadDb'
import { fetchEv91OverallStatusAll, fetchEv91CurrentStatusAll } from './lib/ev91EvLookup'
import {
  buildFullDataSourceMonthRows,
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

const ROWS_PER_PAGE = 50
const DATE_LOAD_DEBOUNCE_MS = 350
const ACTIVE_LOOKBACK_DAYS = 4

function orderFetchStart(fromKey, toKey) {
  if (!toKey) return fromKey
  const lookback = format(subDays(parseISO(toKey), ACTIVE_LOOKBACK_DAYS), 'yyyy-MM-dd')
  if (!fromKey || lookback < fromKey) return lookback
  return fromKey
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
  'Active window end',
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
  'Active window end',
  'Total Order',
  'EV Order',
  'Non-EV Order',
  'Earning',
  'EV Earning',
  'Non Earning',
  'MF Amount',
]

const MONEY_COLUMNS = new Set(['Earning', 'EV Earning', 'Non Earning', 'MF Amount'])

const TEXT_COLUMNS = new Set(['Source', 'City', 'Client', 'Active window end'])

const DEFAULT_SORT_KEY = 'Unique Rider Count'

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
      return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    return value.toLocaleString('en-IN')
  }
  return String(value)
}

function formatMoney(value) {
  return (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
    setMenuStyle({
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      maxHeight: Math.max(160, maxHeight),
      zIndex: 10050,
    })
  }, [minWidth])

  useEffect(() => {
    if (!isOpen) return undefined
    updateMenuPosition()
    const onScrollOrResize = () => updateMenuPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
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
  const [months, setMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [sourceFilter, setSourceFilter] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewTab, setViewTab] = useState('byClient')
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
    loadOrdersForRange(dateFrom, dateTo, { force: true })
  }, [dateFrom, dateTo, loadOrdersForRange])

  const baseReport = useMemo(() => {
    if (!dateFrom || !dateTo || dateFrom > dateTo || !orderRows.length) {
      return { month: [], activeSummary: [], windowEnd: '', windowDates: [] }
    }
    return buildFullDataSourceMonthRows(
      orderRows,
      onboardingRows,
      overallRows,
      mappingRows,
      currentRows,
      { fromKey: dateFrom, toKey: dateTo, byClient: viewTab === 'byClient' }
    )
  }, [orderRows, onboardingRows, overallRows, mappingRows, currentRows, dateFrom, dateTo, viewTab])

  const clientFilterArg = viewTab === 'bySource' ? 'All' : deferredClient === 'All' ? 'All' : [deferredClient]

  const monthRows = useMemo(
    () =>
      filterSourceMonthRows(baseReport.month, {
        cityFilter: deferredCity,
        clientFilter: clientFilterArg,
      }),
    [baseReport.month, deferredCity, clientFilterArg]
  )

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
    if (sourceFilter !== 'All' && sourceOptions.length > 1 && !sourceOptions.includes(sourceFilter)) {
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
  }, [searchTerm, cityFilter, clientFilter, sourceFilter, dateFrom, dateTo, orderRows.length, viewTab, sortKey, sortDir])

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

  const exportExcel = () => {
    if (!sortedRows.length) return
    setExporting(true)
    try {
      const wb = XLSX.utils.book_new()
      const sheetName = viewTab === 'byClient' ? 'Source by Client' : 'Source Total'
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sortedRows), sheetName)
      if (baseReport.activeSummary?.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(baseReport.activeSummary), 'Active Summary')
      }
      const suffix = `${dateFrom}_${dateTo}_${cityFilter}_${clientFilter}_${sourceFilter}`.replace(/\s+/g, '_')
      XLSX.writeFile(wb, `Source_Wise_Data_${suffix}.xlsx`)
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
    <div className="dashboard-container" style={{ paddingBottom: '2rem' }}>
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem', overflow: 'visible' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={28} style={{ color: 'var(--accent-blue)' }} />
              Source Wise Data
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '820px', fontSize: '0.9rem' }}>
              Source / city / client month summary with active rider counts (last 4 order days).
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
              disabled={exporting || loading || !sortedRows.length}
              style={{ padding: '0.45rem 0.75rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              {exporting ? <Loader size={14} className="spin" /> : <Download size={14} />}
              Download Excel
            </button>
          </div>
        </div>
      </header>

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

        {viewTab === 'byClient' && (
          <SearchableSelect
            label="Client"
            icon={Briefcase}
            options={clientOptions}
            value={clientFilter}
            onChange={onClientChange}
            minWidth={160}
            searchPlaceholder="Search clients…"
          />
        )}

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
          {stats.windowEnd && stats.windowDates?.length > 0 && (
            <div
              className="glass"
              style={{
                marginBottom: '0.75rem',
                padding: '0.55rem 0.85rem',
                fontSize: '0.78rem',
                color: 'var(--text-dim)',
              }}
            >
              Active riders use the <strong style={{ color: '#fff' }}>4 days before To ({stats.windowEnd})</strong>
              : {stats.windowDates.join(', ')}
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
                {viewTab === 'byClient' ? ` · Client: ${clientLabel}` : ' · All clients rolled up'}
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
