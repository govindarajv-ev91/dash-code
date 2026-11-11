import '../source-master.css'
import { useEffect, useRef, useState } from 'react'
import { cityMailError, fetchMailRows, saveMailSchedule } from '../lib/cityMailDb'
import { MAIL_DAYS, scheduleTime } from '../lib/cityMailSettings'

const empty = { contact_id: '', day_of_week: '1', hour: '9', minute: '00', meridiem: 'AM', is_active: true }
export default function ClientPeriodSchedulePanel({ canManage }) {
  const [contacts, setContacts] = useState([]), [schedules, setSchedules] = useState([]), [runs, setRuns] = useState([])
  const [form, setForm] = useState(empty), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const locked = useRef(false)
  async function load() {
    const [cities, settings, history] = await Promise.all([fetchMailRows('city_mail_contacts'), fetchMailRows('client_period_mail_schedules'), fetchMailRows('client_period_mail_runs')])
    setContacts(cities); setSchedules(settings); setRuns(history)
  }
  useEffect(() => { let active = true; Promise.resolve().then(() => { if (active) load().catch((err) => setError(cityMailError(err))) }); return () => { active = false } }, [])
  async function save(event) {
    event.preventDefault()
    if (!canManage || locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    try { await saveMailSchedule({ ...form, send_time: scheduleTime(form.hour, form.minute, form.meridiem) }); await load(); setForm(empty); setNotice('Schedule saved. The Apps Script scheduler must be installed once to send automatically.') }
    catch (err) { setError(cityMailError(err)) }
    finally { locked.current = false; setBusy(false) }
  }
  function edit(row) {
    const hour = Number(row.send_time.slice(0, 2))
    setForm({ ...row, day_of_week: row.day_of_week === null ? '' : String(row.day_of_week), hour: String(hour % 12 || 12), minute: row.send_time.slice(3, 5), meridiem: hour >= 12 ? 'PM' : 'AM' })
  }
  return <section className="glass client-period-schedule" style={{ padding: 18, marginBottom: 18 }} aria-label="Auto send settings">
    <h2>Auto send — IST</h2><p>Send both Weekly and Monthly reports to the city’s Mail ID and CC list, even when this page is closed. Manage recipients in Source List → City List. Delivery begins on a scheduler check after the chosen time.</p>
    <p>Last run shows the previous recorded result, even after you change the send time. A failed attempt today needs the Apps Script retry function; changing the time does not reset it.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {canManage ? <form className="source-master-form" onSubmit={save}>
      <label>City<select required value={form.contact_id} disabled={busy} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}><option value="">Choose city</option>{contacts.map((row) => <option key={row.id} value={row.id}>{row.city} — {row.email_id}</option>)}</select></label>
      <label>Day<select value={form.day_of_week} disabled={busy} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}><option value="">Every day</option>{MAIL_DAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
      <label>Hour<select value={form.hour} disabled={busy} onChange={(e) => setForm({ ...form, hour: e.target.value })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>Minute<select value={form.minute} disabled={busy} onChange={(e) => setForm({ ...form, minute: e.target.value })}>{Array.from({ length: 60 }, (_, i) => <option key={i}>{String(i).padStart(2, '0')}</option>)}</select></label>
      <label>AM / PM<select value={form.meridiem} disabled={busy} onChange={(e) => setForm({ ...form, meridiem: e.target.value })}><option>AM</option><option>PM</option></select></label>
      <label><input type="checkbox" checked={form.is_active} disabled={busy} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Enabled</label>
      <button className="fsr-export-btn" disabled={busy}>{form.id ? 'Save changes' : 'Add schedule'}</button>{form.id && <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => setForm(empty)}>Cancel edit</button>}
    </form> : <p>Administrator sign-in is required to view and manage schedules.</p>}
    <button type="button" className="fsr-export-btn" disabled={busy} onClick={() => load().catch((err) => setError(cityMailError(err)))}>Refresh schedules</button>
    <div style={{ overflowX: 'auto' }}><table className="data-table"><thead><tr><th>City</th><th>Day</th><th>Time (IST)</th><th>Status</th><th>Last run</th>{canManage && <th>Actions</th>}</tr></thead><tbody>{schedules.map((row) => {
      const latest = runs.filter((run) => run.schedule_id === row.id).sort((a, b) => b.run_date.localeCompare(a.run_date))[0]
      const hour = Number(row.send_time.slice(0, 2))
      return <tr key={row.id}><td>{contacts.find((c) => c.id === row.contact_id)?.city || 'Unknown'}</td><td>{row.day_of_week === null ? 'Every day' : MAIL_DAYS[row.day_of_week]}</td><td>{hour % 12 || 12}:{row.send_time.slice(3, 5)} {hour >= 12 ? 'PM' : 'AM'}</td><td>{row.is_active ? 'Enabled' : 'Paused'}</td><td>{latest ? `${latest.run_date}: ${latest.status} ${latest.message || ''}` : 'No runs yet'}</td>{canManage && <td><button type="button" className="fsr-export-btn" disabled={busy} onClick={() => edit(row)}>Edit / pause</button></td>}</tr>
    })}{!schedules.length && <tr><td colSpan={canManage ? 6 : 5}>No schedules yet.</td></tr>}</tbody></table></div>
  </section>
}
