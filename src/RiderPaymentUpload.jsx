import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Upload, RotateCcw, Wallet, Landmark, Loader, Database, AlertTriangle, CircleDollarSign, Clock, Shield } from 'lucide-react'
import { formatLastUploadAt } from './lib/paymentMonthList'
import {
  parseRiderPaymentFile,
  parseManualCollationFile,
  parseRentalPendingFile,
  parseEv91SdFile,
  RIDER_PAYMENT_HEADER_LABELS,
  MANUAL_COLLATION_HEADER_LABELS,
  RENTAL_PENDING_HEADER_LABELS,
  EV91_SD_HEADER_LABELS,
} from './lib/paymentUploadParse'
import {
  loadRiderPaymentSummary,
  saveRiderPaymentRows,
  clearRiderPaymentData,
  clearRiderPaymentDataByMonth,
  getRiderPaymentDbSetupMessage,
  isMissingRiderPaymentTable,
} from './lib/riderPaymentDb'
import {
  loadManualCollationSummary,
  saveManualCollationRows,
  clearManualCollationData,
  clearManualCollationDataByMonth,
  getManualCollationDbSetupMessage,
  isMissingManualCollationTable,
} from './lib/manualCollationDb'
import {
  loadRentalPendingSummary,
  saveRentalPendingRows,
  clearRentalPendingData,
  clearRentalPendingDataByMonth,
  getRentalPendingDbSetupMessage,
  isMissingRentalPendingTable,
} from './lib/rentalPendingDb'
import {
  loadEv91SdSummary,
  saveEv91SdRows,
  clearEv91SdData,
  getEv91SdDbSetupMessage,
  isMissingEv91SdTable,
} from './lib/ev91SdDb'

function ResetConfirmModal({ open, title, message, confirming, onCancel, onConfirm }) {
  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-confirm-title"
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
            <h3 id="reset-confirm-title" style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h3>
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

function UploadSection({
  title,
  icon: Icon,
  iconColor,
  headerLabels,
  count,
  lastUploadAt,
  preview,
  previewColumns,
  message,
  uploading,
  resetting,
  resetMonths = [],
  resetMonth = '',
  onResetMonthChange,
  onUpload,
  onReset,
  showMonthReset = true,
}) {
  return (
    <div className="glass" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flex: 1, minWidth: '260px' }}>
          <Icon size={22} style={{ color: iconColor, marginTop: 2 }} />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Upload Excel (.xlsx, .xls) or CSV. Upload replaces all saved rows for this section.
            </p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              <strong>{count.toLocaleString()}</strong> rows in database
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
              onChange={onUpload}
              disabled={uploading || resetting}
              hidden
            />
          </label>
          {showMonthReset ? (
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
                onChange={(e) => onResetMonthChange?.(e.target.value)}
                disabled={uploading || resetting || count === 0}
                title="Choose a month to clear, or All months to clear everything"
              >
                <option value="">All months</option>
                {resetMonths.length === 0 && count > 0 ? (
                  <option value="" disabled>No months found</option>
                ) : null}
                {resetMonths.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="glass-btn"
            onClick={onReset}
            disabled={uploading || resetting || count === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem' }}
          >
            {resetting ? <Loader size={16} className="spin" /> : <RotateCcw size={16} />}
            {showMonthReset && resetMonth ? `Reset ${resetMonth}` : 'Reset all'}
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
          Expected column headers ({headerLabels.length})
        </summary>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.6, wordBreak: 'break-word' }}>
          {headerLabels.join(' · ')}
        </p>
      </details>

      {preview.length > 0 && (
        <div className="table-container" style={{ maxHeight: '280px' }}>
          <table>
            <thead>
              <tr>
                {previewColumns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.id}>
                  {previewColumns.map((col) => (
                    <td key={col.key}>{row[col.key] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function RiderPaymentUpload() {
  const [paymentCount, setPaymentCount] = useState(0)
  const [paymentPreview, setPaymentPreview] = useState([])
  const [paymentMonths, setPaymentMonths] = useState([])
  const [paymentResetMonth, setPaymentResetMonth] = useState('')
  const [collationCount, setCollationCount] = useState(0)
  const [collationPreview, setCollationPreview] = useState([])
  const [collationMonths, setCollationMonths] = useState([])
  const [collationResetMonth, setCollationResetMonth] = useState('')
  const [rentalCount, setRentalCount] = useState(0)
  const [rentalPreview, setRentalPreview] = useState([])
  const [rentalMonths, setRentalMonths] = useState([])
  const [rentalResetMonth, setRentalResetMonth] = useState('')
  const [ev91SdCount, setEv91SdCount] = useState(0)
  const [ev91SdPreview, setEv91SdPreview] = useState([])
  const [paymentLastUpload, setPaymentLastUpload] = useState(null)
  const [collationLastUpload, setCollationLastUpload] = useState(null)
  const [rentalLastUpload, setRentalLastUpload] = useState(null)
  const [ev91SdLastUpload, setEv91SdLastUpload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [paymentUploading, setPaymentUploading] = useState(false)
  const [paymentResetting, setPaymentResetting] = useState(false)
  const [collationUploading, setCollationUploading] = useState(false)
  const [collationResetting, setCollationResetting] = useState(false)
  const [rentalUploading, setRentalUploading] = useState(false)
  const [rentalResetting, setRentalResetting] = useState(false)
  const [ev91SdUploading, setEv91SdUploading] = useState(false)
  const [ev91SdResetting, setEv91SdResetting] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState(null)
  const [collationMessage, setCollationMessage] = useState(null)
  const [rentalMessage, setRentalMessage] = useState(null)
  const [ev91SdMessage, setEv91SdMessage] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [missingTables, setMissingTables] = useState([])

  const refreshSummaries = useCallback(async () => {
    setLoadError(null)
    const emptySummary = { count: 0, preview: [], months: [], lastUploadAt: null, fromDb: true }
    const [payment, collation, rental, ev91Sd] = await Promise.all([
      loadRiderPaymentSummary().catch((err) => {
        console.error('Rider payment summary failed:', err)
        return { ...emptySummary, timedOut: true }
      }),
      loadManualCollationSummary().catch((err) => {
        console.error('Manual collation summary failed:', err)
        return { ...emptySummary, timedOut: true }
      }),
      loadRentalPendingSummary().catch((err) => {
        console.error('Rental pending summary failed:', err)
        return { ...emptySummary, timedOut: true }
      }),
      loadEv91SdSummary().catch((err) => {
        console.error('EV91 SD summary failed:', err)
        return { count: 0, preview: [], lastUploadAt: null, fromDb: true, timedOut: true }
      }),
    ])
    setPaymentCount(payment.count)
    setPaymentPreview(payment.preview)
    setPaymentMonths(payment.months || [])
    setPaymentLastUpload(payment.lastUploadAt ?? null)
    setCollationCount(collation.count)
    setCollationPreview(collation.preview)
    setCollationMonths(collation.months || [])
    setCollationLastUpload(collation.lastUploadAt ?? null)
    setRentalCount(rental.count)
    setRentalPreview(rental.preview)
    setRentalMonths(rental.months || [])
    setRentalLastUpload(rental.lastUploadAt ?? null)
    setEv91SdCount(ev91Sd.count)
    setEv91SdPreview(ev91Sd.preview)
    setEv91SdLastUpload(ev91Sd.lastUploadAt ?? null)
    setPaymentResetMonth((prev) => ((payment.months || []).includes(prev) ? prev : ''))
    setCollationResetMonth((prev) => ((collation.months || []).includes(prev) ? prev : ''))
    setRentalResetMonth((prev) => ((rental.months || []).includes(prev) ? prev : ''))

    const missing = []
    if (payment.missingTable) missing.push('rider_payment_data')
    if (collation.missingTable) missing.push('manual_collation_data')
    if (rental.missingTable) missing.push('rental_pending_data')
    if (ev91Sd.missingTable) missing.push('ev91_sd_data')
    setMissingTables(missing)

    return { payment, collation, rental, ev91Sd }
  }, [])

  useEffect(() => {
    refreshSummaries()
      .catch((err) => {
        console.error('Rider payment upload load failed:', err)
        setLoadError(err?.message || 'Failed to load payment data from Supabase. Check connection and try again.')
      })
      .finally(() => setLoading(false))
  }, [refreshSummaries])

  const handlePaymentUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setPaymentUploading(true)
    setPaymentMessage(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetName } = parseRiderPaymentFile(buffer)
      if (!rows.length) {
        setPaymentMessage({ type: 'error', text: 'No valid rider payment rows found. Check column headers.' })
        return
      }
      const inserted = await saveRiderPaymentRows(rows, { replace: true })
      await refreshSummaries()
      setPaymentMessage({
        type: 'success',
        text: `Saved ${inserted.toLocaleString()} rider payment row(s) from ${sheetName || file.name}.`,
      })
    } catch (err) {
      const text = isMissingRiderPaymentTable(err)
        ? getRiderPaymentDbSetupMessage()
        : err?.message || 'Upload failed.'
      setPaymentMessage({ type: 'error', text })
    } finally {
      setPaymentUploading(false)
    }
  }

  const handlePaymentReset = () => {
    const monthLabel = paymentResetMonth.trim()
    setResetConfirm({
      type: 'payment',
      month: monthLabel,
      title: monthLabel ? `Reset ${monthLabel}?` : 'Reset all rider payment data?',
      message: monthLabel
        ? `Clear rider payment data for month "${monthLabel}" only from the database.`
        : 'Clear ALL rider payment data from the database.',
    })
  }

  const runPaymentReset = async (monthLabel) => {
    setPaymentResetting(true)
    setPaymentMessage(null)
    try {
      if (monthLabel) {
        await clearRiderPaymentDataByMonth(monthLabel)
      } else {
        await clearRiderPaymentData()
      }
      setPaymentResetMonth('')
      await refreshSummaries()
      setPaymentMessage({
        type: 'success',
        text: monthLabel
          ? `Rider payment data cleared for ${monthLabel}.`
          : 'All rider payment data cleared.',
      })
    } catch (err) {
      const text = isMissingRiderPaymentTable(err)
        ? getRiderPaymentDbSetupMessage()
        : err?.message || 'Reset failed.'
      setPaymentMessage({ type: 'error', text })
    } finally {
      setPaymentResetting(false)
      setResetConfirm(null)
    }
  }

  const handleCollationUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setCollationUploading(true)
    setCollationMessage(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetName } = parseManualCollationFile(buffer)
      if (!rows.length) {
        setCollationMessage({ type: 'error', text: 'No valid manual collation rows found. Check column headers.' })
        return
      }
      const inserted = await saveManualCollationRows(rows, { replace: true })
      await refreshSummaries()
      setCollationMessage({
        type: 'success',
        text: `Saved ${inserted.toLocaleString()} manual collation row(s) from ${sheetName || file.name}.`,
      })
    } catch (err) {
      const text = isMissingManualCollationTable(err)
        ? getManualCollationDbSetupMessage()
        : err?.message || 'Upload failed.'
      setCollationMessage({ type: 'error', text })
    } finally {
      setCollationUploading(false)
    }
  }

  const handleCollationReset = () => {
    const monthLabel = collationResetMonth.trim()
    setResetConfirm({
      type: 'collation',
      month: monthLabel,
      title: monthLabel ? `Reset ${monthLabel}?` : 'Reset all manual collation data?',
      message: monthLabel
        ? `Clear manual collation data for month "${monthLabel}" only from the database.`
        : 'Clear ALL manual collation data from the database.',
    })
  }

  const runCollationReset = async (monthLabel) => {
    setCollationResetting(true)
    setCollationMessage(null)
    try {
      if (monthLabel) {
        await clearManualCollationDataByMonth(monthLabel)
      } else {
        await clearManualCollationData()
      }
      setCollationResetMonth('')
      await refreshSummaries()
      setCollationMessage({
        type: 'success',
        text: monthLabel
          ? `Manual collation data cleared for ${monthLabel}.`
          : 'All manual collation data cleared.',
      })
    } catch (err) {
      const text = isMissingManualCollationTable(err)
        ? getManualCollationDbSetupMessage()
        : err?.message || 'Reset failed.'
      setCollationMessage({ type: 'error', text })
    } finally {
      setCollationResetting(false)
      setResetConfirm(null)
    }
  }

  const handleRentalUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setRentalUploading(true)
    setRentalMessage(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetName } = parseRentalPendingFile(buffer)
      if (!rows.length) {
        setRentalMessage({ type: 'error', text: 'No valid rental pending rows found. Check column headers.' })
        return
      }
      const inserted = await saveRentalPendingRows(rows, { replace: true })
      await refreshSummaries()
      setRentalMessage({
        type: 'success',
        text: `Saved ${inserted.toLocaleString()} rental pending row(s) from ${sheetName || file.name}.`,
      })
    } catch (err) {
      const text = isMissingRentalPendingTable(err)
        ? getRentalPendingDbSetupMessage()
        : err?.message || 'Upload failed.'
      setRentalMessage({ type: 'error', text })
    } finally {
      setRentalUploading(false)
    }
  }

  const handleRentalReset = () => {
    const monthLabel = rentalResetMonth.trim()
    setResetConfirm({
      type: 'rental',
      month: monthLabel,
      title: monthLabel ? `Reset ${monthLabel}?` : 'Reset all rental pending data?',
      message: monthLabel
        ? `Clear rental pending data for month "${monthLabel}" only from the database.`
        : 'Clear ALL rental pending amount data from the database.',
    })
  }

  const runRentalReset = async (monthLabel) => {
    setRentalResetting(true)
    setRentalMessage(null)
    try {
      if (monthLabel) {
        await clearRentalPendingDataByMonth(monthLabel)
      } else {
        await clearRentalPendingData()
      }
      setRentalResetMonth('')
      await refreshSummaries()
      setRentalMessage({
        type: 'success',
        text: monthLabel
          ? `Rental pending data cleared for ${monthLabel}.`
          : 'All rental pending data cleared.',
      })
    } catch (err) {
      const text = isMissingRentalPendingTable(err)
        ? getRentalPendingDbSetupMessage()
        : err?.message || 'Reset failed.'
      setRentalMessage({ type: 'error', text })
    } finally {
      setRentalResetting(false)
      setResetConfirm(null)
    }
  }

  const handleEv91SdUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setEv91SdUploading(true)
    setEv91SdMessage(null)
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetName } = parseEv91SdFile(buffer)
      if (!rows.length) {
        setEv91SdMessage({ type: 'error', text: 'No valid EV91 SD rows found. Check column headers.' })
        return
      }
      const inserted = await saveEv91SdRows(rows, { replace: true })
      await refreshSummaries()
      setEv91SdMessage({
        type: 'success',
        text: `Saved ${inserted.toLocaleString()} EV91 SD row(s) from ${sheetName || file.name}.`,
      })
    } catch (err) {
      const text = isMissingEv91SdTable(err)
        ? getEv91SdDbSetupMessage()
        : err?.message || 'Upload failed.'
      setEv91SdMessage({ type: 'error', text })
    } finally {
      setEv91SdUploading(false)
    }
  }

  const handleEv91SdReset = () => {
    setResetConfirm({
      type: 'ev91sd',
      month: '',
      title: 'Reset all EV91 SD data?',
      message: 'Clear ALL EV91 SD data from the database.',
    })
  }

  const runEv91SdReset = async () => {
    setEv91SdResetting(true)
    setEv91SdMessage(null)
    try {
      await clearEv91SdData()
      await refreshSummaries()
      setEv91SdMessage({ type: 'success', text: 'All EV91 SD data cleared.' })
    } catch (err) {
      const text = isMissingEv91SdTable(err)
        ? getEv91SdDbSetupMessage()
        : err?.message || 'Reset failed.'
      setEv91SdMessage({ type: 'error', text })
    } finally {
      setEv91SdResetting(false)
      setResetConfirm(null)
    }
  }

  const handleResetConfirm = async () => {
    if (!resetConfirm) return
    if (resetConfirm.type === 'payment') {
      await runPaymentReset(resetConfirm.month)
    } else if (resetConfirm.type === 'rental') {
      await runRentalReset(resetConfirm.month)
    } else if (resetConfirm.type === 'ev91sd') {
      await runEv91SdReset()
    } else {
      await runCollationReset(resetConfirm.month)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Wallet size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1 style={{ margin: 0 }}>Rider Payment Upload</h1>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
              Upload rider payout, manual bank collation, and rental pending amount files to Supabase
            </p>
          </div>
        </div>
      </header>

      <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
        <Database size={16} />
        First-time setup: run <code style={{ color: '#fff' }}>sql/create_rider_payment_tables.sql</code> in Supabase SQL Editor.
        If the page times out on large data, also run <code style={{ color: '#fff' }}>sql/fix_rider_payment_timeout.sql</code>.
      </div>

      {loadError && (
        <div className="glass" style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#f87171', background: 'rgba(239,68,68,0.1)', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={16} />
            {loadError}
          </span>
          <button
            type="button"
            className="glass-btn"
            onClick={() => {
              setLoading(true)
              refreshSummaries()
                .catch((err) => setLoadError(err?.message || 'Failed to load payment data.'))
                .finally(() => setLoading(false))
            }}
            style={{ padding: '0.4rem 0.85rem' }}
          >
            Retry load
          </button>
        </div>
      )}

      {missingTables.length > 0 && !loadError && (
        <div className="glass" style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#fbbf24', background: 'rgba(251,191,36,0.1)' }}>
          <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
          Missing table(s): {missingTables.join(', ')}. Run the SQL setup script in Supabase, then refresh.
        </div>
      )}

      <UploadSection
        title="Rider Payment Data"
        icon={Wallet}
        iconColor="var(--accent-green)"
        headerLabels={RIDER_PAYMENT_HEADER_LABELS}
        count={paymentCount}
        lastUploadAt={paymentLastUpload}
        preview={paymentPreview}
        previewColumns={[
          { key: 'rider_id', label: 'Rider ID' },
          { key: 'rider_name', label: 'Rider Name' },
          { key: 'client_name', label: 'Client' },
          { key: 'city', label: 'City' },
          { key: 'month', label: 'Month' },
          { key: 'orders', label: 'Orders' },
          { key: 'final_net_payout', label: 'Final Net Payout' },
          { key: 'payment_status', label: 'Status' },
        ]}
        message={paymentMessage}
        uploading={paymentUploading}
        resetting={paymentResetting}
        resetMonths={paymentMonths}
        resetMonth={paymentResetMonth}
        onResetMonthChange={setPaymentResetMonth}
        onUpload={handlePaymentUpload}
        onReset={handlePaymentReset}
      />

      <UploadSection
        title="Manual Collation Data"
        icon={Landmark}
        iconColor="var(--accent-blue)"
        headerLabels={MANUAL_COLLATION_HEADER_LABELS}
        count={collationCount}
        lastUploadAt={collationLastUpload}
        preview={collationPreview}
        previewColumns={[
          { key: 'month', label: 'Month' },
          { key: 'transaction_date', label: 'Txn Date' },
          { key: 'rider_id', label: 'Rider ID' },
          { key: 'rider_name', label: 'Rider Name' },
          { key: 'city', label: 'City' },
          { key: 'deposits', label: 'Deposits' },
          { key: 'withdrawals', label: 'Withdrawals' },
          { key: 'purpose', label: 'Purpose' },
        ]}
        message={collationMessage}
        uploading={collationUploading}
        resetting={collationResetting}
        resetMonths={collationMonths}
        resetMonth={collationResetMonth}
        onResetMonthChange={setCollationResetMonth}
        onUpload={handleCollationUpload}
        onReset={handleCollationReset}
      />

      <UploadSection
        title="Rental Pending Amount"
        icon={CircleDollarSign}
        iconColor="#f59e0b"
        headerLabels={RENTAL_PENDING_HEADER_LABELS}
        count={rentalCount}
        lastUploadAt={rentalLastUpload}
        preview={rentalPreview}
        previewColumns={[
          { key: 'rider_id', label: 'Rider ID' },
          { key: 'rider_name', label: 'Rider Name' },
          { key: 'client_name', label: 'Client' },
          { key: 'city', label: 'City' },
          { key: 'vehicle_number', label: 'Vehicle' },
          { key: 'week_end_date', label: 'Week End' },
          { key: 'actual_pending_for_week_after_sd', label: 'Pending After SD' },
          { key: 'month', label: 'Month' },
        ]}
        message={rentalMessage}
        uploading={rentalUploading}
        resetting={rentalResetting}
        resetMonths={rentalMonths}
        resetMonth={rentalResetMonth}
        onResetMonthChange={setRentalResetMonth}
        onUpload={handleRentalUpload}
        onReset={handleRentalReset}
      />

      <UploadSection
        title="EV91 SD"
        icon={Shield}
        iconColor="#a78bfa"
        headerLabels={EV91_SD_HEADER_LABELS}
        count={ev91SdCount}
        lastUploadAt={ev91SdLastUpload}
        preview={ev91SdPreview}
        previewColumns={[
          { key: 'public_rider_id', label: 'PublicRiderId' },
          { key: 'client_rider_id', label: 'ClientRiderId' },
          { key: 'city', label: 'City' },
          { key: 'client_name', label: 'ClientName' },
          { key: 'total_sd', label: 'TotalSd' },
          { key: 'pending_sd', label: 'PendingSd' },
          { key: 'fixed_deposit', label: 'FixedDeposit' },
        ]}
        message={ev91SdMessage}
        uploading={ev91SdUploading}
        resetting={ev91SdResetting}
        showMonthReset={false}
        onUpload={handleEv91SdUpload}
        onReset={handleEv91SdReset}
      />

      <ResetConfirmModal
        open={Boolean(resetConfirm)}
        title={resetConfirm?.title || ''}
        message={resetConfirm?.message || ''}
        confirming={paymentResetting || collationResetting || rentalResetting || ev91SdResetting}
        onCancel={() => {
          if (!paymentResetting && !collationResetting && !rentalResetting && !ev91SdResetting) setResetConfirm(null)
        }}
        onConfirm={handleResetConfirm}
      />
    </div>
  )
}
