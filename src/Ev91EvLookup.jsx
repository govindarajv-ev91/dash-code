import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  ClipboardPaste,
  Copy,
  Download,
  Loader,
  RefreshCw,
  Search,
  AlertTriangle,
} from 'lucide-react'
import {
  fetchEv91OverallStatusAll,
  fetchEv91CurrentStatusAll,
  buildEv91EvLookupContext,
  lookupEv91RiderEvTypesWithContext,
  lookupEv91RiderByVehicleWithContext,
  ev91EvLookupToCsv,
  ev91VehicleRiderLookupToCsv,
  ev91EvLookupTypesOnly,
  ev91VehicleRiderLookupIdsOnly,
  selectOverviewOrderRows,
} from './lib/ev91EvLookup'

const LOOKUP_DEBOUNCE_MS = 400
const MAX_TABLE_ROWS = 500

export default function Ev91EvLookup({
  riderData,
  loading,
  refreshing = false,
  dataUpdatedAt = null,
  refreshData,
}) {
  const [activeTab, setActiveTab] = useState('worker')
  const [evPasteText, setEvPasteText] = useState('')
  const [vehiclePasteText, setVehiclePasteText] = useState('')
  const [workerResults, setWorkerResults] = useState([])
  const [vehicleResults, setVehicleResults] = useState([])
  const [lookupBusy, setLookupBusy] = useState(false)
  const [overallRows, setOverallRows] = useState([])
  const [currentRows, setCurrentRows] = useState([])
  const [overallLoading, setOverallLoading] = useState(true)
  const [overallError, setOverallError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const orderRows = useMemo(() => selectOverviewOrderRows(riderData), [riderData])

  const loadOverall = useCallback(() => {
    setOverallLoading(true)
    setOverallError('')
    return Promise.all([
      fetchEv91OverallStatusAll(),
      fetchEv91CurrentStatusAll().catch(() => ({ data: [] })),
    ])
      .then(([overall, current]) => {
        setOverallRows(overall.data || [])
        setCurrentRows(current.data || [])
      })
      .catch((err) => {
        console.warn('EV91 Status load failed:', err)
        setOverallRows([])
        setCurrentRows([])
        setOverallError(err?.message || 'Failed to load EV91 Vehicle Status')
      })
      .finally(() => setOverallLoading(false))
  }, [])

  useEffect(() => {
    loadOverall()
  }, [loadOverall, reloadKey])

  const evContext = useMemo(() => {
    if (!overallRows.length && !currentRows.length) return null
    return buildEv91EvLookupContext(overallRows, orderRows, currentRows)
  }, [overallRows, currentRows, orderRows])

  useEffect(() => {
    if (activeTab !== 'worker') return
    if (!evPasteText.trim()) {
      setWorkerResults([])
      setLookupBusy(false)
      return
    }
    if (!evContext) return

    setLookupBusy(true)
    const timer = setTimeout(() => {
      setWorkerResults(lookupEv91RiderEvTypesWithContext(evPasteText, evContext))
      setLookupBusy(false)
    }, LOOKUP_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [evPasteText, evContext, activeTab])

  useEffect(() => {
    if (activeTab !== 'vehicle') return
    if (!vehiclePasteText.trim()) {
      setVehicleResults([])
      setLookupBusy(false)
      return
    }
    if (!evContext) return

    setLookupBusy(true)
    const timer = setTimeout(() => {
      setVehicleResults(lookupEv91RiderByVehicleWithContext(vehiclePasteText, evContext))
      setLookupBusy(false)
    }, LOOKUP_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [vehiclePasteText, evContext, activeTab])

  const activeResults = activeTab === 'worker' ? workerResults : vehicleResults
  const displayedWorkerRows = workerResults.slice(0, MAX_TABLE_ROWS)
  const displayedVehicleRows = vehicleResults.slice(0, MAX_TABLE_ROWS)

  const copyResults = () => {
    if (!activeResults.length) return
    const text =
      activeTab === 'worker'
        ? ev91EvLookupTypesOnly(workerResults)
        : ev91VehicleRiderLookupIdsOnly(vehicleResults)
    navigator.clipboard.writeText(text)
  }

  const exportDetails = () => {
    if (!activeResults.length) return
    const csv =
      activeTab === 'worker'
        ? ev91EvLookupToCsv(workerResults)
        : ev91VehicleRiderLookupToCsv(vehicleResults)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download =
      activeTab === 'worker'
        ? `ev91_ev_non_ev_lookup_${format(new Date(), 'yyyy-MM-dd')}.csv`
        : `ev91_vehicle_rider_lookup_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleRefresh = () => {
    setReloadKey((k) => k + 1)
    if (refreshData && !refreshing) refreshData()
  }

  if (overallLoading && !overallRows.length && !overallError) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container ev91-root">
      {(overallLoading || refreshing) && (
        <div className="fdv-loading-banner glass rp-update-banner">
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span>
            {overallLoading
              ? 'Loading EV91 Overall Vehicle Status for lookup…'
              : 'Refreshing order data…'}
          </span>
        </div>
      )}

      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Search size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>EV / NON-EV Lookup</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Same as Error Finder · uses EV91 <strong style={{ color: '#fff' }}>Overall + Current Status</strong>
              {overallRows.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {overallRows.length.toLocaleString()} overall
                </span>
              )}
              {currentRows.length > 0 && (
                <span style={{ marginLeft: 8 }}>
                  · {currentRows.length.toLocaleString()} current deployed
                </span>
              )}
              {dataUpdatedAt && (
                <span style={{ marginLeft: 8 }}>
                  · Orders updated {format(dataUpdatedAt, 'dd/MM/yyyy HH:mm')}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          className="glass"
          type="button"
          onClick={handleRefresh}
          disabled={overallLoading || refreshing}
          style={{
            padding: '0.75rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: '#fff',
            cursor: overallLoading ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={18} className={overallLoading ? 'ev91-spin' : undefined} />
          Refresh
        </button>
      </header>

      {overallError && (
        <div className="ev91-error glass" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={18} />
          <span>{overallError}</span>
        </div>
      )}

      <div className="glass rp-ev-lookup" style={{ padding: '1.25rem' }}>
        <div className="rp-ev-lookup-header">
          <div>
            <h3>
              <ClipboardPaste size={18} /> Paste lookup
            </h3>
            <p>
              Paste rows to lookup EV91 status — by <strong>WorkerCode / Client ID</strong> (EV only if a
              vehicle is deployed that day, including after Client-Swap / same-day re-deploy) or by{' '}
              <strong>Vehicle Number</strong>. Uses Overall Status timeline + Current Status safety net.
            </p>
          </div>
        </div>

        {!evContext && !overallLoading && (
          <p className="rp-ev-tab-hint">No Overall Status data loaded yet.</p>
        )}

        {overallLoading && !evContext && (
          <p className="rp-ev-tab-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Loader size={14} className="ev91-spin" /> Preparing Overall Status indexes…
          </p>
        )}

        <div className="fdv-tabs" style={{ marginBottom: '0.25rem' }}>
          <button
            type="button"
            className={`fdv-tab ${activeTab === 'worker' ? 'fdv-tab-active' : ''}`}
            onClick={() => setActiveTab('worker')}
          >
            Date + WorkerCode
          </button>
          <button
            type="button"
            className={`fdv-tab ${activeTab === 'vehicle' ? 'fdv-tab-active' : ''}`}
            onClick={() => setActiveTab('vehicle')}
          >
            Date + Vehicle Number
          </button>
        </div>

        {activeTab === 'worker' ? (
          <>
            <p className="rp-ev-tab-hint">
              Paste <strong>Date</strong> and <strong>WorkerCode / Client ID</strong> (tab or space). Returns{' '}
              <strong>EV</strong> only if Overall Status shows a deployed vehicle on that date (including after
              Client-Swap, until Return); otherwise <strong>NON-EV</strong>.
            </p>
            <textarea
              className="rp-ev-paste"
              placeholder={'31/07/2026\t103237282821\n30/07/2026\tFE10572305\n29/07/2026\tBLR-26-R000003'}
              value={evPasteText}
              onChange={(e) => setEvPasteText(e.target.value)}
              rows={8}
              disabled={!evContext}
            />
          </>
        ) : (
          <>
            <p className="rp-ev-tab-hint">
              Paste <strong>Date</strong> and <strong>Vehicle Number</strong> (tab or space). Returns the rider
              (Client ID / EV91 ID) who had that vehicle on that date from Overall Status.
            </p>
            <textarea
              className="rp-ev-paste"
              placeholder={'31/07/2026\tKA00KA0000\n30/07/2026\tTN12AB1234\n29/07/2026\tDL4SDX8338'}
              value={vehiclePasteText}
              onChange={(e) => setVehiclePasteText(e.target.value)}
              rows={8}
              disabled={!evContext}
            />
          </>
        )}

        <div className="rp-ev-actions">
          <span className="rp-ev-count">
            {lookupBusy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <Loader size={14} className="ev91-spin" /> Looking up…
              </span>
            ) : activeTab === 'worker' ? (
              workerResults.length > 0 ? (
                `${workerResults.length} rows · ${workerResults.filter((r) => r.evType === 'EV').length} EV · ${workerResults.filter((r) => r.evType === 'NON-EV').length} NON-EV · ${workerResults.filter((r) => r.status === 'overall').length} from Overall Status`
              ) : (
                'Paste rows above to lookup'
              )
            ) : vehicleResults.length > 0 ? (
              `${vehicleResults.length} rows · ${vehicleResults.filter((r) => r.status === 'deployed').length} matched · ${vehicleResults.filter((r) => r.status === 'not found').length} not found`
            ) : (
              'Paste rows above to lookup'
            )}
          </span>
          <div className="rp-ev-action-buttons">
            <button
              type="button"
              className="fsr-export-btn"
              onClick={copyResults}
              disabled={!activeResults.length || lookupBusy}
            >
              <Copy size={14} /> {activeTab === 'worker' ? 'Copy type only' : 'Copy Client ID'}
            </button>
            <button
              type="button"
              className="fsr-export-btn"
              onClick={exportDetails}
              disabled={!activeResults.length || lookupBusy}
            >
              <Download size={14} /> Export details
            </button>
          </div>
        </div>

        {activeTab === 'worker' && displayedWorkerRows.length > 0 && (
          <div className="rp-ev-table-scroll">
            {workerResults.length > MAX_TABLE_ROWS && (
              <p className="rp-ev-tab-hint" style={{ marginBottom: '0.5rem' }}>
                Showing first {MAX_TABLE_ROWS} of {workerResults.length} rows. Export for full list.
              </p>
            )}
            <table className="rp-ev-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>WorkerCode</th>
                  <th>Vehicle Number</th>
                  <th>EV91 ID</th>
                  <th>Type</th>
                  <th>Matched from</th>
                </tr>
              </thead>
              <tbody>
                {displayedWorkerRows.map((row, idx) => (
                  <tr key={`${row.dateKey}-${row.workerKey}-${idx}`}>
                    <td>{row.dateDisplay}</td>
                    <td>{row.workerCode}</td>
                    <td>{row.vehicleNumber || '—'}</td>
                    <td>{row.ev91RiderId || '—'}</td>
                    <td>
                      <span className={`rp-ev-badge rp-ev-badge-${row.evType === 'EV' ? 'ev' : 'non-ev'}`}>
                        {row.evType}
                      </span>
                    </td>
                    <td className="rp-ev-matched-date">
                      {row.status === 'overall'
                        ? `Overall deploy ${row.matchedDateKey}`
                        : 'Not deployed in Overall Status'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'vehicle' && displayedVehicleRows.length > 0 && (
          <div className="rp-ev-table-scroll">
            {vehicleResults.length > MAX_TABLE_ROWS && (
              <p className="rp-ev-tab-hint" style={{ marginBottom: '0.5rem' }}>
                Showing first {MAX_TABLE_ROWS} of {vehicleResults.length} rows. Export for full list.
              </p>
            )}
            <table className="rp-ev-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vehicle Number</th>
                  <th>Client ID</th>
                  <th>EV91 ID</th>
                  <th>Rider Name</th>
                  <th>Deploy Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayedVehicleRows.map((row, idx) => (
                  <tr key={`${row.dateKey}-${row.vehicleKey}-${idx}`}>
                    <td>{row.dateDisplay}</td>
                    <td>{row.vehicleNumber}</td>
                    <td>{row.clientId || row.workerCode || '—'}</td>
                    <td>{row.ev91RiderId || '—'}</td>
                    <td>{row.riderName || '—'}</td>
                    <td className="rp-ev-matched-date">{row.deployDateKey || '—'}</td>
                    <td>
                      <span
                        className={`rp-ev-badge rp-ev-badge-${row.status === 'deployed' ? 'ev' : 'non-ev'}`}
                      >
                        {row.status === 'deployed' ? 'Deployed' : 'Not found'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading && !orderRows.length && (
        <p style={{ marginTop: '1rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Order data still loading — order Type1 fallback will appear when ready.
        </p>
      )}
    </div>
  )
}
