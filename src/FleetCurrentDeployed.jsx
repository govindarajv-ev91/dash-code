import React, { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Briefcase, Download, MapPin, Search, Truck } from 'lucide-react'
import {
  buildCurrentDeployedClientCitySummary,
  filterCurrentDeployedRows,
  currentDeployedToCsv,
} from './lib/fleetCurrentDeployed'

export default function FleetCurrentDeployed({ fleetData, loading }) {
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const [search, setSearch] = useState('')

  const asOfDate = useMemo(() => new Date(), [])

  const summary = useMemo(
    () => buildCurrentDeployedClientCitySummary(fleetData, asOfDate),
    [fleetData, asOfDate]
  )

  const filteredRows = useMemo(
    () => filterCurrentDeployedRows(summary.rows, { city: cityFilter, client: clientFilter, clientSearch: search }),
    [summary.rows, cityFilter, clientFilter, search]
  )

  const filteredTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.count, 0),
    [filteredRows]
  )

  const exportCsv = () => {
    const csv = currentDeployedToCsv(filteredRows, filteredTotal)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `current_deployed_${format(asOfDate, 'yyyy-MM-dd')}.csv`
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
          <Truck size={28} style={{ color: 'var(--primary)' }} />
          <div>
            <h1>Current Deployment</h1>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Client-wise vehicles currently on road · as of {format(asOfDate, 'dd/MM/yyyy')}
            </p>
          </div>
        </div>
      </div>

      <div className="fsr-filters glass">
        <div className="fsr-filter-group">
          <label className="fsr-filter-label"><MapPin size={16} /> City</label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="fsr-select">
            <option value="All">All cities</option>
            {summary.cities.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>
        <div className="fsr-filter-group">
          <label className="fsr-filter-label"><Briefcase size={16} /> Client</label>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="fsr-select">
            <option value="All">All clients</option>
            {summary.clients.map((client) => (
              <option key={client} value={client}>{client}</option>
            ))}
          </select>
        </div>
        <div className="fsr-filter-group" style={{ flex: 1, minWidth: '220px' }}>
          <label className="fsr-filter-label"><Search size={16} /> Search client / city</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="fsr-date-input"
            placeholder="Filter…"
          />
        </div>
        <button type="button" className="fsr-export-btn" onClick={exportCsv} disabled={!filteredRows.length}>
          <Download size={16} /> Export
        </button>
      </div>

      <div className="fsr-stats-grid">
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-deployed"><Truck size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Currently deployed</span>
            <span className="fsr-stat-value">{filteredTotal.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total"><MapPin size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Cities</span>
            <span className="fsr-stat-value">{summary.cities.length.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-positive"><Briefcase size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Clients</span>
            <span className="fsr-stat-value">{summary.clients.length.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total"><Briefcase size={24} /></div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Client × city rows</span>
            <span className="fsr-stat-value">{filteredRows.length.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="fsr-table-wrap glass">
        <div className="fsr-table-header">
          <h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Briefcase size={20} />
              <span>Client-wise current deployment by city</span>
            </span>
          </h2>
        </div>

        <div className="fsr-table-scroll">
          <table className="fsr-table">
            <thead>
              <tr>
                <th className="fsr-th-name">Client</th>
                <th className="fsr-th-name">City</th>
                <th className="fsr-th-deployed">Currently Deployed</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No currently deployed vehicles found for the selected filters
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={`${row.client}-${row.city}`} className="fsr-row">
                    <td className="fsr-td-name"><span className="fsr-name-badge">{row.client}</span></td>
                    <td className="fsr-td-name"><span className="fsr-name-badge">{row.city}</span></td>
                    <td className="fsr-td-deployed"><span className="fsr-badge fsr-badge-deployed">{row.count}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 && (
          <div className="fsr-table-footer">
            <table className="fsr-table" style={{ margin: 0 }}>
              <tbody>
                <tr className="fsr-footer-row">
                  <td className="fsr-td-name"><strong>TOTAL</strong></td>
                  <td className="fsr-td-name" />
                  <td className="fsr-td-deployed">
                    <span className="fsr-badge fsr-badge-deployed fsr-badge-total">{filteredTotal}</span>
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
