import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, startTransition, memo, useRef } from 'react'
import { History, MapPin, Briefcase, Search, Download, ArrowDownLeft, Wallet, Receipt, MinusCircle, Zap, Shield, Users, Trophy, Calendar, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchAllRiderPayments } from './lib/riderPaymentDb'
import { fetchFleetRiderLookupRows } from './lib/fleetSdFetch'
import {
  buildPaymentHistoryReport,
  filterPaymentHistory,
  formatInr,
  PAYMENT_DEDUCTION_COLUMNS,
  summarizePaymentHistory,
  buildSourceRevenueReport,
  buildSourceClientPivotSheets,
  buildSourceRevenueFlatRows,
  buildSourceDetailExportRows,
  buildTopPerformersReport,
  filterRiderHistoryForPeriod,
} from './lib/paymentHistoryReport'

const ROWS_PER_PAGE = 100
const TABLE_COLUMN_COUNT = 11 + PAYMENT_DEDUCTION_COLUMNS.length

const PaymentHistoryRow = memo(function PaymentHistoryRow({ row }) {
  return (
    <tr>
      <td>
        <span className="status-badge" style={{ fontSize: '0.7rem' }}>
          {row.type || 'Payment'}
        </span>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{row.riderName}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{row.riderId}</div>
      </td>
      <td>{row.riderPhone || '—'}</td>
      <td>
        <div>{row.month || '—'}</div>
        {row.week ? <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>W{row.week}</div> : null}
      </td>
      <td>{row.city}</td>
      <td>{row.client}</td>
      <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{formatInr(row.moneyIn)}</td>
      <td>{formatInr(row.finalNetPayout)}</td>
      {PAYMENT_DEDUCTION_COLUMNS.map((col) => (
        <td key={col.key}>{formatInr(row[col.key])}</td>
      ))}
      <td style={{ fontWeight: 600, color: '#f87171' }}>{formatInr(row.deductionsOut)}</td>
      <td>{row.vehicleNumber || '—'}</td>
      <td>
        <div>{row.paymentStatus || '—'}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{row.paymentDate || row.transactionDate}</div>
        {row.utr ? <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{row.utr}</div> : null}
      </td>
    </tr>
  )
})

function StatCard({ label, value, icon: Icon, color = 'var(--accent-blue)', iconBg = 'rgba(56, 189, 248, 0.12)' }) {
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

function SummaryTable({ title, rows, icon: Icon }) {
  return (
    <div className="glass" style={{ padding: '1rem', flex: 1, minWidth: '320px' }}>
      <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
        <Icon size={18} />
        {title}
        <span className="status-badge" style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </h3>
      <div className="table-container" style={{ maxHeight: '300px' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Rows</th>
              <th>Riders</th>
              <th>Money In</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.rows}</td>
                  <td>{row.riders}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{formatInr(row.totalIn)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PaymentHistory({ onboardingData = [] }) {
  const [activeTab, setActiveTab] = useState('payments')
  const [paymentRows, setPaymentRows] = useState([])
  const [fleetLookupRows, setFleetLookupRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [fleetLookupLoading, setFleetLookupLoading] = useState(true)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const deferredFleetLookup = useDeferredValue(fleetLookupRows)
  const deferredOnboarding = useDeferredValue(onboardingData)
  const [selectedCities, setSelectedCities] = useState([])
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedMonths, setSelectedMonths] = useState([])
  const [sourceMonth, setSourceMonth] = useState('')
  const [sourceCity, setSourceCity] = useState('')
  const [topMonths, setTopMonths] = useState([])
  const [topCities, setTopCities] = useState([])
  const [topSearch, setTopSearch] = useState('')
  const deferredTopMonths = useDeferredValue(topMonths)
  const deferredTopCities = useDeferredValue(topCities)
  const deferredTopSearch = useDeferredValue(topSearch)
  const [selectedTopRider, setSelectedTopRider] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const deferredCities = useDeferredValue(selectedCities)
  const deferredClients = useDeferredValue(selectedClients)
  const deferredMonths = useDeferredValue(selectedMonths)

  // Payments first (blocks spinner). Fleet lookup deferred so first paint is faster.
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchAllRiderPayments()
      .then((payments) => {
        if (cancelled) return
        setPaymentRows(payments)
      })
      .catch(() => {
        if (!cancelled) setPaymentRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'payments') return undefined
    let cancelled = false
    setFleetLookupLoading(true)

    const timer = window.setTimeout(() => {
      fetchFleetRiderLookupRows()
        .then((rows) => {
          if (!cancelled) startTransition(() => setFleetLookupRows(rows || []))
        })
        .catch(() => {
          if (!cancelled) startTransition(() => setFleetLookupRows([]))
        })
        .finally(() => {
          if (!cancelled) setFleetLookupLoading(false)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeTab])

  // Fast report (no fleet) — enough for Source / Top / filters
  const reportBase = useMemo(() => {
    if (!paymentRows.length) return { rows: [] }
    return buildPaymentHistoryReport(paymentRows, [], [], deferredOnboarding, {
      includeFleetLookup: false,
    })
  }, [paymentRows, deferredOnboarding])

  // Fleet-enriched report only on Payment rows tab (vehicle/phone)
  const reportEnriched = useMemo(() => {
    if (activeTab !== 'payments' || !paymentRows.length || !deferredFleetLookup.length) return null
    return buildPaymentHistoryReport(paymentRows, [], deferredFleetLookup, deferredOnboarding, {
      includeFleetLookup: true,
    })
  }, [activeTab, paymentRows, deferredFleetLookup, deferredOnboarding])

  const report = reportEnriched || reportBase

  const filterOptions = useMemo(() => {
    const cities = new Set()
    const clients = new Set()
    const months = new Set()
    for (const r of reportBase.rows) {
      if (r.city && r.city !== 'Unknown') cities.add(r.city)
      if (r.client && r.client !== 'Unknown') clients.add(r.client)
      if (r.month) months.add(r.month)
    }
    return {
      cities: [...cities].sort(),
      clients: [...clients].sort(),
      months: [...months].sort().reverse(),
    }
  }, [reportBase.rows])

  const filtered = useMemo(
    () =>
      filterPaymentHistory(report.rows, {
        search: deferredSearch,
        cities: deferredCities,
        clients: deferredClients,
        months: deferredMonths,
      }),
    [report.rows, deferredSearch, deferredCities, deferredClients, deferredMonths]
  )

  const citySummary = useMemo(
    () => (activeTab === 'payments' ? summarizePaymentHistory(filtered, 'city') : []),
    [activeTab, filtered]
  )
  const clientSummary = useMemo(
    () => (activeTab === 'payments' ? summarizePaymentHistory(filtered, 'client') : []),
    [activeTab, filtered]
  )

  const cityOptions = filterOptions.cities
  const clientOptions = filterOptions.clients
  const monthOptions = filterOptions.months

  useEffect(() => {
    if (!sourceMonth && monthOptions.length) {
      setSourceMonth(monthOptions[0])
    }
  }, [monthOptions, sourceMonth])

  useEffect(() => {
    setSelectedTopRider(null)
  }, [topMonths, topCities])

  const sourceReport = useMemo(() => {
    if (activeTab !== 'source') {
      return { groups: [], totals: { riders: 0, orders: 0, grossPayout: 0, paymentRows: 0, groups: 0 } }
    }
    return buildSourceRevenueReport(reportBase.rows, { month: sourceMonth, city: sourceCity })
  }, [activeTab, reportBase.rows, sourceMonth, sourceCity])

  const sourceRevenueRows = sourceReport.groups
  const sourceTotals = sourceReport.totals

  const topFilterLabel = useMemo(() => {
    const monthPart = deferredTopMonths.length ? deferredTopMonths.join(', ') : 'All months'
    const cityPart = deferredTopCities.length ? deferredTopCities.join(', ') : 'All cities'
    return `${cityPart} · ${monthPart}`
  }, [deferredTopMonths, deferredTopCities])

  const topReport = useMemo(() => {
    if (activeTab !== 'top') {
      return {
        byMoneyIn: [],
        byOrders: [],
        totals: { riders: 0, orders: 0, moneyIn: 0, paymentRows: 0 },
      }
    }
    return buildTopPerformersReport(reportBase.rows, {
      months: deferredTopMonths,
      cities: deferredTopCities,
      limit: 10,
    })
  }, [activeTab, reportBase.rows, deferredTopMonths, deferredTopCities])

  const filteredTopByMoneyIn = useMemo(
    () => filterTopPerformerRows(topReport.byMoneyIn, deferredTopSearch),
    [topReport.byMoneyIn, deferredTopSearch]
  )
  const filteredTopByOrders = useMemo(
    () => filterTopPerformerRows(topReport.byOrders, deferredTopSearch),
    [topReport.byOrders, deferredTopSearch]
  )

  const topRiderHistory = useMemo(() => {
    if (activeTab !== 'top' || !selectedTopRider) return []
    const rows = filterRiderHistoryForPeriod(reportBase.rows, {
      months: deferredTopMonths,
      cities: deferredTopCities,
      riderId: selectedTopRider.riderId,
      riderKey: selectedTopRider.key,
    })
    const q = deferredTopSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        String(r.riderId || '').toLowerCase().includes(q) ||
        String(r.riderName || '').toLowerCase().includes(q) ||
        String(r.riderPhone || '').toLowerCase().includes(q) ||
        String(r.client || '').toLowerCase().includes(q) ||
        String(r.city || '').toLowerCase().includes(q) ||
        String(r.month || '').toLowerCase().includes(q) ||
        String(r.vehicleNumber || '').toLowerCase().includes(q)
    )
  }, [activeTab, reportBase.rows, selectedTopRider, deferredTopMonths, deferredTopCities, deferredTopSearch])

  const totals = useMemo(() => {
    if (activeTab !== 'payments') {
      return { moneyIn: 0, netPayout: 0, totalDed: 0, evRent: 0, codDed: 0, sdDed: 0, rows: 0, riders: 0 }
    }
    let moneyIn = 0
    let netPayout = 0
    let totalDed = 0
    let evRent = 0
    let codDed = 0
    let sdDed = 0
    const riders = new Set()

    for (const r of filtered) {
      moneyIn += r.moneyIn
      netPayout += r.finalNetPayout
      totalDed += r.deductionsOut
      evRent += r.evRent
      codDed += r.codDeduction
      sdDed += r.sdDeduction
      if (r.riderId) riders.add(r.riderId)
    }

    return { moneyIn, netPayout, totalDed, evRent, codDed, sdDed, rows: filtered.length, riders: riders.size }
  }, [activeTab, filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedCities, selectedClients, selectedMonths])

  const exportPaymentRows = useCallback(() => {
    const rows = filtered.map((r) => {
      const base = {
        Type: r.type || 'Payment',
        'Rider ID': r.riderId,
        'Rider Name': r.riderName,
        Phone: r.riderPhone,
        City: r.city,
        Client: r.client,
        Month: r.month,
        Week: r.week,
        'Gross Payout': r.grossPayout,
        'Final Net Payout': r.finalNetPayout,
        'COD Recovery': r.codRecovery,
      }
      for (const col of PAYMENT_DEDUCTION_COLUMNS) {
        base[col.label] = r[col.key]
      }
      return {
        ...base,
        'Total Deductions': r.deductionsOut,
        Vehicle: r.vehicleNumber,
        'Money In': r.moneyIn,
        'Payment Status': r.paymentStatus,
        'Payment Date': r.paymentDate,
        UTR: r.utr,
        'Transaction Particulars': r.transactionParticulars,
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Payment History')
    XLSX.writeFile(wb, `Payment_History_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filtered])

  const sourceExportFilters = useCallback(() => {
    if (!sourceMonth) {
      window.alert('Please select a month before exporting.')
      return null
    }
    return { month: sourceMonth, city: sourceCity }
  }, [sourceMonth, sourceCity])

  const sourceFileSuffix = useCallback(() => {
    const cityPart = sourceCity ? sourceCity.replace(/\s+/g, '_') : 'All_Cities'
    return `${sourceMonth}_${cityPart}_${new Date().toISOString().slice(0, 10)}`
  }, [sourceMonth, sourceCity])

  const exportSourceRevenue = useCallback(() => {
    const filters = sourceExportFilters()
    if (!filters) return
    const rows = buildSourceRevenueFlatRows(report.rows, filters)
    if (!rows.length) {
      window.alert('No payment data to export for the selected month and city.')
      return
    }
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Source Revenue')
    XLSX.writeFile(wb, `Source_Revenue_${sourceFileSuffix()}.xlsx`)
  }, [report.rows, sourceExportFilters, sourceFileSuffix])

  const exportSourceClientSummary = useCallback(() => {
    const filters = sourceExportFilters()
    if (!filters) return
    const sheets = buildSourceClientPivotSheets(report.rows, filters)
    if (!sheets.length) {
      window.alert('No payment data to export for the selected month and city.')
      return
    }
    const wb = XLSX.utils.book_new()
    for (const { aoa, merges, sheetName } of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      if (merges?.length) ws['!merges'] = merges
      const safeName = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Summary'
      XLSX.utils.book_append_sheet(wb, ws, safeName)
    }
    XLSX.writeFile(wb, `Source_Client_Summary_${sourceFileSuffix()}.xlsx`)
  }, [report.rows, sourceExportFilters, sourceFileSuffix])

  const exportSourceDetail = useCallback(() => {
    const filters = sourceExportFilters()
    if (!filters) return
    const rows = buildSourceDetailExportRows(report.rows, filters)
    if (!rows.length) {
      window.alert('No payment data to export for the selected month and city.')
      return
    }
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rider Detail')
    XLSX.writeFile(wb, `Source_Rider_Detail_${sourceFileSuffix()}.xlsx`)
  }, [report.rows, sourceExportFilters, sourceFileSuffix])

  const exportTopPerformers = useCallback(() => {
    if (!topReport.byMoneyIn.length && !topReport.byOrders.length) {
      window.alert('No top performer data for the selected filters.')
      return
    }
    const cityLabel = topCities.length ? topCities.join(', ') : 'All cities'
    const monthLabel = topMonths.length ? topMonths.join(', ') : 'All months'
    const toSheetRows = (list) =>
      list.map((r) => ({
        City: cityLabel,
        Month: monthLabel,
        Rank: r.rank,
        'Rider ID': r.riderId || '',
        'Rider Name': r.riderName,
        Phone: r.phone || '',
        Client: r.client || '',
        Orders: r.orders,
        'Money In': r.moneyIn,
        'Payment Rows': r.paymentRows,
      }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toSheetRows(topReport.byMoneyIn)), 'Top Money In')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toSheetRows(topReport.byOrders)), 'Top Orders')
    const cityPart = topCities.length ? topCities.join('_').replace(/\s+/g, '_') : 'All_Cities'
    const monthPart = topMonths.length ? topMonths.join('_').replace(/\s+/g, '_') : 'All_Months'
    XLSX.writeFile(wb, `Top_Performers_${cityPart}_${monthPart}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [topMonths, topCities, topReport])

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <History size={28} style={{ color: 'var(--accent-blue)' }} />
            <div>
              <h1 style={{ margin: 0 }}>Payment History</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Rider payment history, source revenue & city top performers
              </p>
            </div>
          </div>
          {activeTab === 'payments' ? (
            <button type="button" onClick={exportPaymentRows} className="glass" style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}>
              <Download size={18} />
              Export Excel
            </button>
          ) : activeTab === 'top' ? (
            <button
              type="button"
              onClick={exportTopPerformers}
              className="glass"
              style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}
            >
              <Download size={18} />
              Export Top 10
            </button>
          ) : null}
        </div>
      </header>

      <div className="fdv-tabs" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`fdv-tab ${activeTab === 'payments' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          Payment rows
        </button>
        <button
          type="button"
          className={`fdv-tab ${activeTab === 'source' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('source')}
        >
          Source revenue
        </button>
        <button
          type="button"
          className={`fdv-tab ${activeTab === 'top' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('top')}
        >
          Top performers
        </button>
      </div>

      {activeTab === 'payments' ? (
        <>
      <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="Money In" value={formatInr(totals.moneyIn)} icon={ArrowDownLeft} color="#4ade80" iconBg="rgba(74, 222, 128, 0.12)" />
        <StatCard label="Net Payout" value={formatInr(totals.netPayout)} icon={Wallet} color="var(--accent-blue)" iconBg="rgba(56, 189, 248, 0.12)" />
        <StatCard label="Total Ded." value={formatInr(totals.totalDed)} icon={MinusCircle} color="#f87171" iconBg="rgba(248, 113, 113, 0.12)" />
        <StatCard label="EV Rent" value={formatInr(totals.evRent)} icon={Zap} color="#fbbf24" iconBg="rgba(251, 191, 36, 0.12)" />
        <StatCard label="COD Ded." value={formatInr(totals.codDed)} icon={Receipt} color="#fb923c" iconBg="rgba(251, 146, 60, 0.12)" />
        <StatCard label="SD" value={formatInr(totals.sdDed)} icon={Shield} color="#a78bfa" iconBg="rgba(167, 139, 250, 0.12)" />
      </section>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div className="status-badge" style={{ padding: '0.5rem 0.9rem' }}>
          {totals.rows} rows · {totals.riders} riders
        </div>
        {search !== deferredSearch && (
          <div className="status-badge" style={{ padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
            Filtering…
          </div>
        )}
        {(deferredCities !== selectedCities || deferredClients !== selectedClients || deferredMonths !== selectedMonths) && (
          <div className="status-badge" style={{ padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
            Updating filters…
          </div>
        )}
        {fleetLookupLoading && (
          <div className="status-badge" style={{ padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
            Loading vehicle & phone…
          </div>
        )}
      </div>

      <div className="filter-bar glass" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <select
          value={selectedCities[0] || ''}
          onChange={(e) => setSelectedCities(e.target.value ? [e.target.value] : [])}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={selectedClients[0] || ''}
          onChange={(e) => setSelectedClients(e.target.value ? [e.target.value] : [])}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All clients</option>
          {clientOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={selectedMonths[0] || ''}
          onChange={(e) => setSelectedMonths(e.target.value ? [e.target.value] : [])}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All months</option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search rider, phone, city, client, UTR, vehicle..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <SummaryTable title="City wise payment" rows={citySummary} icon={MapPin} />
        <SummaryTable title="Client wise payment" rows={clientSummary} icon={Briefcase} />
      </div>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Rider</th>
                <th>Phone</th>
                <th>Month</th>
                <th>City</th>
                <th>Client</th>
                <th>Money In</th>
                <th>Net Payout</th>
                {PAYMENT_DEDUCTION_COLUMNS.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
                <th>Total Ded.</th>
                <th>Vehicle</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length ? (
                paginated.map((r) => <PaymentHistoryRow key={r.rowKey} row={r} />)
              ) : (
                <tr>
                  <td colSpan={TABLE_COLUMN_COUNT} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No payment history. Upload data on Payment Upload page first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {filtered.length} rows · {paymentRows.length} payment records
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" className="glass-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>Prev</button>
            <span style={{ fontSize: '0.85rem' }}>{currentPage} / {totalPages}</span>
            <button type="button" className="glass-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </div>
        </>
      ) : activeTab === 'source' ? (
        <>
          <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
            <StatCard label="Unique Riders" value={sourceTotals.riders.toLocaleString()} icon={Users} color="#a78bfa" iconBg="rgba(167, 139, 250, 0.12)" />
            <StatCard label="Total Orders" value={sourceTotals.orders.toLocaleString()} icon={Receipt} color="var(--accent-blue)" iconBg="rgba(56, 189, 248, 0.12)" />
            <StatCard label="Gross Payout" value={formatInr(sourceTotals.grossPayout)} icon={ArrowDownLeft} color="#4ade80" iconBg="rgba(74, 222, 128, 0.12)" />
            <StatCard label="Source groups" value={sourceTotals.groups.toLocaleString()} icon={Briefcase} color="#fbbf24" iconBg="rgba(251, 191, 36, 0.12)" />
          </section>

          <div className="filter-bar glass" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Month
              <select
                className="fsr-select"
                value={sourceMonth}
                onChange={(e) => setSourceMonth(e.target.value)}
                style={{ minWidth: '150px' }}
              >
                <option value="">Select month</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              City
              <select
                className="fsr-select"
                value={sourceCity}
                onChange={(e) => setSourceCity(e.target.value)}
                style={{ minWidth: '150px' }}
              >
                <option value="">All cities</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="rp-ev-action-buttons" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
              <button type="button" className="fsr-export-btn" onClick={exportSourceRevenue} disabled={!sourceMonth}>
                <Download size={14} /> Source revenue
              </button>
              <button type="button" className="fsr-export-btn" onClick={exportSourceClientSummary} disabled={!sourceMonth}>
                <Download size={14} /> Source × Client
              </button>
              <button type="button" className="fsr-export-btn" onClick={exportSourceDetail} disabled={!sourceMonth}>
                <Download size={14} /> Rider detail
              </button>
            </div>
          </div>

          <div className="table-card glass">
            <div className="table-container" style={{ maxHeight: 'calc(100vh - 380px)' }}>
              <table>
                <thead>
                  <tr>
                    <th>City</th>
                    <th>Source</th>
                    <th>Unique Riders</th>
                    <th>Orders</th>
                    <th>Gross Payout</th>
                    <th>Payment Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {!sourceMonth ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                        Select a month to view source-wise revenue.
                      </td>
                    </tr>
                  ) : sourceRevenueRows.length ? (
                    sourceRevenueRows.map((row) => (
                      <tr key={`${row.city}-${row.source}`}>
                        <td>{row.city}</td>
                        <td>{row.source}</td>
                        <td>{row.riders.toLocaleString()}</td>
                        <td>{row.orders.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{formatInr(row.grossPayout)}</td>
                        <td>{row.paymentRows.toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                        No payment data for this month{cityLabel(sourceCity)}.
                      </td>
                    </tr>
                  )}
                </tbody>
                {sourceRevenueRows.length > 0 && (
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-color)' }}>
                      <td colSpan={2}>Total</td>
                      <td>{sourceTotals.riders.toLocaleString()}</td>
                      <td>{sourceTotals.orders.toLocaleString()}</td>
                      <td style={{ color: 'var(--accent-green)' }}>{formatInr(sourceTotals.grossPayout)}</td>
                      <td>{sourceTotals.paymentRows.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
            <StatCard label="Riders" value={topReport.totals.riders.toLocaleString()} icon={Users} color="#a78bfa" iconBg="rgba(167, 139, 250, 0.12)" />
            <StatCard label="Total Orders" value={topReport.totals.orders.toLocaleString()} icon={Receipt} color="var(--accent-blue)" iconBg="rgba(56, 189, 248, 0.12)" />
            <StatCard label="Money In" value={formatInr(topReport.totals.moneyIn)} icon={ArrowDownLeft} color="#4ade80" iconBg="rgba(74, 222, 128, 0.12)" />
            <StatCard label="Payment Rows" value={topReport.totals.paymentRows.toLocaleString()} icon={Trophy} color="#fbbf24" iconBg="rgba(251, 191, 36, 0.12)" />
          </section>

          <div
            className="filter-bar glass"
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              padding: '0.75rem',
              marginBottom: '1rem',
              alignItems: 'center',
              position: 'relative',
              zIndex: 50,
              overflow: 'visible',
            }}
          >
            <TopCheckboxSelect
              label="Month"
              options={monthOptions}
              selected={topMonths}
              onChange={setTopMonths}
              emptyLabel="All months"
              icon={Calendar}
            />
            <TopCheckboxSelect
              label="City"
              options={cityOptions}
              selected={topCities}
              onChange={setTopCities}
              emptyLabel="All cities"
              icon={MapPin}
            />
            <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Search rider ID, name, phone, client…"
                value={topSearch}
                onChange={(e) => setTopSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem 0.55rem 2.25rem',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: '#fff',
                  outline: 'none',
                }}
              />
            </div>
            <div className="status-badge" style={{ padding: '0.5rem 0.9rem' }}>
              {!topMonths.length && !topCities.length
                ? 'Overall top riders (all cities · all months)'
                : `Top 10 · ${topFilterLabel}`}
            </div>
            {(topMonths.length > 0 || topCities.length > 0 || topSearch) && (
              <button
                type="button"
                className="glass-btn"
                style={{ fontSize: '0.75rem' }}
                onClick={() => {
                  setTopMonths([])
                  setTopCities([])
                  setTopSearch('')
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <TopPerformersTable
                  title="Top 10 by Money In"
                  rows={filteredTopByMoneyIn}
                  selectedKey={selectedTopRider?.key}
                  onSelect={setSelectedTopRider}
                  highlight="moneyIn"
                />
                <TopPerformersTable
                  title="Top 10 by Orders"
                  rows={filteredTopByOrders}
                  selectedKey={selectedTopRider?.key}
                  onSelect={setSelectedTopRider}
                  highlight="orders"
                />
              </div>

              <div className="table-card glass">
                <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <History size={16} style={{ color: 'var(--accent-blue)' }} />
                  <strong style={{ fontSize: '0.95rem' }}>
                    {selectedTopRider
                      ? `Rider history · ${selectedTopRider.riderName}${selectedTopRider.riderId ? ` (${selectedTopRider.riderId})` : ''} · ${topFilterLabel}`
                      : 'Rider history'}
                  </strong>
                  {selectedTopRider ? (
                    <button
                      type="button"
                      className="glass-btn"
                      style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
                      onClick={() => setSelectedTopRider(null)}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="table-container" style={{ maxHeight: 'calc(100vh - 520px)' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Rider</th>
                        <th>Phone</th>
                        <th>Month</th>
                        <th>City</th>
                        <th>Week</th>
                        <th>Client</th>
                        <th>Orders</th>
                        <th>Money In</th>
                        <th>Net Payout</th>
                        <th>Vehicle</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!selectedTopRider ? (
                        <tr>
                          <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                            Click a rider in the Top 10 tables to see their payment history
                            {!topMonths.length && !topCities.length ? ' (overall)' : ` for ${topFilterLabel}`}.
                          </td>
                        </tr>
                      ) : topRiderHistory.length ? (
                        topRiderHistory.map((r) => (
                          <tr key={r.rowKey}>
                            <td>
                              <span className="status-badge" style={{ fontSize: '0.7rem' }}>
                                {r.type || 'Payment'}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{r.riderName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.riderId}</div>
                            </td>
                            <td>{r.riderPhone || '—'}</td>
                            <td>{r.month || '—'}</td>
                            <td>{r.city || '—'}</td>
                            <td>{r.week ? `W${r.week}` : '—'}</td>
                            <td>{r.client}</td>
                            <td>{numDisplay(r.orders)}</td>
                            <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{formatInr(r.moneyIn)}</td>
                            <td>{formatInr(r.finalNetPayout)}</td>
                            <td>{r.vehicleNumber || '—'}</td>
                            <td>
                              <div>{r.paymentStatus || '—'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.paymentDate || r.transactionDate}</div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                            No payment rows for this rider with the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
          </>
        </>
      )}
    </div>
  )
}

function filterTopPerformerRows(rows, search) {
  const q = String(search || '').trim().toLowerCase()
  if (!q) return rows || []
  return (rows || []).filter(
    (r) =>
      String(r.riderId || '').toLowerCase().includes(q) ||
      String(r.riderName || '').toLowerCase().includes(q) ||
      String(r.phone || '').toLowerCase().includes(q) ||
      String(r.client || '').toLowerCase().includes(q)
  )
}

function TopCheckboxSelect({ label, options, selected, onChange, emptyLabel = 'All', icon: Icon }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options || []
    return (options || []).filter((o) => String(o).toLowerCase().includes(q))
  }, [options, query])

  const toggle = (opt) => {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt))
    else onChange([...selected, opt])
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((opt) => selected.includes(opt))

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        minWidth: '150px',
        zIndex: open ? 60 : 1,
      }}
    >
      <button
        type="button"
        className="glass"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: '0.45rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          color: '#fff',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          background: selected.length ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
        }}
      >
        {Icon ? <Icon size={14} style={{ color: 'var(--text-dim)' }} /> : null}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', lineHeight: 1 }}>{label}</span>
          <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
            {selected.length === 0 ? emptyLabel : selected.length === 1 ? selected[0] : `${selected.length} selected`}
          </span>
        </div>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.35rem)',
            left: 0,
            zIndex: 9999,
            minWidth: '260px',
            maxHeight: '320px',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#0f172a',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: '10px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            padding: '0.55rem',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '0.35rem 0.55rem', marginBottom: '0.5rem' }}>
            <Search size={12} style={{ color: 'var(--text-dim)' }} />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: '0.8rem' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.45rem' }}>
            <button
              type="button"
              className="glass-btn"
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem' }}
              onClick={() => {
                if (allVisibleSelected) {
                  const drop = new Set(filtered)
                  onChange(selected.filter((s) => !drop.has(s)))
                } else {
                  onChange([...new Set([...selected, ...filtered])])
                }
              }}
            >
              {allVisibleSelected ? 'Uncheck all' : 'Check all'}
            </button>
            {selected.length > 0 ? (
              <button
                type="button"
                className="glass-btn"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.45rem' }}
                onClick={() => onChange([])}
              >
                Clear
              </button>
            ) : null}
          </div>
          {filtered.length ? (
            filtered.map((opt) => {
              const checked = selected.includes(opt)
              return (
                <label
                  key={opt}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    padding: '0.35rem 0.4rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: checked ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                    fontSize: '0.85rem',
                    color: '#fff',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    style={{ accentColor: 'var(--accent-blue)' }}
                  />
                  <span style={{ flex: 1 }}>{opt}</span>
                  {checked ? <Check size={14} style={{ color: 'var(--accent-blue)' }} /> : null}
                </label>
              )
            })
          ) : (
            <div style={{ padding: '0.6rem', color: 'var(--text-dim)', fontSize: '0.8rem', textAlign: 'center' }}>
              No matches
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function TopPerformersTable({ title, rows, selectedKey, onSelect, highlight }) {
  return (
    <div className="glass" style={{ padding: '1rem', flex: 1, minWidth: '320px' }}>
      <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
        <Trophy size={18} />
        {title}
        <span className="status-badge" style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </h3>
      <div className="table-container" style={{ maxHeight: '360px' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Rider ID</th>
              <th>Name</th>
              <th>Orders</th>
              <th>Money In</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const selected = selectedKey === row.key
                return (
                  <tr
                    key={`${highlight}-${row.key}`}
                    onClick={() => onSelect(row)}
                    style={{
                      cursor: 'pointer',
                      background: selected ? 'rgba(56, 189, 248, 0.12)' : undefined,
                    }}
                  >
                    <td>{row.rank}</td>
                    <td>{row.riderId || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{row.riderName}</td>
                    <td style={{ fontWeight: highlight === 'orders' ? 700 : 400, color: highlight === 'orders' ? 'var(--accent-blue)' : undefined }}>
                      {numDisplay(row.orders)}
                    </td>
                    <td style={{ fontWeight: highlight === 'moneyIn' ? 700 : 400, color: 'var(--accent-green)' }}>
                      {formatInr(row.moneyIn)}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>No data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function numDisplay(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString() : '0'
}

function cityLabel(city) {
  return city ? ` in ${city}` : ''
}
