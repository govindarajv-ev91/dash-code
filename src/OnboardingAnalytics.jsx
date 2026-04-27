import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isWithinInterval, startOfDay, endOfDay, parse } from 'date-fns';
import * as XLSX from 'xlsx';
import {
    Users, UserPlus, LogIn, TrendingUp, Filter, Calendar, MapPin,
    Briefcase, ChevronDown, ChevronUp, Search, Activity, Download, X
} from 'lucide-react';

// Helper functions outside component to avoid hoisting issues and redundant declarations
const normalize = (str) => {
    try {
        const s = (str || 'Unknown').toString().trim().toUpperCase();
        if (s === 'BANGALORE') return 'BENGALURU';
        return s;
    } catch (e) { return 'UNKNOWN'; }
};

const toDisplay = (str) => {
    try {
        const s = (str || 'Unknown').toString().toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
    } catch (e) { return 'Unknown'; }
};

const normalizeClient = (str) => {
    try {
        const s = (str || 'Other').toString().trim().toUpperCase();
        if (s === 'BB' || s === 'BB NOW' || s === 'BIGBASKET' || s === 'BIG BASKET') return 'BIGBASKET';
        return s;
    } catch (e) { return 'OTHER'; }
};

const getAllIds = (item) => {
    const potentialFields = [
        'worker_code', 'rider_id', 'rider_id_details', 'rider_mobile_number', 
        'mob_number', 'pan_number', 'aadhar_number', 'worker_id'
    ];
    const found = new Set();
    potentialFields.forEach(f => {
        const v = item[f];
        if (v === null || v === undefined) return;
        const s = v.toString().trim().toLowerCase();
        if (s && s.length > 2 && s !== 'null' && s !== 'nan' && s !== 'n/a' && s !== 'undefined') {
            found.add(s);
            // If it looks like a mobile number (10+ digits), add the last 10 digits as a normalized ID
            const digits = s.replace(/\D/g, '');
            if (digits.length >= 10) {
                found.add(digits.slice(-10));
            }
        }
    });
    return Array.from(found);
};

const getVehicleNumber = (item) => {
    const vehicleFields = [
        'deployed_vehicle_number',
        'deployment_vehicle_number',
        'vehicle_number',
        'vehicle_no',
        'bike_number',
        'bike_no'
    ];
    for (const field of vehicleFields) {
        const val = item[field];
        if (val === null || val === undefined) continue;
        const normalized = val.toString().trim();
        if (normalized && normalized.toLowerCase() !== 'null' && normalized.toLowerCase() !== 'n/a') {
            return normalized;
        }
    }
    return '';
};

const parseDateFlexible = (d, itemMonth) => {
    if (!d) {
        const m = (itemMonth || '').toLowerCase();
        if (m.includes('apr')) return new Date(2026, 3, 15);
        if (m.includes('mar')) return new Date(2026, 2, 15);
        return null;
    }

    const s = d.toString().trim();
    if (!s || s === 'null' || s === 'N/A') return null;

    if (/^\d{5}$/.test(s) || (typeof d === 'number' && d > 40000)) {
        const serial = parseFloat(s);
        const date = new Date((serial - 25569) * 86400 * 1000);
        if (!isNaN(date.getTime())) return date;
    }

    if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(s)) {
        const date = new Date(s);
        if (!isNaN(date.getTime())) return date;
    }

    try {
        const parts = s.split(/[/\-.]/);
        if (parts.length >= 3) {
            let p1 = parseInt(parts[0], 10);
            let p2 = parseInt(parts[1], 10);
            let p3 = parseInt(parts[2].split(' ')[0], 10);
            if (p1 <= 31 && p2 <= 12) {
                const year = p3 < 100 ? 2000 + p3 : p3;
                const date = new Date(year, p2 - 1, p1);
                if (!isNaN(date.getTime())) return date;
            }
        }
    } catch (e) { }

    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
};

const isDateInRange = (item, start, end) => {
    const date = parseDateFlexible(
        item.deployment_date || item.date_record || item.created_at || item.timestamp,
        item.month
    );
    return date && date >= start && date <= end;
};

const OnboardingAnalytics = ({ kycData, onboardingData, fleetData, riderData, loading }) => {
    const [dateRange, setDateRange] = useState({
        start: format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDetail, setSelectedDetail] = useState(null); // { title: string, riders: [] }

    const processedData = useMemo(() => {
        if (!kycData || !onboardingData) return { 
            cityStats: [], 
            clientStats: [], 
            riderStatsRaw: [], 
            totals: { kyc: 0, login: 0, diff: 0, conversion: 0 } 
        };

        const startDate = new Date(dateRange.start + 'T00:00:00');
        const endDate = new Date(dateRange.end + 'T23:59:59');

        const cityMap = new Map();
        const riderMap = new Map();
        const riderList = [];

        const processDataset = (data, type) => {
            data.forEach(item => {
                const ids = getAllIds(item);
                if (ids.length === 0) return;
                
                const inPeriod = isDateInRange(item, startDate, endDate);
                let rider = null;
                for (const id of ids) {
                    if (riderMap.has(id)) {
                        rider = riderMap.get(id);
                        break;
                    }
                }

                if (!rider) {
                    rider = {
                        primaryId: ids[0],
                        name: item.rider_name || item.worker_name || 'N/A',
                        city: normalize(item.city),
                        client: (item.client && item.client !== 'null') ? item.client : 'Other',
                        obEver: type === 'login',
                        flEver: type === 'kyc',
                        metricsEver: type === 'metrics',
                        obInPeriod: type === 'login' && inPeriod,
                        flInPeriod: type === 'kyc' && inPeriod,
                        metricsInPeriod: type === 'metrics' && inPeriod,
                        ids: new Set(ids),
                        latestVehicleNumber: '',
                        latestVehicleDate: null,
                        source: item.source || item.rider_source || ''
                    };
                    riderList.push(rider);
                } else {
                    if (type === 'kyc') rider.flEver = true;
                    if (type === 'login') rider.obEver = true;
                    if (type === 'metrics') rider.metricsEver = true;
                    if (type === 'kyc' && inPeriod) rider.flInPeriod = true;
                    if (type === 'login' && inPeriod) rider.obInPeriod = true;
                    if (type === 'metrics' && inPeriod) rider.metricsInPeriod = true;
                    
                    if (item.source || item.rider_source) rider.source = item.source || item.rider_source;
                    
                    if (rider.name === 'N/A' && (item.rider_name || item.worker_name)) {
                        rider.name = item.rider_name || item.worker_name;
                    }
                    if ((rider.city === 'Unknown' || !rider.city) && item.city) rider.city = normalize(item.city);
                    if (rider.client === 'Other' && item.client) rider.client = item.client;
                    ids.forEach(id => rider.ids.add(id));
                }

                const vehicleNumber = getVehicleNumber(item);
                if (vehicleNumber) {
                    const recordDate = parseDateFlexible(
                        item.deployment_date || item.date_record || item.created_at || item.timestamp,
                        item.month
                    );
                    if (!rider.latestVehicleDate || (recordDate && recordDate > rider.latestVehicleDate)) {
                        rider.latestVehicleDate = recordDate || rider.latestVehicleDate;
                        rider.latestVehicleNumber = vehicleNumber;
                    } else if (!rider.latestVehicleNumber) {
                        rider.latestVehicleNumber = vehicleNumber;
                    }
                }
                ids.forEach(id => riderMap.set(id, rider));
            });
        };

        processDataset(riderData || [], 'metrics');
        processDataset(kycData, 'kyc');
        processDataset(onboardingData, 'login');

        // Build latest deployed vehicle map from fleet records.
        // This is the reliable source for deployed vehicle numbers.
        const latestVehicleById = new Map();
        (fleetData || []).forEach(item => {
            const ids = getAllIds(item);
            if (ids.length === 0) return;

            const status = (item.vehicle_status || '').toString().toLowerCase();
            if (!status.includes('deploy')) return;

            const vehicleNumber = getVehicleNumber(item);
            if (!vehicleNumber) return;

            const recordDate = parseDateFlexible(
                item.date_record || item.bike_deployed_date_sd_refund_request || item.created_at,
                item.month
            );
            const recordTime = recordDate ? recordDate.getTime() : 0;

            ids.forEach(id => {
                const prev = latestVehicleById.get(id);
                if (!prev || recordTime >= prev.time) {
                    latestVehicleById.set(id, { vehicleNumber, time: recordTime });
                }
            });
        });

        // Filtered Lists for breakdowns
        const filteredKyc = kycData.filter(i => isDateInRange(i, startDate, endDate));
        const filteredOnboarding = onboardingData.filter(i => isDateInRange(i, startDate, endDate));

        // Regional and Client Stats (Keep these focused on period activity)
        const filteredMetrics = (riderData || []).filter(i => isDateInRange(i, startDate, endDate));

        filteredMetrics.forEach(item => {
            const cityKey = normalize(item.city);
            if (!cityMap.has(cityKey)) cityMap.set(cityKey, { 
                display: toDisplay(item.city || 'Unknown'), 
                activeIds: new Set(),
                state: item.state || 'N/A'
            });
            const ids = getAllIds(item);
            if (ids.length > 0) ids.forEach(id => cityMap.get(cityKey).activeIds.add(id));
        });

        const clientMap = new Map();
        filteredMetrics.forEach(item => {
            const ids = getAllIds(item);
            const clientRaw = (item.client && item.client !== 'null') ? item.client : 'Other';
            const clientKey = normalizeClient(clientRaw);
            
            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { 
                    display: (clientKey === 'BIGBASKET') ? 'Bigbasket' : (clientRaw === 'Other' ? 'Other' : clientRaw), 
                    activeIds: new Set()
                });
            }
            if (ids.length > 0) ids.forEach(id => clientMap.get(clientKey).activeIds.add(id));
        });

        const cityStats = Array.from(cityMap.values())
            .filter(s => normalize(s.display) !== 'UNKNOWN')
            .map(s => {
                const cityKey = normalize(s.display);
                const activeInCity = riderList.filter(r => 
                    normalize(r.city) === cityKey && r.metricsInPeriod
                );
                
                const totalActive = activeInCity.length;
                const obDone = activeInCity.filter(r => r.obEver).length;
                const flDone = activeInCity.filter(r => r.flEver).length;

                return { 
                    city: s.display, 
                    state: s.state,
                    totalActive, 
                    obDone, 
                    flDone, 
                    obNotDone: totalActive - obDone, 
                    flNotDone: totalActive - flDone 
                };
            })
            .sort((a, b) => b.totalActive - a.totalActive);

        const clientStats = Array.from(clientMap.values())
            .filter(s => normalizeClient(s.display) !== 'OTHER')
            .map(s => {
                const clientKey = normalizeClient(s.display);
                const activeInClient = riderList.filter(r => 
                    normalizeClient(r.client) === clientKey && r.metricsInPeriod
                );
                
                const totalActive = activeInClient.length;
                const obDone = activeInClient.filter(r => r.obEver).length;
                const flDone = activeInClient.filter(r => r.flEver).length;

                return { 
                    client: s.display, 
                    totalActive, 
                    obDone, 
                    flDone, 
                    obNotDone: totalActive - obDone, 
                    flNotDone: totalActive - flDone 
                };
            })
            .sort((a, b) => b.totalActive - a.totalActive);

        const totalActiveRiders = riderList.filter(r => r.metricsInPeriod).length;
        const totalObDone = riderList.filter(r => r.metricsInPeriod && r.obEver).length;
        const totalFlDone = riderList.filter(r => r.metricsInPeriod && r.flEver).length;

        const riderStatsRaw = riderList
            .filter(r => r.kycInPeriod || r.loginInPeriod || r.metricsInPeriod)
            .map(r => {
                let latestFleetVehicle = '';
                let latestFleetVehicleTime = -1;
                r.ids.forEach(id => {
                    const v = latestVehicleById.get(id);
                    if (!v) return;
                    if (v.time >= latestFleetVehicleTime) {
                        latestFleetVehicle = v.vehicleNumber;
                        latestFleetVehicleTime = v.time;
                    }
                });

                return {
                    id: r.primaryId,
                    name: r.name,
                    city: toDisplay(r.city),
                    client: r.client,
                    fl: r.flEver,
                    ob: r.obEver,
                    metrics: r.metricsEver,
                    metricsInPeriod: r.metricsInPeriod,
                    source: r.source || 'N/A',
                    latestVehicleNumber: latestFleetVehicle || r.latestVehicleNumber || 'N/A'
                };
            });

        return {
            cityStats,
            clientStats,
            riderStatsRaw,
            totals: {
                active: totalActiveRiders,
                ob: totalObDone,
                fl: totalFlDone,
                obNotDone: totalActiveRiders - totalObDone,
                flNotDone: totalActiveRiders - totalFlDone,
                conversion: totalActiveRiders > 0 ? ((totalFlDone / totalActiveRiders) * 100).toFixed(1) : 0
            }
        };
    }, [kycData, onboardingData, fleetData, riderData, dateRange]);

    const filteredRiderStats = useMemo(() => {
        if (!processedData.riderStatsRaw) return [];
        return processedData.riderStatsRaw.filter(r => 
            r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(r.client).toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(r.latestVehicleNumber).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [processedData.riderStatsRaw, searchTerm]);

    const handleExport = () => {
        const dataToExport = filteredRiderStats.map(r => ({
            'Rider Name': r.name,
            'Rider ID/Phone': r.id,
            'City': r.city,
            'Client': r.client,
            'Source': r.source,
            'FL Done': r.fl ? 'YES' : 'NO',
            'OB Done': r.ob ? 'YES' : 'NO',
            'Last Deployed Vehicle Number': r.latestVehicleNumber,
            'Overall Status': r.metrics ? 'Active' : (r.fl && r.ob ? 'Complete' : (r.ob ? 'Onboarded' : 'Pending'))
        }));
        
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Rider Breakdown");
        XLSX.writeFile(wb, `Rider_Analytics_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    const handleDetailExport = (riders, title) => {
        const dataToExport = riders.map(r => ({
            'Rider Name': r.name,
            'Rider ID/Phone': r.id,
            'City': r.city,
            'Client': r.client,
            'Source': r.source,
            'FL Done': r.fl ? 'YES' : 'NO',
            'OB Done': r.ob ? 'YES' : 'NO',
            'Last Deployed Vehicle Number': r.latestVehicleNumber
        }));
        
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Detail List");
        XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    const openDetail = (type, name, metric) => {
        const cityKey = type === 'city' ? normalize(name) : null;
        const clientKey = type === 'client' ? normalizeClient(name) : null;
        
        let list = processedData.riderStatsRaw.filter(r => {
            const matchesLoc = type === 'city' ? normalize(r.city) === cityKey : normalizeClient(r.client) === clientKey;
            if (!matchesLoc) return false;
            
            // Only consider riders who were active in the selected period
            if (!r.metricsInPeriod) return false;

            if (metric === 'ob_missing') return !r.ob;
            if (metric === 'fl_missing') return !r.fl;
            return true; // active
        });

        const title = `${metric === 'active' ? 'Active' : (metric === 'ob_missing' ? 'OB Missing' : 'FL Missing')} Riders - ${name}`;
        setSelectedDetail({ title, riders: list });
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Onboarding vs FreshLogin</h1>
                    <p style={{ color: 'var(--text-dim)' }}>Funnel analysis and deployment tracking</p>
                </div>
                <div className="glass" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Calendar size={18} className="text-primary" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                            className="date-input"
                        />
                        <span style={{ color: 'var(--text-dim)' }}>to</span>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                            className="date-input"
                        />
                    </div>
                </div>
            </header>

            <section className="stats-grid">
                <div className="stat-card glass">
                    <div className="flex-between">
                        <Users size={24} style={{ color: 'var(--accent-blue)' }} />
                    </div>
                    <div>
                        <div className="label">Total Active Riders</div>
                        <div className="value">{processedData.totals.active}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between">
                        <UserPlus size={24} style={{ color: 'var(--accent-green)' }} />
                        <span className="status-badge active">Integrity</span>
                    </div>
                    <div>
                        <div className="label">OB Done Matched</div>
                        <div className="value">{processedData.totals.ob}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between">
                        <LogIn size={24} style={{ color: 'var(--accent-purple)' }} />
                    </div>
                    <div>
                        <div className="label">FL Done Matched</div>
                        <div className="value">{processedData.totals.fl}</div>
                    </div>
                </div>
            </section>

            <div className="attendance-grid">
                {/* City Wise Table */}
                <div className="table-card glass">
                    <div className="table-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <MapPin size={20} className="text-primary" />
                            <h3>City Wise Breakdown</h3>
                        </div>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>City Name</th>
                                    <th>State</th>
                                    <th style={{ textAlign: 'center' }}>Total Active</th>
                                    <th style={{ textAlign: 'center' }}>OB Done</th>
                                    <th style={{ textAlign: 'center' }}>FL Done</th>
                                    <th style={{ textAlign: 'center' }}>OB Not Done</th>
                                    <th style={{ textAlign: 'center' }}>FL Not Done</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData.cityStats.map(stat => (
                                    <tr key={stat.city}>
                                        <td style={{ fontWeight: 600 }}>{stat.city}</td>
                                        <td style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>{stat.state}</td>
                                        <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                            <button onClick={() => openDetail('city', stat.city, 'active')} className="count-btn">{stat.totalActive}</button>
                                        </td>
                                        <td style={{ textAlign: 'center', color: 'var(--accent-blue)', fontWeight: 600 }}>{stat.obDone}</td>
                                        <td style={{ textAlign: 'center', color: 'var(--accent-purple)', fontWeight: 600 }}>{stat.flDone}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button onClick={() => openDetail('city', stat.city, 'ob_missing')} className="status-badge return count-btn" style={{ fontSize: '0.85rem', border: 'none' }}>
                                                {stat.obNotDone}
                                            </button>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button onClick={() => openDetail('city', stat.city, 'fl_missing')} className="status-badge return count-btn" style={{ fontSize: '0.85rem', background: 'rgba(239, 68, 68, 0.1)', border: 'none' }}>
                                                {stat.flNotDone}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Client Wise Table */}
                <div className="table-card glass">
                    <div className="table-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Briefcase size={20} className="text-primary" />
                            <h3>Client Wise Breakdown</h3>
                        </div>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Client Name</th>
                                    <th style={{ textAlign: 'center' }}>Total Active</th>
                                    <th style={{ textAlign: 'center' }}>OB Done</th>
                                    <th style={{ textAlign: 'center' }}>FL Done</th>
                                    <th style={{ textAlign: 'center' }}>OB Not Done</th>
                                    <th style={{ textAlign: 'center' }}>FL Not Done</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData.clientStats.map(stat => (
                                    <tr key={stat.client}>
                                        <td style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{stat.client}</td>
                                        <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                            <button onClick={() => openDetail('client', stat.client, 'active')} className="count-btn">{stat.totalActive}</button>
                                        </td>
                                        <td style={{ textAlign: 'center', color: 'var(--accent-blue)', fontWeight: 600 }}>{stat.obDone}</td>
                                        <td style={{ textAlign: 'center', color: 'var(--accent-purple)', fontWeight: 600 }}>{stat.flDone}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button onClick={() => openDetail('client', stat.client, 'ob_missing')} className="count-btn" style={{ color: 'var(--accent-red)', fontWeight: 700, border: 'none', background: 'transparent' }}>
                                                {stat.obNotDone}
                                            </button>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button onClick={() => openDetail('client', stat.client, 'fl_missing')} className="count-btn" style={{ color: 'var(--accent-red)', fontWeight: 700, border: 'none', background: 'transparent' }}>
                                                {stat.flNotDone}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Drill-down Detail Modal */}
            <AnimatePresence>
                {selectedDetail && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setSelectedDetail(null)}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, backdropFilter: 'blur(4px)' }}
                        />
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0, y: 20 }} 
                            animate={{ scale: 1, opacity: 1, y: 0 }} 
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="glass"
                            style={{ 
                                position: 'fixed', top: '10%', left: '10%', right: '10%', bottom: '10%', 
                                zIndex: 1001, padding: '2rem', display: 'flex', flexDirection: 'column',
                                borderRadius: '24px', background: '#111827', border: '1px solid rgba(255,255,255,0.1)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <Activity className="text-primary" />
                                    <h2 style={{ margin: 0 }}>{selectedDetail.title}</h2>
                                    <span className="status-badge" style={{ background: 'rgba(255,255,255,0.05)' }}>{selectedDetail.riders.length} Riders</span>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button 
                                        onClick={() => handleDetailExport(selectedDetail.riders, selectedDetail.title)}
                                        className="btn-export"
                                        style={{ background: 'var(--primary-color)', color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
                                    >
                                        <Download size={18} /> Excel Export
                                    </button>
                                    <button onClick={() => setSelectedDetail(null)} className="glass-btn" style={{ padding: '0.5rem', borderRadius: '50%' }}>
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto' }} className="table-container">
                                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0' }}>
                                    <thead style={{ position: 'sticky', top: 0, background: '#111827', zIndex: 10 }}>
                                        <tr>
                                            <th>Rider Name</th>
                                            <th>Rider ID / Mobile</th>
                                            <th>City</th>
                                            <th>Client</th>
                                            <th>Source</th>
                                            <th style={{ textAlign: 'center' }}>OB Status</th>
                                            <th style={{ textAlign: 'center' }}>FL Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedDetail.riders.map((r, i) => (
                                            <tr key={r.id + i}>
                                                <td style={{ fontWeight: 600 }}>{r.name}</td>
                                                <td>{r.id}</td>
                                                <td>{r.city}</td>
                                                <td style={{ color: 'var(--accent-purple)' }}>{r.client}</td>
                                                <td>{r.source}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {r.ob ? <span style={{ color: 'var(--accent-green)' }}>Done</span> : <span style={{ color: 'var(--accent-red)' }}>Missing</span>}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {r.fl ? <span style={{ color: 'var(--accent-green)' }}>Done</span> : <span style={{ color: 'var(--accent-red)' }}>Missing</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Rider Wise Breakdown Table */}
            <div className="table-card glass" style={{ marginTop: '2rem' }}>
                <div className="table-header" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Users size={20} className="text-primary" />
                        <h3>Rider Wise Breakdown</h3>
                        <span className="status-badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-dim)' }}>
                            {filteredRiderStats.length} Riders
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <div className="search-box glass" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', width: '300px' }}>
                            <Search size={18} style={{ color: 'var(--text-dim)' }} />
                            <input 
                                type="text" 
                                placeholder="Search riders, IDs or cities..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%' }}
                            />
                        </div>
                        <button 
                            onClick={handleExport}
                            className="btn-export"
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.5rem', 
                                background: 'var(--primary-color)', 
                                color: '#fff', 
                                border: 'none', 
                                padding: '0.5rem 1.25rem', 
                                borderRadius: '8px', 
                                cursor: 'pointer',
                                fontWeight: 600,
                                transition: 'all 0.2s'
                            }}
                        >
                            <Download size={18} />
                            Excel Export
                        </button>
                    </div>
                </div>
                <div className="table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#1a1a1a', zIndex: 10 }}>
                            <tr>
                                <th>Rider Name</th>
                                <th>Rider ID / Mobile</th>
                                <th>City</th>
                                <th>Client</th>
                                <th>Source</th>
                                <th style={{ textAlign: 'center' }}>OB Status</th>
                                <th style={{ textAlign: 'center' }}>FL Status</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th style={{ textAlign: 'center' }}>Last Deployed Vehicle Number</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRiderStats.slice(0, 500).map((rider, idx) => (
                                <tr key={rider.id + idx}>
                                    <td style={{ fontWeight: 600 }}>{rider.name}</td>
                                    <td>{rider.id}</td>
                                    <td>{rider.city}</td>
                                    <td style={{ color: 'var(--accent-purple)' }}>{rider.client}</td>
                                    <td>{rider.source}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.ob ? 
                                            <span style={{ color: 'var(--accent-green)' }}>● Done</span> : 
                                            <span style={{ color: 'var(--text-dim)' }}>○ Pending</span>
                                        }
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.fl ? 
                                            <span style={{ color: 'var(--accent-green)' }}>● Done</span> : 
                                            <span style={{ color: 'var(--text-dim)' }}>○ Pending</span>
                                        }
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.metrics ? 
                                            <span className="status-badge active" style={{ fontSize: '0.8rem', background: 'var(--accent-green)', color: '#000' }}>Active</span> :
                                            (rider.fl && rider.ob ? 
                                                <span className="status-badge active" style={{ fontSize: '0.8rem' }}>Complete</span> :
                                                rider.ob ? 
                                                <span className="status-badge" style={{ fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)' }}>OB Done</span> :
                                                <span className="status-badge return" style={{ fontSize: '0.8rem' }}>FL Only</span>
                                            )
                                        }
                                    </td>
                                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                                        {rider.latestVehicleNumber}
                                    </td>
                                </tr>
                            ))}
                            {filteredRiderStats.length > 500 && (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                                        Showing first 500 riders. Use search or export for full list.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .date-input {
                    background: transparent;
                    border: none;
                    color: #fff;
                    font-family: inherit;
                    font-size: 0.9rem;
                    outline: none;
                }
                .date-input::-webkit-calendar-picker-indicator {
                    filter: invert(1);
                    cursor: pointer;
                }
                .flex-between {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1rem;
                }
                .count-btn {
                    background: transparent;
                    border: none;
                    color: inherit;
                    font-weight: inherit;
                    font-size: inherit;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 4px;
                    transition: background 0.2s;
                    text-decoration: underline;
                    text-underline-offset: 4px;
                    text-decoration-color: rgba(255,255,255,0.2);
                }
                .count-btn:hover {
                    background: rgba(255,255,255,0.1);
                    text-decoration-color: currentColor;
                }
            `}} />
        </motion.div>
    );
};

export default OnboardingAnalytics;
