import React, { useMemo, useState, useDeferredValue } from 'react'
import { format } from 'date-fns'
import { ClipboardPaste, Copy, Download } from 'lucide-react'
import { lookupRiderEvTypes, evLookupToCsv, evLookupTypesOnly } from './lib/riderEvLookup'

export default function EvLookupPanel({ riderData, fleetData = [], defaultOpen = true }) {
  const [evPasteText, setEvPasteText] = useState('')
  const [showEvLookup, setShowEvLookup] = useState(defaultOpen)
  const deferredPaste = useDeferredValue(evPasteText)

  const evLookupResults = useMemo(() => {
    if (!deferredPaste.trim()) return []
    return lookupRiderEvTypes(deferredPaste, riderData, fleetData)
  }, [deferredPaste, riderData, fleetData])

  const copyEvTypes = () => {
    if (!evLookupResults.length) return
    navigator.clipboard.writeText(evLookupTypesOnly(evLookupResults))
  }

  const exportEvDetails = () => {
    if (!evLookupResults.length) return
    const csv = evLookupToCsv(evLookupResults)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ev_non_ev_lookup_${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="glass rp-ev-lookup">
      <div className="rp-ev-lookup-header">
        <div>
          <h3><ClipboardPaste size={18} /> EV / NON-EV Lookup</h3>
          <p>
            Paste <strong>Date</strong> and <strong>WorkerCode</strong> (tab or space). Returns{' '}
            <strong>EV</strong> if a fleet vehicle is deployed on that date, else from rider_metrics (with earlier-date fallback).
          </p>
        </div>
        <button type="button" className="fdv-col-toggle-btn" onClick={() => setShowEvLookup((v) => !v)}>
          {showEvLookup ? 'Hide' : 'Show'}
        </button>
      </div>

      {showEvLookup && (
        <>
          <textarea
            className="rp-ev-paste"
            placeholder={'29/05/2026\tCHN129-R0829\n29/05/2026\tCHN46-R2952\n29/05/2026\tWGC01-R3605'}
            value={evPasteText}
            onChange={(e) => setEvPasteText(e.target.value)}
            rows={6}
          />
          <div className="rp-ev-actions">
            <span className="rp-ev-count">
              {evLookupResults.length > 0
                ? `${evLookupResults.length} rows · ${evLookupResults.filter((r) => r.evType === 'EV').length} EV · ${evLookupResults.filter((r) => r.evType === 'NON-EV').length} NON-EV · ${evLookupResults.filter((r) => r.status === 'fleet').length} from fleet`
                : 'Paste rows above to lookup'}
            </span>
            <div className="rp-ev-action-buttons">
              <button type="button" className="fsr-export-btn" onClick={copyEvTypes} disabled={!evLookupResults.length}>
                <Copy size={14} /> Copy type only
              </button>
              <button type="button" className="fsr-export-btn" onClick={exportEvDetails} disabled={!evLookupResults.length}>
                <Download size={14} /> Export details
              </button>
            </div>
          </div>

          {evLookupResults.length > 0 && (
            <div className="rp-ev-table-scroll">
              <table className="rp-ev-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>WorkerCode</th>
                    <th>Type</th>
                    <th>Matched from</th>
                  </tr>
                </thead>
                <tbody>
                  {evLookupResults.map((row, idx) => (
                    <tr key={`${row.dateKey}-${row.workerKey}-${idx}`}>
                      <td>{row.dateDisplay}</td>
                      <td>{row.workerCode}</td>
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
        </>
      )}
    </div>
  )
}
