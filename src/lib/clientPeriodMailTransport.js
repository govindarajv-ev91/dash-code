export function validateClientPeriodMailerUrl(url) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '')) {
    throw new Error('The mail service is not connected. Configure its Apps Script deployment URL.')
  }
  return url
}

export function readMailStatus(url, requestId) {
  validateClientPeriodMailerUrl(url)
  return new Promise((resolve, reject) => {
    const callback = `ev91MailStatus_${crypto.randomUUID().replaceAll('-', '')}`
    const script = document.createElement('script')
    const cleanup = () => { clearTimeout(timer); delete window[callback]; script.remove() }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Mail service status check timed out. Check the inbox and Apps Script executions before sending again.')) }, 15000)
    window[callback] = (result) => { cleanup(); resolve(result) }
    script.onerror = () => { cleanup(); reject(new Error('Cannot read mail service status. Check the deployment URL and access settings.')) }
    script.src = `${url}?action=status&requestId=${encodeURIComponent(requestId)}&callback=${callback}&t=${Date.now()}`
    document.head.appendChild(script)
  })
}

export async function sendClientPeriodTestMail({ url, report, requestId, onStatus = () => {} }) {
  validateClientPeriodMailerUrl(url)
  const body = JSON.stringify({ action: 'sendClientPeriodTest', requestId, report })
  if (body.length > 250000) throw new Error('This city report is too large for the mail service. Nothing was sent.')
  // Apps Script responses cannot be read with a normal cross-origin POST. Poll
  // a request-ID-only JSONP endpoint for explicit MailApp acceptance instead.
  onStatus('Sending report to the mail service...')
  try { await fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body }) } catch {
    onStatus('Submission response was interrupted. Checking whether Google accepted the email...')
  }
  onStatus('Checking Google mail acceptance...')
  for (let attempt = 0; attempt < 12; attempt++) {
    const status = await readMailStatus(url, requestId)
    if (status.service && !status.requestId) throw new Error('The deployed Apps Script is outdated. Replace Code.gs and deploy a New version before sending again.')
    if (status.requestId !== requestId) throw new Error('Mail service returned a different request ID.')
    if (status.status === 'sent') return status
    if (status.status === 'failed') throw new Error(status.message || 'The mail service rejected this request.')
    onStatus(status.status === 'sending' ? 'Google is processing the email...' : 'Waiting for the mail service. Do not send again; the result is not confirmed yet.')
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error('Mail delivery is not confirmed. Check the inbox and Apps Script executions before sending again.')
}
