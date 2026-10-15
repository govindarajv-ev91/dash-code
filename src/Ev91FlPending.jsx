import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Briefcase, ClipboardList, Download, MapPin, RefreshCw, Search } from 'lucide-react'
import { format } from 'date-fns'
import * as XLSX from 'xlsx'
import { loadEv91FlPendingData } from './lib/ev91FlPendingDb'
import { dedupeCanonicalClients } from './lib/clientSummaryClients'
import {
  buildEv91FlPendingRows, filterEv91FlPendingRows, summarizeEv91FlPendingRows,
  flPendingExportRows, FL_PENDING_COLUMNS, FL_PENDING_EXPORT_COLUMNS,
} from './lib/ev91FlPending'

const PAGE_SIZE = 80
const EMPTY_ROWS = []
const buttonStyle = { padding: '0.65rem 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }
const SUMMARY_COLUMNS = ['City', 'Client', 'Riders', 'FL Pending', 'Client ID not in onboarding', 'Source name missing', 'Total Orders']

function display(value) {
  if (value == null || value === '') return '—'
  return typeof value === 'number' ? value.toLocaleString('en-IN') : value
}

export default function Ev91FlPending({ loadData = loadEv91FlPendingData }) {
  const [load, setLoad] = useState({ data: null, busy: true, error: '', updatedAt: null })
  const [reloadKey, setReloadKey] = useState(0)
  const [city, setCity] = useState('All')
  const [client, setClient] = useState('All')
  const [status, setStatus] = useState('pending')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadData({ force: reloadKey > 0 }).then((data) => {
      if (!cancelled) setLoad({ data, busy: false, error: '', updatedAt: new Date() })
    }).catch((error) => {
      if (!cancelled) setLoad({ data: null, busy: false, error: error?.message || 'Could not load FL Pending.', updatedAt: null })
    })
    return () => { cancelled = true }
  }, [loadData, reloadKey])

  const rows = useMemo(() => load.data ? buildEv91FlPendingRows(
    load.data.orderRows, load.data.mappingRows, load.data.onboardingRows, load.data.riderDetails, load.updatedAt,
  ) : EMPTY_ROWS, [load.data, load.updatedAt])
  const cities = useMemo(() => [...new Set(rows.map((row) => row.city))].sort(), [rows])
  const clients = useMemo(() => dedupeCanonicalClients(rows.map((row) => row.client)), [rows])
  const filteredRows = useMemo(() => filterEv91FlPendingRows(rows, { city, client, status, search: deferredSearch }),
    [rows, city, client, status, deferredSearch])
  const summary = useMemo(() => summarizeEv91FlPendingRows(filteredRows), [filteredRows])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const stats = [
    ['Riders shown', filteredRows.length],
    ['FL Pending', filteredRows.filter((row) => row.pending).length],
    ['Client ID not in onboarding', filteredRows.filter((row) => row.status === 'Client ID not in onboarding').length],
    ['Source name missing', filteredRows.filter((row) => row.status === 'Source name missing').length],
    ['Total Orders', filteredRows.reduce((sum, row) => sum + row.totalOrders, 0)],
  ]

  const refresh = () => {
    setLoad({ data: null, busy: true, error: '', updatedAt: null })
    setExportError('')
    setReloadKey((key) => key + 1)
  }
  const exportExcel = () => {
    setExportError('')
    try {
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(flPendingExportRows(filteredRows),
        { header: FL_PENDING_EXPORT_COLUMNS.map((column) => column.label) }), 'FL Pending')
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary, { header: SUMMARY_COLUMNS }), 'City Client Summary')
      XLSX.writeFile(workbook, `EV91_FL_Pending_${format(load.updatedAt, 'yyyy-MM-dd')}.xlsx`)
    } catch (error) {
      setExportError(error?.message || 'Could not export FL Pending.')
    }
  }

  return (
    <div className="dashboard-container ev91-root">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1><ClipboardList size={26} style={{ verticalAlign: 'middle', color: 'var(--accent-green)' }} /> FL Pending</h1>
          <p style={{ color: 'var(--text-dim)', margin: 0 }}>
            Order Client IDs missing from onboarding or missing a source name.
            {load.updatedAt && ` · Updated ${format(load.updatedAt, 'dd/MM/yyyy HH:mm')}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="glass" style={buttonStyle} onClick={exportExcel} disabled={load.busy || !filteredRows.length}>
            <Download size={18} /> Export Excel
          </button>
          <button type="button" className="glass" style={buttonStyle} onClick={refresh} disabled={load.busy}>
            <RefreshCw size={18} className={load.busy ? 'ev91-spin' : undefined} /> Refresh
          </button>
        </div>
      </header>

      {load.busy && <div className="fdv-loading-banner glass" role="status"><span className="loader" /> Loading orders, onboarding and EV91 rider details…</div>}
      {(load.error || exportError) && <div className="ev91-error glass" role="alert"><AlertTriangle size={18} /> {load.error || exportError}</div>}
      {!load.busy && !load.error && <>
        <section className="stats-grid">
          {stats.map(([label, value]) => <div className="stat-card glass" key={label}>
            <div className="label">{label}</div><div className="value">{display(value)}</div>
          </div>)}
        </section>

        <section className="table-card glass" style={{ marginBottom: '1rem' }}>
          <div className="ev91-filters">
            <label className="ev91-filter-field"><Search size={16} />
              <input aria-label="Search FL riders" placeholder="Client ID, EV91 ID, name, phone, source…" value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            </label>
            <label className="ev91-filter-field"><MapPin size={16} />
              <select aria-label="City" value={city} onChange={(event) => { setCity(event.target.value); setPage(1) }}>
                <option value="All">All cities</option>{cities.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="ev91-filter-field"><Briefcase size={16} />
              <select aria-label="Client" value={client} onChange={(event) => { setClient(event.target.value); setPage(1) }}>
                <option value="All">All clients</option>{clients.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="ev91-filter-field">
              <select aria-label="FL status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
                <option value="pending">FL Pending only</option>
                <option value="Client ID not in onboarding">Client ID not in onboarding</option>
                <option value="Source name missing">Source name missing</option>
                <option value="FL Complete">FL Complete</option>
                <option value="All">All riders</option>
              </select>
            </label>
          </div>
          <p style={{ color: 'var(--text-dim)', padding: '0 1rem 1rem', margin: 0, fontSize: '0.85rem' }}>
            One Client ID per city/client. Source comes from rider_onboarding, matched by Client ID.
            Order Start Date and LWD use days with orders above zero. Aging = days since first order; Days Since LWD = days since last working date.
          </p>
        </section>

        <section className="table-card glass" style={{ marginBottom: '1rem' }} aria-label="City and client summary">
          <div className="table-header"><h3>City / Client Summary</h3></div>
          <div className="table-container"><table>
            <thead><tr>{SUMMARY_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{summary.map((row) => <tr key={`${row.City}|${row.Client}`}>
              {SUMMARY_COLUMNS.map((column) => <td key={column}>{display(row[column])}</td>)}
            </tr>)}</tbody>
          </table></div>
        </section>

        <section className="table-card glass" aria-label="FL rider details">
          <div className="table-header">
            <h3>{filteredRows.length.toLocaleString('en-IN')} riders</h3>
            <div className="ev91-pager">
              <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
              <span>Page {currentPage} / {totalPages}</span>
              <button type="button" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
            </div>
          </div>
          <div className="table-container"><table>
            <thead><tr>{FL_PENDING_COLUMNS.map(({ key, label }) => <th key={key}>{label}</th>)}</tr></thead>
            <tbody>{visibleRows.length ? visibleRows.map((row) => <tr key={row.key}>
              {FL_PENDING_COLUMNS.map(({ key }) => <td key={key}>
                {key === 'status' ? <span className={`status-badge ${row.pending ? 'ev91-badge-pending' : 'ev91-badge-deployed'}`}>{row.status}</span> : display(row[key])}
              </td>)}
            </tr>) : <tr><td colSpan={FL_PENDING_COLUMNS.length} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
              {rows.length ? 'No riders match the current filters.' : 'No order Client IDs found.'}
            </td></tr>}</tbody>
          </table></div>
        </section>
      </>}
    </div>
  )
}
