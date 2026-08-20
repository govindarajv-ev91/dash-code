import React, { useState, useMemo, useDeferredValue, useEffect, useCallback } from 'react'
import { 
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { 
  TrendingUp,
  Users,
  Truck,
  Calendar,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  X,
  Download,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { format, subDays, parseISO, startOfDay, eachDayOfInterval } from 'date-fns'
import {
  toMetricDateKey,
  selectOverviewOrderRows,
} from './lib/mergeRiderMetrics'
import {
  fetchAllEv91MisData,
  summarizeCurrentStatusRows,
  currentStatusDistributionSeries,
  countOverallDeployReturnInRange,
} from './lib/ev91MisApi'
import { fetchEv91OverallStatusAll } from './lib/ev91EvLookup'
import { fetchRiderPaymentsForRevenue } from './lib/riderPaymentDb'
import {
  buildMonthlyRevenueSeries,
  buildFyCompareMetric,
  buildClientMonthLineSeries,
  formatInr,
  formatCompactCount,
  currentIndianFinancialYearLabel,
} from './lib/paymentHistoryReport'
import { fetchIotDataInRange } from './lib/iotDataDb'
import {
  KM_PRODUCTIVITY_BUCKETS,
  buildVehicleKmProductivityTable,
  buildKmProductivityDatePresets,
  downloadVehicleKmProductivityDetails,
} from './lib/vehicleKmProductivityReport'

const COLORS = ['#6366f1', '#38bdf8', '#a855f7', '#fb7185', '#4ade80']
/** Line chart colors for client month-wise metrics. */
const CLIENT_LINE_COLORS = {
  revenue: '#38bdf8',
  orders: '#4ade80',
  riders: '#c084fc',
}

const KM_RANGE_PRESETS = [
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'custom', label: 'Custom' },
]

function KmProductivityTable({ title, report, loading, rowLabel = 'City' }) {
  const rows = report?.rows || report?.cities || []
  const totals = report?.totals || null
  const vehicleCount = report?.vehicleCount || 0
  const withKmCount = report?.withKmCount || 0
  const isClient = rowLabel === 'Client'

  const stickyCity = {
    position: 'sticky',
    left: 0,
    zIndex: 3,
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    whiteSpace: 'nowrap',
    minWidth: isClient ? 140 : 110,
    maxWidth: isClient ? 220 : 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    background: '#0f172a',
    boxShadow: '4px 0 8px rgba(0,0,0,0.25)',
  }

  const stickyHead = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    textAlign: 'center',
    padding: '0.5rem 0.4rem',
    whiteSpace: 'nowrap',
    background: '#1e293b',
    minWidth: 72,
  }

  const stickyCityHead = {
    ...stickyCity,
    top: 0,
    zIndex: 4,
    background: '#1e293b',
    fontWeight: 700,
  }

  const cell = {
    textAlign: 'center',
    padding: '0.45rem 0.4rem',
    whiteSpace: 'nowrap',
    minWidth: 72,
  }

  return (
    <div
      className="glass"
      style={{
        padding: '1rem',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>{title}</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
        {loading
          ? 'Loading…'
          : `${vehicleCount.toLocaleString('en-IN')} vehicles · ${withKmCount.toLocaleString('en-IN')} with KM > 0`}
      </p>
      <div
        style={{
          maxHeight: '420px',
          overflow: 'auto',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          width: '100%',
        }}
      >
        <table
          style={{
            width: 'max-content',
            minWidth: '100%',
            borderCollapse: 'separate',
            borderSpacing: 0,
            fontSize: '0.78rem',
          }}
        >
          <thead>
            {totals && (
              <tr>
                <th style={stickyCityHead}>TOTAL</th>
                {KM_PRODUCTIVITY_BUCKETS.map((b) => (
                  <th key={`t-${b.key}`} style={stickyHead} title={b.label}>
                    {(totals[b.key] || 0).toLocaleString('en-IN')}
                  </th>
                ))}
                <th style={{ ...stickyHead, fontWeight: 700 }}>
                  {(totals.total || 0).toLocaleString('en-IN')}
                </th>
              </tr>
            )}
            <tr>
              <th
                style={{
                  ...stickyCityHead,
                  top: totals ? 34 : 0,
                }}
              >
                {rowLabel}
              </th>
              {KM_PRODUCTIVITY_BUCKETS.map((b) => (
                <th
                  key={b.key}
                  style={{
                    ...stickyHead,
                    top: totals ? 34 : 0,
                    background: '#0f172a',
                    fontSize: '0.7rem',
                  }}
                  title={b.label}
                >
                  {b.label.replace(' TO ', '–').replace(' KM', '')}
                </th>
              ))}
              <th
                style={{
                  ...stickyHead,
                  top: totals ? 34 : 0,
                  background: '#0f172a',
                }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={KM_PRODUCTIVITY_BUCKETS.length + 2} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '1.5rem' }}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={KM_PRODUCTIVITY_BUCKETS.length + 2} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '1.5rem' }}>
                  No vehicles in this range
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const name = row.name || row.client || row.city || 'Unknown'
                return (
                  <tr key={name}>
                    <td style={{ ...stickyCity, background: '#111827' }} title={name}>
                      {name}
                    </td>
                    {KM_PRODUCTIVITY_BUCKETS.map((b) => (
                      <td key={b.key} style={cell}>
                        {(row[b.key] || 0).toLocaleString('en-IN')}
                      </td>
                    ))}
                    <td style={{ ...cell, fontWeight: 600 }}>
                      {(row.total || 0).toLocaleString('en-IN')}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
/** Active Riders = unique riders with delivered orders in this many days. */
const ACTIVE_RIDER_DAYS = 5

function FyTrendMetricCard({ title, loading, empty, compare }) {
  const pct = compare?.vsPyPct
  const isUp = pct != null && pct >= 0
  const peakIdx = compare?.peakIdx ?? -1
  const lowIdx = compare?.lowIdx ?? -1

  const CurrentDot = (props) => {
    const { cx, cy, index } = props
    if (cx == null || cy == null) return null
    if (index === peakIdx) {
      return <circle cx={cx} cy={cy} r={5} fill="#3b82f6" stroke="#fff" strokeWidth={1.5} />
    }
    if (index === lowIdx) {
      return <circle cx={cx} cy={cy} r={5} fill="#f97316" stroke="#fff" strokeWidth={1.5} />
    }
    return null
  }

  return (
    <div
      className="glass"
      style={{
        flex: 1,
        minWidth: '280px',
        padding: '1.1rem 1.15rem 0.75rem',
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 500 }}>{title}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.35rem', letterSpacing: '-0.02em' }}>
        {loading ? '…' : empty ? '—' : formatCompactCount(compare?.total || 0)}
      </div>
      <div
        style={{
          marginTop: '0.25rem',
          fontSize: '0.78rem',
          fontWeight: 600,
          color: pct == null ? 'var(--text-dim)' : isUp ? '#22c55e' : '#f43f5e',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        {loading || empty || pct == null ? (
          <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
            {compare?.hasPrevious ? 'vs prior FY' : 'No prior FY data'}
          </span>
        ) : (
          <>
            <span>{isUp ? '▲' : '▼'}</span>
            <span>
              {Math.abs(pct).toFixed(2)}% vs. PY
              {compare?.prevFy ? ` (${compare.prevFy})` : ''}
            </span>
          </>
        )}
      </div>
      <div style={{ height: '140px', width: '100%', marginTop: '0.65rem' }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            Loading…
          </div>
        ) : empty ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={compare.spark} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="month"
                stroke="var(--text-dim)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                formatter={(value, name) => [
                  Number(value).toLocaleString('en-IN'),
                  name === 'current' ? 'Current FY' : 'Prior FY',
                ]}
                labelFormatter={(label) => label}
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                }}
              />
              <Line
                type="monotone"
                dataKey="previous"
                name="previous"
                stroke="rgba(148,163,184,0.55)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="current"
                name="current"
                stroke="#e2e8f0"
                strokeWidth={2.25}
                dot={(props) => <CurrentDot {...props} />}
                activeDot={{ r: 4, fill: '#e2e8f0' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.85rem',
          fontSize: '0.65rem',
          color: 'var(--text-dim)',
          marginTop: '0.15rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0', display: 'inline-block' }} />
          Current FY
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(148,163,184,0.55)', display: 'inline-block' }} />
          Prior FY
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
          Peak
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', display: 'inline-block' }} />
          Low
        </span>
      </div>
    </div>
  )
}

function isEvOrderRow(curr) {
  const t1 = String(curr.type1 || '').toUpperCase()
  const t2 = String(curr.type2 || '').toUpperCase()
  const isEv1 = t1.includes('EV') && !t1.includes('NON')
  const isEv2 = t2.includes('EV') && !t2.includes('NON')
  return isEv1 || isEv2
}

function buildOrderDailyIndex(rows) {
  const byDate = new Map()
  /** date → { all: Set, ev: Set, nonEv: Set } of worker_code */
  const ridersByDate = new Map()

  for (const curr of rows || []) {
    const date = toMetricDateKey(curr.date_record)
    if (!date) continue

    const delivered = parseInt(curr.delivered, 10) || 0
    if (!byDate.has(date)) byDate.set(date, { date, ev: 0, nonEv: 0, total: 0 })
    const bucket = byDate.get(date)
    bucket.total += delivered

    const isEv = isEvOrderRow(curr)
    if (isEv) bucket.ev += delivered
    else bucket.nonEv += delivered

    if (delivered > 0 && curr.worker_code) {
      if (!ridersByDate.has(date)) {
        ridersByDate.set(date, { all: new Set(), ev: new Set(), nonEv: new Set() })
      }
      const day = ridersByDate.get(date)
      day.all.add(curr.worker_code)
      if (isEv) day.ev.add(curr.worker_code)
      else day.nonEv.add(curr.worker_code)
    }
  }

  return { byDate, ridersByDate }
}

/**
 * Active rider date window (today is never included):
 * - No date filter → last 5 completed days (yesterday back 5 days)
 * - Date range selected → 5 days immediately before the range start (or single selected day)
 */
function getActiveRiderWindow(filterFrom, filterTo) {
  if (!filterFrom && !filterTo) {
    const asOf = startOfDay(new Date())
    const to = format(subDays(asOf, 1), 'yyyy-MM-dd')
    const from = format(subDays(asOf, ACTIVE_RIDER_DAYS), 'yyyy-MM-dd')
    return {
      from,
      to,
      label: `Last ${ACTIVE_RIDER_DAYS} days excl. today (${from} → ${to})`,
    }
  }

  const anchorStr = filterFrom || filterTo
  const anchor = startOfDay(parseISO(anchorStr))
  const to = format(subDays(anchor, 1), 'yyyy-MM-dd')
  const from = format(subDays(anchor, ACTIVE_RIDER_DAYS), 'yyyy-MM-dd')
  return {
    from,
    to,
    label: `${ACTIVE_RIDER_DAYS} days before ${anchorStr} (${from} → ${to})`,
  }
}

function countActiveRidersInWindow(ridersByDate, from, to) {
  const all = new Set()
  const ev = new Set()
  const nonEv = new Set()
  for (const [date, day] of ridersByDate || []) {
    if (date < from || date > to) continue
    const sets = day?.all ? day : { all: day, ev: new Set(), nonEv: new Set() }
    for (const code of sets.all || []) all.add(code)
    for (const code of sets.ev || []) ev.add(code)
    for (const code of sets.nonEv || []) nonEv.add(code)
  }
  return { total: all.size, ev: ev.size, nonEv: nonEv.size }
}

function buildActiveRiderDailySeries(ridersByDate, from, to) {
  try {
    const start = parseISO(from)
    const end = parseISO(to)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
    return eachDayOfInterval({ start, end }).map((d) => {
      const key = format(d, 'yyyy-MM-dd')
      const day = ridersByDate.get(key)
      if (!day) return { date: key, riders: 0, ev: 0, nonEv: 0 }
      if (day.all) {
        return {
          date: key,
          riders: day.all.size,
          ev: day.ev.size,
          nonEv: day.nonEv.size,
        }
      }
      // Legacy shape: plain Set
      return { date: key, riders: day.size, ev: 0, nonEv: 0 }
    })
  } catch {
    return []
  }
}

const Dashboard = ({ riderData, loading, refreshData }) => {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [ev91StatusSummary, setEv91StatusSummary] = useState(null)
  const [ev91CurrentRows, setEv91CurrentRows] = useState([])
  const [ev91StatusLoading, setEv91StatusLoading] = useState(true)
  const [ev91StatusError, setEv91StatusError] = useState('')
  const [ev91OverallRows, setEv91OverallRows] = useState([])
  const [ev91OverallLoading, setEv91OverallLoading] = useState(true)
  const [paymentRows, setPaymentRows] = useState([])
  const [paymentLoading, setPaymentLoading] = useState(true)
  const [paymentError, setPaymentError] = useState('')
  const [revenueFy, setRevenueFy] = useState(() => currentIndianFinancialYearLabel())
  const [paymentClient, setPaymentClient] = useState('All')
  const [kmPreset, setKmPreset] = useState('yesterday')
  const [kmCustomFrom, setKmCustomFrom] = useState('')
  const [kmCustomTo, setKmCustomTo] = useState('')
  const [kmIotRows, setKmIotRows] = useState([])
  const [kmIotLoading, setKmIotLoading] = useState(false)
  const [kmIotError, setKmIotError] = useState('')
  const deferredRiderData = useDeferredValue(riderData)

  const kmDatePresets = useMemo(() => buildKmProductivityDatePresets(new Date()), [])

  const kmDateRange = useMemo(() => {
    if (kmPreset === 'custom') {
      const from = kmCustomFrom || kmCustomTo || ''
      const to = kmCustomTo || kmCustomFrom || ''
      return { from, to }
    }
    const p = kmDatePresets[kmPreset]
    return p ? { from: p.from, to: p.to } : { from: '', to: '' }
  }, [kmPreset, kmCustomFrom, kmCustomTo, kmDatePresets])

  const loadKmIot = useCallback(async (from, to) => {
    if (!from || !to) {
      setKmIotRows([])
      setKmIotError('')
      return
    }
    setKmIotLoading(true)
    setKmIotError('')
    try {
      const rows = await fetchIotDataInRange(from, to)
      setKmIotRows(rows || [])
    } catch (err) {
      console.warn('KM productivity IoT load failed:', err)
      setKmIotRows([])
      setKmIotError(err?.message || 'Failed to load IoT KM')
    } finally {
      setKmIotLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKmIot(kmDateRange.from, kmDateRange.to)
  }, [kmDateRange.from, kmDateRange.to, loadKmIot])

  const loadEv91CurrentStatus = useCallback(async () => {
    setEv91StatusLoading(true)
    setEv91StatusError('')
    try {
      const all = await fetchAllEv91MisData('current-status')
      setEv91CurrentRows(all.data || [])
      setEv91StatusSummary(summarizeCurrentStatusRows(all.data || [], all.summary))
    } catch (err) {
      console.warn('EV91 current-status load failed:', err)
      setEv91CurrentRows([])
      setEv91StatusSummary(null)
      setEv91StatusError(err?.message || 'Failed to load EV91 current status')
    } finally {
      setEv91StatusLoading(false)
    }
  }, [])

  const loadEv91OverallStatus = useCallback(async () => {
    setEv91OverallLoading(true)
    try {
      const result = await fetchEv91OverallStatusAll({ force: false })
      setEv91OverallRows(result.data || [])
    } catch (err) {
      console.warn('EV91 overall-status load failed:', err)
      setEv91OverallRows([])
    } finally {
      setEv91OverallLoading(false)
    }
  }, [])

  const loadMonthlyRevenue = useCallback(async (force = false) => {
    setPaymentLoading(true)
    setPaymentError('')
    try {
      const rows = await fetchRiderPaymentsForRevenue({ force })
      setPaymentRows(rows || [])
    } catch (err) {
      console.warn('Monthly revenue load failed:', err)
      setPaymentRows([])
      setPaymentError(err?.message || 'Failed to load payment revenue')
    } finally {
      setPaymentLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEv91CurrentStatus()
    loadEv91OverallStatus()
    loadMonthlyRevenue(false)
  }, [loadEv91CurrentStatus, loadEv91OverallStatus, loadMonthlyRevenue])

  const filterFrom = startDate || endDate || ''
  const filterTo = endDate || startDate || ''

  const overviewOrderRows = useMemo(
    () => selectOverviewOrderRows(deferredRiderData),
    [deferredRiderData]
  )

  const overviewOrdersFromUpload = useMemo(
    () => (deferredRiderData || []).some((r) => r?._data_source === 'order_upload'),
    [deferredRiderData]
  )

  const orderDailyIndex = useMemo(
    () => buildOrderDailyIndex(overviewOrderRows),
    [overviewOrderRows]
  )

  const ordersByDate = useMemo(() => {
    const out = []
    for (const bucket of orderDailyIndex.byDate.values()) {
      const date = bucket.date
      if (filterFrom && date < filterFrom) continue
      if (filterTo && date > filterTo) continue
      out.push(bucket)
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [orderDailyIndex, filterFrom, filterTo])

  const activeRiderWindow = useMemo(
    () => getActiveRiderWindow(filterFrom, filterTo),
    [filterFrom, filterTo]
  )

  const activeRiderCounts = useMemo(
    () =>
      countActiveRidersInWindow(
        orderDailyIndex.ridersByDate,
        activeRiderWindow.from,
        activeRiderWindow.to
      ),
    [orderDailyIndex.ridersByDate, activeRiderWindow]
  )

  const activeRiderDaily = useMemo(
    () =>
      buildActiveRiderDailySeries(
        orderDailyIndex.ridersByDate,
        activeRiderWindow.from,
        activeRiderWindow.to
      ),
    [orderDailyIndex.ridersByDate, activeRiderWindow]
  )

  const stats = useMemo(() => {
    let totalOrders = 0
    for (const [date, bucket] of orderDailyIndex.byDate) {
      if (filterFrom && date < filterFrom) continue
      if (filterTo && date > filterTo) continue
      totalOrders += bucket.total
    }

    let activeVehicles = 0
    let returnedVehicles = 0
    let vehicleLoading = false

    if (!filterFrom && !filterTo) {
      activeVehicles =
        Number(ev91StatusSummary?.deployed) ||
        Number(ev91StatusSummary?.deployedAssigned) ||
        0
      returnedVehicles = Number(ev91StatusSummary?.returned) || 0
      vehicleLoading = ev91StatusLoading
    } else {
      activeVehicles =
        Number(ev91StatusSummary?.deployed) ||
        Number(ev91StatusSummary?.deployedAssigned) ||
        0
      const apiCounts = countOverallDeployReturnInRange(ev91OverallRows, {
        startDate: filterFrom,
        endDate: filterTo,
      })
      returnedVehicles = apiCounts.returned
      vehicleLoading = ev91StatusLoading || ev91OverallLoading
    }

    let dateStr = 'All Time'
    if (filterFrom && filterTo && filterFrom === filterTo) dateStr = filterFrom
    else if (filterFrom && filterTo) dateStr = `${filterFrom} to ${filterTo}`
    else if (filterFrom) dateStr = `Since ${filterFrom}`
    else if (filterTo) dateStr = `Until ${filterTo}`

    let vehicleChange = 'EV91 current status'
    if (vehicleLoading) vehicleChange = 'Loading…'
    if (!vehicleLoading && ev91StatusError) {
      vehicleChange = `EV91 API · ${ev91StatusError}`
    }

    return [
      {
        label: 'Total Orders',
        value: totalOrders.toLocaleString(),
        icon: TrendingUp,
        change: dateStr,
        isPositive: true,
      },
      {
        label: 'Active Riders',
        value: activeRiderCounts.total.toLocaleString(),
        icon: Users,
        change: `EV ${activeRiderCounts.ev.toLocaleString()} · Non-EV ${activeRiderCounts.nonEv.toLocaleString()} · ${activeRiderWindow.label}`,
        isPositive: true,
      },
      {
        label: 'Deployed Vehicles',
        value: vehicleLoading ? '…' : activeVehicles.toLocaleString(),
        icon: Truck,
        change: vehicleChange,
        isPositive: true,
      },
      {
        label: 'Returned Units',
        value: vehicleLoading ? '…' : returnedVehicles.toLocaleString(),
        icon: Activity,
        change: `${dateStr} · EV91 API`,
        isPositive: false,
      },
    ]
  }, [
    orderDailyIndex,
    filterFrom,
    filterTo,
    activeRiderCounts,
    activeRiderWindow,
    ev91StatusSummary,
    ev91StatusLoading,
    ev91StatusError,
    ev91OverallRows,
    ev91OverallLoading,
  ])

  const realVehicleStatusDist = useMemo(
    () => currentStatusDistributionSeries(ev91StatusSummary),
    [ev91StatusSummary]
  )

  const monthlyRevenueAll = useMemo(
    () => buildMonthlyRevenueSeries(paymentRows, {}),
    [paymentRows]
  )

  const revenueFyOptions = monthlyRevenueAll.financialYears?.length
    ? monthlyRevenueAll.financialYears
    : [currentIndianFinancialYearLabel()]

  useEffect(() => {
    if (!revenueFyOptions.length) return
    if (!revenueFyOptions.includes(revenueFy)) {
      setRevenueFy(revenueFyOptions[0])
    }
  }, [revenueFyOptions, revenueFy])

  const monthlyRevenue = useMemo(
    () =>
      buildMonthlyRevenueSeries(paymentRows, {
        dateFrom: filterFrom,
        dateTo: filterTo,
        financialYear: revenueFy,
        sortBy: 'revenue',
      }),
    [paymentRows, filterFrom, filterTo, revenueFy]
  )

  const monthlyRevenueByFy = useMemo(
    () =>
      buildMonthlyRevenueSeries(paymentRows, {
        dateFrom: filterFrom,
        dateTo: filterTo,
        financialYear: revenueFy,
        sortBy: 'fy',
      }),
    [paymentRows, filterFrom, filterTo, revenueFy]
  )

  const monthlyOrdersCompare = useMemo(
    () =>
      buildFyCompareMetric(paymentRows, {
        financialYear: revenueFy,
        dateFrom: filterFrom,
        dateTo: filterTo,
        metric: 'orders',
      }),
    [paymentRows, revenueFy, filterFrom, filterTo]
  )

  const monthlyRidersCompare = useMemo(
    () =>
      buildFyCompareMetric(paymentRows, {
        financialYear: revenueFy,
        dateFrom: filterFrom,
        dateTo: filterTo,
        metric: 'riders',
      }),
    [paymentRows, revenueFy, filterFrom, filterTo]
  )

  const clientMonthLine = useMemo(
    () =>
      buildClientMonthLineSeries(paymentRows, {
        financialYear: revenueFy,
        dateFrom: filterFrom,
        dateTo: filterTo,
        client: paymentClient,
      }),
    [paymentRows, revenueFy, filterFrom, filterTo, paymentClient]
  )

  useEffect(() => {
    const names = clientMonthLine.clients?.map((c) => c.name) || []
    if (paymentClient !== 'All' && names.length && !names.includes(paymentClient)) {
      setPaymentClient('All')
    }
  }, [clientMonthLine.clients, paymentClient])

  const kmDeployedTable = useMemo(
    () =>
      buildVehicleKmProductivityTable(ev91OverallRows, kmIotRows, {
        startDate: kmDateRange.from,
        endDate: kmDateRange.to,
        kind: 'deployed',
        currentRows: ev91CurrentRows,
      }),
    [ev91OverallRows, ev91CurrentRows, kmIotRows, kmDateRange.from, kmDateRange.to]
  )

  const kmReturnedTable = useMemo(
    () =>
      buildVehicleKmProductivityTable(ev91OverallRows, kmIotRows, {
        startDate: kmDateRange.from,
        endDate: kmDateRange.to,
        kind: 'returned',
        currentRows: ev91CurrentRows,
      }),
    [ev91OverallRows, ev91CurrentRows, kmIotRows, kmDateRange.from, kmDateRange.to]
  )

  const kmDeployedClientTable = useMemo(
    () =>
      buildVehicleKmProductivityTable(ev91OverallRows, kmIotRows, {
        startDate: kmDateRange.from,
        endDate: kmDateRange.to,
        kind: 'deployed',
        currentRows: ev91CurrentRows,
        groupBy: 'client',
      }),
    [ev91OverallRows, ev91CurrentRows, kmIotRows, kmDateRange.from, kmDateRange.to]
  )

  const kmReturnedClientTable = useMemo(
    () =>
      buildVehicleKmProductivityTable(ev91OverallRows, kmIotRows, {
        startDate: kmDateRange.from,
        endDate: kmDateRange.to,
        kind: 'returned',
        currentRows: ev91CurrentRows,
        groupBy: 'client',
      }),
    [ev91OverallRows, ev91CurrentRows, kmIotRows, kmDateRange.from, kmDateRange.to]
  )

  const kmTablesLoading = kmIotLoading || ev91OverallLoading

  if (loading && riderData.length === 0) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
      <header className="header">
        <div>
          <h1>General Overview</h1>
          <p style={{ color: 'var(--text-dim)' }}>
            Fleet & Rider Performance Metrics
            {overviewOrdersFromUpload ? (
              <span style={{ marginLeft: 8, color: 'var(--accent-blue)' }}>
                · Orders from Order Upload only
              </span>
            ) : (
              <span style={{ marginLeft: 8 }}>· Orders from rider_metrics</span>
            )}
            <span style={{ marginLeft: 8 }}>
              · Active Riders = ordered in last {ACTIVE_RIDER_DAYS} days excluding today (or{' '}
              {ACTIVE_RIDER_DAYS} days before selected date)
            </span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.05)',
              padding: '0.5rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <Calendar size={18} style={{ color: 'var(--text-dim)' }} />
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
            />
            <span style={{ color: 'var(--text-dim)' }}>to</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('')
                  setEndDate('')
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-red)',
                  cursor: 'pointer',
                  padding: '0 0.5rem',
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="glass"
            style={{
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => {
              refreshData?.()
              loadEv91CurrentStatus()
              loadEv91OverallStatus()
              loadMonthlyRevenue(true)
              loadKmIot(kmDateRange.from, kmDateRange.to)
            }}
          >
            <RefreshCw size={18} /> Refresh
          </button>
        </div>
      </header>

      <section className="stats-grid">
        {stats.map((stat, i) => (
          <div key={stat.label} className="stat-card glass">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <stat.icon size={24} style={{ color: COLORS[i % COLORS.length] }} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: stat.isPositive ? 'var(--accent-green)' : 'var(--accent-red)',
                  maxWidth: '70%',
                  textAlign: 'right',
                }}
              >
                {stat.change ? (
                  <>
                    {stat.change}{' '}
                    {stat.isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  </>
                ) : null}
              </div>
            </div>
            <div>
              <div className="label">{stat.label}</div>
              <div className="value">{stat.value}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="charts-grid">
        <div className="chart-card glass">
          <h3>Orders Performance</h3>
          {overviewOrdersFromUpload && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Showing uploaded order dates only
            </p>
          )}
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ordersByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                />
                <Legend verticalAlign="top" height={36} />
                <Line
                  type="monotone"
                  name="Total"
                  dataKey="total"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  name="EV Orders"
                  dataKey="ev"
                  stroke="#4ade80"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  name="Non-EV Orders"
                  dataKey="nonEv"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card glass">
          <h3>Vehicle Status Distribution</h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            EV91 Current Vehicle Status · Deployed / Returned / Not yet to deploy
            {ev91StatusLoading ? ' · Loading…' : ''}
            {ev91StatusError ? ` · ${ev91StatusError}` : ''}
          </p>
          <div style={{ height: '300px', width: '100%' }}>
            {ev91StatusLoading && realVehicleStatusDist.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-dim)',
                }}
              >
                Loading EV91 status…
              </div>
            ) : realVehicleStatusDist.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-dim)',
                }}
              >
                No current-status data
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                  <Pie
                    data={realVehicleStatusDist}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    nameKey="name"
                  >
                    {realVehicleStatusDist.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip />
                  <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="chart-card glass" style={{ marginTop: '1.25rem' }}>
        <h3>Active Riders — {ACTIVE_RIDER_DAYS}-day window</h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Unique riders with delivered orders · {activeRiderWindow.label}
          {' · '}
          Total {activeRiderCounts.total.toLocaleString()}
          {' · '}
          <span style={{ color: '#4ade80' }}>EV {activeRiderCounts.ev.toLocaleString()}</span>
          {' · '}
          <span style={{ color: '#f43f5e' }}>Non-EV {activeRiderCounts.nonEv.toLocaleString()}</span>
        </p>
        <div style={{ height: '280px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activeRiderDaily}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar dataKey="ev" name="EV" fill="#4ade80" radius={[4, 4, 0, 0]} />
              <Bar dataKey="nonEv" name="Non-EV" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

      <div
        className="glass"
        style={{
          marginTop: '1.25rem',
          padding: '1.5rem',
          height: 'auto',
          overflow: 'visible',
          minWidth: 0,
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '0.35rem',
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Rider Payment Data</h3>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              From <code style={{ color: '#fff' }}>rider_payment_data</code> upload · Indian FY (Apr → Mar)
              {paymentLoading ? ' · Loading…' : ''}
              {paymentError ? ` · ${paymentError}` : ''}
            </p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.8rem',
              color: 'var(--text-dim)',
            }}
          >
            Financial Year
            <select
              value={revenueFy}
              onChange={(e) => setRevenueFy(e.target.value)}
              className="fsr-select"
              style={{
                padding: '0.35rem 0.6rem',
                color: '#fff',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
              }}
            >
              {revenueFyOptions.map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>
          Month-wise Revenue · {revenueFy}
        </h4>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Sorted by revenue (high → low)
          {!paymentLoading && !paymentError && (
            <>
              {' · '}
              Total {formatInr(monthlyRevenue.totals.gross)}
              {' · '}
              Net {formatInr(monthlyRevenue.totals.net)}
              {filterFrom || filterTo ? ' · filtered by date range' : ''}
            </>
          )}
        </p>
        <div style={{ height: '300px', width: '100%' }}>
          {paymentLoading && monthlyRevenue.series.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              Loading monthly revenue…
            </div>
          ) : monthlyRevenue.series.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              No payment revenue for {revenueFy}{filterFrom || filterTo ? ' in this date range' : ''}.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenue.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="var(--text-dim)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v >= 10000000
                      ? `${(v / 10000000).toFixed(1)}Cr`
                      : v >= 100000
                        ? `${(v / 100000).toFixed(1)}L`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : String(v)
                  }
                />
                <Tooltip
                  formatter={(value, name) => [formatInr(value), name]}
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                />
                <Legend verticalAlign="top" height={36} />
                <Bar dataKey="gross" name="Gross payout" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <h4 style={{ margin: '1.5rem 0 0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>
          Month-wise (FY calendar) · {revenueFy}
        </h4>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          Apr → Mar financial year order · revenue / orders / riders
        </p>
        <div style={{ height: '300px', width: '100%' }}>
          {paymentLoading && monthlyRevenueByFy.series.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              Loading…
            </div>
          ) : monthlyRevenueByFy.series.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              No data for {revenueFy}.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenueByFy.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="left"
                  stroke="var(--text-dim)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v >= 10000000
                      ? `${(v / 10000000).toFixed(1)}Cr`
                      : v >= 100000
                        ? `${(v / 100000).toFixed(1)}L`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : String(v)
                  }
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--text-dim)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'Gross payout') return [formatInr(value), name]
                    return [Number(value).toLocaleString('en-IN'), name]
                  }}
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                />
                <Legend verticalAlign="top" height={36} />
                <Bar yAxisId="left" dataKey="gross" name="Gross payout" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="orders" name="Orders" fill="#4ade80" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="riders" name="Unique riders" fill="#a78bfa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            marginTop: '1.35rem',
          }}
        >
          <FyTrendMetricCard
            title="Monthly Order Count"
            loading={paymentLoading}
            empty={!paymentLoading && monthlyRevenue.series.length === 0 && monthlyOrdersCompare.total === 0}
            compare={monthlyOrdersCompare}
          />
          <FyTrendMetricCard
            title="Monthly Unique Riders"
            loading={paymentLoading}
            empty={!paymentLoading && monthlyRevenue.series.length === 0 && monthlyRidersCompare.total === 0}
            compare={monthlyRidersCompare}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginTop: '1.5rem',
            marginBottom: '0.5rem',
          }}
        >
          <div>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
              Client-wise · Month trend
            </h4>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Line chart · {revenueFy} · Apr → Mar
              {!paymentLoading && !paymentError && (
                <>
                  {' · '}
                  Revenue {formatInr(clientMonthLine.totals.gross)}
                  {' · '}
                  Orders {clientMonthLine.totals.orders.toLocaleString('en-IN')}
                  {' · '}
                  Riders {clientMonthLine.totals.riders.toLocaleString('en-IN')}
                </>
              )}
            </p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.8rem',
              color: 'var(--text-dim)',
            }}
          >
            Client
            <select
              value={paymentClient}
              onChange={(e) => setPaymentClient(e.target.value)}
              className="fsr-select"
              style={{
                padding: '0.35rem 0.6rem',
                color: '#fff',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                minWidth: '160px',
              }}
            >
              <option value="All">All clients</option>
              {(clientMonthLine.clients || []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '0.65rem',
            fontSize: '0.72rem',
            color: 'var(--text-dim)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, background: CLIENT_LINE_COLORS.revenue, borderRadius: 2 }} />
            Revenue (₹)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, background: CLIENT_LINE_COLORS.orders, borderRadius: 2 }} />
            Orders
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, background: CLIENT_LINE_COLORS.riders, borderRadius: 2 }} />
            Rider count
          </span>
        </div>
        <div style={{ height: '320px', width: '100%' }}>
          {paymentLoading && !(clientMonthLine.clients || []).length ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              Loading client trend…
            </div>
          ) : !(clientMonthLine.clients || []).length ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
              No client payment data for {revenueFy}.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={clientMonthLine.series} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="revenue"
                  stroke={CLIENT_LINE_COLORS.revenue}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v >= 10000000
                      ? `${(v / 10000000).toFixed(1)}Cr`
                      : v >= 100000
                        ? `${(v / 100000).toFixed(1)}L`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : String(v)
                  }
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  stroke={CLIENT_LINE_COLORS.orders}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'Revenue') return [formatInr(value), name]
                    return [Number(value).toLocaleString('en-IN'), name]
                  }}
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                  }}
                />
                <Legend verticalAlign="top" height={36} />
                <Line
                  yAxisId="revenue"
                  type="monotone"
                  dataKey="gross"
                  name="Revenue"
                  stroke={CLIENT_LINE_COLORS.revenue}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CLIENT_LINE_COLORS.revenue }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="orders"
                  name="Orders"
                  stroke={CLIENT_LINE_COLORS.orders}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CLIENT_LINE_COLORS.orders }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="riders"
                  name="Rider count"
                  stroke={CLIENT_LINE_COLORS.riders}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CLIENT_LINE_COLORS.riders }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div
        className="glass"
        style={{
          marginTop: '1.25rem',
          padding: '1.5rem',
          overflow: 'visible',
          minWidth: 0,
          width: '100%',
          height: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '0.85rem',
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Vehicle Kilometer Productivity Analysis</h3>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              City-wise vehicle count by IoT KM · vehicles deployed (or returned) during the range
              {kmDateRange.from && kmDateRange.to ? ` · ${kmDateRange.from} → ${kmDateRange.to}` : ''}
              {kmTablesLoading ? ' · Loading…' : ''}
              {kmIotError ? ` · ${kmIotError}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="glass"
              disabled={kmTablesLoading || !kmDateRange.from || !kmDateRange.to}
              onClick={() =>
                downloadVehicleKmProductivityDetails(ev91OverallRows, kmIotRows, {
                  startDate: kmDateRange.from,
                  endDate: kmDateRange.to,
                  currentRows: ev91CurrentRows,
                })
              }
              style={{
                padding: '0.4rem 0.8rem',
                color: '#fff',
                cursor: kmTablesLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.75rem',
                opacity: kmTablesLoading ? 0.6 : 1,
              }}
              title="Download vehicle-level detail (City + Client)"
            >
              <Download size={14} /> Export Details
            </button>
            {KM_RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="glass-btn"
                onClick={() => setKmPreset(p.id)}
                style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.75rem',
                  border:
                    kmPreset === p.id
                      ? '1px solid var(--accent-blue)'
                      : '1px solid var(--border-color)',
                  color: kmPreset === p.id ? 'var(--accent-blue)' : '#fff',
                }}
              >
                {p.label}
              </button>
            ))}
            {kmPreset === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="date"
                  value={kmCustomFrom}
                  onChange={(e) => setKmCustomFrom(e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    color: '#fff',
                    padding: '0.35rem 0.5rem',
                  }}
                />
                <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>to</span>
                <input
                  type="date"
                  value={kmCustomTo}
                  onChange={(e) => setKmCustomTo(e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    color: '#fff',
                    padding: '0.35rem 0.5rem',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', minWidth: 0 }}>
          <KmProductivityTable
            title="Deployed — Vehicle Kilometer Productivity Analysis"
            report={kmDeployedTable}
            loading={kmTablesLoading}
            rowLabel="City"
          />
          <KmProductivityTable
            title="Return — Vehicle Kilometer Productivity Analysis"
            report={kmReturnedTable}
            loading={kmTablesLoading}
            rowLabel="City"
          />
          <KmProductivityTable
            title="Deployed — Client-wise Kilometer Productivity"
            report={kmDeployedClientTable}
            loading={kmTablesLoading}
            rowLabel="Client"
          />
          <KmProductivityTable
            title="Return — Client-wise Kilometer Productivity"
            report={kmReturnedClientTable}
            loading={kmTablesLoading}
            rowLabel="Client"
          />
        </div>
      </div>
    </motion.div>
  )
}

export default Dashboard
