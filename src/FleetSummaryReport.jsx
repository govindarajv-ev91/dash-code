import React, { useState, useMemo } from 'react'
import { Calendar, TrendingUp, TrendingDown, MapPin, Briefcase, Download, BarChart3 } from 'lucide-react'
import { format, parse, isValid, startOfDay, endOfDay } from 'date-fns'

// Parse various date formats
const parseFleetDate = (dateStr) => {
  if (!dateStr || dateStr === 'null') return null
  try {
    const s = dateStr.toString().trim()
    
    // Handle DD/MM/YYYY
    if (s.includes('/')) {
      const parts = s.split('/')
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10)
        const month = parseInt(parts[1], 10) - 1
        const year = parseInt(parts[2], 10)
        const d = new Date(year, month, day)
        return isValid(d) ? d : null
      }
    }
    
    // Handle YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) {
      const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10))
      return isValid(d) ? d : null
    }
    
    // Fallback to native Date
    const d = new Date(s)
    return isValid(d) ? d : null
  } catch (e) {
    return null
  }
}

export default function FleetSummaryReport({ fleetData, loading }) {
  const [startDate, setStartDate] = useState(() => {
    return format(new Date(), 'yyyy-MM-dd')
  })
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [statusFilter, setStatusFilter] = useState('all') // all | deployed | returned
  const [viewType, setViewType] = useState('city') // city | client

  // Parse date range
  const dateRange = useMemo(() => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    return {
      start: startOfDay(start),
      end: endOfDay(end)
    }
  }, [startDate, endDate])

  // Filter and group data
  const summaryData = useMemo(() => {
    if (!fleetData || fleetData.length === 0) return {}

    const cityMap = new Map()
    const clientMap = new Map()
    const seenKeys = new Set() // Track unique vehicle + status + date combinations to avoid duplicates

    for (const row of fleetData) {
      // Use date_record (the actual event date) for filtering
      const eventDate = parseFleetDate(row.date_record)
      if (!eventDate) continue

      // Check if date is in range
      if (eventDate < dateRange.start || eventDate > dateRange.end) continue

      const status = (row.vehicle_status || '').toString().trim().toLowerCase()
      const city = (row.city_locations || row.city || 'Unknown').toString().trim()
      const client = (row.client_name || 'Unknown').toString().trim()
      const vehicle = (row.vehicle_number || '').toString().trim()
      
      // Determine if deployed or returned based on vehicle_status field
      let deploymentStatus = 'deployed'
      if (status === 'return' || status.includes('return')) {
        deploymentStatus = 'returned'
      } else if (status === 'deployee' || status.includes('deploy')) {
        deploymentStatus = 'deployed'
      } else {
        // Skip rows with unclear status
        continue
      }

      // Create unique key to avoid counting duplicates (vehicle + date + status)
      const uniqueKey = `${vehicle}|${format(eventDate, 'yyyy-MM-dd')}|${deploymentStatus}`
      if (seenKeys.has(uniqueKey)) {
        continue // Skip duplicate entry
      }
      seenKeys.add(uniqueKey)

      // Apply status filter
      if (statusFilter !== 'all' && deploymentStatus !== statusFilter) {
        continue
      }

      // Update city stats
      if (!cityMap.has(city)) {
        cityMap.set(city, { deployed: 0, returned: 0, details: [] })
      }
      const cityStats = cityMap.get(city)
      if (deploymentStatus === 'deployed') cityStats.deployed++
      else cityStats.returned++
      cityStats.details.push({
        vehicle: vehicle,
        rider: row.rider_name,
        client,
        date: eventDate,
        status: deploymentStatus
      })

      // Update client stats
      if (!clientMap.has(client)) {
        clientMap.set(client, { deployed: 0, returned: 0, details: [] })
      }
      const clientStats = clientMap.get(client)
      if (deploymentStatus === 'deployed') clientStats.deployed++
      else clientStats.returned++
      clientStats.details.push({
        vehicle: vehicle,
        rider: row.rider_name,
        city,
        date: eventDate,
        status: deploymentStatus
      })
    }

    return { cityMap, clientMap }
  }, [fleetData, dateRange, statusFilter])

  const displayData = useMemo(() => {
    if (viewType === 'city') {
      return Array.from(summaryData.cityMap || [])
        .sort((a, b) => (b[1].deployed + b[1].returned) - (a[1].deployed + a[1].returned))
    } else {
      return Array.from(summaryData.clientMap || [])
        .sort((a, b) => (b[1].deployed + b[1].returned) - (a[1].deployed + a[1].returned))
    }
  }, [summaryData, viewType])

  const totals = useMemo(() => {
    let totalDeployed = 0
    let totalReturned = 0
    
    if (viewType === 'city') {
      for (const [, stats] of summaryData.cityMap || []) {
        totalDeployed += stats.deployed
        totalReturned += stats.returned
      }
    } else {
      for (const [, stats] of summaryData.clientMap || []) {
        totalDeployed += stats.deployed
        totalReturned += stats.returned
      }
    }

    return { totalDeployed, totalReturned }
  }, [summaryData, viewType])

  const handleExportSummary = () => {
    let csv = `${viewType === 'city' ? 'City' : 'Client'},Deployed,Returned,Total\n`
    
    for (const [name, stats] of displayData) {
      const total = stats.deployed + stats.returned
      csv += `"${name}",${stats.deployed},${stats.returned},${total}\n`
    }
    
    csv += `\nTotal,${totals.totalDeployed},${totals.totalReturned},${totals.totalDeployed + totals.totalReturned}\n`

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_summary_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading-container">
          <span className="loader"></span>
        </div>
      </div>
    )
  }

  return (
    <div className="fsr-container">
      {/* Header */}
      <div className="fsr-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <BarChart3 size={28} style={{ color: 'var(--primary)' }} />
          <h1>Fleet Summary Report</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="fsr-filters glass">
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} />
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="fsr-date-input"
          />
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <Calendar size={16} />
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="fsr-date-input"
          />
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="fsr-select"
          >
            <option value="all">All</option>
            <option value="deployed">Deployed</option>
            <option value="returned">Returned</option>
          </select>
        </div>

        <div className="fsr-filter-group">
          <label className="fsr-filter-label">Group By</label>
          <select
            value={viewType}
            onChange={(e) => setViewType(e.target.value)}
            className="fsr-select"
          >
            <option value="city">City</option>
            <option value="client">Client</option>
          </select>
        </div>

        <button className="fsr-export-btn" onClick={handleExportSummary} title="Export summary as CSV">
          <Download size={16} /> Export
        </button>
      </div>

      {/* Summary Stats */}
      <div className="fsr-stats-grid">
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-deployed">
            <TrendingUp size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Deployed</span>
            <span className="fsr-stat-value">{totals.totalDeployed.toLocaleString()}</span>
          </div>
        </div>

        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-returned">
            <TrendingDown size={24} />
          </div>
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
          <div className="fsr-stat-icon fsr-stat-total">
            <BarChart3 size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Total Events</span>
            <span className="fsr-stat-value">{(totals.totalDeployed + totals.totalReturned).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Summary Table */}
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
                <th className="fsr-th-deployed">
                  <TrendingUp size={16} style={{ marginRight: '0.5rem' }} />
                  Deployed
                </th>
                <th className="fsr-th-returned">
                  <TrendingDown size={16} style={{ marginRight: '0.5rem' }} />
                  Returned
                </th>
                <th className="fsr-th-total">Total</th>
                <th className="fsr-th-net">Net Add</th>
                <th className="fsr-th-percent">Deploy %</th>
              </tr>
            </thead>
            <tbody>
              {displayData.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
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
                      <td className="fsr-td-name">
                        <span className="fsr-name-badge">{name}</span>
                      </td>
                      <td className="fsr-td-deployed">
                        <span className="fsr-badge fsr-badge-deployed">{stats.deployed}</span>
                      </td>
                      <td className="fsr-td-returned">
                        <span className="fsr-badge fsr-badge-returned">{stats.returned}</span>
                      </td>
                      <td className="fsr-td-total">
                        <span className="fsr-badge fsr-badge-total">{total}</span>
                      </td>
                      <td className="fsr-td-net">
                        <span className={`fsr-badge ${netAddition >= 0 ? 'fsr-badge-net-positive' : 'fsr-badge-net-negative'}`}>
                          {netAddition >= 0 ? '+' : ''}{netAddition}
                        </span>
                      </td>
                      <td className="fsr-td-percent">
                        <div className="fsr-progress-bar">
                          <div 
                            className="fsr-progress-fill" 
                            style={{ width: `${deployPercent}%` }}
                          ></div>
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

        {/* Summary Footer */}
        {displayData.length > 0 && (
          <div className="fsr-table-footer">
            <tr className="fsr-footer-row">
              <td className="fsr-td-name">
                <strong>TOTAL</strong>
              </td>
              <td className="fsr-td-deployed">
                <span className="fsr-badge fsr-badge-deployed fsr-badge-total">{totals.totalDeployed}</span>
              </td>
              <td className="fsr-td-returned">
                <span className="fsr-badge fsr-badge-returned fsr-badge-total">{totals.totalReturned}</span>
              </td>
              <td className="fsr-td-total">
                <span className="fsr-badge fsr-badge-total fsr-badge-total">{totals.totalDeployed + totals.totalReturned}</span>
              </td>
              <td className="fsr-td-net">
                <span className={`fsr-badge ${(totals.totalDeployed - totals.totalReturned) >= 0 ? 'fsr-badge-net-positive' : 'fsr-badge-net-negative'}`}>
                  {(totals.totalDeployed - totals.totalReturned) >= 0 ? '+' : ''}{totals.totalDeployed - totals.totalReturned}
                </span>
              </td>
              <td className="fsr-td-percent">
                <div className="fsr-progress-bar">
                  <div 
                    className="fsr-progress-fill" 
                    style={{ width: `${((totals.totalDeployed / (totals.totalDeployed + totals.totalReturned)) * 100).toFixed(1)}%` }}
                  ></div>
                  <span className="fsr-progress-text">
                    {((totals.totalDeployed / (totals.totalDeployed + totals.totalReturned)) * 100).toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          </div>
        )}
      </div>
    </div>
  )
}
