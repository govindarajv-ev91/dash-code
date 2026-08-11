import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Upload,
  RotateCcw,
  Package,
  Loader,
  Database,
  AlertTriangle,
  Clock,
  Download,
} from 'lucide-react'
import { formatLastUploadAt } from './lib/paymentMonthList'
import {
  parseOrderUploadFile,
  downloadOrderUploadTemplate,
  summarizeOrderUploadDates,
  ORDER_UPLOAD_HEADER_LABELS,
  ORDER_UPLOAD_PREVIEW_COLUMNS,
} from './lib/orderUploadParse'
import {
  loadOrderUploadSummary,
  refreshOrderUploadSummaryAfterSave,
  saveOrderUploadRows,
  clearOrderUploadData,
  clearOrderUploadDataByMonth,
  getOrderUploadDbSetupMessage,
  isMissingOrderUploadTable,
} from './lib/orderUploadDb'

function ResetConfirmModal({ open, title, message, confirming, onCancel, onConfirm }) {
  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-reset-confirm-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        disabled={confirming}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          border: 'none',
          cursor: confirming ? 'not-allowed' : 'pointer',
        }}
      />
      <div
        className="glass"
        style={{
          position: 'relative',
          width: 'min(440px, 100%)',
          padding: '1.5rem',
          boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <AlertTriangle size={22} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 id="order-reset-confirm-title" style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {message}
            </p>
          </div>
        </div>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.8rem', color: '#f87171' }}>
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            className="glass-btn"
            onClick={onCancel}
            disabled={confirming}
            style={{ padding: '0.5rem 1rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              fontWeight: 600,
              cursor: confirming ? 'not-allowed' : 'pointer',
              opacity: confirming ? 0.7 : 1,
            }}
          >
            {confirming ? <Loader size={16} className="spin" /> : null}
            OK, clear data
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function OrderUpload({ onOrdersSaved }) {
  const [count, setCount] = useState(0)
  const [preview, setPreview] = useState([])
  const [months, setMonths] = useState([])
  const [resetMonth, setResetMonth] = useState('')
  const [lastUploadAt, setLastUploadAt] = useState(null)
  const [missingTable, setMissingTable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [message, setMessage] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(null)

  const refreshSummary = useCallback(async () => {
    setLoading(true)
    try {
      const summary = await loadOrderUploadSummary()
      setCount(summary.count || 0)
      setPreview(summary.preview || [])
      setMonths(summary.months || [])
      setLastUploadAt(summary.count > 0 ? summary.lastUploadAt || null : null)
      setMissingTable(Boolean(summary.missingTable))
      if (summary.missingTable) {
        setMessage({ type: 'error', text: getOrderUploadDbSetupMessage() })
      }
      return summary
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: err?.message || 'Failed to load order upload summary' })
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const applySummary = useCallback((summary) => {
    if (!summary) return
    setCount(summary.count || 0)
    setPreview(summary.preview || [])
    setMonths(summary.months || [])
    setLastUploadAt(summary.count > 0 ? summary.lastUploadAt || null : null)
    setMissingTable(Boolean(summary.missingTable))
  }, [])

  useEffect(() => {
    refreshSummary()
  }, [refreshSummary])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)
    setMessage(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetName } = parseOrderUploadFile(buffer)
      if (!rows.length) {
        setMessage({ type: 'error', text: 'No valid order rows found. Check template headers.' })
        return
      }
      const result = await saveOrderUploadRows(rows, { replace: false })
      const saved = result?.saved ?? 0
      const skipped = result?.skipped ?? 0
      const savedRows = result?.rows || []

      // Fast summary — avoid exact COUNT(*) + full-table fetch (prod timeouts).
      const summary = await refreshOrderUploadSummaryAfterSave(savedRows, { previousCount: count }).catch(
        () => null
      )
      if (summary) applySummary(summary)
      else {
        setCount((c) => c + saved)
        if (savedRows.length) setPreview(savedRows.slice(0, 25))
      }

      const dateSummary = summarizeOrderUploadDates(rows)
      const dateText = dateSummary.length
        ? dateSummary.map(({ date, count: n }) => `${date} (${n.toLocaleString()})`).join(', ')
        : 'none'
      setMessage({
        type: 'ok',
        text:
          `Saved ${saved.toLocaleString()} unique rows (Date + WorkerCode + Client + order)` +
          (skipped ? ` · ${skipped.toLocaleString()} duplicate/blank rows skipped in file` : '') +
          ` · Dates in file: ${dateText}` +
          ` · DB ~${((summary?.count ?? count) || 0).toLocaleString()} rows` +
          ` from “${sheetName || file.name}”. Previous days kept.`,
      })
      if (typeof onOrdersSaved === 'function') {
        onOrdersSaved(savedRows)
      }
    } catch (err) {
      console.error(err)
      if (isMissingOrderUploadTable(err)) {
        setMissingTable(true)
        setMessage({ type: 'error', text: getOrderUploadDbSetupMessage() })
      } else {
        setMessage({ type: 'error', text: err?.message || 'Upload failed' })
      }
    } finally {
      setUploading(false)
    }
  }

  const requestReset = () => {
    if (!count) return
    setResetConfirm({
      title: resetMonth ? `Reset ${resetMonth}?` : 'Reset all order uploads?',
      message: resetMonth
        ? `This will permanently delete all uploaded order rows for ${resetMonth}.`
        : 'This will permanently delete all uploaded order rows in the database.',
    })
  }

  const confirmReset = async () => {
    setResetting(true)
    setMessage(null)
    const monthCleared = resetMonth
    try {
      const deleted = monthCleared
        ? await clearOrderUploadDataByMonth(monthCleared)
        : await clearOrderUploadData()

      // Immediate UI update so count/last-upload don't stay stale while refresh runs.
      if (!monthCleared) {
        setCount(0)
        setPreview([])
        setMonths([])
        setLastUploadAt(null)
      }

      const summary = await refreshSummary()
      setMessage({
        type: 'ok',
        text: monthCleared
          ? `Cleared order data for ${monthCleared}` +
            (deleted != null ? ` (${Number(deleted).toLocaleString()} rows removed)` : '') +
            ` · DB now ${(summary?.count ?? 0).toLocaleString()} rows.`
          : `Cleared all order upload data` +
            (deleted != null ? ` (${Number(deleted).toLocaleString()} rows removed)` : '') +
            `.`,
      })
      setResetMonth('')
      setResetConfirm(null)
      if (typeof onOrdersSaved === 'function') {
        await onOrdersSaved()
      }
    } catch (err) {
      console.error(err)
      if (isMissingOrderUploadTable(err)) {
        setMissingTable(true)
        setMessage({ type: 'error', text: getOrderUploadDbSetupMessage() })
      } else {
        setMessage({ type: 'error', text: err?.message || 'Reset failed' })
      }
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="dashboard-container">
      <header style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Package size={28} style={{ color: '#38bdf8' }} />
            <div>
              <h1 style={{ margin: 0 }}>Order Upload</h1>
              <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Daily order tracking (separate from rider_metrics) · unique by Date + WorkerCode · Type1 = EV / NON-EV
                {' · '}
                If production times out, run <code style={{ color: '#fff' }}>sql/fix_order_upload_production_timeout.sql</code> in Supabase.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="fsr-export-btn"
            onClick={downloadOrderUploadTemplate}
            title="Download Excel template"
          >
            <Download size={16} />
            Download template
          </button>
        </div>
      </header>

      {missingTable && (
        <div
          className="glass"
          style={{
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
            background: 'rgba(251, 191, 36, 0.08)',
            border: '1px solid rgba(251, 191, 36, 0.25)',
          }}
        >
          <Database size={18} style={{ color: '#fbbf24', marginTop: 2 }} />
          <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            <strong style={{ color: '#fbbf24' }}>Setup required:</strong>{' '}
            {getOrderUploadDbSetupMessage()}
          </div>
        </div>
      )}

      <div className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flex: 1, minWidth: '260px' }}>
            <Package size={22} style={{ color: '#38bdf8', marginTop: 2 }} />
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Rider order data</h2>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Manual order tracking mapped into Dashboard, Attendance, Rider Performance & IoT
                (with rider_metrics). Unique: <strong>Date + WorkerCode + Client + order</strong>
                (e.g. 11 and 5 for same rider both kept).
              </p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                <strong>{loading ? '…' : count.toLocaleString()}</strong> rows in database
              </p>
              {count > 0 && lastUploadAt ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Clock size={12} />
                  Last upload: <strong>{formatLastUploadAt(lastUploadAt)}</strong>
                </p>
              ) : count > 0 ? (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Last upload: —
                </p>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="fsr-export-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? <Loader size={16} className="spin" /> : <Upload size={16} />}
              Upload file
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleUpload}
                disabled={uploading || resetting}
                hidden
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                fontSize: '0.7rem',
                color: 'var(--text-dim)',
                minWidth: '170px',
              }}
            >
              <span>Reset month</span>
              <select
                className="fsr-select rpu-reset-select"
                value={resetMonth}
                onChange={(e) => setResetMonth(e.target.value)}
                disabled={uploading || resetting || count === 0}
                title="Choose a month to clear, or All months to clear everything"
              >
                <option value="">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="glass-btn"
              onClick={requestReset}
              disabled={uploading || resetting || count === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem' }}
            >
              {resetting ? <Loader size={16} className="spin" /> : <RotateCcw size={16} />}
              {resetMonth ? `Reset ${resetMonth}` : 'Reset all'}
            </button>
          </div>
        </div>

        {message && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              background: message.type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
              color: message.type === 'error' ? '#f87171' : '#4ade80',
            }}
          >
            {message.text}
          </div>
        )}

        <details style={{ marginBottom: preview.length ? '1rem' : 0 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
            Expected column headers ({ORDER_UPLOAD_HEADER_LABELS.length})
          </summary>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.6, wordBreak: 'break-word' }}>
            {ORDER_UPLOAD_HEADER_LABELS.join(' · ')}
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
            Type1 values: <strong>EV</strong> or <strong>NON-EV</strong>
            {' · '}
            Date format: <strong>dd-mm-yyyy</strong> (e.g. 22-07-2026) — saved as matching calendar day
            {' · '}
            Unique key: <strong>Date + WorkerCode + Client + delivered</strong>
          </p>
        </details>

        {preview.length > 0 && (
          <div className="table-container" style={{ maxHeight: '360px' }}>
            <table>
              <thead>
                <tr>
                  {ORDER_UPLOAD_PREVIEW_COLUMNS.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, idx) => (
                  <tr key={row.id ?? `${row.worker_code}-${row.date_record}-${row.delivered}-${idx}`}>
                    {ORDER_UPLOAD_PREVIEW_COLUMNS.map((col) => (
                      <td key={col.key}>{row[col.key] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !preview.length && !missingTable && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            No order rows yet. Download the template, fill Client / Date / WorkerCode / delivered / City / Type1, then upload.
          </p>
        )}
      </div>

      <ResetConfirmModal
        open={Boolean(resetConfirm)}
        title={resetConfirm?.title || ''}
        message={resetConfirm?.message || ''}
        confirming={resetting}
        onCancel={() => !resetting && setResetConfirm(null)}
        onConfirm={confirmReset}
      />
    </div>
  )
}
