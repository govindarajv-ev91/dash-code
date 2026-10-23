import { Buffer } from 'node:buffer'

const WALLET_URL = 'https://dashboard.ev91riderz.com/api/v1/security-deposit/export/wallet'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function walletResponse(method) {
  if (method !== 'GET') {
    return Response.json({ message: 'Method not allowed' }, {
      status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
    })
  }
  try {
    const upstream = await fetch(WALLET_URL, {
      headers: { Accept: XLSX_TYPE }, cache: 'no-store', signal: AbortSignal.timeout(25000),
    })
    if (!upstream.ok) throw new Error(`EV91 SD wallet returned HTTP ${upstream.status}`)
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (!upstream.headers.get('content-type')?.toLowerCase().includes(XLSX_TYPE) ||
        bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('EV91 SD wallet did not return an Excel workbook.')
    }
    return new Response(bytes, { headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': 'attachment; filename="ev91-sd-wallet.xlsx"',
      'Cache-Control': 'no-store',
    } })
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'EV91 SD wallet timed out. Please retry.'
      : error?.message || 'Unable to reach EV91 SD wallet.'
    return Response.json({ message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

export default async function handler(req, res) {
  const response = await walletResponse(req?.method || 'GET')
  if (!res) return response
  response.headers.forEach((value, name) => res.setHeader(name, value))
  const bytes = Buffer.from(await response.arrayBuffer())
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    return res.status(response.status).send(bytes)
  }
  res.statusCode = response.status
  res.end(bytes)
}
