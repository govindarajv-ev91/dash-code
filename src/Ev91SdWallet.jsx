import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, RefreshCw, Search, Shield } from 'lucide-react'
import { normalizeSummaryCity } from './lib/citySummaryAliases'
import { EV91_SD_WALLET_COLUMNS, downloadEv91SdWallet, fetchEv91SdWallet, getCachedEv91SdWallet } from './lib/ev91SdWalletApi'

const PAGE_SIZE = 100
const amount = (value) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const controlStyle = { background: 'var(--bg-secondary)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.65rem', minWidth: 150 }

export default function Ev91SdWallet() {
  const [result, setResult] = useState(() => ({ wallet: getCachedEv91SdWallet(), loading: true, error: '' }))
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [client, setClient] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchEv91SdWallet({ force: reload > 0 }).then((wallet) => {
      if (!cancelled) setResult({ wallet, loading: false, error: '' })
    }).catch((error) => {
      if (!cancelled) setResult((previous) => ({ ...previous, loading: false, error: error?.message || 'Unable to load EV91 SD.' }))
    })
    return () => { cancelled = true }
  }, [reload])

  const rows = result.wallet?.rows
  const options = useMemo(() => ({
    cities: [...new Set((rows || []).map((row) => normalizeSummaryCity(row.city)).filter(Boolean))].sort(),
    clients: [...new Set((rows || []).map((row) => row.client_name).filter(Boolean))].sort(),
  }), [rows])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (rows || []).filter((row) => (!city || normalizeSummaryCity(row.city) === city) &&
      (!client || row.client_name === client) && (!query || EV91_SD_WALLET_COLUMNS.some(({ key }) =>
        String(row[key]).toLowerCase().includes(query))))
  }, [rows, search, city, client])
  const totals = useMemo(() => filtered.reduce((sum, row) => ({
    total_sd: sum.total_sd + row.total_sd,
    pending_sd: sum.pending_sd + row.pending_sd,
    fixed_deposit: sum.fixed_deposit + row.fixed_deposit,
  }), { total_sd: 0, pending_sd: 0, fixed_deposit: 0 }), [filtered])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visiblePage = Math.min(page, pageCount)
  const visibleRows = filtered.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE)
  const exportRows = async () => {
    setExporting(true)
    setExportError('')
    try { await downloadEv91SdWallet(filtered) }
    catch (error) { setExportError(error?.message || 'Unable to download EV91 SD.') }
    finally { setExporting(false) }
  }

  return <div className="dashboard-container ev91-root">
    <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
      <div>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}><Shield size={26} /> EV91 SD</h1>
        <p style={{ color: 'var(--text-dim)' }}>Rider security deposit wallet</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button type="button" className="glass-btn" disabled={!filtered.length || exporting} onClick={exportRows}>
          <Download size={16} /> {exporting ? 'Downloading…' : 'Download Excel'}
        </button>
        <button type="button" className="glass-btn" disabled={result.loading} onClick={() => {
          setResult((previous) => ({ ...previous, loading: true, error: '' }))
          setExportError('')
          setReload((value) => value + 1)
        }}><RefreshCw size={16} className={result.loading ? 'ev91-spin' : undefined} /> Refresh</button>
      </div>
    </header>

    <section className="rp-stats-grid" aria-label="Filtered SD totals" style={{ marginBottom: '1rem' }}>
      {[
        ['Wallet records', filtered.length], ['Total SD', totals.total_sd],
        ['Pending SD', totals.pending_sd], ['Fixed deposit', totals.fixed_deposit],
      ].map(([label, value]) => <div className="rp-stat-card glass" key={label}>
        <div className="rp-stat-body"><div className="rp-stat-label">{label}</div>
          <div className="rp-stat-value">{result.wallet ? amount(value) : '—'}</div>
        </div>
      </div>)}
    </section>

    <div className="glass" role="region" aria-label="SD wallet filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 260px' }}>
        <Search size={18} /><input type="search" aria-label="Search SD wallets" placeholder="Search rider ID, city or client" value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1) }} style={{ ...controlStyle, width: '100%' }} />
      </label>
      <select aria-label="City" value={city} onChange={(event) => { setCity(event.target.value); setPage(1) }} style={controlStyle}>
        <option value="">All cities</option>{[...new Set([...options.cities, city].filter(Boolean))].map((value) => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Client" value={client} onChange={(event) => { setClient(event.target.value); setPage(1) }} style={controlStyle}>
        <option value="">All clients</option>{[...new Set([...options.clients, client].filter(Boolean))].map((value) => <option key={value}>{value}</option>)}
      </select>
      <button type="button" className="glass-btn" onClick={() => { setSearch(''); setCity(''); setClient(''); setPage(1) }}>Clear filters</button>
    </div>

    <div className="rp-meta glass" style={{ marginBottom: '1rem' }}>
      <span>{result.loading ? <span role="status">{result.wallet ? 'Refreshing EV91 SD…' : 'Loading EV91 SD…'}</span>
        : `${filtered.length.toLocaleString('en-IN')} of ${(rows?.length || 0).toLocaleString('en-IN')} wallet records`}</span>
      {result.wallet && <span>Last loaded: {new Date(result.wallet.loadedAt).toLocaleString('en-IN')}</span>}
    </div>
    {(result.error || exportError) && <div role="alert" className="ev91-error glass" style={{ marginBottom: '1rem' }}>
      {result.error || exportError}{result.wallet && result.error ? ' Showing the last successfully loaded data.' : ''}
    </div>}

    <div className="glass rp-table-wrap" aria-busy={result.loading}>
      <div className="rp-table-scroll"><table className="rp-table">
        <thead><tr>{EV91_SD_WALLET_COLUMNS.map(({ key, label }) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>
          {visibleRows.length > 0 && <tr><th scope="row" colSpan={4}>Total for matching records</th>
            {['total_sd', 'pending_sd', 'fixed_deposit'].map((key) => <th key={key}>{amount(totals[key])}</th>)}
          </tr>}
          {visibleRows.map((row, index) => <tr key={`${row.public_rider_id}|${row.client_rider_id}|${index}`}>
            {EV91_SD_WALLET_COLUMNS.map(({ key, amount: isAmount }) => <td key={key} style={isAmount ? { textAlign: 'right' } : undefined}>
              {isAmount ? amount(row[key]) : row[key] || '—'}
            </td>)}
          </tr>)}
          {!visibleRows.length && <tr><td colSpan={7} className="rp-empty">
            {result.loading ? 'Loading EV91 SD…' : result.error && !result.wallet ? 'Unable to load wallets. Use Refresh to retry.' : 'No wallets match the selected filters.'}
          </td></tr>}
        </tbody>
      </table></div>
      <div className="rp-table-footer">
        <span>Page {visiblePage} of {pageCount} · Totals and download include all matching records.</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="glass-btn" aria-label="Previous page" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={17} /></button>
          <button type="button" className="glass-btn" aria-label="Next page" disabled={visiblePage >= pageCount} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={17} /></button>
        </div>
      </div>
    </div>
  </div>
}
