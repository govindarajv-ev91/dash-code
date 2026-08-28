import React, { useState, useEffect, useMemo, useCallback, useDeferredValue } from 'react'
import { format, subDays, subMonths } from 'date-fns'
import {
  Leaf,
  Search,
  Download,
  Loader,
  Calendar,
  Truck,
  MapPin,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchIotDataInRange,
  loadIotSummary,
  getIotDbSetupMessage,
  isMissingIotTable,
} from './lib/iotDataDb'
import { monthDaysFromLabel } from './lib/fullDataMonthReport'
import { dedupeCanonicalCities, normalizeSummaryCity } from './lib/citySummaryAliases'
import { loadOrderUploadSummary } from './lib/orderUploadDb'
import {
  aggregateEnvironmentalByVehicle,
  buildEnvironmentalDailyRows,
  ENV_IMPACT_DEFAULTS,
  ENV_IMPACT_FORMULAS,
  summarizeEnvironmentalImpact,
} from './lib/evEnvironmentalImpact'

const ROWS_PER_PAGE = 50
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function recentMonthLabels(count = 18) {
  const out = []
  let d = new Date()
  for (let i = 0; i < count; i++) {
    out.push(`${MONTH_LABEL[d.getMonth()]}-${d.getFullYear()}`)
    d = subMonths(d, 1)
  }
  return out
}

export default function EvEnvironmentalImpact({
  vehicleInventoryData = [],
  loading: appLoading,
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const defaultFrom = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [selectedMonth, setSelectedMonth] = useState('')
  const [monthOptions, setMonthOptions] = useState(recentMonthLabels())
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(today)
  const [iotRows, setIotRows] = useState([])
  const [iotLoading, setIotLoading] = useState(true)
  const [iotError, setIotError] = useState(null)
  const [missingTable, setMissingTable] = useState(false)
  const [cityFilter, setCityFilter] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [showExplain, setShowExplain] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [viewMode, setViewMode] = useState('summary')

  const deferredInventory = useDeferredValue(vehicleInventoryData)
  const deferredSearch = useDeferredValue(searchTerm)

  useEffect(() => {
    loadIotSummary()
      .then((summary) => setMissingTable(Boolean(summary.missingTable)))
      .catch(() => {})
    loadOrderUploadSummary()
      .then((summary) => {
        if (summary.months?.length) {
          setMonthOptions(summary.months)
          if (!selectedMonth) setSelectedMonth(summary.months[0])
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyMonthRange = useCallback((monthLabel) => {
    if (!monthLabel) return
    const { fromKey, toKey } = monthDaysFromLabel(monthLabel)
    if (fromKey && toKey) {
      setDateFrom(fromKey)
      setDateTo(toKey)
    }
  }, [])

  useEffect(() => {
    if (selectedMonth) applyMonthRange(selectedMonth)
  }, [selectedMonth, applyMonthRange])

  const loadRangeData = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setIotError('Select a valid date range (From ≤ To).')
      setIotRows([])
      setIotLoading(false)
      return
    }

    setIotLoading(true)
    setIotError(null)
    try {
      const rows = await fetchIotDataInRange(dateFrom, dateTo)
      setIotRows(rows)
      if (!rows.length) {
        setIotError('No IoT km data for this range. Widen dates or check iot_data uploads.')
      }
    } catch (err) {
      if (isMissingIotTable(err)) {
        setMissingTable(true)
        setIotError(getIotDbSetupMessage())
      } else {
        setIotError(err.message || 'Failed to load IoT data')
      }
      setIotRows([])
    } finally {
      setIotLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (!missingTable) loadRangeData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, missingTable])

  const dailyRows = useMemo(
    () => buildEnvironmentalDailyRows(iotRows, deferredInventory),
    [iotRows, deferredInventory]
  )

  const cityOptions = useMemo(() => {
    const cities = dedupeCanonicalCities(dailyRows.map((r) => r.city))
    return ['All', ...cities]
  }, [dailyRows])

  const filteredDaily = useMemo(() => {
    let rows = dailyRows
    if (cityFilter && cityFilter !== 'All') {
      rows = rows.filter((r) => normalizeSummaryCity(r.city) === cityFilter)
    }
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.vehicleNumber.toLowerCase().includes(q) ||
        r.runDate.includes(q) ||
        r.city.toLowerCase().includes(q)
    )
  }, [dailyRows, cityFilter, deferredSearch])

  const vehicleSummary = useMemo(
    () => aggregateEnvironmentalByVehicle(filteredDaily),
    [filteredDaily]
  )

  const vehicleSearchActive = Boolean(deferredSearch.trim())

  useEffect(() => {
    setViewMode(vehicleSearchActive ? 'daily' : 'summary')
  }, [vehicleSearchActive])

  const tableRows = viewMode === 'daily' ? filteredDaily : vehicleSummary
  const stats = useMemo(() => summarizeEnvironmentalImpact(filteredDaily), [filteredDaily])

  const totalPages = Math.max(1, Math.ceil(tableRows.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return tableRows.slice(start, start + ROWS_PER_PAGE)
  }, [tableRows, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, cityFilter, dateFrom, dateTo, viewMode, iotRows.length])

  const exportExcel = () => {
    if (!filteredDaily.length && !vehicleSummary.length) return
    const dailySheet = filteredDaily.map((r) => ({
      Date: r.runDate,
      'Vehicle Number': r.vehicleNumber,
      City: r.city,
      'Running KM': r.distanceKm,
      'Petrol Saved (L)': r.petrolLiters,
      'CO₂ Saved (kg)': r.co2Kg,
      'Trees Equivalent': r.treesEquivalent,
    }))
    const vehicleSheet = vehicleSummary.map((r) => ({
      'Vehicle Number': r.vehicleNumber,
      City: r.city,
      'Active Days': r.activeDays,
      'Total KM': r.distanceKm,
      'Petrol Saved (L)': r.petrolLiters,
      'CO₂ Saved (kg)': r.co2Kg,
      'Trees Equivalent': r.treesEquivalent,
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicleSheet), 'By Vehicle')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailySheet), 'Daily Detail')
    XLSX.writeFile(wb, `EV_Environmental_Impact_${dateFrom}_to_${dateTo}.xlsx`)
  }

  if (appLoading && !vehicleInventoryData?.length) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Leaf size={28} style={{ color: '#4ade80' }} />
              CO₂ Control &amp; EV Savings
            </h1>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-dim)', maxWidth: '760px' }}>
              Petrol saved, CO₂ avoided, and tree equivalent from EV running km (IoT). Filter by month, date range, city, or search a vehicle for day-wise detail.
            </p>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!filteredDaily.length}
            className="glass"
            style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}
          >
            <Download size={18} />
            Export
          </button>
        </div>
      </header>

      <section className="glass" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
        <button
          type="button"
          onClick={() => setShowExplain((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
            padding: 0,
            width: '100%',
            textAlign: 'left',
          }}
        >
          <Info size={18} style={{ color: '#4ade80' }} />
          How these numbers are calculated
          {showExplain ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showExplain && (
          <div style={{ marginTop: '0.85rem', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 0.75rem' }}>
              All savings are estimated by comparing EV distance from{' '}
              <code style={{ color: '#fff' }}>iot_data</code> to a petrol two-wheeler running the same km.
              City is taken from Vehicle Inventory. Assumptions (editable in code if your fleet differs):
            </p>
            <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
              <li>Petrol bike mileage: <strong style={{ color: '#fff' }}>{ENV_IMPACT_DEFAULTS.ICE_KM_PER_LITER} km/L</strong></li>
              <li>CO₂ per liter petrol: <strong style={{ color: '#fff' }}>{ENV_IMPACT_DEFAULTS.CO2_KG_PER_LITER_PETROL} kg</strong></li>
              <li>One tree absorbs ~<strong style={{ color: '#fff' }}>{ENV_IMPACT_DEFAULTS.CO2_KG_PER_TREE_PER_YEAR} kg CO₂/year</strong></li>
            </ul>
            {ENV_IMPACT_FORMULAS.map((item) => (
              <div
                key={item.title}
                style={{
                  marginBottom: '0.65rem',
                  padding: '0.65rem 0.75rem',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>{item.title}</div>
                <div>{item.formula}</div>
                <div style={{ marginTop: '0.25rem', color: '#86efac' }}>Example: {item.example}</div>
              </div>
            ))}
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem' }}>
              Trees equivalent = how many mature trees would need one full year to absorb the same CO₂ mass (not number of trees planted).
            </p>
          </div>
        )}
      </section>

      <div
        className="filter-bar glass"
        style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.85rem', marginBottom: '1rem', alignItems: 'flex-end' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} /> Month
          </span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', minWidth: '130px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          >
            <option value="">Custom range</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span>From date</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => {
              setSelectedMonth('')
              setDateFrom(e.target.value)
            }}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span>To date</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={(e) => {
              setSelectedMonth('')
              setDateTo(e.target.value)
            }}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          />
        </label>
        <button type="button" className="btn-primary" onClick={loadRangeData} disabled={iotLoading} style={{ padding: '0.5rem 1rem' }}>
          {iotLoading ? <Loader size={16} className="spin" /> : 'Apply range'}
        </button>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <MapPin size={14} /> City
          </span>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="fsr-select"
            style={{ padding: '0.45rem 0.6rem', minWidth: '140px', color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
          >
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search vehicle number for day-wise detail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '10px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      {iotError && !iotLoading && (
        <div className="glass" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', color: '#fbbf24' }}>
          {iotError}
        </div>
      )}

      <section className="stats-grid" style={{ marginBottom: '1.25rem' }}>
        <div className="stat-card glass">
          <div className="label">EV running distance</div>
          <div className="value">{stats.distanceKm.toLocaleString('en-IN')} km</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Petrol saved</div>
          <div className="value" style={{ color: '#fbbf24' }}>{stats.petrolLiters.toLocaleString('en-IN')} L</div>
        </div>
        <div className="stat-card glass">
          <div className="label">CO₂ saved</div>
          <div className="value" style={{ color: '#4ade80' }}>{stats.co2Kg.toLocaleString('en-IN')} kg</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Trees equivalent</div>
          <div className="value" style={{ color: '#86efac' }}>{stats.treesEquivalent.toLocaleString('en-IN')}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Vehicles</div>
          <div className="value">{stats.vehicles.toLocaleString()}</div>
        </div>
        <div className="stat-card glass">
          <div className="label">Period</div>
          <div className="value" style={{ fontSize: '1rem' }}>{dateFrom} → {dateTo}</div>
        </div>
      </section>

      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={viewMode === 'summary' ? 'btn-primary' : 'glass-btn'}
          onClick={() => setViewMode('summary')}
          style={{ padding: '0.45rem 0.85rem' }}
        >
          Vehicle summary
        </button>
        <button
          type="button"
          className={viewMode === 'daily' ? 'btn-primary' : 'glass-btn'}
          onClick={() => setViewMode('daily')}
          style={{ padding: '0.45rem 0.85rem' }}
        >
          Day-wise detail
        </button>
        {vehicleSearchActive && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', alignSelf: 'center' }}>
            Showing day-wise rows matching vehicle search
          </span>
        )}
      </div>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 480px)' }}>
          {iotLoading ? (
            <div className="loading-container" style={{ minHeight: '200px' }}>
              <span className="loader" />
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {viewMode === 'daily' && <th>Date</th>}
                  <th>Vehicle</th>
                  <th>City</th>
                  {viewMode === 'summary' && <th>Active days</th>}
                  <th style={{ textAlign: 'right' }}>Running km</th>
                  <th style={{ textAlign: 'right' }}>Petrol saved (L)</th>
                  <th style={{ textAlign: 'right' }}>CO₂ saved (kg)</th>
                  <th style={{ textAlign: 'right' }}>Trees eq.</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length ? (
                  paginated.map((r, i) => (
                    <tr key={viewMode === 'daily' ? r.rowKey : r.vehicleNumber}>
                      <td>{(currentPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                      {viewMode === 'daily' && (
                        <td style={{ whiteSpace: 'nowrap' }}>{r.runDate}</td>
                      )}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                          <Truck size={14} />
                          {r.vehicleNumber}
                        </div>
                      </td>
                      <td>{r.city}</td>
                      {viewMode === 'summary' && <td>{r.activeDays}</td>}
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.distanceKm.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', color: '#fbbf24' }}>{r.petrolLiters.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', color: '#4ade80' }}>{r.co2Kg.toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right', color: '#86efac' }}>{r.treesEquivalent.toLocaleString('en-IN')}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={viewMode === 'daily' ? 8 : 8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-dim)' }}>
                      No data for this filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Showing {((currentPage - 1) * ROWS_PER_PAGE) + 1}–{Math.min(currentPage * ROWS_PER_PAGE, tableRows.length)} of {tableRows.length}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="glass-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className="glass-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
