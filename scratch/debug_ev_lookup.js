import { createClient } from '@supabase/supabase-js'
import { format } from 'date-fns'

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseFleetDate(dateStr) {
  if (dateStr == null || dateStr === '') return null
  let s = dateStr.toString().trim()
  if (!s) return null
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date((parseFloat(s) - 25569) * 86400 * 1000)
    if (!isNaN(d.getTime())) return startOfDay(d)
  }
  const datePart = s.split(/\s+/)[0]
  const slash = datePart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (slash) {
    const day = parseInt(slash[1], 10)
    const month = parseInt(slash[2], 10) - 1
    let year = parseInt(slash[3], 10)
    if (year < 100) year += 2000
    const d = new Date(year, month, day)
    if (!isNaN(d.getTime())) return startOfDay(d)
  }
  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10))
    if (!isNaN(d.getTime())) return startOfDay(d)
  }
  const parsed = new Date(s)
  return isNaN(parsed.getTime()) ? null : startOfDay(parsed)
}

function normalizeRiderIdKey(value) {
  return (value ?? '').toString().trim().toUpperCase().replace(/[_\s-]+/g, '-')
}

const supabase = createClient(
  'https://arnxvnkednpzyzyfculx.supabase.co',
  'sb_publishable_o04xyDV5z09-dAfxP6awvA_FIdop2lH'
)

const codes = ['CHN129-R0829', 'CHN46-R2952', 'WGC01-R3605', 'CHN65-R0910', 'NOD10-R3547', 'MYQ09-R0602', 'CHN129-R0749']

const { data: riderRows, error } = await supabase
  .from('rider_metrics')
  .select('date_record,worker_code,type1,type2,fl')

if (error) {
  console.error(error)
  process.exit(1)
}

console.log('Total rider rows:', riderRows.length)

const targetKey = format(parseFleetDate('29/05/2026'), 'dd/MM/yyyy')
console.log('Target date key:', targetKey)

const index = new Map()
for (const row of riderRows) {
  const worker = (row.worker_code ?? '').toString().trim()
  if (!worker) continue
  const date = parseFleetDate(row.date_record)
  if (!date) continue
  const key = `${format(date, 'dd/MM/yyyy')}|${normalizeRiderIdKey(worker)}`
  index.set(key, { type1: row.type1, type2: row.type2 })
}

for (const code of codes) {
  const key = `${targetKey}|${normalizeRiderIdKey(code)}`
  const hit = index.get(key)
  console.log(code, '=>', hit ? hit : 'NOT FOUND')
}

// fuzzy search by rider suffix
for (const code of codes) {
  const suffix = code.split('-').pop()
  const fuzzy = riderRows.filter((r) => {
    const d = parseFleetDate(r.date_record)
    return d && format(d, 'dd/MM/yyyy') === targetKey && (r.worker_code || '').includes(suffix)
  })
  if (fuzzy.length && !index.has(`${targetKey}|${normalizeRiderIdKey(code)}`)) {
    console.log('Fuzzy on date for', code, ':', fuzzy.slice(0, 2))
  }
}

const dateSamples = [...new Set(riderRows.map((r) => r.date_record))].slice(0, 20)
console.log('Unique date_record samples:', dateSamples)

const onDate = riderRows.filter((r) => {
  const d = parseFleetDate(r.date_record)
  return d && format(d, 'dd/MM/yyyy') === targetKey
})
console.log('Rows on target date:', onDate.length)
console.log('Sample on date:', onDate.slice(0, 3))

// type1 distribution on that date
const types = {}
for (const r of onDate) {
  const t = (r.type1 || 'null').toString()
  types[t] = (types[t] || 0) + 1
}
console.log('type1 distribution on date:', types)
