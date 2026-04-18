import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Search } from 'lucide-react';
import { differenceInDays, format } from 'date-fns';

const ErrorFinder = ({ fleetData, riderData, loading }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClient, setFilterClient] = useState('All');

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

    const errors = useMemo(() => {
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

        const byRider = new Map();
        (fleetData || []).forEach(rec => {
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

                // Keep latest valid values from sorted history
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

    const clients = useMemo(() => {
        const set = new Set(errors.map(e => e.client).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [errors]);

    const filteredErrors = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        return errors.filter(e => {
            const matchesSearch = !s ||
                (e.riderId || '').toLowerCase().includes(s) ||
                (e.riderName || '').toLowerCase().includes(s);
            const matchesClient = filterClient === 'All' || e.client === filterClient;
            return matchesSearch && matchesClient;
        });
    }, [errors, searchTerm, filterClient]);

    const exportCsv = () => {
        const headers = ['Rider ID', 'Rider Name', 'Client', 'Sourcer Name', 'City', 'Vehicle Details'];
        const escapeCsv = (val) => {
            const str = (val ?? '').toString();
            return `"${str.replace(/"/g, '""')}"`;
        };

        const rows = filteredErrors.map(err => {
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
        link.setAttribute('download', `error_finder_${new Date().toISOString().slice(0, 10)}.csv`);
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
                    <p style={{ color: 'var(--text-dim)' }}>Riders with more than one active vehicle assignment</p>
                </div>
            </header>

            <div className="filters-container glass" style={{ padding: '1rem 1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
                    <div className="filter-group" style={{ flex: 1, minWidth: '280px' }}>
                        <label className="filter-label">Search Rider ID / Name</label>
                        <div className="glass" style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 1rem', gap: '0.75rem' }}>
                            <Search size={18} className="text-dim" />
                            <input
                                type="text"
                                placeholder="Search rider..."
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
                </div>
            </div>

            <div className="table-card glass">
                <div className="table-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <AlertTriangle size={20} className="text-primary" />
                        <h3>Multi-Vehicle Active Errors</h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button
                            className="glass"
                            onClick={exportCsv}
                            style={{ padding: '0.4rem 0.85rem', color: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                            Export CSV
                        </button>
                        <span className="status-badge return">{filteredErrors.length}</span>
                    </div>
                </div>
                <div className="table-container">
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
                            {filteredErrors.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ color: 'var(--text-dim)' }}>No errors found for current filters.</td>
                                </tr>
                            ) : filteredErrors.map((err) => (
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
                </div>
            </div>
        </motion.div>
    );
};

export default ErrorFinder;
