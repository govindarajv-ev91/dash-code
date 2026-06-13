import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, startTransition } from 'react'
import { Shield, Zap, Search, Download, Landmark, Receipt, Wallet } from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchAllRiderPayments } from './lib/riderPaymentDb'
import { fetchAllManualCollation } from './lib/manualCollationDb'
import { fetchFleetSdRows } from './lib/fleetSdFetch'
import {
  buildSdPaymentReport,
  buildEvRentMonthReport,
  filterSdRows,
  filterEvRentRows,
  formatInr,
} from './lib/sdPaymentReport'

const ROWS_PER_PAGE = 100

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

export default function SdPaymentViewer() {
  const [activeTab, setActiveTab] = useState('sd')
  const [paymentRows, setPaymentRows] = useState([])
  const [collationRows, setCollationRows] = useState([])
  const [fleetRows, setFleetRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [fleetLoading, setFleetLoading] = useState(true)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const deferredFleet = useDeferredValue(fleetRows)
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetchAllRiderPayments().catch(() => []),
      fetchAllManualCollation().catch(() => []),
    ])
      .then(([payments, collation]) => {
        if (cancelled) return
        setPaymentRows(payments)
        setCollationRows(collation)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    fetchFleetSdRows()
      .then((rows) => {
        if (!cancelled) startTransition(() => setFleetRows(rows || []))
      })
      .catch(() => {
        if (!cancelled) startTransition(() => setFleetRows([]))
      })
      .finally(() => {
        if (!cancelled) setFleetLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const sdRows = useMemo(
    () => buildSdPaymentReport(paymentRows, collationRows, deferredFleet),
    [paymentRows, collationRows, deferredFleet]
  )

  const evRentRows = useMemo(
    () => buildEvRentMonthReport(paymentRows, collationRows, deferredFleet),
    [paymentRows, collationRows, deferredFleet]
  )

  const cityOptions = useMemo(() => {
    const source = activeTab === 'sd' ? sdRows : evRentRows
    return [...new Set(source.map((r) => r.city))].filter((c) => c && c !== 'Unknown').sort()
  }, [activeTab, sdRows, evRentRows])

  const monthOptions = useMemo(
    () => [...new Set(evRentRows.map((r) => r.month))].filter(Boolean).sort().reverse(),
    [evRentRows]
  )

  const filteredSd = useMemo(
    () => filterSdRows(sdRows, { search: deferredSearch, cities: selectedCity ? [selectedCity] : [] }),
    [sdRows, deferredSearch, selectedCity]
  )

  const filteredEvRent = useMemo(
    () =>
      filterEvRentRows(evRentRows, {
        search: deferredSearch,
        cities: selectedCity ? [selectedCity] : [],
        months: selectedMonth ? [selectedMonth] : [],
      }),
    [evRentRows, deferredSearch, selectedCity, selectedMonth]
  )

  const activeRows = activeTab === 'sd' ? filteredSd : filteredEvRent

  const sdTotals = useMemo(() => {
    let fleetPaid = 0
    let paymentDed = 0
    let manualPaid = 0
    for (const r of filteredSd) {
      fleetPaid += r.fleetSdPaid
      paymentDed += r.paymentSdDeduction
      manualPaid += r.manualSdPaid
    }
    return { fleetPaid, paymentDed, manualPaid, riders: filteredSd.length }
  }, [filteredSd])

  const evTotals = useMemo(() => {
    let paymentRent = 0
    let manualRent = 0
    const riders = new Set()
    for (const r of filteredEvRent) {
      paymentRent += r.paymentEvRent
      manualRent += r.manualEvRent
      riders.add(r.riderId)
    }
    return { paymentRent, manualRent, rows: filteredEvRent.length, riders: riders.size }
  }, [filteredEvRent])

  const totalPages = Math.max(1, Math.ceil(activeRows.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return activeRows.slice(start, start + ROWS_PER_PAGE)
  }, [activeRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, search, selectedCity, selectedMonth])

  const exportExcel = useCallback(() => {
    if (activeTab === 'sd') {
      const rows = filteredSd.map((r) => ({
        'Rider ID': r.riderId,
        'Rider Name': r.riderName,
        City: r.city,
        Client: r.client,
        Vehicle: r.vehicleNumber,
        Phone: r.riderPhone,
        'Fleet SD Total': r.fleetSdTotal,
        'Fleet SD Paid': r.fleetSdPaid,
        'Fleet SD Pending': r.fleetSdPending,
        'SD UTR': r.sdUtr,
        'Payment SD Deduction': r.paymentSdDeduction,
        'Manual SD Paid': r.manualSdPaid,
        Gap: r.sdGap,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'SD Payment')
      XLSX.writeFile(wb, `SD_Payment_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } else {
      const rows = filteredEvRent.map((r) => ({
        Type: r.rowType === 'manual' ? 'Manual' : r.type || 'Payment',
        Month: r.month,
        Week: r.week,
        'Rider ID': r.riderId,
        'Rider Name': r.riderName,
        City: r.city,
        Client: r.client,
        Vehicle: r.vehicleNumber,
        Purpose: r.purpose,
        'Payment EV Rent': r.paymentEvRent,
        'Manual EV Rent': r.manualEvRent,
        'Total EV Rent': r.totalEvRent,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'EV Rent')
      XLSX.writeFile(wb, `EV_Rent_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }
  }, [activeTab, filteredSd, filteredEvRent])

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <header style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Shield size={28} style={{ color: '#a78bfa' }} />
            <div>
              <h1 style={{ margin: 0 }}>SD & EV Rent</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Unique EV riders · fleet SD · payment deductions · manual collation
              </p>
            </div>
          </div>
          <button type="button" onClick={exportExcel} className="glass" style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}>
            <Download size={18} />
            Export Excel
          </button>
        </div>
      </header>

      <div className="fdv-tab-bar glass" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`fdv-tab ${activeTab === 'sd' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('sd')}
        >
          <Shield size={16} />
          SD Payment
        </button>
        <button
          type="button"
          className={`fdv-tab ${activeTab === 'evrent' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('evrent')}
        >
          <Zap size={16} />
          EV Rent
        </button>
      </div>

      {activeTab === 'sd' ? (
        <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
          <StatCard label="EV Riders" value={sdTotals.riders.toLocaleString('en-IN')} icon={Shield} color="#a78bfa" iconBg="rgba(167, 139, 250, 0.12)" />
          <StatCard label="Fleet SD Paid" value={formatInr(sdTotals.fleetPaid)} icon={Landmark} color="#4ade80" iconBg="rgba(74, 222, 128, 0.12)" />
          <StatCard label="Payment SD Ded." value={formatInr(sdTotals.paymentDed)} icon={Receipt} color="#fb923c" iconBg="rgba(251, 146, 60, 0.12)" />
          <StatCard label="Manual SD Paid" value={formatInr(sdTotals.manualPaid)} icon={Wallet} color="var(--accent-blue)" iconBg="rgba(56, 189, 248, 0.12)" />
        </section>
      ) : (
        <section className="rp-stats-grid" style={{ marginBottom: '1rem' }}>
          <StatCard label="Rows" value={evTotals.rows.toLocaleString('en-IN')} icon={Zap} color="#fbbf24" iconBg="rgba(251, 191, 36, 0.12)" />
          <StatCard label="Unique Riders" value={evTotals.riders.toLocaleString('en-IN')} icon={Shield} color="#a78bfa" iconBg="rgba(167, 139, 250, 0.12)" />
          <StatCard label="Payment EV Rent" value={formatInr(evTotals.paymentRent)} icon={Receipt} color="#fb923c" iconBg="rgba(251, 146, 60, 0.12)" />
          <StatCard label="Manual EV Rent" value={formatInr(evTotals.manualRent)} icon={Wallet} color="var(--accent-blue)" iconBg="rgba(56, 189, 248, 0.12)" />
        </section>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {fleetLoading && (
          <div className="status-badge" style={{ padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
            Loading fleet SD…
          </div>
        )}
        {search !== deferredSearch && (
          <div className="status-badge" style={{ padding: '0.5rem 0.9rem', color: 'var(--text-dim)' }}>
            Filtering…
          </div>
        )}
      </div>

      <div className="filter-bar glass" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <select
          value={selectedCity}
          onChange={(e) => setSelectedCity(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
        >
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {activeTab === 'evrent' && (
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', padding: '0.5rem' }}
          >
            <option value="">All months</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search rider, city, vehicle, UTR..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 380px)' }}>
          <table>
            <thead>
              {activeTab === 'sd' ? (
                <tr>
                  <th>Rider</th>
                  <th>City</th>
                  <th>Client</th>
                  <th>Vehicle</th>
                  <th>Fleet SD Total</th>
                  <th>Fleet SD Paid</th>
                  <th>Fleet SD Pending</th>
                  <th>Payment SD Ded.</th>
                  <th>Manual SD Paid</th>
                  <th>SD UTR</th>
                </tr>
              ) : (
                <tr>
                  <th>Type</th>
                  <th>Month</th>
                  <th>Rider</th>
                  <th>City</th>
                  <th>Client</th>
                  <th>Vehicle</th>
                  <th>Purpose</th>
                  <th>Payment EV Rent</th>
                  <th>Manual EV Rent</th>
                  <th>Total</th>
                </tr>
              )}
            </thead>
            <tbody>
              {paginated.length ? (
                activeTab === 'sd' ? (
                  paginated.map((r) => (
                    <tr key={r.rowKey}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.riderName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.riderId}</div>
                      </td>
                      <td>{r.city}</td>
                      <td>{r.client}</td>
                      <td>{r.vehicleNumber || '—'}</td>
                      <td>{formatInr(r.fleetSdTotal)}</td>
                      <td style={{ color: '#4ade80', fontWeight: 600 }}>{formatInr(r.fleetSdPaid)}</td>
                      <td>{formatInr(r.fleetSdPending)}</td>
                      <td style={{ color: '#fb923c', fontWeight: 600 }}>{formatInr(r.paymentSdDeduction)}</td>
                      <td style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{formatInr(r.manualSdPaid)}</td>
                      <td style={{ fontSize: '0.75rem' }}>{r.sdUtr || '—'}</td>
                    </tr>
                  ))
                ) : (
                  paginated.map((r) => (
                    <tr key={r.rowKey}>
                      <td>
                        <span className="status-badge" style={{ fontSize: '0.7rem' }}>
                          {r.rowType === 'manual' ? 'Manual' : r.type || 'Payment'}
                        </span>
                      </td>
                      <td>
                        <div>{r.month}</div>
                        {r.week ? <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>W{r.week}</div> : null}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.riderName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.riderId}</div>
                      </td>
                      <td>{r.city}</td>
                      <td>{r.client}</td>
                      <td>{r.vehicleNumber || '—'}</td>
                      <td style={{ fontSize: '0.75rem' }}>{r.purpose || '—'}</td>
                      <td style={{ color: '#fb923c', fontWeight: 600 }}>{formatInr(r.paymentEvRent)}</td>
                      <td style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{formatInr(r.manualEvRent)}</td>
                      <td style={{ fontWeight: 700 }}>{formatInr(r.totalEvRent)}</td>
                    </tr>
                  ))
                )
              ) : (
                <tr>
                  <td colSpan={activeTab === 'sd' ? 10 : 10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No data. Upload payment & manual collation on Payment Upload page first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {activeRows.length} rows
            {activeTab === 'sd'
              ? ` · ${paymentRows.length} payment · ${collationRows.length} collation`
              : ` · ${filteredEvRent.filter((r) => r.rowType === 'payment').length} payment · ${filteredEvRent.filter((r) => r.rowType === 'manual').length} manual`}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" className="glass-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>Prev</button>
            <span style={{ fontSize: '0.85rem' }}>{currentPage} / {totalPages}</span>
            <button type="button" className="glass-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  )
}
