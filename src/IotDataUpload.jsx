import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader, Upload } from 'lucide-react'
import {
  attachEv91VehicleLookup, allowsMultiFilePerDate, downloadIotDataTemplate,
  downloadUnmatchedVehicles, IOT_SOURCE_TEMPLATES, parseIotWorkbookArrayBuffer, toIotDbRows,
} from './lib/iotDataParse'
import { fetchIotLastUploadsBySource, saveIotRows } from './lib/iotDataDb'
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
  const [lastUploads, setLastUploads] = useState({})
  const [historyError, setHistoryError] = useState('')
  const busyRef = useRef(false)
  const fileInputRef = useRef(null)
  const template = IOT_SOURCE_TEMPLATES[source]
  const unmatched = preview.filter((row) => !row.lookup_matched)

  const refreshSourceHistory = useCallback(async () => {
    try {
      setLastUploads(await fetchIotLastUploadsBySource())
      setHistoryError('')
    } catch {
      setHistoryError('Upload history by provider is unavailable. You can still read older dates using the report below.')
    }
  }, [])

  useEffect(() => { void refreshSourceHistory() }, [refreshSourceHistory])

  const chooseSource = (key) => {
    if (busyRef.current) return
    setSource(key); setPendingRows([]); setPreview([]); setFileName(''); setMessage(null)
  }

  const chooseFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPreview([]); setPendingRows([]); setMessage(null); setFileName(file.name)
    try {
      if (!/\.(xlsx?|csv)$/i.test(file.name)) throw new Error('Choose an Excel (.xlsx or .xls) or CSV file.')
      const { rows } = parseIotWorkbookArrayBuffer(await file.arrayBuffer(), source)
      if (!rows.length) throw new Error('The first worksheet has no data. Fill in the selected provider template and choose the file again.')
      const resolved = attachEv91VehicleLookup(rows, await fetchAllEv91Vehicles())
      setPreview(resolved)
      // Retain the exact payload and batch ID across retries, as in the original project.
      setPendingRows(toIotDbRows(resolved, crypto.randomUUID()))
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
      await refreshSourceHistory()
      await onSaved?.({ dateFrom: dates[0], dateTo: dates[dates.length - 1], source })
    } catch (error) {
      setMessage({ error: true, text: error.message || 'Upload failed. You can retry the same file safely.' })
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  return (
    <section className="glass" aria-label="IoT file upload" style={{ padding: '1rem', marginBottom: '1rem' }}>
      <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Upload IoT data</h2>
      <div role="group" aria-label="IoT upload source" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
        {IOT_SOURCES.map((item) => {
          const history = lastUploads[item.value]
          return <button key={item.value} type="button" className={source === item.value ? 'btn-primary' : 'glass-btn'}
            aria-pressed={source === item.value} onClick={() => chooseSource(item.value)} disabled={busy}
            style={{ padding: '0.75rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <strong>{item.label}</strong>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{history
              ? 'Latest data: ' + history.date + ' · ' + history.vehicles.toLocaleString() + ' vehicles'
              : 'Select provider to upload'}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
              File count (latest date): <strong>{history ? history.files.toLocaleString() : '—'}</strong>
            </span>
            {history?.uploadedAt && <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>Uploaded: {formatLastUploadAt(history.uploadedAt)}</span>}
          </button>
        })}
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Choose the provider and upload its Excel/CSV export. New data is added to the existing IoT history. Older dates remain available.</p>
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
        <summary>Expected columns for {template.label}</summary>
        <p>{template.headers.join(' · ')}</p>
        <p>Vehicle: {template.requiredFields.vehicle} · Date: {template.requiredFields.date} · Daily KM: {template.requiredFields.distance}.</p>
        <p>Vehicle numbers, chassis numbers, motor IDs, and composite identifiers are matched against EV91 Vehicles. Each file is saved together.</p>
      </details>
      {historyError && <p role="status" style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{historyError}</p>}
      {fileName && <p style={{ fontSize: '0.85rem' }}>{fileName} · {preview.length.toLocaleString()} valid rows · {(preview.length - unmatched.length).toLocaleString()} matched · {unmatched.length.toLocaleString()} unmatched</p>}
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
