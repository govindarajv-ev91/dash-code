import React, { useEffect, useState } from 'react'
import { Bike, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react'
import { fetchEv91VehiclePage as fetchVehiclePage } from './lib/ev91VehiclesApi'

const PAGE_SIZE = 100
const VEHICLE_COLUMNS = [
  { key: 'registrationNumber', label: 'Vehicle No.' },
  { key: 'oemName', label: 'OEM Name' },
  { key: 'model', label: 'Model' },
  { key: 'chassisNumber', label: 'Chassis Number' },
  { key: 'motorNumber', label: 'Motor Number' },
  { key: 'batteryConfiguration', label: 'Battery Configuration' },
  { key: 'city', label: 'City' },
  { key: 'hub', label: 'Hub' },
  { key: 'vehicleStatus', label: 'Vehicle Status' },
  { key: 'operationalStatus', label: 'Operational Status' },
  { key: 'year', label: 'Year' },
  { key: 'variant', label: 'Variant' },
  { key: 'color', label: 'Color' },
]

export default function Ev91Vehicles() {
  const [vehicles, setVehicles] = useState([])
  const [page, setPage] = useState(1)
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [totalPages, setTotalPages] = useState(1)
  const [totalVehicles, setTotalVehicles] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (search) params.set('search', search)

    fetchVehiclePage(params)
      .then((body) => {
        if (cancelled) return
        setVehicles(Array.isArray(body.vehicles) ? body.vehicles : [])
        setTotalPages(Math.max(1, Number(body.pagination?.totalPages) || 1))
        setTotalVehicles(Number(body.pagination?.totalItems ?? body.meta?.totalRecords) || 0)
      })
      .catch((err) => {
        if (cancelled) return
        setVehicles([])
        setError(err?.message || 'Failed to load EV91 vehicles')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, reloadKey, search])

  const firstRow = vehicles.length ? (page - 1) * PAGE_SIZE + 1 : 0
  const lastRow = Math.min(page * PAGE_SIZE, totalVehicles)

  const submitSearch = (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setPage(1)
    setSearch(searchText.trim())
  }

  const clearSearch = () => {
    setSearchText('')
    setSearch('')
    setPage(1)
    setLoading(true)
    setError('')
  }

  const getVehicleValue = (vehicle, key) => {
    if (key === 'oemName') return vehicle.model?.oem?.name || vehicle.oem?.name || ''
    if (key === 'model') return vehicle.model?.displayName || ''
    if (key === 'city') return vehicle.hub?.city?.displayName || vehicle.hub?.city?.name || ''
    if (key === 'hub') return vehicle.hub?.name || ''
    return vehicle[key] ?? ''
  }

  const exportVehicles = async () => {
    if (exporting || !totalVehicles) return
    setExporting(true)
    setError('')
    try {
      const exportRows = []
      for (let exportPage = 1; exportPage <= totalPages; exportPage++) {
        const params = new URLSearchParams({ page: String(exportPage), limit: String(PAGE_SIZE) })
        if (search) params.set('search', search)
        const body = await fetchVehiclePage(params)
        exportRows.push(...(Array.isArray(body.vehicles) ? body.vehicles : []))
      }

      const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
      const csv = [
        VEHICLE_COLUMNS.map((column) => escapeCsv(column.label)).join(','),
        ...exportRows.map((vehicle) =>
          VEHICLE_COLUMNS.map((column) => escapeCsv(getVehicleValue(vehicle, column.key))).join(',')
        ),
      ].join('\r\n')
      const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `ev91_vehicles${search ? `_search_${search}` : ''}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err?.message || 'Failed to export EV91 vehicles')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="dashboard-container ev91-root">
      <header className="header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Bike size={28} style={{ color: 'var(--accent-green)' }} />
          <div>
            <h1>EV91 Vehicles</h1>
            <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
              Vehicle inventory · Model names from EV91 vehicle records
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="glass"
            onClick={exportVehicles}
            disabled={loading || exporting || !totalVehicles}
            style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}
          >
            <Download size={17} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            type="button"
            className="glass"
            onClick={() => {
              setLoading(true)
              setError('')
              setReloadKey((key) => key + 1)
            }}
            disabled={loading}
            style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}
          >
            <RefreshCw size={17} className={loading ? 'ev91-spin' : undefined} />
            Refresh
          </button>
        </div>
      </header>

      <form
        onSubmit={submitSearch}
        className="glass"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.55rem 0.75rem',
          marginBottom: '1rem',
          maxWidth: 560,
        }}
      >
        <Search size={18} style={{ color: 'var(--text-dim)', flex: 'none' }} />
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search vehicle number or model"
          aria-label="Search vehicles by registration number or model"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: 'var(--text-main)',
            font: 'inherit',
          }}
        />
        {searchText && (
          <button
            type="button"
            className="glass-btn"
            onClick={clearSearch}
            disabled={loading}
            aria-label="Clear vehicle search"
            title="Clear search"
          >
            <X size={16} />
          </button>
        )}
        <button type="submit" className="glass-btn" disabled={loading}>
          Search
        </button>
      </form>

      <div className="rp-meta glass" style={{ marginBottom: '1rem' }}>
        <span>
          <strong>{totalVehicles.toLocaleString()}</strong> {search ? 'matching vehicles' : 'vehicles'}
          {search && <span> · Search: {search}</span>}
        </span>
        <span>{loading ? 'Loading…' : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()}`}</span>
      </div>

      {error && (
        <div className="ev91-error glass" role="alert" style={{ marginBottom: '1rem' }}>
          <span>{error}</span>
        </div>
      )}

      <div className={`glass rp-table-wrap ${loading ? 'rp-table-pending' : ''}`}>
        <div className="rp-table-scroll">
          <table className="rp-table">
            <thead>
              <tr>{VEHICLE_COLUMNS.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length} className="rp-empty">Loading EV91 vehicles…</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length} className="rp-empty">No vehicles found</td></tr>
              ) : vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  {VEHICLE_COLUMNS.map((column) => {
                    return <td key={column.key}>{String(getVehicleValue(vehicle, column.key))}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rp-table-footer">
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
            Page {page} of {totalPages.toLocaleString()}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="glass-btn"
              aria-label="Previous page"
              title="Previous page"
              disabled={loading || page <= 1}
              onClick={() => {
                setLoading(true)
                setError('')
                setPage((current) => Math.max(1, current - 1))
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="glass-btn"
              aria-label="Next page"
              title="Next page"
              disabled={loading || page >= totalPages}
              onClick={() => {
                setLoading(true)
                setError('')
                setPage((current) => Math.min(totalPages, current + 1))
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
