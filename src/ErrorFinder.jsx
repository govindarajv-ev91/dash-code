import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Search, Truck, Upload, RotateCcw, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { differenceInDays, format } from 'date-fns';
import { parseFleetDate } from './lib/fleetDeployReturnExport';
import { findVehicleMasterMismatches, summarizeVehicleMasterCompare } from './lib/errorFinderReport';
import {
  parseVehicleMasterFile,
  attachMasterDate,
  VEHICLE_MASTER_HEADER_LABELS,
} from './lib/vehicleMasterParse';
import {
  loadVehicleMasterSummary,
  saveVehicleMasterRows,
  clearVehicleMasterData,
  clearVehicleMasterDataByDate,
  fetchAllVehicleMaster,
  getVehicleMasterDbSetupMessage,
  isMissingVehicleMasterTable,
} from './lib/vehicleMasterDb';
import EvLookupPanel from './EvLookupPanel';

const TABS = {
  MULTI: 'multi',
  V_MISMATCH: 'vmismatch',
};

const ErrorFinder = ({ fleetData, riderData, loading }) => {
    const [activeTab, setActiveTab] = useState(TABS.MULTI);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClient, setFilterClient] = useState('All');
    const [showUploadPanel, setShowUploadPanel] = useState(false);
    const [masterDate, setMasterDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [vehicleMasterRows, setVehicleMasterRows] = useState([]);
    const [masterCount, setMasterCount] = useState(0);
    const [masterPreview, setMasterPreview] = useState([]);
    const [masterDates, setMasterDates] = useState([]);
    const [masterResetDate, setMasterResetDate] = useState('');
    const [masterLoading, setMasterLoading] = useState(true);
    const [masterUploading, setMasterUploading] = useState(false);
    const [masterResetting, setMasterResetting] = useState(false);
    const [masterMessage, setMasterMessage] = useState(null);
    const [filterMasterDate, setFilterMasterDate] = useState('');

    const pickFirstValid = (...vals) => {
        for (const v of vals) {
            if (v === null || v === undefined) continue;
            const s = v.toString().trim();
            if (!s || s.toUpperCase() === 'N/A' || s.toUpperCase() === 'NULL') continue;
            return s;
        }
        return 'N/A';
    };

    const riderLookup = useMemo(() => {
        const dateCache = new Map();
        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            const s = dateStr.toString().trim();
            if (!s) return null;
            if (dateCache.has(s)) return dateCache.get(s);
            let d = null;
            if (/^\d{5}(\.\d+)?$/.test(s)) {
                d = new Date((parseFloat(s) - 25569) * 86400 * 1000);
            } else if (s.includes('/')) {
                const parts = s.split(' ')[0].split('/');
                if (parts.length === 3) {
                    const dd = parseInt(parts[0], 10);
                    const mm = parseInt(parts[1], 10) - 1;
                    let yyyy = parts[2];
                    if (yyyy.length === 2) yyyy = `20${yyyy}`;
                    d = new Date(parseInt(yyyy, 10), mm, dd);
                }
            }
            if (!d || isNaN(d.getTime())) d = new Date(s);
            const out = d && !isNaN(d.getTime()) ? d : null;
            dateCache.set(s, out);
            return out;
        };

        const byRiderId = new Map();
        const clientBySource = new Map();
        (riderData || []).forEach(r => {
            const riderKey = (r.worker_code || '').toString().trim().toUpperCase();
            const sourceVal = pickFirstValid(r.source, r.source_name, r.sourcer_name, r.sourcer);
            const clientVal = pickFirstValid(r.client, r.client_name, r.clientName);
            const cityVal = pickFirstValid(r.city, r.city_name);
            const riderNameVal = pickFirstValid(r.rider_name, r.riderName, r.name);
            const sourceKey = sourceVal.toUpperCase();
            const rowDate = parseDate(r.date_record);

            if (!riderKey) return;
            if (!byRiderId.has(riderKey)) {
                byRiderId.set(riderKey, {
                    riderName: riderNameVal,
                    client: clientVal,
                    sourceName: sourceVal,
                    city: cityVal,
                    lastSeenDate: rowDate
                });
            } else {
                const curr = byRiderId.get(riderKey);
                const isNewer = rowDate && (!curr.lastSeenDate || rowDate > curr.lastSeenDate);
                if (isNewer) curr.lastSeenDate = rowDate;

                if (isNewer && riderNameVal !== 'N/A') curr.riderName = riderNameVal;
                else if ((!curr.riderName || curr.riderName === 'N/A') && riderNameVal !== 'N/A') curr.riderName = riderNameVal;

                if (isNewer && clientVal !== 'N/A') curr.client = clientVal;
                else if (clientVal !== 'N/A' && (!curr.client || curr.client === 'N/A')) curr.client = clientVal;

                if (isNewer && sourceVal !== 'N/A') curr.sourceName = sourceVal;
                else if (sourceVal !== 'N/A' && (!curr.sourceName || curr.sourceName === 'N/A')) curr.sourceName = sourceVal;

                if (isNewer && cityVal !== 'N/A') curr.city = cityVal;
                else if (cityVal !== 'N/A' && (!curr.city || curr.city === 'N/A')) curr.city = cityVal;
            }

            if (sourceKey && sourceKey !== 'N/A' && clientVal !== 'N/A' && !clientBySource.has(sourceKey)) {
                clientBySource.set(sourceKey, clientVal);
            }
        });
        return { byRiderId, clientBySource };
    }, [riderData]);

    const refreshVehicleMaster = useCallback(async (force = false) => {
        setMasterLoading(true);
        try {
            const [summary, allRows] = await Promise.all([
                loadVehicleMasterSummary(),
                fetchAllVehicleMaster({ force }),
            ]);
            setMasterCount(summary.count);
            setMasterPreview(summary.preview);
            setMasterDates(summary.dates);
            setVehicleMasterRows(allRows || []);
            if (summary.missingTable) {
                setMasterMessage({ type: 'error', text: getVehicleMasterDbSetupMessage() });
            }
        } catch (err) {
            console.warn('Vehicle master load failed:', err);
            setVehicleMasterRows([]);
            setMasterMessage({ type: 'error', text: err?.message || 'Failed to load vehicle master data.' });
        } finally {
            setMasterLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshVehicleMaster();
    }, [refreshVehicleMaster]);

    useEffect(() => {
        if (!masterDates.length) {
            setFilterMasterDate('');
            return;
        }
        setFilterMasterDate((prev) => (prev && masterDates.includes(prev) ? prev : masterDates[0]));
    }, [masterDates]);

    const handleMasterUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        if (!masterDate) {
            setMasterMessage({ type: 'error', text: 'Choose a master date before uploading.' });
            return;
        }

        setMasterUploading(true);
        setMasterMessage(null);
        try {
            const buffer = await file.arrayBuffer();
            const { rows } = parseVehicleMasterFile(buffer);
            const dated = attachMasterDate(rows, new Date(`${masterDate}T00:00:00`));
            if (!dated.length) {
                setMasterMessage({ type: 'error', text: 'No valid vehicle rows found in the file.' });
                return;
            }
            const inserted = await saveVehicleMasterRows(dated, { masterDate, replaceDate: true });
            await refreshVehicleMaster(true);
            setMasterMessage({
                type: 'success',
                text: `Saved ${inserted.toLocaleString()} vehicle master rows for ${masterDate}.`,
            });
        } catch (err) {
            const text = isMissingVehicleMasterTable(err)
                ? getVehicleMasterDbSetupMessage()
                : (err?.message || 'Upload failed.');
            setMasterMessage({ type: 'error', text });
        } finally {
            setMasterUploading(false);
        }
    };

    const handleMasterReset = async () => {
        if (!window.confirm(
            masterResetDate
                ? `Clear all vehicle master rows for ${masterResetDate}?`
                : 'Clear all vehicle master rows?'
        )) return;

        setMasterResetting(true);
        setMasterMessage(null);
        try {
            if (masterResetDate) {
                await clearVehicleMasterDataByDate(masterResetDate);
            } else {
                await clearVehicleMasterData();
            }
            await refreshVehicleMaster(true);
            setMasterMessage({
                type: 'success',
                text: masterResetDate
                    ? `Cleared vehicle master for ${masterResetDate}.`
                    : 'Cleared all vehicle master rows.',
            });
        } catch (err) {
            setMasterMessage({ type: 'error', text: err?.message || 'Reset failed.' });
        } finally {
            setMasterResetting(false);
        }
    };

    const multiVehicleErrors = useMemo(() => {
        const dateCache = new Map();
        const parseDate = (dateStr) => {
            if (!dateStr) return null;
            const s = dateStr.toString().trim();
            if (!s) return null;
            if (dateCache.has(s)) return dateCache.get(s);
            const d = parseFleetDate(s);
            const out = d && !isNaN(d.getTime()) ? d : null;
            dateCache.set(s, out);
            return out;
        };

        const byRider = new Map();
        (fleetData || []).forEach(rec => {
            const status = (rec.vehicle_status || '').toString().trim().toLowerCase();
            if (status !== 'deployee' && status !== 'return') return;
            const riderKey = (rec.rider_id || '').toString().trim().toUpperCase();
            if (!riderKey) return;
            if (!byRider.has(riderKey)) byRider.set(riderKey, []);
            byRider.get(riderKey).push(rec);
        });

        const today = new Date();
        const result = [];
        byRider.forEach((history, riderKey) => {
            history.sort((a, b) => (parseDate(a.date_record) || new Date(0)) - (parseDate(b.date_record) || new Date(0)));
            const active = new Map();
            let fleetRiderName = '';
            let fleetSourceName = '';
            let fleetCity = '';
            history.forEach(rec => {
                const d = parseDate(rec.date_record);
                if (!d) return;
                const key = (rec.vehicle_number || '').toString().trim().toUpperCase();
                if (!key) return;
                const recRiderName = pickFirstValid(rec.rider_name, rec.riderName, rec.name);
                const recSourceName = pickFirstValid(
                    rec['Source name  -  Vehicle Asset Details'],
                    rec.source_name,
                    rec.sourceName,
                    rec.source,
                    rec.sourcer_name,
                    rec.sourcer
                );
                const recCity = pickFirstValid(rec.city_locations, rec.city, rec.city_name);

                if (recRiderName !== 'N/A') fleetRiderName = recRiderName;
                if (recSourceName !== 'N/A') fleetSourceName = recSourceName;
                if (recCity !== 'N/A') fleetCity = recCity;
                if (rec.vehicle_status === 'Deployee') {
                    active.set(key, {
                        vehicleNumber: (rec.vehicle_number || '').toString().trim(),
                        deployeeDate: d
                    });
                } else if (rec.vehicle_status === 'Return') {
                    active.delete(key);
                }
            });

            if (active.size > 1) {
                const sourceKey = fleetSourceName.toString().trim().toUpperCase();
                const riderInfoById = riderLookup.byRiderId.get(riderKey) || {};
                const riderDisplayId = (history[history.length - 1]?.rider_id || riderKey).toString().trim();
                const resolvedSourceName = riderInfoById.sourceName && riderInfoById.sourceName !== 'N/A'
                    ? riderInfoById.sourceName
                    : (fleetSourceName || 'N/A');

                const resolvedClient = riderInfoById.client && riderInfoById.client !== 'N/A'
                    ? riderInfoById.client
                    : sourceKey && riderLookup.clientBySource.has(sourceKey)
                        ? riderLookup.clientBySource.get(sourceKey)
                        : 'N/A';
                const resolvedCity = riderInfoById.city && riderInfoById.city !== 'N/A'
                    ? riderInfoById.city
                    : (fleetCity || 'N/A');

                const activeVehicles = Array.from(active.values()).map(v => ({
                    ...v,
                    daysOnRoad: differenceInDays(today, v.deployeeDate)
                }));
                result.push({
                    riderId: riderDisplayId,
                    riderName: riderInfoById.riderName && riderInfoById.riderName !== 'N/A'
                        ? riderInfoById.riderName
                        : (fleetRiderName || 'N/A'),
                    client: resolvedClient,
                    sourceName: resolvedSourceName,
                    city: resolvedCity,
                    activeVehicles
                });
            }
        });
        return result;
    }, [fleetData, riderLookup]);

    const vehicleMismatchErrors = useMemo(
        () => findVehicleMasterMismatches(fleetData, vehicleMasterRows, { masterDate: filterMasterDate }),
        [fleetData, vehicleMasterRows, filterMasterDate]
    );

    const mismatchCompareStats = useMemo(() => {
        if (!filterMasterDate || !vehicleMasterRows.length) return null;
        return summarizeVehicleMasterCompare(fleetData, vehicleMasterRows, filterMasterDate);
    }, [filterMasterDate, vehicleMasterRows, fleetData]);

    const clients = useMemo(() => {
        const source = activeTab === TABS.MULTI ? multiVehicleErrors : vehicleMismatchErrors;
        const set = new Set(source.map(e => e.client).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [activeTab, multiVehicleErrors, vehicleMismatchErrors]);

    const filteredMultiErrors = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        return multiVehicleErrors.filter(e => {
            const matchesSearch = !s ||
                (e.riderId || '').toLowerCase().includes(s) ||
                (e.riderName || '').toLowerCase().includes(s);
            const matchesClient = filterClient === 'All' || e.client === filterClient;
            return matchesSearch && matchesClient;
        });
    }, [multiVehicleErrors, searchTerm, filterClient]);

    const filteredVehicleMismatchErrors = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        return vehicleMismatchErrors.filter(e => {
            const matchesSearch = !s ||
                (e.vehicleNumber || '').toLowerCase().includes(s) ||
                (e.riderId || '').toLowerCase().includes(s) ||
                (e.riderName || '').toLowerCase().includes(s);
            const matchesClient = filterClient === 'All' || e.client === filterClient;
            return matchesSearch && matchesClient;
        });
    }, [vehicleMismatchErrors, searchTerm, filterClient]);

    const activeCount = activeTab === TABS.MULTI
        ? filteredMultiErrors.length
        : filteredVehicleMismatchErrors.length;

    const exportMultiCsv = () => {
        const headers = ['Rider ID', 'Rider Name', 'Client', 'Sourcer Name', 'City', 'Vehicle Details'];
        const escapeCsv = (val) => {
            const str = (val ?? '').toString();
            return `"${str.replace(/"/g, '""')}"`;
        };

        const rows = filteredMultiErrors.map(err => {
            const vehicleDetails = err.activeVehicles
                .map(v => `${v.vehicleNumber} - ${v.daysOnRoad} days (${format(v.deployeeDate, 'dd MMM yyyy')} to Now)`)
                .join(' | ');

            return [
                err.riderId,
                err.riderName,
                err.client,
                err.sourceName,
                err.city,
                vehicleDetails
            ].map(escapeCsv).join(',');
        });

        const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `error_finder_multi_vehicle_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const exportVehicleMismatchCsv = () => {
        const headers = ['Date', 'Vehicle Number', 'Status', 'Rider ID', 'Rider Name', 'Client', 'City'];
        const escapeCsv = (val) => {
            const str = (val ?? '').toString();
            return `"${str.replace(/"/g, '""')}"`;
        };

        const rows = filteredVehicleMismatchErrors.map(err => [
            err.dateLabel,
            err.vehicleNumber,
            err.vehicleStatus,
            err.riderId,
            err.riderName,
            err.client,
            err.city,
        ].map(escapeCsv).join(','));

        const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `error_finder_v_mismatch_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Error Finder</h1>
                    <p style={{ color: 'var(--text-dim)' }}>
                        {activeTab === TABS.MULTI
                            ? 'Riders with more than one active vehicle assignment'
                            : 'Fleet vehicles not found in uploaded vehicle master for the same date'}
                    </p>
                </div>
            </header>

            <div className="fdv-tab-bar glass" style={{ marginBottom: '1rem' }}>
                <button
                    type="button"
                    className={`fdv-tab ${activeTab === TABS.MULTI ? 'fdv-tab-active' : ''}`}
                    onClick={() => setActiveTab(TABS.MULTI)}
                >
                    <AlertTriangle size={16} />
                    Multi-Vehicle
                    <span className="fdv-source-btn-count">{multiVehicleErrors.length}</span>
                </button>
                <button
                    type="button"
                    className={`fdv-tab ${activeTab === TABS.V_MISMATCH ? 'fdv-tab-active' : ''}`}
                    onClick={() => setActiveTab(TABS.V_MISMATCH)}
                >
                    <Truck size={16} />
                    V Mismatch
                    <span className="fdv-source-btn-count">{vehicleMismatchErrors.length}</span>
                </button>
            </div>

            {activeTab === TABS.V_MISMATCH && (
                <div className="glass" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
                    <button
                        type="button"
                        onClick={() => setShowUploadPanel((v) => !v)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            padding: 0,
                            fontSize: '0.95rem',
                            fontWeight: 600,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Upload size={18} style={{ color: '#facc15' }} />
                            Vehicle Master Upload
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 500 }}>
                                ({masterCount.toLocaleString()} rows saved)
                            </span>
                        </span>
                        {showUploadPanel ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {showUploadPanel && (
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                                Upload Excel/CSV with Vehicle Number, Chassis Number, and Engine (Motor) Number.
                                Choose the master date first — fleet rows on that same date are checked against vehicle numbers in this upload.
                            </p>

                            {masterMessage && (
                                <div
                                    style={{
                                        padding: '0.65rem 0.85rem',
                                        borderRadius: '8px',
                                        fontSize: '0.85rem',
                                        background: masterMessage.type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                                        color: masterMessage.type === 'error' ? '#f87171' : '#4ade80',
                                    }}
                                >
                                    {masterMessage.text}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <div className="filter-group">
                                    <label className="filter-label">Master date</label>
                                    <input
                                        type="date"
                                        value={masterDate}
                                        onChange={(e) => setMasterDate(e.target.value)}
                                        disabled={masterUploading || masterResetting}
                                        style={{
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '8px',
                                            color: '#fff',
                                            padding: '0.55rem 0.75rem',
                                        }}
                                    />
                                </div>
                                <label className="fsr-export-btn" style={{ cursor: masterUploading ? 'not-allowed' : 'pointer', opacity: masterUploading ? 0.6 : 1 }}>
                                    {masterUploading ? <Loader size={16} className="spin" /> : <Upload size={16} />}
                                    Upload file
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        onChange={handleMasterUpload}
                                        disabled={masterUploading || masterResetting}
                                        hidden
                                    />
                                </label>
                                <div className="filter-group">
                                    <label className="filter-label">Reset date</label>
                                    <select
                                        value={masterResetDate}
                                        onChange={(e) => setMasterResetDate(e.target.value)}
                                        disabled={masterUploading || masterResetting || masterCount === 0}
                                    >
                                        <option value="">All dates</option>
                                        {masterDates.map((d) => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    className="glass-btn"
                                    onClick={handleMasterReset}
                                    disabled={masterUploading || masterResetting || masterCount === 0}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                >
                                    {masterResetting ? <Loader size={16} className="spin" /> : <RotateCcw size={16} />}
                                    {masterResetDate ? `Reset ${masterResetDate}` : 'Reset all'}
                                </button>
                            </div>

                            <details>
                                <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                                    Expected columns ({VEHICLE_MASTER_HEADER_LABELS.length})
                                </summary>
                                <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                                    {VEHICLE_MASTER_HEADER_LABELS.join(' · ')}
                                </p>
                            </details>

                            {masterPreview.length > 0 && (
                                <div className="table-container" style={{ maxHeight: '220px' }}>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Vehicle Number</th>
                                                <th>Chassis Number</th>
                                                <th>Engine (Motor) Number</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {masterPreview.map((row) => (
                                                <tr key={row.id}>
                                                    <td>{row.master_date || '—'}</td>
                                                    <td>{row.vehicle_number || '—'}</td>
                                                    <td>{row.chassis_number || '—'}</td>
                                                    <td>{row.engine_motor_number || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="filters-container glass" style={{ padding: '1rem 1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
                    <div className="filter-group" style={{ flex: 1, minWidth: '280px' }}>
                        <label className="filter-label">
                            {activeTab === TABS.MULTI ? 'Search Rider ID / Name' : 'Search Vehicle / Rider'}
                        </label>
                        <div className="glass" style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 1rem', gap: '0.75rem' }}>
                            <Search size={18} className="text-dim" />
                            <input
                                type="text"
                                placeholder={activeTab === TABS.MULTI ? 'Search rider...' : 'Search vehicle or rider...'}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: '#fff', width: '100%', outline: 'none' }}
                            />
                        </div>
                    </div>
                    <div className="filter-group">
                        <label className="filter-label">Client</label>
                        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                            {clients.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    {activeTab === TABS.V_MISMATCH && masterDates.length > 0 && (
                        <div className="filter-group">
                            <label className="filter-label">Master date</label>
                            <select value={filterMasterDate} onChange={(e) => setFilterMasterDate(e.target.value)}>
                                {masterDates.map((d) => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            <EvLookupPanel riderData={riderData} fleetData={fleetData} />

            <div className="table-card glass">
                <div className="table-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {activeTab === TABS.MULTI ? (
                            <>
                                <AlertTriangle size={20} className="text-primary" />
                                <h3>Multi-Vehicle Active Errors</h3>
                            </>
                        ) : (
                            <>
                                <Truck size={20} className="text-primary" />
                                <div>
                                    <h3 style={{ margin: 0 }}>Vehicle Master Mismatch</h3>
                                    {mismatchCompareStats && (
                                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                                            {mismatchCompareStats.deployedFleetCount.toLocaleString()} deployed fleet
                                            {' vs '}
                                            {mismatchCompareStats.masterVehicleCount.toLocaleString()} master vehicles
                                            {' on '}
                                            {mismatchCompareStats.masterDate}
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button
                            className="glass"
                            onClick={activeTab === TABS.MULTI ? exportMultiCsv : exportVehicleMismatchCsv}
                            style={{ padding: '0.4rem 0.85rem', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                            Export CSV
                        </button>
                        <span className="status-badge return">{activeCount}</span>
                    </div>
                </div>
                <div className="table-container">
                    {activeTab === TABS.MULTI ? (
                        <table>
                            <thead>
                                <tr>
                                    <th>Rider ID</th>
                                    <th>Rider Name</th>
                                    <th>Client</th>
                                    <th>Sourcer Name</th>
                                    <th>City</th>
                                    <th>Vehicle Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMultiErrors.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" style={{ color: 'var(--text-dim)' }}>No errors found for current filters.</td>
                                    </tr>
                                ) : filteredMultiErrors.map((err) => (
                                    <tr key={err.riderId}>
                                        <td>{err.riderId}</td>
                                        <td>{err.riderName}</td>
                                        <td>{err.client}</td>
                                        <td>{err.sourceName}</td>
                                        <td>{err.city}</td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                {err.activeVehicles.map((v, i) => (
                                                    <div key={`${err.riderId}-${v.vehicleNumber}-${i}`} style={{ fontSize: '0.8rem' }}>
                                                        <strong>{v.vehicleNumber}</strong> - {v.daysOnRoad} days ({format(v.deployeeDate, 'dd MMM yyyy')} to Now)
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Vehicle Number</th>
                                    <th>Status</th>
                                    <th>Rider ID</th>
                                    <th>Rider Name</th>
                                    <th>Client</th>
                                    <th>City</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredVehicleMismatchErrors.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" style={{ color: 'var(--text-dim)' }}>
                                            {masterLoading
                                                ? 'Loading vehicle master data…'
                                                : masterCount > 0
                                                    ? filterMasterDate
                                                        ? mismatchCompareStats?.deployedFleetCount === 0
                                                            ? `No deployed fleet found on ${filterMasterDate}.`
                                                            : `No deployed fleet vehicles missing from master for ${filterMasterDate}.`
                                                        : 'Choose a master date to compare.'
                                                    : 'Upload vehicle master data for a date to start V mismatch checks.'}
                                        </td>
                                    </tr>
                                ) : filteredVehicleMismatchErrors.map((err, idx) => (
                                    <tr key={`${err.dateLabel}-${err.vehicleNumber}-${err.riderId}-${idx}`}>
                                        <td>{err.dateLabel}</td>
                                        <td><strong>{err.vehicleNumber}</strong></td>
                                        <td>
                                            <span className={`status-badge ${err.vehicleStatus === 'Deployee' ? 'deployee' : 'return'}`}>
                                                {err.vehicleStatus}
                                            </span>
                                        </td>
                                        <td>{err.riderId || 'N/A'}</td>
                                        <td>{err.riderName || 'N/A'}</td>
                                        <td>{err.client}</td>
                                        <td>{err.city}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </motion.div>
    );
};

export default ErrorFinder;
