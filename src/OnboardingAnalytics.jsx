import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isWithinInterval, startOfDay, endOfDay, parse } from 'date-fns';
import * as XLSX from 'xlsx';
import {
    Users, UserPlus, LogIn, TrendingUp, Filter, Calendar, MapPin,
    Briefcase, ChevronDown, ChevronUp, Search, Activity, Download
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

const getAllIds = (item) => {
    const potentialFields = [
        'rider_id', 'rider_id_details', 'rider_mobile_number', 
        'pan_number', 'aadhar_number', 'worker_code', 'worker_id'
    ];
    const found = new Set();
    potentialFields.forEach(f => {
        const v = item[f];
        if (v === null || v === undefined) return;
        const s = v.toString().trim().toLowerCase();
        if (s && s.length > 2 && s !== 'null' && s !== 'nan' && s !== 'n/a' && s !== 'undefined') {
            found.add(s);
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

const OnboardingAnalytics = ({ kycData, onboardingData, fleetData, loading }) => {
    const [dateRange, setDateRange] = useState({
        start: format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [searchTerm, setSearchTerm] = useState('');

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
                        name: item.rider_name || 'N/A',
                        city: normalize(item.city),
                        client: (item.client && item.client !== 'null') ? item.client : 'Other',
                        kycEver: type === 'kyc',
                        loginEver: type === 'login',
                        kycInPeriod: type === 'kyc' && inPeriod,
                        loginInPeriod: type === 'login' && inPeriod,
                        ids: new Set(ids),
                        latestVehicleNumber: '',
                        latestVehicleDate: null
                    };
                    riderList.push(rider);
                } else {
                    if (type === 'kyc') rider.kycEver = true;
                    if (type === 'login') rider.loginEver = true;
                    if (type === 'kyc' && inPeriod) rider.kycInPeriod = true;
                    if (type === 'login' && inPeriod) rider.loginInPeriod = true;
                    
                    if (rider.name === 'N/A' && item.rider_name) rider.name = item.rider_name;
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
        filteredKyc.forEach(item => {
            const cityKey = normalize(item.city);
            if (!cityMap.has(cityKey)) cityMap.set(cityKey, { display: toDisplay(item.city || 'Unknown'), kycRiders: new Set(), loginRiders: new Set() });
            const ids = getAllIds(item);
            if (ids.length > 0) ids.forEach(id => cityMap.get(cityKey).kycRiders.add(id));
        });

        filteredOnboarding.forEach(item => {
            const cityKey = normalize(item.city);
            if (!cityMap.has(cityKey)) cityMap.set(cityKey, { display: toDisplay(item.city || 'Unknown'), kycRiders: new Set(), loginRiders: new Set() });
            const ids = getAllIds(item);
            if (ids.length > 0) ids.forEach(id => cityMap.get(cityKey).loginRiders.add(id));
        });

        const clientMap = new Map();
        const normalizeClient = (str) => {
            const s = (str || 'Other').toString().trim().toUpperCase();
            if (s === 'BB' || s === 'BB NOW' || s === 'BIGBASKET' || s === 'BIG BASKET') return 'BIGBASKET';
            return s;
        };

        filteredKyc.forEach(item => {
            const ids = getAllIds(item);
            let clientRaw = (item.client && item.client !== 'null') ? item.client : 'Other';
            const clientKey = normalizeClient(clientRaw);
            
            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { 
                    display: (clientKey === 'BIGBASKET') ? 'Bigbasket' : (clientRaw === 'Other' ? 'Other' : clientRaw), 
                    kycRiders: new Set(), 
                    loginRiders: new Set() 
                });
            }
            if (ids.length > 0) ids.forEach(id => clientMap.get(clientKey).kycRiders.add(id));
        });

        filteredOnboarding.forEach(item => {
            const ids = getAllIds(item);
            const clientRaw = (item.client || 'Other').toString().trim();
            const clientKey = normalizeClient(clientRaw);
            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { 
                    display: (clientKey === 'BIGBASKET') ? 'Bigbasket' : (clientRaw === 'Other' ? 'Other' : clientRaw), 
                    kycRiders: new Set(), 
                    loginRiders: new Set() 
                });
            }
            if (ids.length > 0) ids.forEach(id => clientMap.get(clientKey).loginRiders.add(id));
        });

        const cityStats = Array.from(cityMap.values())
            .filter(s => normalize(s.display) !== 'UNKNOWN')
            .map(s => {
                const kycCount = s.kycRiders.size;
                const loginCount = s.loginRiders.size;
                return { city: s.display, kycCount, loginCount, diff: kycCount - loginCount };
            })
            .sort((a, b) => b.kycCount - a.kycCount);

        const clientStats = Array.from(clientMap.values())
            .filter(s => normalizeClient(s.display) !== 'OTHER')
            .map(s => {
                const kycCount = s.kycRiders.size;
                const loginCount = s.loginRiders.size;
                return { client: s.display, kycCount, loginCount, diff: kycCount - loginCount };
            })
            .sort((a, b) => b.kycCount - a.kycCount);

        const totalKyc = riderList.filter(r => r.kycInPeriod).length;
        const totalLogin = riderList.filter(r => r.loginInPeriod).length;

        const riderStatsRaw = riderList
            .filter(r => r.kycInPeriod || r.loginInPeriod)
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
                    kyc: r.kycEver,
                    login: r.loginEver,
                    latestVehicleNumber: latestFleetVehicle || r.latestVehicleNumber || 'N/A'
                };
            });

        return {
            cityStats,
            clientStats,
            riderStatsRaw,
            totals: {
                kyc: totalKyc,
                login: totalLogin,
                diff: totalKyc - totalLogin,
                conversion: totalKyc > 0 ? ((totalLogin / totalKyc) * 100).toFixed(1) : 0
            }
        };
    }, [kycData, onboardingData, fleetData, dateRange]);

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
            'KYC Done': r.kyc ? 'YES' : 'NO',
            'Fresh Login': r.login ? 'YES' : 'NO',
            'Last Deployed Vehicle Number': r.latestVehicleNumber,
            'Overall Status': r.kyc && r.login ? 'Active' : (r.kyc ? 'Onboarded' : 'Pending KYC')
        }));
        
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Rider Breakdown");
        XLSX.writeFile(wb, `Rider_Analytics_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
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
                        <UserPlus size={24} style={{ color: 'var(--accent-blue)' }} />
                    </div>
                    <div>
                        <div className="label">Total Onboarded</div>
                        <div className="value">{processedData.totals.kyc}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between">
                        <LogIn size={24} style={{ color: 'var(--accent-green)' }} />
                        <span className="status-badge active">Fresh Logins</span>
                    </div>
                    <div>
                        <div className="label">Total Fresh Logins</div>
                        <div className="value">{processedData.totals.login}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between">
                        <TrendingUp size={24} style={{ color: 'var(--accent-red)' }} />
                    </div>
                    <div>
                        <div className="label">Total Dropout Gap</div>
                        <div className="value" style={{ color: 'var(--accent-red)' }}>{processedData.totals.diff}</div>
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
                                    <th style={{ textAlign: 'center' }}>Onboarding</th>
                                    <th style={{ textAlign: 'center' }}>FreshLogin</th>
                                    <th style={{ textAlign: 'center' }}>Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData.cityStats.map(stat => (
                                    <tr key={stat.city}>
                                        <td style={{ fontWeight: 600 }}>{stat.city}</td>
                                        <td style={{ textAlign: 'center' }}>{stat.kycCount}</td>
                                        <td style={{ textAlign: 'center' }}>{stat.loginCount}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className="status-badge return" style={{ fontSize: '0.85rem' }}>
                                                {stat.diff}
                                            </span>
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
                                    <th style={{ textAlign: 'center' }}>Onboarding</th>
                                    <th style={{ textAlign: 'center' }}>FreshLogin</th>
                                    <th style={{ textAlign: 'center' }}>Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData.clientStats.map(stat => (
                                    <tr key={stat.client}>
                                        <td style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{stat.client}</td>
                                        <td style={{ textAlign: 'center' }}>{stat.kycCount}</td>
                                        <td style={{ textAlign: 'center' }}>{stat.loginCount}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ color: stat.diff > 0 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 700 }}>
                                                {stat.diff > 0 ? `+${stat.diff}` : stat.diff}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

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
                                <th style={{ textAlign: 'center' }}>KYC Status</th>
                                <th style={{ textAlign: 'center' }}>Login Status</th>
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
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.kyc ? 
                                            <span style={{ color: 'var(--accent-green)' }}>● Done</span> : 
                                            <span style={{ color: 'var(--text-dim)' }}>○ Pending</span>
                                        }
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.login ? 
                                            <span style={{ color: 'var(--accent-green)' }}>● Done</span> : 
                                            <span style={{ color: 'var(--text-dim)' }}>○ Pending</span>
                                        }
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {rider.kyc && rider.login ? 
                                            <span className="status-badge active" style={{ fontSize: '0.8rem' }}>Complete</span> :
                                            rider.kyc ? 
                                            <span className="status-badge" style={{ fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)' }}>Onboarded</span> :
                                            <span className="status-badge return" style={{ fontSize: '0.8rem' }}>Login Only</span>
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
            `}} />
        </motion.div>
    );
};

export default OnboardingAnalytics;
