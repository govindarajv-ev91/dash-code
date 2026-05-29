import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Search, Download, ChevronUp, ChevronDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Database, X, Filter, Columns3, Eye, EyeOff, FileSpreadsheet, BarChart3 } from 'lucide-react'
import { downloadDeployReturnCsv } from './lib/fleetDeployReturnExport'
import FleetSummaryReport from './FleetSummaryReport'

const PAGE_SIZES = [25, 50, 100, 250]

// ── Column ordering: grouped logically with payment/SD/source in the middle ──
const ORDERED_KEYS = [
  // 🔵 Core / Rider Info
  'id', 'data_source', 'date_record', 'vehicle_number', 'rider_name', 'rider_id',
  'rider_contact_number', 'email_address', 'vehicle_status',
  'city_locations', 'client_name', 'hub_location', 'category',
  'keerthana_tc_chenai_tn',

  // 🟢 Security Deposit (Deployee)
  'security_deposit_total_deployee', 'security_deposit_paid_deployee',
  'security_deposit_pending_deployee', 'sd_paid_utr_deployee',
  'sd_amount_paid_screenshot_deployee',

  // 🟠 Payment & Rent
  'rent_amount', 'payment_type', 'payment_status', 'rent_pending',
  'rent_pending_returning', 'damage_amount_returning',
  'traffic_fine_returning', 'damage_payment_mode_returning',
  'damage_traffic_fine_amount', 'utr_number_1', 'utr_number_2',
  'utr_and_cash_photo', 'any_pending_amount_damage_and_rent',

  // 🟣 Source & Filled By
  'source_name', 'source_name_vehicle_asset_details', 'filled_by',

  // 🔵 Deployment Info
  'vehicle_deployed_at_deployed', 'bike_deployed_date_sd_refund_request',
  'bike_return_date_sd_refund_request', 'deployed_agreement_photo_deployee',
  'bgv_status_deployee', 'nominee_name_deployee',
  'nominee_phone_number_deployee', 'rider_alternate_phone_number_deployee',
  'original_document_to_be_submitted_deployee',
  'image_of_original_document_submitted_deployee',

  // 🟤 Vehicle Asset Details
  'charger_number_vehicle_asset_details', 'battery_number_vehicle_asset_details',
  'charger_image_vehicle_asset_details', 'battery_image_vehicle_asset_details',
  'vehicle_image_video_with_rider_front_back_left_right_ve',
  'remarks_vehicle_asset_details', 'kms_vehicle_asset_details',

  // 🔴 Return Details
  'reason_for_returning', 'exact_reason_for_returning_remarks',
  'is_the_original_doc_s_returned',
  'doc_image_doc_with_rider_image_return_returning',
  'vehicle_condition_returning', 'vehicle_condition_returning_2',
  'vehicle_part_damaged_returning', 'damage_part_images_returning',
  'if_damage_for_vehicle_returning', 'proof_return_details', 'proof_photos',

  // 🟡 SD Refund Request
  'total_sd_collected_sd_refund_request', 'bank_name_sd_refund_request',
  'bank_account_number_sd_refund_request', 'bank_ifsc_code_sd_refund_request',
  'rent_pending_sd_refund_request', 'traffic_fine_sd_refund_request',
  'vehicle_damage_amount_sd_refund_request', 'service_cost_sd_refund_request',
  'bank_passbook_photo_sd_refund_request',

  // 🩵 BGV
  'nominee_name_bgv', 'nominee_contact_number_bgv',
  'permanent_address_bgv', 'present_address',
  'home_image_with_rider',
  'local_address_proof_mandatory_electricity_bill_or_rent',
  'ticket_id_bgv', 'bgv_ticket_id', 'g_map_location',

  // 🟠 Charger/Battery Swapping
  'part_name_charger_and_battery_swaping', 'km_charger_and_battery_swaping',
  'part_number_charger_and_battery_swaping',
  'failure_part_video_charger_and_battery_swaping',
  'damage_amount_charger_and_battery_swaping', 'swaping_status',
  'if_any_parts_damage_charger_and_battery_swaping',

  // 🔧 Service Done
  'service_status', 'service_done', 'km_service_done',
  'issue_explanation_service_done', 'replaced_parts_name_service_done',
  'part_damage_amount_service_done', 'damage_part_photos_service_done',
  'technician_name_service_done', 'if_vehicle_damage_service_done',

  // 🚗 On-road Service
  'km_s_before_service', 'km_s_before_service_2',
  'vehicle_image_or_video_onroad_service', 'issue_type_onroad_service',
  'issue_type_onroad_service_row_2',
  'vehicle_part_number_onroad_service', 'ticket_raised_by_onroad_service',
  'final_remarks_onroad_service', 'issue_explanation_onroad_service',

  // 🔨 Vehicle Damage Form
  'damage_part_name_vehicle_damage_form', 'damage_photos_vehicle_damage_form',
  'total_damage_amount_vehicle_damage_form', 'paid_amount_vehicle_damage_form',
  'pending_amount_vehicle_damage_form', 'utr_number_vehicle_damage_form',
  'utr_screenshot_vehicle_damage_form', 'remarks_vehicle_damage_form',
  'form_filled_by_vehicle_damage_form',

  // 📋 Tickets & Misc
  'ticket_id', 'ticket',
  'warehouse_location', 'warehouse_location_2', 'warehouse_location_3', 'warehouse_location_4',
  'location', 'remarks', 'reason', 'pan_card',
  'odometer_reading', 'service_date', 'service_person_name',
  'column_100', 'column_117',

  // 📅 Time / Meta
  'city', 'month', 'week', 'aging', 'created_at', 'updated_at',
]

// ── Header color groups ──
const HEADER_GROUPS = {
  // Core / Rider — blue
  core: { color: '#38bdf8', border: 'rgba(56,189,248,0.35)',
    keys: new Set(['id','date_record','vehicle_number','rider_name','rider_id',
      'rider_contact_number','email_address','vehicle_status',
      'city_locations','client_name','hub_location','category','keerthana_tc_chenai_tn']) },
  // Security Deposit — green
  sd: { color: '#4ade80', border: 'rgba(74,222,128,0.35)',
    keys: new Set(['security_deposit_total_deployee','security_deposit_paid_deployee',
      'security_deposit_pending_deployee','sd_paid_utr_deployee',
      'sd_amount_paid_screenshot_deployee',
      'total_sd_collected_sd_refund_request','bank_name_sd_refund_request',
      'bank_account_number_sd_refund_request','bank_ifsc_code_sd_refund_request',
      'rent_pending_sd_refund_request','traffic_fine_sd_refund_request',
      'vehicle_damage_amount_sd_refund_request','service_cost_sd_refund_request',
      'bank_passbook_photo_sd_refund_request']) },
  // Payment & Rent — orange
  payment: { color: '#fb923c', border: 'rgba(251,146,60,0.35)',
    keys: new Set(['rent_amount','payment_type','payment_status','rent_pending',
      'rent_pending_returning','damage_amount_returning','traffic_fine_returning',
      'damage_payment_mode_returning','damage_traffic_fine_amount',
      'utr_number_1','utr_number_2','utr_and_cash_photo',
      'any_pending_amount_damage_and_rent']) },
  // Source & Filled By — purple
  source: { color: '#c084fc', border: 'rgba(192,132,252,0.35)',
    keys: new Set(['source_name','source_name_vehicle_asset_details','filled_by']) },
  // Return — red/pink
  returning: { color: '#fb7185', border: 'rgba(251,113,133,0.35)',
    keys: new Set(['reason_for_returning','exact_reason_for_returning_remarks',
      'is_the_original_doc_s_returned','doc_image_doc_with_rider_image_return_returning',
      'vehicle_condition_returning','vehicle_condition_returning_2',
      'vehicle_part_damaged_returning','damage_part_images_returning',
      'if_damage_for_vehicle_returning','proof_return_details','proof_photos',
      'bike_return_date_sd_refund_request']) },
  // Vehicle Assets — teal
  assets: { color: '#2dd4bf', border: 'rgba(45,212,191,0.35)',
    keys: new Set(['charger_number_vehicle_asset_details','battery_number_vehicle_asset_details',
      'charger_image_vehicle_asset_details','battery_image_vehicle_asset_details',
      'vehicle_image_video_with_rider_front_back_left_right_ve',
      'remarks_vehicle_asset_details','kms_vehicle_asset_details']) },
  // Service — amber
  service: { color: '#fbbf24', border: 'rgba(251,191,36,0.35)',
    keys: new Set(['service_status','service_done','km_service_done',
      'issue_explanation_service_done','replaced_parts_name_service_done',
      'part_damage_amount_service_done','damage_part_photos_service_done',
      'technician_name_service_done','if_vehicle_damage_service_done',
      'km_s_before_service','km_s_before_service_2',
      'vehicle_image_or_video_onroad_service','issue_type_onroad_service',
      'issue_type_onroad_service_row_2','vehicle_part_number_onroad_service',
      'ticket_raised_by_onroad_service','final_remarks_onroad_service',
      'issue_explanation_onroad_service','odometer_reading','service_date','service_person_name']) },
}

function getHeaderColor(key) {
  for (const g of Object.values(HEADER_GROUPS)) {
    if (g.keys.has(key)) return g
  }
  return null
}

// Friendly labels for known columns
const LABELS = {
  id: 'ID',
  data_source: 'Data Source',
  keerthana_tc_chenai_tn: 'Timestamp',
  email_address: 'Email',
  city_locations: 'City / Location',
  date_record: 'Date Record',
  vehicle_number: 'Vehicle No.',
  vehicle_status: 'Status',
  rider_id: 'Rider ID',
  rider_name: 'Rider Name',
  rider_contact_number: 'Contact No.',
  client_name: 'Client',
  hub_location: 'Hub Location',
  category: 'Category',
  created_at: 'Created At',
  updated_at: 'Updated At',
  bike_deployed_date_sd_refund_request: 'Deployed Date',
  bike_return_date_sd_refund_request: 'Return Date',
  reason_for_returning: 'Return Reason',
  city: 'City',
  month: 'Month',
  week: 'Week',
  security_deposit_total_deployee: 'SD Total',
  security_deposit_paid_deployee: 'SD Paid',
  security_deposit_pending_deployee: 'SD Pending',
  sd_paid_utr_deployee: 'SD UTR',
  rent_amount: 'Rent Amount',
  rent_pending: 'Rent Pending',
  rent_pending_returning: 'Rent Pending (Return)',
  payment_type: 'Payment Type',
  payment_status: 'Payment Status',
  source_name: 'Source Name',
  filled_by: 'Filled By',
  damage_amount_returning: 'Damage Amount',
  traffic_fine_returning: 'Traffic Fine',
  damage_traffic_fine_amount: 'Damage/Fine Amt',
  total_sd_collected_sd_refund_request: 'SD Collected',
  aging: 'Aging',
}

function prettyLabel(key) {
  if (LABELS[key]) return LABELS[key]
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bSd\b/g, 'SD')
    .replace(/\bBgv\b/g, 'BGV')
    .replace(/\bUtr\b/g, 'UTR')
    .replace(/\bKm\b/g, 'KM')
}

function StatusBadge({ value }) {
  if (!value) return <span className="fdv-cell-empty">—</span>
  const lower = (value || '').toString().toLowerCase()
  let cls = 'fdv-badge '
  if (lower.includes('deploy')) cls += 'fdv-badge-deployed'
  else if (lower.includes('return')) cls += 'fdv-badge-returned'
  else if (lower.includes('active')) cls += 'fdv-badge-active'
  else if (lower.includes('inactive') || lower.includes('idle')) cls += 'fdv-badge-inactive'
  else cls += 'fdv-badge-other'
  return <span className={cls}>{value}</span>
}

function isImageUrl(val) {
  if (!val || typeof val !== 'string') return false
  return val.startsWith('https://drive.google.com') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(val)
}

// Helper to parse dates in DD/MM/YYYY or standard formats for correct chronological sorting
function parseDateString(str) {
  if (!str) return null
  const s = str.toString().trim()
  // Match DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) {
    const day = parseInt(m[1], 10)
    const month = parseInt(m[2], 10) - 1
    const year = parseInt(m[3], 10)
    return new Date(year, month, day).getTime()
  }
  const parsed = Date.parse(s)
  return isNaN(parsed) ? null : parsed
}

// Helper to highlight matching text in search suggestions
function highlightText(text, highlight) {
  if (!highlight) return text
  const parts = text.toString().split(new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'))
  return parts.map((part, index) => 
    part.toLowerCase() === highlight.toLowerCase() ? (
      <strong key={index} className="fdv-suggestion-highlight">{part}</strong>
    ) : (
      part
    )
  )
}

export default function FleetDataViewer({ fleetData, totalCount = 0, sheetCount = 0, loading, refreshData }) {
  const [activeTab, setActiveTab] = useState('data')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('date_record')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [columnFilter, setColumnFilter] = useState('all')
  const [hiddenCols, setHiddenCols] = useState(new Set())
  const [showColManager, setShowColManager] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('all') // all | Database | Google Sheet
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!loading && refreshing) setRefreshing(false)
  }, [loading, refreshing])

  const sourceCounts = useMemo(() => {
    if (!fleetData?.length) return { all: 0, database: 0, sheet: 0 }
    let database = 0
    let sheet = 0
    for (const row of fleetData) {
      if (row.data_source === 'Google Sheet') sheet++
      else database++
    }
    return { all: fleetData.length, database, sheet }
  }, [fleetData])

  const sourceFiltered = useMemo(() => {
    if (!fleetData) return []
    if (sourceFilter === 'all') return fleetData
    return fleetData.filter(row => (row.data_source || 'Database') === sourceFilter)
  }, [fleetData, sourceFilter])

  // ---------- dynamic columns from data ----------
  const allColumns = useMemo(() => {
    if (!fleetData || fleetData.length === 0) return []
    const keySet = new Set()
    // Scan first 50 rows to get all keys
    fleetData.slice(0, 50).forEach(row => {
      Object.keys(row).forEach(k => keySet.add(k))
    })

    const prioritized = ORDERED_KEYS.filter(k => keySet.has(k))
    const rest = [...keySet]
      .filter(k => !ORDERED_KEYS.includes(k))
      .sort((a, b) => a.localeCompare(b))

    return [...prioritized, ...rest]
  }, [fleetData])

  const visibleColumns = useMemo(() => {
    return allColumns.filter(k => !hiddenCols.has(k))
  }, [allColumns, hiddenCols])

  // Autocomplete suggestions based on typed search query across all visible / selected columns
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2 || !sourceFiltered.length) return []

    const matches = new Set()
    for (const row of sourceFiltered) {
      if (matches.size >= 8) break // Limit to 8 suggestions for performance & readability

      if (columnFilter === 'all') {
        for (const col of visibleColumns) {
          const val = row[col]
          if (val != null) {
            const strVal = val.toString().trim()
            const lowerVal = strVal.toLowerCase()
            // Ignore extremely long values (like remarks), URLs, and standard row UUIDs
            if (
              lowerVal.includes(q) &&
              strVal.length < 30 &&
              !strVal.startsWith('http') &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal)
            ) {
              matches.add(strVal)
              if (matches.size >= 8) break
            }
          }
        }
      } else {
        const val = row[columnFilter]
        if (val != null) {
          const strVal = val.toString().trim()
          const lowerVal = strVal.toLowerCase()
          if (
            lowerVal.includes(q) &&
            strVal.length < 30 &&
            !strVal.startsWith('http') &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strVal)
          ) {
            matches.add(strVal)
          }
        }
      }
    }
    return Array.from(matches)
  }, [search, sourceFiltered, columnFilter, visibleColumns])

  // ---------- filtered + sorted data ----------
  const filtered = useMemo(() => {
    if (!sourceFiltered.length) return []
    const q = search.trim().toLowerCase()
    if (!q) return [...sourceFiltered]

    return sourceFiltered.filter(row => {
      if (columnFilter === 'all') {
        return visibleColumns.some(col => {
          const v = row[col]
          return v != null && v.toString().toLowerCase().includes(q)
        })
      } else {
        const v = row[columnFilter]
        return v != null && v.toString().toLowerCase().includes(q)
      }
    })
  }, [sourceFiltered, search, columnFilter, visibleColumns])

  const handleSourceFilter = useCallback((value) => {
    setSourceFilter(value)
    setPage(0)
  }, [])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      let va = a[sortKey]
      let vb = b[sortKey]

      // Handle null/empty sorting
      if (va == null || va === '') return sortDir === 'asc' ? 1 : -1
      if (vb == null || vb === '') return sortDir === 'asc' ? -1 : 1

      // If it's a date field (like date_record or has 'date' in its name), sort chronologically
      if (sortKey.toLowerCase().includes('date') || sortKey === 'date_record') {
        const da = parseDateString(va)
        const db = parseDateString(vb)
        if (da !== null && db !== null) {
          return sortDir === 'asc' ? da - db : db - da
        }
      }

      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }

      va = va.toString().toLowerCase()
      vb = vb.toString().toLowerCase()
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageData = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const handleSearch = useCallback((val) => {
    setSearch(val)
    setPage(0)
    setShowSuggestions(true)
  }, [])

  const handleClearCacheAndRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const request = indexedDB.open('DashFleetDB', 1)
      request.onerror = () => {
        console.error('IndexedDB open error:', request.error)
        if (refreshData) refreshData()
      }
      request.onsuccess = (e) => {
        const db = e.target.result
        try {
          const tx = db.transaction('cacheStore', 'readwrite')
          const store = tx.objectStore('cacheStore')
          store.delete('fleet_data')
          store.delete('fleet_sheet_data')
          tx.oncomplete = () => {
            if (refreshData) refreshData()
          }
          tx.onerror = () => {
            if (refreshData) refreshData()
          }
        } catch (err) {
          console.error('Error opening object store:', err)
          if (refreshData) refreshData()
        }
      }
    } catch (err) {
      console.error('IndexedDB open error:', err)
      if (refreshData) refreshData()
    }
  }, [refreshData])

  const toggleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return key
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const toggleColumn = useCallback((key) => {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const showAllCols = useCallback(() => setHiddenCols(new Set()), [])

  const exportDeployReturn = useCallback(() => {
    const count = downloadDeployReturnCsv(fleetData || [])
    console.log(`Deploy/Return export: ${count} rows (all Deployee cycles, duplicate vehicles kept)`)
  }, [fleetData])

  // export CSV
  const exportCSV = useCallback(() => {
    const headers = visibleColumns.map(c => prettyLabel(c)).join(',')
    const rows = sorted.map(row =>
      visibleColumns.map(c => {
        let v = row[c] ?? ''
        v = v.toString().replace(/"/g, '""')
        return `"${v}"`
      }).join(',')
    )
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_data_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [sorted, visibleColumns])

  // render cell value
  const renderCell = (col, value) => {
    if (value == null || value === '') return <span className="fdv-cell-empty">—</span>
    if (col === 'vehicle_status') return <StatusBadge value={value} />
    if (col === 'data_source') {
      const isSheet = value === 'Google Sheet'
      return (
        <span className={`fdv-source-badge ${isSheet ? 'fdv-source-sheet' : 'fdv-source-db'}`}>
          {value || 'Database'}
        </span>
      )
    }
    const str = value.toString()
    if (isImageUrl(str)) {
      return <a href={str} target="_blank" rel="noopener noreferrer" className="fdv-link">📎 View</a>
    }
    if (str.length > 60) {
      return <span title={str}>{str.slice(0, 57)}…</span>
    }
    return str
  }

  // ---------- render ----------
  if (loading && (!fleetData || fleetData.length === 0)) {
    return (
      <div className="dashboard-container">
        <div className="loading-container">
          <span className="loader"></span>
        </div>
      </div>
    )
  }

  const isPartialData = allColumns.length > 0 && allColumns.length < 20
  const isMissingRows = totalCount > 0 && (fleetData?.length || 0) < totalCount
  const isFleetLoading = loading || refreshing

  // Render summary view if active
  if (activeTab === 'summary') {
    return (
      <div className="dashboard-container fdv-root">
        {/* Tab Bar */}
        <div className="fdv-tab-bar glass">
          <button
            className={`fdv-tab ${activeTab === 'data' ? 'fdv-tab-active' : ''}`}
            onClick={() => setActiveTab('data')}
            title="View fleet data table"
          >
            <Database size={16} />
            Data
          </button>
          <button
            className={`fdv-tab ${activeTab === 'summary' ? 'fdv-tab-active' : ''}`}
            onClick={() => setActiveTab('summary')}
            title="View fleet summary report"
          >
            <BarChart3 size={16} />
            Summary Report
          </button>
        </div>

        <FleetSummaryReport fleetData={fleetData} loading={loading} />
      </div>
    )
  }

  return (
    <div className="dashboard-container fdv-root">
      {(refreshing || (loading && fleetData?.length > 0)) && (
        <div className="fdv-loading-banner glass fdv-refresh-loading-banner">
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <span>
            {refreshing ? 'Refreshing fleet data from database & Google Sheet…' : 'Loading fleet data…'}
          </span>
        </div>
      )}

      {/* Tab Bar */}
      <div className="fdv-tab-bar glass">
        <button
          className={`fdv-tab ${activeTab === 'data' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('data')}
          title="View fleet data table"
        >
          <Database size={16} />
          Data
        </button>
        <button
          className={`fdv-tab ${activeTab === 'summary' ? 'fdv-tab-active' : ''}`}
          onClick={() => setActiveTab('summary')}
          title="View fleet summary report"
        >
          <BarChart3 size={16} />
          Summary Report
        </button>
      </div>
      {/* Loading banner when only partial data */}
      {isPartialData && !refreshing && (
        <div className="fdv-loading-banner glass">
          <span className="loader" style={{ width: 20, height: 20, borderWidth: 3 }}></span>
          <span>Loading full fleet data ({allColumns.length} columns loaded so far, ~100+ total)… Please wait a moment.</span>
        </div>
      )}
      {!loading && sheetCount === 0 && sourceCounts.database > 0 && (
        <div className="fdv-loading-banner glass" style={{ borderColor: 'rgba(251,113,133,0.35)' }}>
          <span style={{ color: '#fb7185', fontWeight: 600 }}>Google Sheet not loaded:</span>
          <span style={{ marginLeft: 8 }}>
            0 rows imported from the published sheet. Click <b>Refresh Cache</b> to retry (uses proxy + fallback fetch).
          </span>
        </div>
      )}
      {isMissingRows && (
        <div className="fdv-loading-banner glass" style={{ borderColor: 'rgba(251,146,60,0.35)' }}>
          <span style={{ color: '#fb923c', fontWeight: 600 }}>Incomplete load:</span>
          <span style={{ marginLeft: 8 }}>
            loaded {fleetData.length.toLocaleString()} of {totalCount.toLocaleString()} rows from Supabase.
            This is usually caused by API timeouts/retries stopping early or Row Level Security limiting visible rows.
            Click <b>Refresh Cache</b> and keep this page open until the DB total matches.
          </span>
        </div>
      )}
      {/* Header */}
      <div className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Database size={28} style={{ color: 'var(--primary)' }} />
          <h1>Fleet Data</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="fdv-refresh-btn"
            onClick={handleClearCacheAndRefresh}
            disabled={isFleetLoading}
            title="Clear cache and fetch full columns fresh from database"
          >
            {isFleetLoading ? (
              <>
                <span className="loader fdv-btn-loader" />
                Refreshing…
              </>
            ) : (
              'Refresh Cache'
            )}
          </button>
          <span className="fdv-row-count">
            {sorted.length.toLocaleString()}
            {sorted.length !== sourceFiltered.length ? ` of ${sourceFiltered.length.toLocaleString()}` : ''} rows
            {sourceFilter !== 'all' ? ` · ${sourceFilter}` : ''}
            {totalCount > 0 && sourceFilter !== 'Google Sheet' ? ` (DB: ${totalCount.toLocaleString()})` : ''}
          </span>
          <span className="fdv-row-count">
            {visibleColumns.length} / {allColumns.length} cols
          </span>
          <button
            className="fdv-col-toggle-btn"
            onClick={() => setShowColManager(!showColManager)}
            title="Show/Hide Columns"
          >
            <Columns3 size={16} /> Columns
          </button>
          <button
            className="fdv-export-btn"
            onClick={exportDeployReturn}
            title="Export every Deployee row with paired Return (duplicate vehicles & riders included)"
          >
            <FileSpreadsheet size={16} /> Deploy/Return
          </button>
          <button className="fdv-export-btn" onClick={exportCSV} title="Download visible table as CSV">
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* Column Manager */}
      {showColManager && (
        <div className="fdv-col-manager glass">
          <div className="fdv-col-manager-header">
            <span>Toggle Columns ({allColumns.length} total)</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="fdv-col-action-btn" onClick={showAllCols}>Show All</button>
              <button className="fdv-col-action-btn" onClick={() => setShowColManager(false)}>
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="fdv-col-manager-grid">
            {allColumns.map(col => (
              <label key={col} className={`fdv-col-chip ${hiddenCols.has(col) ? 'fdv-col-chip-hidden' : ''}`}>
                <input
                  type="checkbox"
                  checked={!hiddenCols.has(col)}
                  onChange={() => toggleColumn(col)}
                />
                {hiddenCols.has(col) ? <EyeOff size={12} /> : <Eye size={12} />}
                <span>{prettyLabel(col)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Data source filter */}
      <div className="fdv-source-filter glass">
        <span className="fdv-source-filter-label">Data source</span>
        <div className="fdv-source-filter-btns">
          <button
            type="button"
            className={`fdv-source-btn ${sourceFilter === 'all' ? 'fdv-source-btn-active' : ''}`}
            onClick={() => handleSourceFilter('all')}
          >
            All <span className="fdv-source-btn-count">{sourceCounts.all.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className={`fdv-source-btn fdv-source-btn-db ${sourceFilter === 'Database' ? 'fdv-source-btn-active' : ''}`}
            onClick={() => handleSourceFilter('Database')}
          >
            Database <span className="fdv-source-btn-count">{sourceCounts.database.toLocaleString()}</span>
          </button>
          <button
            type="button"
            className={`fdv-source-btn fdv-source-btn-sheet ${sourceFilter === 'Google Sheet' ? 'fdv-source-btn-active' : ''}`}
            onClick={() => handleSourceFilter('Google Sheet')}
          >
            Google Sheet <span className="fdv-source-btn-count">{(sheetCount || sourceCounts.sheet).toLocaleString()}</span>
          </button>
        </div>
      </div>

      {/* Search + Column filter bar */}
      <div className="fdv-search-bar glass">
        <div className="fdv-search-input-wrap">
          <Search size={18} className="fdv-search-icon" />
          <input
            id="fleet-search"
            type="text"
            placeholder="Search fleet data…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setShowSuggestions(false)}
            className="fdv-search-input"
            autoComplete="off"
          />
          {search && (
            <button className="fdv-search-clear" onClick={() => { handleSearch(''); setShowSuggestions(false); }}>
              <X size={16} />
            </button>
          )}

          {/* Autocomplete Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="fdv-suggestions-dropdown glass">
              {suggestions.map((item, idx) => (
                <button
                  key={idx}
                  className="fdv-suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault() // prevent input blur from triggering before selection
                    setSearch(item)
                    setPage(0)
                    setShowSuggestions(false)
                  }}
                >
                  <Search size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
                  <span>{highlightText(item, search)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="fdv-column-filter">
          <Filter size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <select
            value={columnFilter}
            onChange={e => { setColumnFilter(e.target.value); setPage(0) }}
            className="fdv-col-select"
          >
            <option value="all">All Columns</option>
            {visibleColumns.map(c => (
              <option key={c} value={c}>{prettyLabel(c)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass fdv-table-wrap">
        <div className="fdv-table-scroll">
          <table className="fdv-table">
            <thead>
              <tr>
                <th className="fdv-row-num-th">#</th>
                {visibleColumns.map(col => {
                  const grp = getHeaderColor(col)
                  const thStyle = {
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderTop: grp ? `3px solid ${grp.color}` : 'none',
                    borderBottom: grp ? `1px solid ${grp.border}` : 'inherit',
                    color: grp ? grp.color : 'inherit',
                    transition: 'all 0.2s ease'
                  }
                  return (
                    <th
                      key={col}
                      style={thStyle}
                      onClick={() => toggleSort(col)}
                      title={`${prettyLabel(col)} (${col})`}
                    >
                      <span className="fdv-th-inner">
                        {prettyLabel(col)}
                        {sortKey === col ? (
                          sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        ) : (
                          <span style={{ width: 14 }} />
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                    {search ? 'No matching records found' : 'No data available'}
                  </td>
                </tr>
              ) : (
                pageData.map((row, i) => (
                  <tr key={row.id ?? i} className="fdv-row">
                    <td className="fdv-row-num">{safePage * pageSize + i + 1}</td>
                    {visibleColumns.map(col => (
                      <td key={col}>{renderCell(col, row[col])}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="fdv-pagination">
          <div className="fdv-page-size">
            <span>Rows per page:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}>
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <span className="fdv-page-info">
            {sorted.length === 0 ? '0 of 0' : `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, sorted.length)} of ${sorted.length.toLocaleString()}`}
          </span>
          <div className="fdv-page-btns">
            <button disabled={safePage === 0} onClick={() => setPage(0)}><ChevronsLeft size={18} /></button>
            <button disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}><ChevronLeft size={18} /></button>
            <button disabled={safePage >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}><ChevronRight size={18} /></button>
            <button disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}><ChevronsRight size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
