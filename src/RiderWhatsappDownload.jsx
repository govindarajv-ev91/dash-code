import { useEffect, useMemo, useState } from 'react'
import { loadWhatsappPaymentData, loadWhatsappWeekOptions } from './lib/riderWhatsappData'
import { buildWhatsappReport, prepareWhatsappPayments, WHATSAPP_COLUMNS } from './lib/riderWhatsappReport'

const EMPTY_DATA = { payments: [], contacts: {} }

function MultiFilter({ label, options, value, onChange }) {
  const selected = value === null ? options : value.filter((item) => options.includes(item))
  return <fieldset style={{ flex: '1 1 240px', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '0.75rem' }}>
    <legend>{label}</legend>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="glass-btn" aria-label={`Select all ${label.toLowerCase()}`} disabled={!options.length} onClick={() => onChange(null)}>Select all</button>
      <button type="button" className="glass-btn" aria-label={`Unselect all ${label.toLowerCase()}`} disabled={!selected.length} onClick={() => onChange([])}>Unselect all</button>
    </div>
    <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 8 }}>
      {options.map((option) => <label key={option} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
        <input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} />{option}
      </label>)}
    </div>
    <small>{selected.length} of {options.length} selected</small>
  </fieldset>
}

export default function RiderWhatsappDownload() {
  const [result, setResult] = useState({ key: '', data: EMPTY_DATA, error: '' })
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [week, setWeek] = useState('')
  const [clients, setClients] = useState(null)
  const [cities, setCities] = useState(null)
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [weekOptions, setWeekOptions] = useState({ rows: [], loading: true, error: '' })
  const requestKey = week ? `${week}|${refresh}` : ''
  const loading = !!week && result.key !== requestKey
  const data = result.key === requestKey ? result.data : EMPTY_DATA
  const loadError = result.key === requestKey ? result.error : ''

  useEffect(() => {
    const controller = new AbortController()
    loadWhatsappWeekOptions({ signal: controller.signal }).then((rows) => {
      if (!controller.signal.aborted) setWeekOptions({ rows, loading: false, error: '' })
    }).catch((err) => {
      if (!controller.signal.aborted) setWeekOptions({ rows: [], loading: false, error: err?.message || 'Unable to load payment weeks.' })
    })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!week) return undefined
    const controller = new AbortController()
    loadWhatsappPaymentData({ week, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setResult({ key: requestKey, data, error: '' })
    }).catch((err) => {
      if (!controller.signal.aborted) setResult({ key: requestKey, data: EMPTY_DATA, error: err?.message || 'Unable to load payment data and rider phone numbers.' })
    })
    return () => controller.abort()
  }, [week, requestKey])

  const payments = useMemo(() => prepareWhatsappPayments(data.payments), [data.payments])
  const selectedWeek = weekOptions.rows.find((option) => option.value === week)
  const clientOptions = useMemo(() => [...new Set(payments.map((row) => row.client_name))].sort(), [payments])
  const cityOptions = useMemo(() => [...new Set(payments.map((row) => row.city))].sort(), [payments])
  const rows = useMemo(() => buildWhatsappReport(payments, { paymentWeek: week, clients, cities, contacts: data.contacts }), [payments, week, clients, cities, data.contacts])
  const readyRows = useMemo(() => rows.filter((row) => row.Mobnumber), [rows])
  const pageCount = Math.max(1, Math.ceil(rows.length / 100))
  const currentPage = Math.min(page, pageCount - 1)
  const emptyMessage = !week ? 'Select a week to load rider payments.' : loading ? 'Loading selected week payments and phone numbers...' : loadError ? 'Payment data could not be loaded. See the error above and retry.' : !data.payments.length ? 'No payment records found for this week. Check the selected week or the uploaded payment period dates.' : !payments.length ? 'Payment records were found, but none have a completed payout status.' : 'No completed payouts match the selected clients and cities.'
  const statusCounts = useMemo(() => {
    const counts = new Map()
    for (const row of data.payments) {
      const status = String(row.payment_status || '').trim() || '(blank)'
      counts.set(status, (counts.get(status) || 0) + 1)
    }
    return [...counts].map(([status, count]) => `${status}: ${count}`).join(', ')
  }, [data.payments])

  async function download(format) {
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.json_to_sheet(readyRows, { header: WHATSAPP_COLUMNS })
      sheet['!cols'] = WHATSAPP_COLUMNS.map(() => ({ wch: 22 }))
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Payout Done')
      const label = (selectedWeek?.label || 'payouts').replace(/[^a-zA-Z0-9_-]+/g, '_')
      XLSX.writeFile(book, `Rider_WhatsApp_${label}.${format}`, { bookType: format })
    } catch (err) {
      setError(err?.message || 'Download failed. Please retry.')
    } finally { setExporting(false) }
  }

  return <div>
    <div className="page-header"><h1>Rider WhatsApp Download</h1>
      <p>Download completed rider payouts for WhatsApp blasts.</p></div>
    <div className="glass" style={{ padding: '1.25rem', marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <label style={{ flex: '1 1 240px' }}>Week
          <select aria-label="Week" className="filter-select" value={week} disabled={weekOptions.loading} onChange={(event) => { setWeek(event.target.value); setClients(null); setCities(null); setPage(0); setError('') }} style={{ display: 'block', width: '100%', marginTop: 8 }}>
            <option value="">{weekOptions.loading ? 'Loading available payment weeks...' : 'Select payment week'}</option>
            {weekOptions.rows.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small>{selectedWeek ? `Uploaded payment week: ${selectedWeek.label}` : 'Choose a week from Rider Payment Data.'}</small>
          {!weekOptions.loading && !weekOptions.error && !weekOptions.rows.length && <p>No uploaded payment weeks found.</p>}
        </label>
        <MultiFilter label="Clients" options={clientOptions} value={clients} onChange={(value) => { setClients(value); setPage(0) }} />
        <MultiFilter label="Cities" options={cityOptions} value={cities} onChange={(value) => { setCities(value); setPage(0) }} />
      </div>
      <p>Others: NA. Rows are totalled per rider, client and city for the selected payment week. Phone numbers use onboarding records, then fleet records and Client Mapping History when missing.</p>
      <p role="status">{!week || loading || loadError ? emptyMessage : `${rows.length} payout entries · ${readyRows.length} ready to download · ${rows.length - readyRows.length} missing a valid phone number`}</p>
      {!loading && !loadError && week && !payments.length && statusCounts && <p>Uploaded payment statuses for this week: {statusCounts}</p>}
      <p style={{ color: 'var(--text-dim)' }}>Only payments with status Released are included. Entries without a valid phone number appear below and are excluded from downloads.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="fsr-export-btn" disabled={loading || exporting || !readyRows.length} onClick={() => download('xlsx')}>Download Excel</button>
        <button className="fsr-export-btn" disabled={loading || exporting || !readyRows.length} onClick={() => download('csv')}>Download CSV</button>
        <button className="glass-btn" disabled={loading || exporting || weekOptions.loading} onClick={() => { setError(''); setRefresh((value) => value + 1) }}>Refresh data</button>
      </div>
      {error && <p role="alert" style={{ color: '#f87171' }}>{error}</p>}
      {loadError && <p role="alert" style={{ color: '#f87171' }}>{loadError}</p>}
      {weekOptions.error && <p role="alert" style={{ color: '#f87171' }}>{weekOptions.error}</p>}
      {data.warning && <p role="status" style={{ color: '#fbbf24' }}>{data.warning}</p>}
    </div>
    <div className="glass table-container" style={{ overflowX: 'auto' }}>
      <table><thead><tr>{WHATSAPP_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{rows.slice(currentPage * 100, (currentPage + 1) * 100).map((row, index) => <tr key={index}>{WHATSAPP_COLUMNS.map((column) => <td key={column}>{column === 'Mobnumber' && !row[column] ? 'Missing phone' : row[column]}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={WHATSAPP_COLUMNS.length}>{emptyMessage}</td></tr>}
        </tbody></table>
    </div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
      <button className="glass-btn" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage + 1} of {pageCount}</span>
      <button className="glass-btn" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
    </div>
  </div>
}
