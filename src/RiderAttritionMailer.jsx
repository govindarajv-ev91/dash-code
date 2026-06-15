import React, { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  Mail,
  TrendingDown,
  Download,
  Search,
  MapPin,
  Briefcase,
  AlertTriangle,
  Loader,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Calendar,
} from 'lucide-react'
import { fetchPublishedCsv } from './lib/fleetSheetMerge'
import * as XLSX from 'xlsx'
import {
  buildAttritionReport,
  filterAttritionRiders,
  attritionRidersToExcelRows,
  summarizeAttrition,
} from './lib/riderAttritionReport'
import {
  CITY_MAIL_CONFIG_URL,
  citiesForCityKeys,
  getMailConfigForCityKey,
  listCityKeyOptions,
  parseCityMailConfigCsv,
  resolveCityKey,
  resolveCityMailRecipients,
} from './lib/cityMailConfig'

const ROWS_PER_PAGE = 100
const LEADERSHIP_MAIL_TO =
  'sujithra.y@ev91riderz.com,murali.bharath@ev91riderz.com,govindaraj.v@ev91riderz.com'

const MAILER_URL =
  import.meta.env.VITE_MAILER_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbyDWrOipQzyd7wTbIUpMYvW0MfyNgk5y2EV8coNmRAuQy7aN1m3ViGcGcypSwppSUAP/exec'

function MultiSelect({ label, options, selected, onChange, icon: Icon, color, formatOption }) {
  const fmt = formatOption || ((value) => value)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 220 })
  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const updateMenuPos = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: Math.max(rect.width, 220),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updateMenuPos()
    window.addEventListener('resize', updateMenuPos)
    window.addEventListener('scroll', updateMenuPos, true)
    return () => {
      window.removeEventListener('resize', updateMenuPos)
      window.removeEventListener('scroll', updateMenuPos, true)
    }
  }, [open, updateMenuPos])

  useEffect(() => {
    const onClick = (e) => {
      const inRoot = rootRef.current?.contains(e.target)
      const inMenu = menuRef.current?.contains(e.target)
      if (!inRoot && !inMenu) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const toggle = (opt) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="ram-multiselect-menu"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            zIndex: 10000,
            maxHeight: 'min(320px, calc(100vh - 24px))',
            overflowY: 'auto',
            padding: '0.5rem',
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
          }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '0.45rem 0.65rem',
              background: selected.length === 0 ? 'rgba(255,255,255,0.08)' : 'transparent',
              border: 'none',
              color: selected.length === 0 ? '#fff' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.75rem',
              borderRadius: '6px',
            }}
          >
            All {label}
          </button>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0.35rem 0' }} />
          {options.map((opt) => (
            <label
              key={opt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.65rem',
                fontSize: '0.75rem',
                color: '#fff',
                cursor: 'pointer',
                borderRadius: '6px',
              }}
            >
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmt(opt)}</span>
            </label>
          ))}
        </div>,
        document.body
      )
    : null

  return (
    <div ref={rootRef} className="ram-multiselect" style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        className="glass"
        onClick={() => {
          setOpen((v) => {
            const next = !v
            if (next) requestAnimationFrame(updateMenuPos)
            return next
          })
        }}
        style={{
          padding: '0.4rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          border: 'none',
          cursor: 'pointer',
          minWidth: '120px',
        }}
      >
        {Icon && <Icon size={14} style={{ color }} />}
        <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{label}</span>
          <span style={{ fontSize: '0.8rem', color: '#fff' }}>
            {selected.length === 0 ? 'All' : selected.length === 1 ? fmt(selected[0]) : `${selected.length} selected`}
          </span>
        </div>
      </button>
      {menu}
    </div>
  )
}

function SummaryTable({ title, rows, icon: Icon }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  return (
    <div className="glass" style={{ padding: '1rem', flex: 1, minWidth: '280px' }}>
      <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
        <Icon size={18} className="text-primary" />
        {title}
        <span className="status-badge" style={{ marginLeft: 'auto', background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
          {total}
        </span>
      </h3>
      <div className="table-container" style={{ maxHeight: '320px' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: 'right' }}>Riders</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>{row.count}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '1.5rem' }}>
                  No attrition riders
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RiderAttritionMailer({
  riderData,
  onboardingData = [],
  fleetData = [],
  loading,
}) {
  const [minDaysNotWorking, setMinDaysNotWorking] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchDebounceRef = useRef(null)
  const [selectedCityKeys, setSelectedCityKeys] = useState([])
  const [selectedClients, setSelectedClients] = useState([])
  const [selectedFirstOrderMonths, setSelectedFirstOrderMonths] = useState([])
  const [ccEmail, setCcEmail] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [sendingAll, setSendingAll] = useState(false)
  const [cityMailConfig, setCityMailConfig] = useState({
    cityKeyByLookup: new Map(),
    mailByCityKey: new Map(),
    sheetRows: [],
  })

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchTerm), 250)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [searchTerm])

  const deferredRiderData = useDeferredValue(riderData)
  const deferredFleetData = useDeferredValue(fleetData)
  const isReportStale =
    deferredRiderData !== riderData || deferredFleetData !== fleetData

  useEffect(() => {
    const fetchCityConfigs = async () => {
      try {
        const csv = await fetchPublishedCsv(CITY_MAIL_CONFIG_URL)
        setCityMailConfig(parseCityMailConfigCsv(csv))
      } catch (err) {
        console.error('Failed to fetch city configs:', err)
      }
    }
    fetchCityConfigs()
  }, [])

  const scopedCities = useMemo(() => {
    if (!selectedCityKeys.length) return []
    return citiesForCityKeys(selectedCityKeys, cityMailConfig.sheetRows)
  }, [selectedCityKeys, cityMailConfig.sheetRows])

  const emailByWorker = useMemo(() => {
    const map = new Map()
    const link = (ids, email, phone) => {
      if (!email && !phone) return
      ids.forEach((id) => {
        if (!id) return
        const prev = map.get(id) || {}
        map.set(id, {
          email: email || prev.email || 'N/A',
          phone: phone || prev.phone || 'N/A',
        })
      })
    }

    for (const o of onboardingData || []) {
      const ids = [
        (o.worker_code || '').toString().trim().toLowerCase(),
        (o.rider_id_details || '').toString().trim().toLowerCase(),
      ].filter(Boolean)
      const phone = (o.rider_mobile_number || o.mob_number || '').toString().trim()
      const email = (o.email_address || '').toString().trim()
      link(ids, email, phone)
      if (phone.replace(/\D/g, '').length >= 10) {
        link([phone.replace(/\D/g, '').slice(-10)], email, phone)
      }
    }

    for (const f of fleetData || []) {
      const ids = [(f.rider_id || '').toString().trim().toLowerCase()].filter(Boolean)
      const phone = (f.rider_contact_number || '').toString().trim()
      link(ids, '', phone)
    }

    return map
  }, [onboardingData, fleetData])

  const report = useMemo(() => {
    if (!deferredRiderData?.length) return null
    return buildAttritionReport(deferredRiderData, deferredFleetData, {
      minDaysNotWorking,
      cities: scopedCities,
      clients: selectedClients,
    })
  }, [deferredRiderData, deferredFleetData, minDaysNotWorking, scopedCities, selectedClients])

  const enrichedRiders = useMemo(() => {
    if (!report?.riders) return []
    return report.riders.map((r) => {
      const keys = [r.workerCode.toLowerCase(), r.mobNumber.replace(/\D/g, '').slice(-10)].filter(Boolean)
      let email = 'N/A'
      let phone = r.mobNumber
      for (const key of keys) {
        const info = emailByWorker.get(key)
        if (info?.email && info.email !== 'N/A') email = info.email
        if (info?.phone && info.phone !== 'N/A') phone = info.phone
      }
      const cityKey = resolveCityKey(r.city, cityMailConfig.cityKeyByLookup)
      return { ...r, email, mobNumber: phone, cityKey }
    })
  }, [report, emailByWorker, cityMailConfig.cityKeyByLookup])

  const filtered = useMemo(
    () =>
      filterAttritionRiders(enrichedRiders, {
        search: debouncedSearch,
        cityKeys: selectedCityKeys,
        clients: selectedClients,
        firstOrderMonths: selectedFirstOrderMonths,
        minDaysNotWorking,
      }),
    [
      enrichedRiders,
      debouncedSearch,
      selectedCityKeys,
      selectedClients,
      selectedFirstOrderMonths,
      minDaysNotWorking,
    ]
  )

  const summaryRiders = useMemo(
    () =>
      filterAttritionRiders(enrichedRiders, {
        search: '',
        cityKeys: selectedCityKeys,
        clients: selectedClients,
        firstOrderMonths: selectedFirstOrderMonths,
        minDaysNotWorking,
      }),
    [enrichedRiders, selectedCityKeys, selectedClients, selectedFirstOrderMonths, minDaysNotWorking]
  )

  const citySummary = useMemo(
    () => summarizeAttrition(summaryRiders, 'cityKey'),
    [summaryRiders]
  )
  const clientSummary = useMemo(
    () => summarizeAttrition(summaryRiders, 'client'),
    [summaryRiders]
  )

  const typeCounts = useMemo(() => {
    let ev = 0
    let nonEv = 0
    for (const r of filtered) {
      if (r.vType === 'EV') ev++
      else nonEv++
    }
    return { ev, nonEv }
  }, [filtered])

  const cityKeyOptions = useMemo(() => {
    const riderKeys = report?.riders?.map((r) => resolveCityKey(r.city, cityMailConfig.cityKeyByLookup)) || []
    return listCityKeyOptions(cityMailConfig.sheetRows, riderKeys)
  }, [report?.riders, cityMailConfig.sheetRows, cityMailConfig.cityKeyByLookup])
  const clientOptions = useMemo(
    () => [...new Set(enrichedRiders.map((r) => r.client))].filter((c) => c && c !== 'Unknown').sort(),
    [enrichedRiders]
  )
  const firstOrderMonthOptions = useMemo(() => {
    const months = new Set()
    for (const r of enrichedRiders) {
      const key = (r.firstOrderDateKey || '').slice(0, 7)
      if (key) months.add(key)
    }
    return [...months].sort().reverse()
  }, [enrichedRiders])
  const formatFirstOrderMonth = useCallback((monthKey) => {
    const [year, month] = monthKey.split('-')
    if (!year || !month) return monthKey
    return format(new Date(Number(year), Number(month) - 1, 1), 'MMM yyyy')
  }, [])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return filtered.slice(start, start + ROWS_PER_PAGE)
  }, [filtered, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [minDaysNotWorking, debouncedSearch, selectedCityKeys, selectedClients, selectedFirstOrderMonths])

  const exportExcel = useCallback(() => {
    const rows = attritionRidersToExcelRows(filtered)
    if (!rows.length) return
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rider Attrition')
    XLSX.writeFile(
      wb,
      `Rider_Attrition_${report?.asOfDateKey || format(new Date(), 'yyyy-MM-dd')}.xlsx`
    )
  }, [filtered, report])

  const mailEligibleRiders = useMemo(
    () => filtered.filter((r) => r.deployStatus !== 'Return'),
    [filtered]
  )

  const sendGroupedMails = async () => {
    if (!report || mailEligibleRiders.length === 0) return
    setSendingAll(true)
    const cityKeyGroups = {}
    mailEligibleRiders.forEach((r) => {
      const key = r.cityKey || 'Unknown'
      if (!cityKeyGroups[key]) cityKeyGroups[key] = []
      cityKeyGroups[key].push(r)
    })

    let sentCount = 0
    let skippedCount = 0

    for (const cityKey of Object.keys(cityKeyGroups)) {
      const groupRiders = cityKeyGroups[cityKey]
      if (!groupRiders.length) continue
      const config = getMailConfigForCityKey(cityKey, cityMailConfig.mailByCityKey)
      const { to: toRecipients, cc: ccRecipients } = resolveCityMailRecipients(config, {
        userCc: ccEmail,
        leadershipFallback: LEADERSHIP_MAIL_TO,
      })

      try {
        await fetch(MAILER_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            isAttritionGrouped: true,
            email: toRecipients,
            ccEmail: ccRecipients,
            city: cityKey,
            asOfDate: report.asOfDateKey,
            minDaysNotWorking,
            riders: groupRiders.map((r) => ({
              name: r.workerName,
              workerCode: r.workerCode,
              phone: r.mobNumber,
              city: r.city,
              cityKey: r.cityKey,
              client: r.client,
              hub: r.hub,
              source: r.source,
              firstOrderDate: r.firstOrderDate,
              lastWorkingDate: r.lastWorkingDate,
              daysNotWorking: r.daysNotWorking,
              vType: r.vType,
              deployVehicle: r.deployVehicle,
              deployStatus: r.deployStatus,
              deployDate: r.deployDate,
            })),
          }),
        })
        sentCount++
      } catch (err) {
        console.error(err)
        skippedCount++
      }
    }
    setSendingAll(false)
    if (sentCount === 0) {
      window.alert(
        'No mail sent. Riders with Fleet status Return are excluded. Check city mail config or filters.'
      )
    } else if (skippedCount > 0) {
      window.alert(`Sent ${sentCount} City Key mail(s). Skipped ${skippedCount}.`)
    }
  }

  const sendWhatsApp = (rider) => {
    const phone = rider.mobNumber?.toString().replace(/\D/g, '')
    if (!phone || phone.length < 10) return
    const msg = `Hi ${rider.workerName}, your last working date was ${rider.lastWorkingDate}. You have not worked for ${rider.daysNotWorking} day(s). Please contact your hub if you need support. (Code: ${rider.workerCode})`
    window.open(`https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loader" />
      </div>
    )
  }

  const asOfLabel = report ? format(report.asOfDay, 'EEEE, dd/MM/yyyy') : '—'

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
      <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0 }}>Rider Attrition Mailer</h1>
            <p style={{ color: 'var(--text-dim)', margin: '0.5rem 0 0', maxWidth: '760px' }}>
              Client & city wise attrition — riders not working since their last working date (LWD).
              Shows first order date, LWD, and days not working.
            </p>
            {report && (
              <p style={{ color: 'var(--accent-blue)', margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                Data as of <strong>{asOfLabel}</strong>
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none' }}>
              <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Min days not working:</span>
              <select
                value={minDaysNotWorking}
                onChange={(e) => setMinDaysNotWorking(Number(e.target.value))}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}
              >
                <option value={1}>1+ day</option>
                <option value={2}>2+ days</option>
                <option value={3}>3+ days</option>
                <option value={5}>5+ days</option>
                <option value={7}>7+ days</option>
              </select>
            </div>
            <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Mail size={14} style={{ color: 'var(--accent-blue)' }} />
              <input
                type="text"
                placeholder="Extra CC (optional)"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '150px', fontSize: '0.8rem' }}
              />
            </div>
            <button
              type="button"
              onClick={sendGroupedMails}
              disabled={sendingAll || mailEligibleRiders.length === 0}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {sendingAll ? <Loader size={18} className="spin" /> : <Mail size={18} />}
              Send grouped mail
            </button>
            <button type="button" onClick={exportExcel} className="glass" style={{ padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }}>
              <Download size={18} />
              Export Excel
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="status-badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '0.35rem 0.8rem' }}>
            <TrendingDown size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {enrichedRiders.length} attrition riders
          </div>
          <div className="status-badge" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', padding: '0.35rem 0.8rem' }}>
            {filtered.length} filtered
          </div>
          <div className="status-badge ev" style={{ padding: '0.35rem 0.8rem' }}>
            {typeCounts.ev} EV
          </div>
          <div className="status-badge non-ev" style={{ padding: '0.35rem 0.8rem' }}>
            {typeCounts.nonEv} NON-EV
          </div>
          {isReportStale && (
            <div className="status-badge" style={{ padding: '0.35rem 0.8rem', color: 'var(--text-dim)' }}>
              Updating…
            </div>
          )}
        </div>
      </header>

      <div
        className="filter-bar glass ram-filter-bar"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}
      >
        <MultiSelect label="City Key" options={cityKeyOptions} selected={selectedCityKeys} onChange={setSelectedCityKeys} icon={MapPin} color="var(--accent-blue)" />
        <MultiSelect label="Client" options={clientOptions} selected={selectedClients} onChange={setSelectedClients} icon={Briefcase} color="var(--accent-purple)" />
        <MultiSelect
          label="First order month"
          options={firstOrderMonthOptions}
          selected={selectedFirstOrderMonths}
          onChange={setSelectedFirstOrderMonths}
          formatOption={formatFirstOrderMonth}
          icon={Calendar}
          color="var(--accent-green)"
        />
        {(selectedCityKeys.length > 0 || selectedClients.length > 0 || selectedFirstOrderMonths.length > 0) && (
          <button
            type="button"
            className="glass-btn"
            onClick={() => {
              setSelectedCityKeys([])
              setSelectedClients([])
              setSelectedFirstOrderMonths([])
            }}
            style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <SummaryTable title="City Key wise attrition" rows={citySummary} icon={MapPin} />
        <SummaryTable title="Client wise attrition" rows={clientSummary} icon={Briefcase} />
      </div>

      <div
        className="filter-bar glass"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}
      >
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            placeholder="Search rider, code, mobile, city, city key, client..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 0.75rem 0.65rem 2.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '10px', color: '#fff', outline: 'none' }}
          />
        </div>
      </div>

      <div className="table-card glass">
        <div className="table-container" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table>
            <thead>
              <tr>
                <th>Rider</th>
                <th>City</th>
                <th>Client</th>
                <th>V type</th>
                <th>Deployee vehicle</th>
                <th>Fleet status</th>
                <th>First order date</th>
                <th>Last working date</th>
                <th>Days not working</th>
                <th>Hub / Source</th>
                <th>Contact</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length ? (
                paginated.map((r) => (
                  <tr key={r.workerCode}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.workerName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.workerCode}</div>
                    </td>
                    <td>
                      <div>{r.city}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.cityKey}</div>
                    </td>
                    <td>{r.client}</td>
                    <td>
                      <span className={`status-badge ${r.vType === 'EV' ? 'ev' : 'non-ev'}`}>
                        {r.vType}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.deployVehicle}</div>
                      {r.deployDate && r.deployDate !== 'N/A' ? (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Deploy {r.deployDate}</div>
                      ) : null}
                    </td>
                    <td>
                      {r.deployStatus === 'Deployee' ? (
                        <span className="status-badge deployee">{r.deployStatus}</span>
                      ) : r.deployStatus === 'Return' ? (
                        <span className="status-badge return">{r.deployStatus}</span>
                      ) : (
                        <span className="status-badge unknown">{r.deployStatus}</span>
                      )}
                    </td>
                    <td>{r.firstOrderDate}</td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--accent-green)' }}>{r.lastWorkingDate}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.lastWorkingDayName}</div>
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          background: r.daysNotWorking >= 7 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.15)',
                          color: r.daysNotWorking >= 7 ? '#ef4444' : '#f59e0b',
                          fontWeight: 700,
                        }}
                      >
                        {r.daysNotWorking} day{r.daysNotWorking !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td>
                      <div>{r.hub}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.source}</div>
                    </td>
                    <td>
                      <div>{r.mobNumber}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{r.email}</div>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => sendWhatsApp(r)}
                        className="glass-btn"
                        title="WhatsApp"
                        style={{ padding: '0.35rem' }}
                      >
                        <MessageSquare size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dim)' }}>
                    No attrition riders matching filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            Showing {filtered.length ? (currentPage - 1) * ROWS_PER_PAGE + 1 : 0}–{Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)} className="glass-btn" style={{ padding: '0.4rem' }}>
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: '0.85rem' }}>
              Page {currentPage} / {totalPages}
            </span>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="glass-btn" style={{ padding: '0.4rem' }}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
