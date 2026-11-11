import { useEffect, useRef, useState } from 'react'
import { cityMailError, fetchMailRows, saveCityContact } from '../lib/cityMailDb'

const empty = { city: '', name: '', email_id: '', phone_number: '', cc: '' }
export default function CityMailContacts({ canManage }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  async function load() {
    try { setRows(await fetchMailRows('city_mail_contacts')); setError('') }
    catch (err) { setError(cityMailError(err)) }
  }
  useEffect(() => { let active = true; fetchMailRows('city_mail_contacts').then((data) => { if (active) setRows(data) }).catch((err) => { if (active) setError(cityMailError(err)) }); return () => { active = false } }, [])
  async function save(event) {
    event.preventDefault()
    if (!canManage || locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await saveCityContact(form); setForm(empty); await load(); setNotice('City contact saved. Scheduled emails use these To and CC addresses.') }
    catch (err) { setError(cityMailError(err)) }
    finally { locked.current = false; setBusy(false) }
  }
  return <section aria-label="City List">
    <h2>City List</h2>
    <p>One contact per city. Scheduled reports include Weekly and Monthly summaries. Separate multiple To or CC email addresses with commas.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!canManage && <p>Sign in as an administrator to manage city contacts.</p>}
    {canManage && <form className="glass source-master-form" onSubmit={save}>
      <h3>{form.id == null ? 'Add city' : 'Edit city'}</h3>
      {[['city', 'City'], ['name', 'Name'], ['email_id', 'Mail ID'], ['phone_number', 'Phone number'], ['cc', 'CC (comma separated)']].map(([key, label]) => <label key={key}>{label}<input required={['city', 'name', 'email_id'].includes(key)} type={key === 'phone_number' ? 'tel' : 'text'} value={form[key]} disabled={busy} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
      <button className="fsr-export-btn" disabled={busy}>Save city</button>
      {form.id != null && <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => setForm(empty)}>Cancel edit</button>}
    </form>}
    <button type="button" className="fsr-export-btn" disabled={busy} onClick={load}>Refresh cities</button>
    <div className="glass source-master-table-wrap"><table className="data-table"><thead><tr>{['City', 'Name', 'Mail ID', 'Phone number', 'CC'].map((label) => <th key={label}>{label}</th>)}{canManage && <th>Actions</th>}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{row.city}</td><td>{row.name}</td><td>{row.email_id}</td><td>{row.phone_number}</td><td>{row.cc}</td>{canManage && <td><button type="button" className="fsr-export-btn" disabled={busy} onClick={() => setForm(row)}>Edit city</button></td>}</tr>)}{!rows.length && <tr><td colSpan={canManage ? 6 : 5}>No city contacts yet.</td></tr>}</tbody>
    </table></div>
  </section>
}
