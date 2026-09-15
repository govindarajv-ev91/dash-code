import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Download, MapPin, RefreshCw, Truck } from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchEv91CurrentStatusAll } from './lib/ev91EvLookup'
import { EV91_CITIES, formatEv91Cell, statusBadgeClass } from './lib/ev91MisApi'
import {
  buildCityOperationalStatusCounts,
  cityOperationalCountsToSortedRows,
  filterOperationalAvailableRows,
  getCityRtdAvailableCount,
  normalizeOperationalStatusLabel,
} from './lib/ev91OperationalSummary'
import { normalizeSummaryCity } from './lib/citySummaryAliases'
import { vehiclePartitionKey } from './lib/fleetDeployReturnExport'

export default function Ev91OperationalStatus() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCity, setSelectedCity] = useState('All')

  const load = useCallback((force = false) => {
    setLoading(true)
    setError('')
    return fetchEv91CurrentStatusAll({ force })
      .then((result) => setRows(result.data || []))
      .catch((err) => {
        console.warn('EV91 operational status load failed:', err)
        setRows([])
        setError(err?.message || 'Failed to load EV91 Current Status')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  const byCity = useMemo(() => buildCityOperationalStatusCounts(rows), [rows])

  const cityRows = useMemo(() => cityOperationalCountsToSortedRows(byCity), [byCity])

  const cities = useMemo(() => {
    const fromApi = cityRows.map((r) => r.city).filter(Boolean)
    return fromApi.length ? fromApi : [...EV91_CITIES]
  }, [cityRows])

  const totalRtd = useMemo(() => getCityRtdAvailableCount(byCity, 'All'), [byCity])

  const filteredCityRows = useMemo(() => {
    if (selectedCity === 'All') return cityRows
    return cityRows.filter((r) => r.city === selectedCity)
  }, [cityRows, selectedCity])

  const availableVehicles = useMemo(
    () => {
      const list = filterOperationalAvailableRows(rows, selectedCity)
      // Deduplicate by normalized vehicle key so the detail list matches the
      // city RTD counts which are also deduplicated.
      const out = []
      const seen = new Set()
      for (const r of list) {
        const vKey = vehiclePartitionKey(r.vehicleNumber || r.Vehiclenumber || r.vehicle || '')
        if (vKey) {
          if (seen.has(vKey)) continue
          seen.add(vKey)
        }
        out.push(r)
      }
      return out
    },
    [rows, selectedCity]
  )

  const rawAvailableRows = useMemo(() => {
    return (rows || []).filter((r) => {
      const cityOk = selectedCity === 'All' || normalizeSummaryCity(r.city) === selectedCity
      if (!cityOk) return false
      const op = normalizeOperationalStatusLabel(r.operationalStatus).toLowerCase()
      return op.startsWith('available')
    })
  }, [rows, selectedCity])

  const selectedRtd = useMemo(
    () => getCityRtdAvailableCount(byCity, selectedCity),
    [byCity, selectedCity]
  )

  const exportCitySummary = () => {
    const sheetRows = cityRows.map((r) => ({
      City: r.city,
      'RTD (Available)': r.available,
      Assigned: r.assigned,
      'Team Use': r.teamUse,
      Maintenance: r.maintenance,
      Returned: r.returned,
      Other: r.other,
      Total: r.total,
    }))
    const ws = XLSX.utils.json_to_sheet(sheetRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'RTD by City')
    XLSX.writeFile(wb, `ev91_operational_rtd_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading && !rows.length && !error) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container ev91-root ev91-summary-page">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Activity size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>Operational Status</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0 }}>
              EV91 Current Status · RTD = Operational &quot;Available&quot; (Ready To Deploy) · city-wise
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div className="glass" style={{ padding: '0.4rem 1rem', fontWeight: 600, color: 'var(--accent-green)' }}>
            <Truck size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            RTD (All cities): {totalRtd.toLocaleString()}
          </div>
          <button type="button" className="fsr-export-btn" onClick={exportCitySummary} disabled={!cityRows.length}>
            <Download size={16} /> Export RTD
          </button>
          <button type="button" className="fsr-export-btn" onClick={() => load(true)} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'ev91-spin' : undefined} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="ev91-error glass" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="fdv-summary-filters glass" style={{ marginBottom: '1rem' }}>
        <div className="fdv-summary-filter">
          <label>
            <MapPin size={14} /> City
          </label>
          <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
            <option value="All">All Cities</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>
        <div className="fdv-summary-filter" style={{ alignSelf: 'flex-end' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            {rows.length.toLocaleString()} current-status rows · RTD{' '}
            {selectedCity === 'All' ? `(all): ${totalRtd}` : `${selectedCity}: ${selectedRtd}`}
          </span>
        </div>
      </div>

      <div className="table-card glass" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header">
          <h3>RTD by City (Operational = Available)</h3>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>City</th>
                <th>RTD (Available)</th>
                <th>Assigned</th>
                <th>Team Use</th>
                <th>Maintenance</th>
                <th>Returned</th>
                <th>Other</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredCityRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                    No operational data
                  </td>
                </tr>
              ) : (
                filteredCityRows.map((r) => (
                  <tr key={r.city}>
                    <td style={{ fontWeight: 600 }}>{r.city}</td>
                    <td style={{ fontWeight: 700, color: 'var(--accent-green)' }}>{r.available}</td>
                    <td>{r.assigned}</td>
                    <td>{r.teamUse}</td>
                    <td>{r.maintenance}</td>
                    <td>{r.returned}</td>
                    <td>{r.other}</td>
                    <td>{r.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-card glass">
          <div className="table-header">
          <h3>Available vehicles (RTD detail)</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="fsr-export-btn"
              onClick={() => {
                // Build export list from raw current-status rows using a
                // startsWith('available') test so variants like
                // "Available - Without(...)" are included in the export even
                // though they are excluded from the RTD summary counts.
                const rawList = (rows || []).filter((r) => {
                  const cityOk = selectedCity === 'All' || normalizeSummaryCity(r.city) === selectedCity
                  if (!cityOk) return false
                  const op = normalizeOperationalStatusLabel(r.operationalStatus).toLowerCase()
                  return op.startsWith('available')
                })

                // Deduplicate by normalized vehicle key for consistency with UI.
                const dedup = []
                const seen = new Set()
                for (const r of rawList) {
                  const vehicle = r.vehicleNumber || r.Vehiclenumber || r.vehicle || ''
                  const vKey = vehiclePartitionKey(vehicle)
                  if (vKey) {
                    if (seen.has(vKey)) continue
                    seen.add(vKey)
                  }
                  dedup.push(r)
                }

                const sheetRows = dedup.map((r) => ({
                  City: normalizeSummaryCity(r.city),
                  Vehicle: r.vehicleNumber || r.Vehiclenumber || r.vehicle || '',
                  Operational: normalizeOperationalStatusLabel(r.operationalStatus),
                  Deployment: r.currentStatus || '',
                  Client: r.clientName || '',
                  'Last Status': formatEv91Cell(r.lastStatusDate),
                }))
                const ws = XLSX.utils.json_to_sheet(sheetRows)
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Available RTD')
                XLSX.writeFile(wb, `ev91_available_rtd_${new Date().toISOString().slice(0, 10)}.xlsx`)
              }}
              disabled={!rows.length}
              title="Export Available vehicles (deduped)"
            >
              <Download size={14} /> Export
            </button>
            <button
              type="button"
              className="fsr-export-btn"
              onClick={() => {
                // Export raw rows (no dedupe) for comparison with source API
                const sheetRows = rawAvailableRows.map((r) => ({
                  City: normalizeSummaryCity(r.city),
                  Vehicle: r.vehicleNumber || r.Vehiclenumber || r.vehicle || '',
                  Operational: normalizeOperationalStatusLabel(r.operationalStatus),
                  Deployment: r.currentStatus || '',
                  Client: r.clientName || '',
                  'Last Status': formatEv91Cell(r.lastStatusDate),
                }))
                const ws = XLSX.utils.json_to_sheet(sheetRows)
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Available RTD Raw')
                XLSX.writeFile(wb, `ev91_available_rtd_raw_${new Date().toISOString().slice(0, 10)}.xlsx`)
              }}
              disabled={!rawAvailableRows.length}
              title="Export raw Available rows (no dedupe)"
            >
              <Download size={14} /> Export Raw
            </button>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
              Raw: {rawAvailableRows.length.toLocaleString()} · Deduped: {availableVehicles.length.toLocaleString()} · Summary: {totalRtd}
            </span>
          </div>
        </div>
        <div className="table-container" style={{ maxHeight: '420px' }}>
          <table>
            <thead>
              <tr>
                <th>City</th>
                <th>Vehicle</th>
                <th>Operational</th>
                <th>Deployment</th>
                <th>Client</th>
                <th>Last Status</th>
              </tr>
            </thead>
            <tbody>
              {availableVehicles.slice(0, 200).map((row, idx) => {
                const op = normalizeOperationalStatusLabel(row.operationalStatus)
                return (
                  <tr key={`${row.vehicleNumber}-${idx}`}>
                    <td>{normalizeSummaryCity(row.city)}</td>
                    <td>{row.vehicleNumber}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(op)}`}>{op || '—'}</span>
                    </td>
                    <td>{row.currentStatus || '—'}</td>
                    <td>{row.clientName || '—'}</td>
                    <td>{formatEv91Cell(row.lastStatusDate)}</td>
                  </tr>
                )
              })}
              {availableVehicles.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                    No Available (RTD) vehicles for this filter
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {availableVehicles.length > 200 && (
          <p style={{ padding: '0.75rem 1rem', margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Showing first 200 of {availableVehicles.length.toLocaleString()} — export from EV91 Current Status for full list.
          </p>
        )}
      </div>
    </div>
  )
}
