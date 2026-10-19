import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader, Pencil, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react'
import { deleteSourceMaster, fetchSourceMaster, saveSourceMaster, setSourceMasterActive, sourceMasterError } from './lib/sourceMasterDb'
import { normalizeSummaryCity } from './lib/citySummaryAliases'
import './source-master.css'

const EMPTY_FORM = { city: '', source_name: '', is_active: true }
const CITIES = ['Bangalore', 'Chennai', 'Delhi', 'Hyderabad', 'Mumbai', 'Mysore']

export default function SourceMaster({ canManage = false }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('All')
  const [status, setStatus] = useState('All')
  const [form, setForm] = useState(EMPTY_FORM)
  const [pendingRemove, setPendingRemove] = useState(null)
  const formRef = useRef(null)
  const request = useRef(0)
  const locked = useRef(false)

  const load = useCallback(async () => {
    const version = ++request.current
    setLoading(true)
    try {
      const data = await fetchSourceMaster({ includeInactive: true })
      if (version === request.current) { setRows(data); setError('') }
    } catch (failure) {
      if (version === request.current) setError(sourceMasterError(failure))
    } finally {
      if (version === request.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) load() })
    return () => { active = false; request.current += 1 }
  }, [load])

  const cities = useMemo(() => [...new Set(rows.map((row) => normalizeSummaryCity(row.city)))].sort(), [rows])
  const visible = useMemo(() => rows.filter((row) =>
    (city === 'All' || normalizeSummaryCity(row.city) === city) &&
    (status === 'All' || row.is_active === (status === 'Active')) &&
    `${row.city} ${row.source_name}`.toLowerCase().includes(search.trim().toLowerCase())
  ).sort((a, b) => a.city.localeCompare(b.city) || a.source_name.localeCompare(b.source_name)), [rows, city, status, search])

  async function change(action, message) {
    if (!canManage || locked.current) return
    locked.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await action()
      setNotice(message)
      await load()
    } catch (failure) { setError(sourceMasterError(failure)) }
    finally { locked.current = false; setBusy(false) }
  }

  function save(event) {
    event.preventDefault()
    change(async () => {
      await saveSourceMaster(form)
      setForm(EMPTY_FORM)
    }, form.id == null ? 'Source added.' : 'Source updated.')
  }

  function edit(row) {
    setForm({ id: row.id, city: row.city, source_name: row.source_name, is_active: row.is_active })
    setNotice(''); setError('')
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    formRef.current?.querySelector('input')?.focus()
  }

  function changeStatus(row, active) {
    if (row.is_active === active) return
    change(async () => {
      await setSourceMasterActive(row.id, active)
      if (form.id === row.id) setForm((current) => ({ ...current, is_active: active }))
    }, active ? 'Source activated.' : 'Source deactivated.')
  }

  return <div className="page-container source-master-page">
    <header className="header">
      <div><h1><Users size={24} /> Source List</h1>
        <p>Manage city-wise sources shown in Source Wise Data and EV91 Client Period Trend. Exports include all sources.</p></div>
      <button type="button" className="fsr-export-btn" disabled={loading || busy} onClick={load}>
        {loading ? <Loader size={16} className="spin" /> : <RefreshCw size={16} />} Refresh
      </button>
    </header>
    {error && <div className="glass source-master-message source-master-error" role="alert">{error}</div>}
    {notice && <div className="glass source-master-message" role="status">{notice}</div>}
    {!canManage && <p className="source-master-hint">Sign in with an administrator account to change Active/Inactive status, add, edit or remove sources.</p>}
    {canManage && <form className="glass source-master-form" onSubmit={save} ref={formRef}>
      <h2>{form.id == null ? 'Add source' : 'Edit source'}</h2>
      <label>City<input list="source-master-city-list" required value={form.city} disabled={busy}
        onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="Choose or enter a city" /></label>
      <datalist id="source-master-city-list">{[...new Set([...CITIES, ...rows.map((row) => row.city)])].sort().map((value) => <option key={value} value={value} />)}</datalist>
      <label className="source-master-name">Source name<input required value={form.source_name} disabled={busy}
        onChange={(event) => setForm({ ...form, source_name: event.target.value })} placeholder="Enter source name" /></label>
      <div className="source-master-status-field"><span>Source status</span>
        <div className="source-master-status-buttons" role="group" aria-label="Source form status">
          {[true, false].map((active) => <button key={String(active)} type="button" aria-pressed={form.is_active === active}
            data-status={active ? 'active' : 'inactive'} disabled={busy}
            onClick={() => setForm({ ...form, is_active: active })}>{active ? 'Active' : 'Inactive'}</button>)}
        </div>
      </div>
      <button type="submit" className="fsr-export-btn" disabled={busy || loading}>
        {busy ? <Loader size={16} className="spin" /> : <Plus size={16} />} {form.id == null ? 'Add source' : 'Save changes'}
      </button>
      {form.id != null && <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => setForm(EMPTY_FORM)}>Cancel edit</button>}
    </form>}
    <div className="glass source-master-filters">
      <label className="source-master-name"><span><Search size={14} /> Search sources</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Source name or city" /></label>
      <label>Filter city<select value={city} onChange={(event) => setCity(event.target.value)}><option value="All">All cities</option>{cities.map((value) => <option key={value}>{value}</option>)}</select></label>
      <div className="source-master-status-field"><span>Filter status</span>
        <div className="source-master-status-buttons" role="group" aria-label="Filter sources by status">
          {['All', 'Active', 'Inactive'].map((value) => <button type="button" key={value} aria-pressed={status === value}
            data-status={value.toLowerCase()} onClick={() => setStatus(value)}>{value}</button>)}
        </div>
      </div>
      <span className="source-master-hint">{visible.length} of {rows.length} sources · {rows.filter((row) => row.is_active).length} active</span>
    </div>
    {pendingRemove && <div className="glass source-master-message" role="alertdialog" aria-label="Remove source">
      <p>Remove <strong>{pendingRemove.source_name}</strong> ({pendingRemove.city}) from the source list? Historical data and exports are preserved.</p>
      <div className="source-master-actions">
        <button type="button" className="fsr-export-btn source-master-danger" disabled={busy || !canManage} onClick={() => change(async () => {
          await deleteSourceMaster(pendingRemove.id)
          if (form.id === pendingRemove.id) setForm(EMPTY_FORM)
          setPendingRemove(null)
        }, 'Source removed from the list.')}>Confirm remove</button>
        <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => setPendingRemove(null)}>Cancel</button>
      </div>
    </div>}
    <div className="glass source-master-table-wrap" aria-busy={loading}>
      <table className="data-table"><thead><tr><th>City</th><th>Source name</th><th>Status</th>{canManage && <th>Actions</th>}</tr></thead>
        <tbody>{loading ? <tr><td colSpan={canManage ? 4 : 3}>Loading sources...</td></tr> : visible.length ? visible.map((row) =>
          <tr key={row.id}><td>{row.city}</td><td>{row.source_name}</td><td>
            <div className="source-master-status-buttons" role="group" aria-label={`Status for ${row.source_name}`}>
              {[true, false].map((active) => <button type="button" key={String(active)}
                aria-pressed={row.is_active === active} data-status={active ? 'active' : 'inactive'}
                disabled={!canManage || busy || row.is_active === active}
                title={!canManage ? 'Sign in as an administrator to change source status.' : row.is_active === active ? 'Current status' : `Set source ${active ? 'active' : 'inactive'}`}
                onClick={() => changeStatus(row, active)}>{active ? 'Active' : 'Inactive'}</button>)}
            </div>
          </td>
            {canManage && <td><div className="source-master-actions">
              <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => edit(row)}><Pencil size={14} /> Edit</button>
              <button type="button" className="fsr-export-btn source-master-danger" disabled={busy} onClick={() => setPendingRemove(row)}><Trash2 size={14} /> Remove</button>
            </div></td>}
          </tr>) : <tr><td colSpan={canManage ? 4 : 3}>{rows.length ? 'No sources match these filters.' : 'No sources yet.'}</td></tr>}</tbody>
      </table>
    </div>
  </div>
}
