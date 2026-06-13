import React, { useMemo, useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ClipboardPaste, Copy, Download, Loader } from 'lucide-react'
import {
  buildEvLookupContext,
  lookupRiderEvTypesWithContext,
  lookupRiderByVehicleWithContext,
  evLookupToCsv,
  evLookupTypesOnly,
  vehicleRiderLookupToCsv,
  vehicleRiderLookupWorkerCodesOnly,
} from './lib/riderEvLookup'
import { countFleetSources } from './lib/fleetInsightIndex'

const LOOKUP_DEBOUNCE_MS = 400
const MAX_TABLE_ROWS = 500

export default function EvLookupPanel({ riderData, fleetData = [], defaultOpen = false }) {
  const [activeTab, setActiveTab] = useState('worker')
  const [evPasteText, setEvPasteText] = useState('')
  const [vehiclePasteText, setVehiclePasteText] = useState('')
  const [showEvLookup, setShowEvLookup] = useState(defaultOpen)
  const [workerResults, setWorkerResults] = useState([])
  const [vehicleResults, setVehicleResults] = useState([])
  const [lookupBusy, setLookupBusy] = useState(false)

  const fleetSourceCounts = useMemo(() => countFleetSources(fleetData), [fleetData])

  const evContext = useMemo(() => {
    if (!showEvLookup || !fleetData?.length) return null
    return buildEvLookupContext(riderData, fleetData)
  }, [showEvLookup, riderData, fleetData])

  useEffect(() => {
    if (!showEvLookup || activeTab !== 'worker') return
    if (!evPasteText.trim()) {
      setWorkerResults([])
      setLookupBusy(false)
      return
    }
    if (!evContext) return

    setLookupBusy(true)
    const timer = setTimeout(() => {
      setWorkerResults(lookupRiderEvTypesWithContext(evPasteText, evContext))
      setLookupBusy(false)
    }, LOOKUP_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [evPasteText, evContext, showEvLookup, activeTab])

  useEffect(() => {
    if (!showEvLookup || activeTab !== 'vehicle') return
    if (!vehiclePasteText.trim()) {
      setVehicleResults([])
      setLookupBusy(false)
      return
    }
    if (!evContext) return

    setLookupBusy(true)
    const timer = setTimeout(() => {
      setVehicleResults(lookupRiderByVehicleWithContext(vehiclePasteText, evContext))
      setLookupBusy(false)
    }, LOOKUP_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [vehiclePasteText, evContext, showEvLookup, activeTab])

  const evLookupResults = workerResults
  const vehicleLookupResults = vehicleResults
  const activeResults = activeTab === 'worker' ? evLookupResults : vehicleLookupResults
  const displayedWorkerRows = evLookupResults.slice(0, MAX_TABLE_ROWS)
  const displayedVehicleRows = vehicleLookupResults.slice(0, MAX_TABLE_ROWS)

  const copyResults = () => {
    if (!activeResults.length) return
    const text = activeTab === 'worker'
      ? evLookupTypesOnly(evLookupResults)
      : vehicleRiderLookupWorkerCodesOnly(vehicleLookupResults)
    navigator.clipboard.writeText(text)
  }

  const exportDetails = () => {
    if (!activeResults.length) return
    const csv = activeTab === 'worker'
      ? evLookupToCsv(evLookupResults)
      : vehicleRiderLookupToCsv(vehicleLookupResults)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeTab === 'worker'
      ? `ev_non_ev_lookup_${format(new Date(), 'yyyy-MM-dd')}.csv`
      : `vehicle_rider_lookup_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="glass rp-ev-lookup">
      <div className="rp-ev-lookup-header">
        <div>
          <h3><ClipboardPaste size={18} /> EV / NON-EV Lookup</h3>
          <p>
            Paste rows to lookup fleet data — by <strong>WorkerCode</strong> (EV/NON-EV type) or by{' '}
            <strong>Vehicle Number</strong> (which rider had the bike on that date).
            {showEvLookup && evContext ? (
              <>
                {' '}Fleet loaded: {fleetSourceCounts.total.toLocaleString()} rows
                ({fleetSourceCounts.legacy.toLocaleString()} Database + {fleetSourceCounts.form.toLocaleString()} New Fleet Data).
              </>
            ) : null}
          </p>
        </div>
        <button type="button" className="fdv-col-toggle-btn" onClick={() => setShowEvLookup((v) => !v)}>
          {showEvLookup ? 'Hide' : 'Show'}
        </button>
      </div>

      {showEvLookup && (
        <>
          {!evContext && (
            <p className="rp-ev-tab-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Loader size={14} className="spin" /> Preparing fleet indexes…
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
                Paste <strong>Date</strong> and <strong>WorkerCode</strong> (tab or space). Returns EV if a fleet
                vehicle is deployed on that date, else from rider_metrics.
              </p>
              <textarea
                className="rp-ev-paste"
                placeholder={'29/05/2026\tCHN129-R0829\n29/05/2026\tCHN46-R2952\n29/05/2026\tWGC01-R3605'}
                value={evPasteText}
                onChange={(e) => setEvPasteText(e.target.value)}
                rows={6}
                disabled={!evContext}
              />
            </>
          ) : (
            <>
              <p className="rp-ev-tab-hint">
                Paste <strong>Date</strong> and <strong>Vehicle Number</strong> (tab or space). Returns the rider
                (WorkerCode) who had that vehicle deployed on that date.
              </p>
              <textarea
                className="rp-ev-paste"
                placeholder={'29/05/2026\tDL4SDX8338\n29/05/2026\tTN12AB1234\n30/05/2026\tKA01AB5678'}
                value={vehiclePasteText}
                onChange={(e) => setVehiclePasteText(e.target.value)}
                rows={6}
                disabled={!evContext}
              />
            </>
          )}

          <div className="rp-ev-actions">
            <span className="rp-ev-count">
              {lookupBusy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Loader size={14} className="spin" /> Looking up…
                </span>
              ) : activeTab === 'worker' ? (
                evLookupResults.length > 0
                  ? `${evLookupResults.length} rows · ${evLookupResults.filter((r) => r.evType === 'EV').length} EV · ${evLookupResults.filter((r) => r.evType === 'NON-EV').length} NON-EV · ${evLookupResults.filter((r) => r.status === 'fleet').length} from fleet`
                  : 'Paste rows above to lookup'
              ) : vehicleLookupResults.length > 0 ? (
                `${vehicleLookupResults.length} rows · ${vehicleLookupResults.filter((r) => r.status === 'deployed').length} matched · ${vehicleLookupResults.filter((r) => r.status === 'not found').length} not found`
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
                <Copy size={14} /> {activeTab === 'worker' ? 'Copy type only' : 'Copy WorkerCode'}
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
              {evLookupResults.length > MAX_TABLE_ROWS && (
                <p className="rp-ev-tab-hint" style={{ marginBottom: '0.5rem' }}>
                  Showing first {MAX_TABLE_ROWS} of {evLookupResults.length} rows. Export for full list.
                </p>
              )}
              <table className="rp-ev-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>WorkerCode</th>
                    <th>Vehicle Number</th>
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
                      <td>
                        <span className={`rp-ev-badge rp-ev-badge-${row.evType === 'EV' ? 'ev' : 'non-ev'}`}>
                          {row.evType}
                        </span>
                      </td>
                      <td className="rp-ev-matched-date">
                        {row.status === 'not found'
                          ? '—'
                          : row.status === 'fleet'
                            ? `Fleet deploy ${row.matchedDateKey}`
                            : row.status === 'fallback'
                              ? row.matchedDateKey
                              : row.dateDisplay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'vehicle' && displayedVehicleRows.length > 0 && (
            <div className="rp-ev-table-scroll">
              {vehicleLookupResults.length > MAX_TABLE_ROWS && (
                <p className="rp-ev-tab-hint" style={{ marginBottom: '0.5rem' }}>
                  Showing first {MAX_TABLE_ROWS} of {vehicleLookupResults.length} rows. Export for full list.
                </p>
              )}
              <table className="rp-ev-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vehicle Number</th>
                    <th>WorkerCode</th>
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
                      <td>{row.workerCode || '—'}</td>
                      <td>{row.riderName || '—'}</td>
                      <td className="rp-ev-matched-date">{row.deployDateKey || '—'}</td>
                      <td>
                        <span className={`rp-ev-badge rp-ev-badge-${row.status === 'deployed' ? 'ev' : 'non-ev'}`}>
                          {row.status === 'deployed' ? 'Deployed' : 'Not found'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
