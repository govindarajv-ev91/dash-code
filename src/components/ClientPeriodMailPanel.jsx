import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Mail } from 'lucide-react'
import { fetchRiderPaymentsForPeriod } from '../lib/riderPaymentDb'
import { fetchSourceMaster } from '../lib/sourceMasterDb'
import { buildSourceMasterIndex } from '../lib/sourceMaster'
import { buildClientPeriodMailReport, renderClientPeriodMailHtml, clientPeriodMailRange, CLIENT_PERIOD_TEST_TO } from '../lib/clientPeriodMailer'
import { sendClientPeriodTestMail, readMailStatus } from '../lib/clientPeriodMailTransport'
import { loadClientPeriodMailLogo } from '../lib/clientPeriodMailLogo'

const MAILER_URL = import.meta.env.VITE_CLIENT_PERIOD_MAILER_SCRIPT_URL || ''
const control = { padding: '8px', borderRadius: 6, border: '1px solid #64748b', background: '#172338', color: '#fff' }

export default function ClientPeriodMailPanel({ cities }) {
  const [expanded, setExpanded] = useState(false)
  const [city, setCity] = useState('')
  const [logo, setLogo] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const running = useRef(false)
  const invalidate = () => { setPreview(null); setMessage(''); setError('') }

  async function prepare() {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setMessage(''); setPreview(null)
    try {
      if (!city) throw new Error('Choose the city whose data should be emailed.')
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const [weeklyPayments, monthlyPayments, sources, onboarding, emailLogo] = await Promise.all([
        fetchRiderPaymentsForPeriod({ ...clientPeriodMailRange('weekly', today), monthly: false, slim: true, force: true }),
        fetchRiderPaymentsForPeriod({ ...clientPeriodMailRange('monthly', today), monthly: true, slim: true, force: true }),
        fetchSourceMaster(), import('../lib/riderOnboardingDb').then(({ fetchRiderOnboardingRows }) =>
          fetchRiderOnboardingRows({ force: true, full: true })),
        logo || loadClientPeriodMailLogo(),
      ])
      const sourceIndex = buildSourceMasterIndex(sources)
      const reports = ['weekly', 'monthly'].map((mode, index) => buildClientPeriodMailReport({ payments: index === 0 ? weeklyPayments : monthlyPayments, onboarding, sourceIndex, city, mode, today }))
      if (!reports.some((report) => report.paymentRowCount)) throw new Error('No payment data for this city in the email date range. Nothing will be sent.')
      const report = { version: 1, mode: 'both', city: reports[0].city, fromDate: '2026-03-30', toDate: today, reports, logo: emailLogo }
      setPreview({ report, html: renderClientPeriodMailHtml(report), requestId: crypto.randomUUID() })
    } catch (err) { setError(err.message || 'Unable to prepare the email.') }
    finally { running.current = false; setBusy(false) }
  }

  async function chooseLogo(event) {
    const file = event.target.files?.[0]
    invalidate(); setLogo('')
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 50000) {
      setError('Choose a PNG or JPEG logo smaller than 50 KB.'); return
    }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file)
      })
      setLogo(data)
    } catch { setError('Unable to read the logo image.') }
  }

  async function send() {
    if (!preview || running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    setPreview((previous) => ({ ...previous, attempted: true }))
    try {
      const result = await sendClientPeriodTestMail({ url: MAILER_URL, report: preview.report, requestId: preview.requestId, onStatus: setMessage })
      setMessage(`Accepted by Google for ${result.to}${result.acceptedAt ? ` at ${new Date(result.acceptedAt).toLocaleString()}` : ''}. Check the inbox/spam for delivery.`)
      setPreview((previous) => previous ? { ...previous, sent: true } : previous)
    } catch (err) { setMessage(''); setError(err.message || 'Unable to confirm the email. Check the inbox before retrying.') }
    finally { running.current = false; setBusy(false) }
  }

  async function checkStatus() {
    if (!preview || running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('Checking email status without resending...')
    try {
      const result = await readMailStatus(MAILER_URL, preview.requestId)
      if (result.requestId !== preview.requestId) throw new Error('Status unavailable. Update the Apps Script deployment to the latest version.')
      if (result.status === 'sent') {
        setMessage(`Accepted by Google for ${result.to}${result.acceptedAt ? ` at ${new Date(result.acceptedAt).toLocaleString()}` : ''}. Check inbox/spam for delivery.`)
        setPreview((previous) => ({ ...previous, sent: true }))
      } else if (result.status === 'failed') throw new Error(`Failed: ${result.message}`)
      else setMessage(result.status === 'sending' ? 'Sending: Google is processing the email.' : 'Not confirmed: no result is available yet. Check Apps Script Executions and the inbox before preparing another email.')
    } catch (err) { setMessage(''); setError(err.message || 'Status check failed. No additional email was sent.') }
    finally { running.current = false; setBusy(false) }
  }

  return <div className="glass" role="region" aria-label="Client period test email" style={{ padding: 18, marginBottom: 18 }}>
    <h3 style={{ margin: 0 }}>
      <button type="button" aria-expanded={expanded} aria-controls="client-period-test-email-content" onClick={() => setExpanded((previous) => !previous)} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        {expanded ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
        <Mail size={17} aria-hidden="true" /> City report email — manual test
      </button>
    </h3>
    <div id="client-period-test-email-content" hidden={!expanded}>
    <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Both Weekly and Monthly reports in one email, with all four tables in each. Weekly: latest 10 calendar weeks. Monthly: March 2026 through today. Independent of the page period selection.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
      <label>Mail city<br /><select aria-label="Mail city" value={city} disabled={busy} onChange={(event) => { setCity(event.target.value); invalidate() }} style={control}>
        <option value="">Choose a city</option>{cities.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>Replace logo (optional, PNG/JPEG, max 50 KB)<br /><input aria-label="Company logo" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={chooseLogo} style={control} /><small style={{ display: 'block' }}>The existing company logo is included automatically.</small></label>
      <label>Test recipient<br /><input aria-label="Test recipient" readOnly value={CLIENT_PERIOD_TEST_TO} style={{ ...control, width: 270 }} /></label>
      <button type="button" className="fsr-export-btn" disabled={busy || !city} onClick={prepare}>{busy ? 'Working…' : 'Preview email'}</button>
    </div>
    {error && <p role="alert" style={{ color: '#f87171' }}>{error}</p>}
    {message && <p role="status" aria-live="polite" style={{ background: '#17365d', padding: 12, borderRadius: 6 }}>{message}</p>}
    {preview && <div style={{ marginTop: 16 }}>
      {!preview.sent && <iframe title="City report email preview" sandbox="" srcDoc={preview.html} style={{ width: '100%', height: 480, border: '1px solid #334155', background: '#0f172a' }} />}
      <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        {!preview.sent && <button type="button" className="fsr-export-btn" onClick={send} disabled={busy || preview.attempted || !MAILER_URL}>{preview.attempted ? 'Email submitted' : 'Send test email'}</button>}
        {preview.sent && <strong style={{ color: '#4ade80' }}>Done — email accepted. Preview closed.</strong>}
        {preview.attempted && <button type="button" className="fsr-export-btn" disabled={busy} onClick={checkStatus}>Check email status</button>}
        {preview.attempted && <small>Request: {preview.requestId}. Status checks do not resend.</small>}
        {!MAILER_URL && <span role="status">Mail service is not connected yet. Preview is available.</span>}
      </div>
    </div>}
    </div>
  </div>
}
