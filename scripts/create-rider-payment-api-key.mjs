import { randomBytes } from 'node:crypto'
import { readFile, appendFile } from 'node:fs/promises'

const path = new URL('../.env.local', import.meta.url)
const text = await readFile(path, 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return ''
  throw error
})
const existing = text.match(/^RIDER_PAYMENT_API_KEY\s*=\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m)?.[1]
const key = existing || `rp_${randomBytes(32).toString('base64url')}`
if (!existing) await appendFile(path, `${text && !text.endsWith('\n') ? '\n' : ''}RIDER_PAYMENT_API_KEY=${key}\n`)
console.log(key)
