import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader, RefreshCw, Upload } from 'lucide-react'
import {
  attachEv91VehicleLookup, allowsMultiFilePerDate, downloadIotDataTemplate,
  downloadUnmatchedVehicles, IOT_SOURCE_TEMPLATES, parseIotWorkbookArrayBuffer, toIotDbRows,
  getOpspodUploadDate,
} from './lib/iotDataParse'
import { fetchExistingOpspodVehicleDays, fetchIotLastUploadsBySource, getCachedIotUploadHistory, saveIotRows } from './lib/iotDataDb'
import { filterOpspodCatchupRows } from './lib/iotUpload/opspodCatchup'
import { fetchAllEv91Vehicles } from './lib/ev91VehiclesApi'
import { formatIotSource, IOT_SOURCES } from './lib/iotDataSources'
import { formatLastUploadAt } from './lib/paymentMonthList'

export default function IotDataUpload({ disabled, onSaved }) {
  const [source, setSource] = useState('opspod_ev91')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState([])
  const [pendingRows, setPendingRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [lastUploads, setLastUploads] = useState(getCachedIotUploadHistory)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyErrors, setHistoryErrors] = useState({})
  const [importInfo, setImportInfo] = useState(null)
  const busyRef = useRef(false)
  const fileInputRef = useRef(null)
  const template = IOT_SOURCE_TEMPLATES[source]
  const unmatched = preview.filter((row) => !row.lookup_matched)

  const refreshSourceHistory = useCallback(async ({ force = false } = {}) => {
    setHistoryLoading(true)
    try {
      const result = await fetchIotLastUploadsBySource({ force })
      setLastUploads(result.history)
      setHistoryErrors(result.errors)
    } catch {
      setHistoryErrors(Object.fromEntries(IOT_SOURCES.map((item) => [item.value, 'Upload history is temporarily unavailable.'])))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSourceHistory()
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refreshSourceHistory() }
    const interval = window.setInterval(refreshVisible, 60000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [refreshSourceHistory])

  useEffect(() => {
    if (!Object.keys(historyErrors).length) return
    const retry = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void refreshSourceHistory()
    }, 15000)
    return () => window.clearTimeout(retry)
  }, [historyErrors, refreshSourceHistory])

  const chooseSource = (key) => {
    if (busyRef.current) return
    setSource(key); setPendingRows([]); setPreview([]); setFileName(''); setMessage(null); setImportInfo(null)
  }

  const chooseFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPreview([]); setPendingRows([]); setMessage(null); setFileName(file.name); setImportInfo(null)
    try {
      if (!/\.(xlsx?|csv)$/i.test(file.name)) throw new Error('Choose an Excel (.xlsx or .xls) or CSV file.')
      const { rows, importInfo: info } = parseIotWorkbookArrayBuffer(await file.arrayBuffer(), source)
      if (!rows.length) throw new Error('The first worksheet has no vehicle data. Choose a report containing vehicle rows and try again.')
      const isOpspodDaywise = info?.format === 'opspod_daywise'
      const [vehicles, existingRows] = await Promise.all([
        fetchAllEv91Vehicles(),
        isOpspodDaywise ? fetchExistingOpspodVehicleDays(info.dateFrom, info.dateTo) : Promise.resolve([]),
      ])
      const resolved = attachEv91VehicleLookup(rows, vehicles)
      const catchup = isOpspodDaywise ? filterOpspodCatchupRows(resolved, existingRows) : { rows: resolved, alreadySaved: 0 }
      setPreview(catchup.rows)
      setImportInfo(info ? {
        ...info, alreadySaved: catchup.alreadySaved,
        newDates: [...new Set(catchup.rows.map((row) => row.run_date))].sort(),
      } : null)
      if (isOpspodDaywise && !catchup.rows.length) {
        setMessage({ error: false, text: 'All completed vehicle/date records in this report are already saved. No new rows to upload.' })
      }
      // Retain the exact payload and batch ID across retries, as in the original project.
      setPendingRows(toIotDbRows(catchup.rows, crypto.randomUUID()))
    } catch (error) {
      setMessage({ error: true, text: error.message || 'Could not read the file.' })
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  const save = async () => {
    if (!pendingRows.length || disabled || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      const { inserted, skipped } = await saveIotRows(pendingRows)
      const dates = pendingRows.map((row) => row.run_date).sort()
      setPendingRows([])
      setMessage({ error: false, text: 'Saved ' + inserted.toLocaleString() + ' ' + formatIotSource(source) + ' rows. ' + skipped.toLocaleString() + ' duplicate rows skipped. Older dates are kept.' })
      await refreshSourceHistory({ force: true })
      await onSaved?.({ dateFrom: dates[0], dateTo: dates[dates.length - 1], source })
    } catch (error) {
      setMessage({ error: true, text: error.message || 'Upload failed. You can retry the same file safely.' })
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  return (
    <section className="glass" aria-label="IoT file upload" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Upload IoT data</h2>
        <button type="button" className="glass-btn" onClick={refreshSourceHistory} disabled={historyLoading}>
          <RefreshCw size={14} className={historyLoading ? 'spin' : undefined} /> Refresh history
        </button>
      </div>
      <div role="group" aria-label="IoT upload source" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
        {IOT_SOURCES.map((item) => {
          const history = lastUploads[item.value]
          const historyError = historyErrors[item.value]
          return <button key={item.value} type="button" className={source === item.value ? 'btn-primary' : 'glass-btn'}
            aria-pressed={source === item.value} onClick={() => chooseSource(item.value)} disabled={busy}
            style={{ padding: '0.75rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <strong>{item.label}</strong>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{history
              ? 'Latest data: ' + history.date + ' · ' + history.vehicles.toLocaleString() + ' unique vehicles'
              : historyError ? 'Upload history unavailable'
                : historyLoading ? 'Loading upload history…' : 'No uploads yet'}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
              File count (latest date): <strong>{history ? history.files.toLocaleString() : historyError || historyLoading ? '—' : '0'}</strong>
            </span>
            {history?.uploadedAt && <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>Uploaded: {formatLastUploadAt(history.uploadedAt)}</span>}
            {historyError && <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{history ? 'Showing previous history. Retrying automatically…' : 'Retrying automatically…'}</span>}
          </button>
        })}
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Choose the provider and upload its Excel/CSV export. New data is added to the existing IoT history. Older dates remain available.</p>
      {source === 'opspod_ev91' && <p style={{ color: 'var(--accent-blue)', fontSize: '0.85rem' }}>Upload the original Daywise Distance export directly. Missing vehicle/day records through yesterday ({getOpspodUploadDate().split('-').reverse().join('-')}, India time) are picked automatically, including missed holiday uploads. Existing records are skipped.</p>}
      {source === 'alt_mobility' && <p style={{ color: 'var(--accent-blue)', fontSize: '0.85rem' }}>Upload the original Alt Mobility export directly. Date columns such as 2026-10-01 and 2026-10-02 supply daily KM automatically. Single-day and multi-day downloads are supported.</p>}
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Vehicle lookup uses EV91 Vehicles. The full inventory is cached for 5 minutes for faster repeat uploads.</p>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{allowsMultiFilePerDate(source)
        ? 'Opspod permits more files on the same date; existing vehicle/date rows are skipped.'
        : 'This provider accepts one upload per date. A file containing an already uploaded date is rejected without saving any rows.'}</p>
      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="glass-btn" onClick={() => downloadIotDataTemplate(source)} disabled={busy}><Download size={16} /> Download template</button>
        <button type="button" className="glass-btn" onClick={() => fileInputRef.current?.click()} disabled={busy || disabled}><Upload size={16} /> Choose file</button>
        <input ref={fileInputRef} type="file" aria-label="Choose IoT file" accept=".xlsx,.xls,.csv" onChange={chooseFile} disabled={busy || disabled} style={{ display: 'none' }} />
        <button type="button" className="btn-primary" onClick={save} disabled={busy || disabled || !pendingRows.length}>
          {busy ? <Loader size={16} className="spin" /> : <Upload size={16} />} Save IoT data
        </button>
        {unmatched.length > 0 && <button type="button" className="glass-btn" disabled={busy}
          onClick={() => downloadUnmatchedVehicles(unmatched, { fileNameHint: fileName })}><Download size={16} /> Download unmatched ({unmatched.length.toLocaleString()})</button>}
      </div>
      <details style={{ fontSize: '0.8rem', marginTop: '0.85rem', color: 'var(--text-dim)' }}>
        <summary>Supported formats for {template.label}</summary>
        {source === 'opspod_ev91' && <p>Daywise exports: keep the title, Month or Duration row, Object, and numbered day columns (1–31). ID Name, Branch, and Company columns are optional. Completed dates are checked against saved records for each vehicle. Daily KM comes from numbered day columns; Total Distance is the monthly total.</p>}
        {source === 'alt_mobility' && <p>Original export: reg_no and one or more YYYY-MM-DD columns. Each date column supplies that day's KM for the vehicle. The total_distance column contains the report total. Dates are read directly from the headers.</p>}
        <p>{['opspod_ev91', 'alt_mobility'].includes(source) ? 'Optional daily template: ' : ''}{template.headers.join(' · ')}</p>
        <p>{['opspod_ev91', 'alt_mobility'].includes(source) ? 'Daily template fields — ' : ''}Vehicle: {template.requiredFields.vehicle} · Date: {template.requiredFields.date} · Daily KM: {template.requiredFields.distance}.</p>
        <p>Vehicle numbers, chassis numbers, motor IDs, and composite identifiers are matched against EV91 Vehicles. Each file is saved together.</p>
      </details>
      {fileName && <p style={{ fontSize: '0.85rem' }}>{fileName} · {preview.length.toLocaleString()} {importInfo?.format === 'opspod_daywise' ? 'new rows' : 'valid rows'} · {(preview.length - unmatched.length).toLocaleString()} matched · {unmatched.length.toLocaleString()} unmatched</p>}
      {importInfo?.format === 'opspod_daywise' && <div role="status" style={{ color: 'var(--accent-blue)', fontSize: '0.85rem' }}>
        <p>Automatic catch-up: {importInfo.dateFrom.split('-').reverse().join('-')} to {importInfo.dateTo.split('-').reverse().join('-')} ({importInfo.dayCount} completed days). {importInfo.alreadySaved.toLocaleString()} already saved rows skipped.</p>
        {importInfo.newDates.length > 0 && <p>Dates ready to save: {importInfo.newDates.map((date) => date.split('-').reverse().join('-')).join(', ')}.</p>}
      </div>}
      {importInfo?.format === 'alt_mobility_daywise' && <p role="status" style={{ color: 'var(--accent-blue)', fontSize: '0.85rem' }}>Alt Mobility import: {importInfo.dayCount} date column(s). Dates ready to save: {importInfo.dates.map((date) => date.split('-').reverse().join('-')).join(', ')}. Each day's KM is saved separately.</p>}
      {message && <p role={message.error ? 'alert' : 'status'} style={{ color: message.error ? '#fbbf24' : '#4ade80' }}>{message.text}</p>}
      {preview.length > 0 && <div className="table-container" style={{ maxHeight: '260px', marginTop: '0.75rem' }}>
        <table><thead><tr><th>Raw vehicle ID</th><th>Vehicle number</th><th>Run date</th><th>Distance (KM)</th><th>Source</th><th>Lookup</th></tr></thead>
          <tbody>{preview.slice(0, 10).map((row, index) => <tr key={index}>
            <td>{row.raw_vehicle_id}</td><td>{row.vehicle_number || 'Unmatched'}</td><td>{row.run_date}</td>
            <td>{row.total_distance.toLocaleString('en-IN')}</td><td>{formatIotSource(row.data_source)}</td><td>{row.lookup_match_type || 'Unmatched'}</td>
          </tr>)}</tbody>
        </table>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Preview of the first {Math.min(preview.length, 10)} rows. All distances are saved in KM.</p>
      </div>}
    </section>
  )
}
