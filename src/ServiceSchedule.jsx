import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subMonths } from 'date-fns'
import {
  Wrench,
  MapPin,
  Search,
  Download,
  Truck,
  AlertTriangle,
  Gauge,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { fetchIotDataInRange, isMissingIotTable, getIotDbSetupMessage } from './lib/iotDataDb'
import { fetchEv91DeployedRiders } from './lib/ev91RiderPerformance'
import {
  fetchAllVehicleServiceLogs,
  buildVehicleServiceIndex,
  saveVehicleServiceDone,
  isMissingVehicleServiceTable,
  getVehicleServiceSetupMessage,
} from './lib/vehicleServiceDb'
import {
  buildServiceScheduleReport,
  buildVehicleDayKmIndex,
  ev91RowsToServiceAssignments,
  getEarliestDeployFromAssignments,
  serviceScheduleExportRows,
  SERVICE_INTERVAL_MONTHS,
  SERVICE_REOPEN_DAYS,
} from './lib/serviceScheduleReport'

function statusColor(status) {
  if (status === 'due' || status === 'overdue') return '#f87171'
  if (status === 'soon') return '#fbbf24'
  return 'var(--accent-green)'
}

export default function ServiceSchedule() {
  const [cityFilter, setCityFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [ev91Rows, setEv91Rows] = useState([])
  const [ev91Loading, setEv91Loading] = useState(true)
  const [ev91Error, setEv91Error] = useState(null)
  const [iotRows, setIotRows] = useState([])
  const [iotLoading, setIotLoading] = useState(false)
  const [iotError, setIotError] = useState(null)
  const [serviceLogs, setServiceLogs] = useState([])
  const [serviceLoading, setServiceLoading] = useState(true)
  const [serviceError, setServiceError] = useState(null)
  const [savingVehicle, setSavingVehicle] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const asOfDate = useMemo(() => new Date(), [refreshKey])

  const loadServiceLogs = useCallback(async () => {
    setServiceLoading(true)
    setServiceError(null)
    try {
      const rows = await fetchAllVehicleServiceLogs()
      setServiceLogs(rows || [])
    } catch (err) {
      setServiceLogs([])
      if (isMissingVehicleServiceTable(err)) {
        setServiceError(getVehicleServiceSetupMessage())
      } else {
        setServiceError(err?.message || 'Failed to load service done data')
      }
    } finally {
      setServiceLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setEv91Loading(true)
    setEv91Error(null)

    fetchEv91DeployedRiders()
      .then((result) => {
        if (!cancelled) setEv91Rows(result.rows || [])
      })
      .catch((err) => {
        if (cancelled) return
        setEv91Rows([])
        setEv91Error(err?.message || 'Failed to load EV91 Current Status')
      })
      .finally(() => {
        if (!cancelled) setEv91Loading(false)
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    loadServiceLogs()
  }, [loadServiceLogs, refreshKey])

  const assignments = useMemo(
    () => ev91RowsToServiceAssignments(ev91Rows, asOfDate),
    [ev91Rows, asOfDate]
  )

  useEffect(() => {
    if (ev91Loading) return undefined
    let cancelled = false
    const earliest = getEarliestDeployFromAssignments(assignments)
    const fallbackFrom = subMonths(asOfDate, 6)
    const fromDate = earliest || fallbackFrom
    const from = format(fromDate, 'yyyy-MM-dd')
    const to = format(asOfDate, 'yyyy-MM-dd')

    setIotLoading(true)
    setIotError(null)

    fetchIotDataInRange(from, to)
      .then((rows) => {
        if (!cancelled) setIotRows(rows || [])
      })
      .catch((err) => {
        if (cancelled) return
        setIotRows([])
        if (isMissingIotTable(err)) {
          setIotError(getIotDbSetupMessage())
        } else {
          setIotError(err?.message || 'Failed to load IoT KM')
        }
      })
      .finally(() => {
        if (!cancelled) setIotLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [assignments, asOfDate, ev91Loading])

  const dayKmIndex = useMemo(() => buildVehicleDayKmIndex(iotRows), [iotRows])
  const serviceIndex = useMemo(() => buildVehicleServiceIndex(serviceLogs), [serviceLogs])

  const report = useMemo(
    () =>
      buildServiceScheduleReport(assignments, {
        asOfDate,
        city: cityFilter,
        statusFilter,
        search,
        dayKmIndex,
        serviceIndex,
      }),
    [assignments, asOfDate, cityFilter, statusFilter, search, dayKmIndex, serviceIndex]
  )

  const markServiceDone = useCallback(
    async (row) => {
      if (!row?.vehicleNumber) return

      if (row.serviceDoneValue === 'done') {
        const force = window.confirm(
          `${row.vehicleNumber} is already marked Service Done for this cycle.\n\n` +
            `Last service: ${row.lastServiceDoneLabel}\n` +
            `Services done so far: ${row.servicesDone}\n` +
            `Next service due: ${row.nextServiceDueLabel}\n\n` +
            `Dropdown normally unlocks ${SERVICE_REOPEN_DAYS} days before next due.\n` +
            `Add another Service Done record now anyway?`
        )
        if (!force) return
      } else {
        const ok = window.confirm(
          `Mark service done for ${row.vehicleNumber}?\n\n` +
            `This is service #${(row.servicesDone || 0) + 1} for this vehicle.\n` +
            `Saved permanently. Next due will be +${SERVICE_INTERVAL_MONTHS} months from today.\n` +
            `Dropdown for the next service unlocks ${SERVICE_REOPEN_DAYS} days before that due date.`
        )
        if (!ok) return
      }

      setSavingVehicle(row.vehicleNumber)
      try {
        await saveVehicleServiceDone({
          vehicleNumber: row.vehicleNumber,
          serviceDate: new Date(),
          city: row.city,
          clientName: row.client,
          riderId: row.riderId,
          riderName: row.riderName,
          ev91RiderId: row.ev91RiderId,
          totalKm: row.totalKm,
        })
        await loadServiceLogs()
      } catch (err) {
        if (isMissingVehicleServiceTable(err)) {
          window.alert(getVehicleServiceSetupMessage())
        } else {
          window.alert(err?.message || 'Failed to save service done')
        }
      } finally {
        setSavingVehicle('')
      }
    },
    [loadServiceLogs]
  )

  const onServiceDropdownChange = useCallback(
    (row, value) => {
      if (value === 'done') {
        markServiceDone(row)
        return
      }
      if (value === 'not_done' && row.serviceDoneValue === 'done') {
        window.alert(
          `${row.vehicleNumber}: Service Done stays saved.\n` +
            `Dropdown unlocks again ${SERVICE_REOPEN_DAYS} days before next due (${row.nextServiceDueLabel}) — then select Service Done for service #${(row.servicesDone || 0) + 1}.`
        )
      }
    },
    [markServiceDone]
  )

  const exportExcel = useCallback(() => {
    const rows = serviceScheduleExportRows(report.rows)
    if (!rows.length) {
      window.alert('No deployed vehicles to export.')
      return
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Service Schedule')
    if (serviceLogs.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          serviceLogs.map((s) => ({
            'Vehicle No.': s.vehicle_number,
            'Service Date': s.service_date,
            Status: s.service_status,
            City: s.city,
            Client: s.client_name,
            'Rider ID': s.rider_id,
            'Rider Name': s.rider_name,
            'EV91 Rider ID': s.ev91_rider_id,
            'KM at service': s.total_km,
            'Saved At': s.created_at,
          }))
        ),
        'Service Done Log'
      )
    }
    const cityPart = cityFilter && cityFilter !== 'All' ? cityFilter.replace(/\s+/g, '_') : 'All_Cities'
    XLSX.writeFile(wb, `Service_Schedule_EV91_${cityPart}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
  }, [report.rows, cityFilter, serviceLogs])

  if (ev91Loading && !ev91Rows.length) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="fsr-container">
      <div className="fsr-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', width: '100%', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Wrench size={28} style={{ color: 'var(--primary)' }} />
            <div>
              <h1>Service Schedule</h1>
              <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                EV91 Deployed · every {SERVICE_INTERVAL_MONTHS} months · next Service Done unlocks {SERVICE_REOPEN_DAYS}{' '}
                days before due · KM deploy → today · {report.asOfLabel}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="fsr-export-btn"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={ev91Loading}
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="fsr-export-btn" onClick={exportExcel} disabled={!report.rows.length}>
              <Download size={16} /> Export
            </button>
          </div>
        </div>
      </div>

      {ev91Error ? (
        <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', color: '#f87171' }}>
          EV91 API: {ev91Error}
        </div>
      ) : null}
      {serviceError ? (
        <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', color: '#fbbf24' }}>
          Service Done save: {serviceError}
        </div>
      ) : null}

      <div className="fsr-filters glass">
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <MapPin size={16} /> City
          </label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="fsr-select">
            <option value="All">All cities</option>
            {report.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>
        <div className="fsr-filter-group">
          <label className="fsr-filter-label">
            <AlertTriangle size={16} /> Status
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="fsr-select">
            <option value="All">All statuses</option>
            <option value="due">Due today</option>
            <option value="soon">Due soon</option>
            <option value="ok">Upcoming</option>
            <option value="service_done">Service Done</option>
            <option value="service_pending">Not Done</option>
          </select>
        </div>
        <div className="fsr-filter-group" style={{ flex: 1, minWidth: '220px' }}>
          <label className="fsr-filter-label">
            <Search size={16} /> Search
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="fsr-date-input"
            placeholder="Vehicle, rider, client…"
          />
        </div>
      </div>

      <div className="fsr-stats-grid">
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-deployed">
            <Truck size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">EV91 Deployed</span>
            <span className="fsr-stat-value">{report.totals.vehicles.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-negative">
            <AlertTriangle size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Due today</span>
            <span className="fsr-stat-value">{report.totals.overdue.toLocaleString()}</span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-positive">
            <CheckCircle2 size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Service Done (cycle)</span>
            <span className="fsr-stat-value">
              {serviceLoading ? '…' : report.totals.serviceDone.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="fsr-stat-card glass">
          <div className="fsr-stat-icon fsr-stat-total">
            <Gauge size={24} />
          </div>
          <div className="fsr-stat-content">
            <span className="fsr-stat-label">Total KM (deploy → today)</span>
            <span className="fsr-stat-value">
              {iotLoading ? '…' : report.totals.totalKm.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
            </span>
          </div>
        </div>
      </div>

      {iotError ? (
        <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', color: '#fbbf24' }}>
          KM unavailable: {iotError}
        </div>
      ) : null}

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 320px)' }}>
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Rider</th>
                <th>City</th>
                <th>Client</th>
                <th>Deployed</th>
                <th>Days</th>
                <th>Last service</th>
                <th>Services done</th>
                <th>Next service</th>
                <th>Due status</th>
                <th>Service</th>
                <th style={{ textAlign: 'right' }}>Total KM</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length ? (
                report.rows.map((r) => (
                  <tr key={`${r.vehicleNumber}-${r.ev91RiderId || r.riderId}`}>
                    <td style={{ fontWeight: 600 }}>{r.vehicleNumber || '—'}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.riderName || '—'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {r.riderId || r.ev91RiderId || '—'}
                      </div>
                    </td>
                    <td>{r.city}</td>
                    <td>{r.client}</td>
                    <td>{r.deployDateLabel}</td>
                    <td>{r.allotmentDays}</td>
                    <td>{r.lastServiceDoneLabel}</td>
                    <td style={{ fontWeight: 700 }}>{r.servicesDone}</td>
                    <td style={{ fontWeight: 600 }}>{r.nextServiceDueLabel}</td>
                    <td>
                      <span className="status-badge" style={{ color: statusColor(r.status), fontSize: '0.7rem' }}>
                        {r.statusLabel}
                        {r.daysUntilDue != null && r.status !== 'due' ? ` · ${r.daysUntilDue}d` : ''}
                      </span>
                    </td>
                    <td>
                      <select
                        className="fsr-select"
                        value={r.serviceDoneValue}
                        disabled={
                          !!savingVehicle ||
                          !!serviceError ||
                          (r.serviceDoneValue === 'done' && !r.serviceDropdownEnabled)
                        }
                        title={
                          r.serviceDoneValue === 'done' && !r.serviceDropdownEnabled
                            ? `Locked until ${SERVICE_REOPEN_DAYS} days before next due (${r.nextServiceDueLabel})`
                            : r.serviceDoneValue === 'not_done' && r.servicesDone > 0
                              ? `Ready for service #${r.servicesDone + 1}`
                              : undefined
                        }
                        onChange={(e) => onServiceDropdownChange(r, e.target.value)}
                        style={{
                          minWidth: '130px',
                          color: r.serviceDoneValue === 'done' ? 'var(--accent-green)' : undefined,
                          opacity:
                            r.serviceDoneValue === 'done' && !r.serviceDropdownEnabled ? 0.7 : 1,
                        }}
                      >
                        <option value="not_done">Not Done</option>
                        <option value="done">
                          {savingVehicle === r.vehicleNumber ? 'Saving…' : 'Service Done'}
                        </option>
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {iotLoading
                        ? '…'
                        : r.totalKm.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    {ev91Loading ? 'Loading EV91 Deployed…' : 'No EV91 Deployed vehicles for this filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
