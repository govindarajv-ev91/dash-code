import React, { useState, useMemo } from 'react'
import {
  Calendar, TrendingUp, TrendingDown, MapPin, Briefcase, Download, BarChart3,
} from 'lucide-react'
import { format } from 'date-fns'
import { buildMasterSheetRows, filterMasterSheetRows } from './lib/fleetMasterSheet'

export default function FleetCitySummary({ fleetData, loading }) {
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewType, setViewType] = useState('city')

  const summaryData = useMemo(() => {
    if (!fleetData?.length) return { cityMap: new Map(), clientMap: new Map() }

    const masterRows = buildMasterSheetRows(fleetData)
    const filtered = filterMasterSheetRows(masterRows, {
      city: 'All',
      startDate,
      endDate,
    })

    const cityMap = new Map()
    const clientMap = new Map()
    const seenKeys = new Set()

    for (const row of filtered) {
      const deploymentStatus = row.vehicleStatus === 'Return' ? 'returned' : 'deployed'

      if (statusFilter !== 'all' && deploymentStatus !== statusFilter) continue

      const uniqueKey = `${row.vehicleNumber}|${format(row.date, 'yyyy-MM-dd')}|${deploymentStatus}`
      if (seenKeys.has(uniqueKey)) continue
      seenKeys.add(uniqueKey)

      const city = row.city || 'Unknown'
      const client = row.client || 'Unknown'

      if (!cityMap.has(city)) cityMap.set(city, { deployed: 0, returned: 0 })
      if (!clientMap.has(client)) clientMap.set(client, { deployed: 0, returned: 0 })

      if (deploymentStatus === 'deployed') {
        cityMap.get(city).deployed++
        clientMap.get(client).deployed++
      } else {
        cityMap.get(city).returned++
        clientMap.get(client).returned++
      }
    }

    return { cityMap, clientMap }
  }, [fleetData, startDate, endDate, statusFilter])

  const displayData = useMemo(() => {
    const map = viewType === 'city' ? summaryData.cityMap : summaryData.clientMap
    return [...(map || [])].sort(
      (a, b) => (b[1].deployed + b[1].returned) - (a[1].deployed + a[1].returned)
    )
  }, [summaryData, viewType])

  const totals = useMemo(() => {
    let totalDeployed = 0
    let totalReturned = 0
    const map = viewType === 'city' ? summaryData.cityMap : summaryData.clientMap
    for (const [, stats] of map || []) {
      totalDeployed += stats.deployed
      totalReturned += stats.returned
    }
    return { totalDeployed, totalReturned }
  }, [summaryData, viewType])

  const handleExportSummary = () => {
    let csv = `${viewType === 'city' ? 'City' : 'Client'},Deployed,Returned,Total,Net Add,Deploy %\n`
    for (const [name, stats] of displayData) {
      const total = stats.deployed + stats.returned
      const net = stats.deployed - stats.returned
      const pct = total > 0 ? ((stats.deployed / total) * 100).toFixed(1) : 0
      csv += `"${name}",${stats.deployed},${stats.returned},${total},${net},${pct}%\n`
    }
    const grandTotal = totals.totalDeployed + totals.totalReturned
    const grandPct = grandTotal > 0 ? ((totals.totalDeployed / grandTotal) * 100).toFixed(1) : 0
    csv += `\nTotal,${totals.totalDeployed},${totals.totalReturned},${grandTotal},${totals.totalDeployed - totals.totalReturned},${grandPct}%\n`

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_${viewType}_summary_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && (!fleetData || fleetData.length === 0)) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="fsr-container">
      <div className="fsr-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart3 size={28} style={{ color: 'var(--primary)' }} />
          <h1>Fleet Summary Report</h1>
        </div>
      </div>

      <div className="fsr-filters glass">
        <div className="fsr-filter-group">
          <label className="fsr-filter-label"><Calendar size={16} /> Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="fsr-date-input" />
        </div>
        <div className="fsr-filter-group">
          <label className="fsr-filter-label"><Calendar size={16} /> End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="fsr-date-input" />
        </div>
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="fsr-select">
            <option value="all">All</option>
            <option value="deployed">Deployed</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">Group By</label>
          <select value={viewType} onChange={(e) => setViewType(e.target.value)} className="fsr-select">
            <option value="city">City</option>
            <option value="client">Client</option>
          </select>
        </div>
        <button type="button" className="fsr-export-btn" onClick={handleExportSummary}>
          <Download size={16} /> Export
        </button>
      </div>

      <div className="fsr-stats-grid">
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-deployed"><TrendingUp size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Deployed</span>
            <span className="fsr-stat-value">{totals.totalDeployed.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-returned"><TrendingDown size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Returned</span>
            <span className="fsr-stat-value">{totals.totalReturned.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className={`fsr-stat-icon ${(totals.totalDeployed - totals.totalReturned) >= 0 ? 'fsr-stat-positive' : 'fsr-stat-negative'}`}>
            {(totals.totalDeployed - totals.totalReturned) >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Net Addition</span>
            <span className={`fsr-stat-value ${(totals.totalDeployed - totals.totalReturned) >= 0 ? 'fsr-stat-value-positive' : 'fsr-stat-value-negative'}`}>
              {(totals.totalDeployed - totals.totalReturned) >= 0 ? '+' : ''}{(totals.totalDeployed - totals.totalReturned).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total"><BarChart3 size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Total Events</span>
            <span className="fsr-stat-value">{(totals.totalDeployed + totals.totalReturned).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="fsr-table-wrap glass">
        <div className="fsr-table-header">
          <h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {viewType === 'city' ? <MapPin size={20} /> : <Briefcase size={20} />}
              <span>{viewType === 'city' ? 'City Wise Summary' : 'Client Wise Summary'}</span>
            </span>
          </h2>
        </div>

        <div className="fsr-table-scroll">
          <table className="fsr-table">
            <thead>
              <tr>
                <th className="fsr-th-name">{viewType === 'city' ? 'City' : 'Client'}</th>
                <th className="fsr-th-deployed"><TrendingUp size={16} style={{ marginRight: '0.5rem' }} />Deployed</th>
                <th className="fsr-th-returned"><TrendingDown size={16} style={{ marginRight: '0.5rem' }} />Returned</th>
                <th className="fsr-th-total">Total</th>
                <th className="fsr-th-net">Net Add</th>
                <th className="fsr-th-percent">Deploy %</th>
              </tr>
            </thead>
            <tbody>
              {displayData.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No data available for the selected date range
                  </td>
                </tr>
              ) : (
                displayData.map(([name, stats], idx) => {
                  const total = stats.deployed + stats.returned
                  const netAddition = stats.deployed - stats.returned
                  const deployPercent = total > 0 ? ((stats.deployed / total) * 100).toFixed(1) : 0
                  return (
                    <tr key={idx} className="fsr-row">
                      <td className="fsr-td-name"><span className="fsr-name-badge">{name}</span></td>
                      <td className="fsr-td-deployed"><span className="fsr-badge fsr-badge-deployed">{stats.deployed}</span></td>
                      <td className="fsr-td-returned"><span className="fsr-badge fsr-badge-returned">{stats.returned}</span></td>
                      <td className="fsr-td-total"><span className="fsr-badge fsr-badge-total">{total}</span></td>
                      <td className="fsr-td-net">
                        <span className={`fsr-badge ${netAddition >= 0 ? 'fsr-badge-net-positive' : 'fsr-badge-net-negative'}`}>
                          {netAddition >= 0 ? '+' : ''}{netAddition}
                        </span>
                      </td>
                      <td className="fsr-td-percent">
                        <div className="fsr-progress-bar">
                          <div className="fsr-progress-fill" style={{ width: `${deployPercent}%` }} />
                          <span className="fsr-progress-text">{deployPercent}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {displayData.length > 0 && (
          <div className="fsr-table-footer">
            <table className="fsr-table" style={{ margin: 0 }}>
              <tbody>
                <tr className="fsr-footer-row">
                  <td className="fsr-td-name"><strong>TOTAL</strong></td>
                  <td className="fsr-td-deployed"><span className="fsr-badge fsr-badge-deployed fsr-badge-total">{totals.totalDeployed}</span></td>
                  <td className="fsr-td-returned"><span className="fsr-badge fsr-badge-returned fsr-badge-total">{totals.totalReturned}</span></td>
                  <td className="fsr-td-total"><span className="fsr-badge fsr-badge-total fsr-badge-total">{totals.totalDeployed + totals.totalReturned}</span></td>
                  <td className="fsr-td-net">
                    <span className={`fsr-badge ${(totals.totalDeployed - totals.totalReturned) >= 0 ? 'fsr-badge-net-positive' : 'fsr-badge-net-negative'}`}>
                      {(totals.totalDeployed - totals.totalReturned) >= 0 ? '+' : ''}{totals.totalDeployed - totals.totalReturned}
                    </span>
                  </td>
                  <td className="fsr-td-percent">
                    <div className="fsr-progress-bar">
                      <div
                        className="fsr-progress-fill"
                        style={{
                          width: `${totals.totalDeployed + totals.totalReturned > 0 ? ((totals.totalDeployed / (totals.totalDeployed + totals.totalReturned)) * 100).toFixed(1) : 0}%`,
                        }}
                      />
                      <span className="fsr-progress-text">
                        {totals.totalDeployed + totals.totalReturned > 0
                          ? ((totals.totalDeployed / (totals.totalDeployed + totals.totalReturned)) * 100).toFixed(1)
                          : 0}%
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
