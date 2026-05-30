import React, { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Activity, Download, Search, MapPin, Briefcase, FileSpreadsheet } from 'lucide-react'
import {
  getRiderPerformanceHeaders,
  buildRiderPerformanceReport,
  rowsToPerformanceCsv,
  getCellValue,
  filterReportRowsForExcelExport,
} from './lib/riderPerformanceReport'
import { downloadRiderPerformanceSummaryExcel } from './lib/riderPerformanceExcelExport'

export default function RiderPerformance({ fleetData, riderData, loading }) {
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('All')
  const [clientFilter, setClientFilter] = useState('All')
  const today = useMemo(() => new Date(), [])
  const reportDate = format(today, 'yyyy-MM-dd')
  const tableHeaders = useMemo(() => getRiderPerformanceHeaders(today), [today])

  const reportRows = useMemo(() => {
    if (!fleetData?.length) return []
    return buildRiderPerformanceReport(fleetData, riderData, today)
  }, [fleetData, riderData, today])

  const cities = useMemo(() => {
    const set = new Set(reportRows.map((r) => r.City).filter(Boolean))
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [reportRows])

  const clients = useMemo(() => {
    const set = new Set(reportRows.map((r) => r.Client).filter(Boolean))
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [reportRows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reportRows.filter((row) => {
      if (cityFilter !== 'All' && row.City !== cityFilter) return false
      if (clientFilter !== 'All' && row.Client !== clientFilter) return false
      if (!q) return true
      const blob = [
        row['V no'],
        row.ID,
        row.Name,
        row.Client,
        row.City,
        row['mobile no'],
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [reportRows, search, cityFilter, clientFilter])

  const [exportingSummary, setExportingSummary] = useState(false)

  const exportCsv = () => {
    const csv = rowsToPerformanceCsv(filteredRows, tableHeaders)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rider_performance_${reportDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportSummaryExcel = async () => {
    if (!reportRows.length || exportingSummary) return
    const exportRows = filterReportRowsForExcelExport(reportRows, riderData, today)
    if (!exportRows.length) {
      window.alert(
        'No riders to export. Riders must have client order data in the last 5 days and Max Order below 20 (last 3 days: D-2 to D-4).'
      )
      return
    }
    setExportingSummary(true)
    try {
      await downloadRiderPerformanceSummaryExcel(exportRows, today)
    } catch (err) {
      console.error('Summary Excel export failed:', err)
      window.alert(`Excel export failed: ${err?.message || 'Unknown error'}`)
    } finally {
      setExportingSummary(false)
    }
  }

  if (loading && (!fleetData || fleetData.length === 0)) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container rp-root">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Activity size={28} style={{ color: 'var(--primary)' }} />
          <div>
            <h1>Rider Performance</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Currently deployed riders only · date-wise deploy order
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="fsr-export-btn" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
          <button
            type="button"
            className="fsr-export-btn"
            onClick={exportSummaryExcel}
            disabled={!reportRows.length || exportingSummary}
          >
            <FileSpreadsheet size={16} />
            {exportingSummary ? 'Building Excel…' : 'Summary Excel'}
          </button>
        </div>
      </header>

      <div className="rp-filters glass">
        <div className="rp-filter">
          <label><MapPin size={14} /> City</label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="rp-filter">
          <label><Briefcase size={14} /> Client</label>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            {clients.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="rp-filter rp-filter-search">
          <label><Search size={14} /> Search</label>
          <input
            type="text"
            placeholder="Vehicle, ID, name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="rp-meta glass">
        <span><strong>{filteredRows.length.toLocaleString()}</strong> deployed riders</span>
        <span>Report date: {format(new Date(), 'dd/MM/yyyy')} (today)</span>
      </div>

      <div className="glass rp-table-wrap">
        <div className="rp-table-scroll">
          <table className="rp-table">
            <thead>
              <tr>
                {tableHeaders.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="rp-empty">
                    No currently deployed riders found
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={`${row.ID}-${row['V no']}-${idx}`}>
                    {tableHeaders.map((h) => (
                      <td key={h}>{getCellValue(row, h, today) ?? ''}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
