import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isWithinInterval, startOfDay, endOfDay, parse } from 'date-fns';
import {
    Users, UserPlus, LogIn, TrendingUp, Filter, Calendar, MapPin,
    Briefcase, ChevronDown, ChevronUp, Search, Activity
} from 'lucide-react';

const OnboardingAnalytics = ({ kycData, onboardingData, loading }) => {
    const [dateRange, setDateRange] = useState({
        start: format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [searchTerm, setSearchTerm] = useState('');

    const processedData = useMemo(() => {
        if (!kycData || !onboardingData) return { cityStats: [], clientStats: [], totals: {} };

        const parseDateFlexible = (d, itemMonth) => {
            if (!d) {
                if (itemMonth && itemMonth.toLowerCase().includes('apr')) return new Date(2026, 3, 15);
                if (itemMonth && itemMonth.toLowerCase().includes('mar')) return new Date(2026, 2, 15);
                return null;
            }

            const s = d.toString().trim();
            if (!s || s === 'null' || s === 'N/A') return null;

            // 0. Handle Excel Serial Dates (e.g., "46113")
            if (/^\d{5}$/.test(s) || (typeof d === 'number' && d > 40000)) {
                const serial = parseFloat(s);
                // Excel base date is Dec 30, 1899
                const date = new Date((serial - 25569) * 86400 * 1000);
                if (!isNaN(date.getTime())) return date;
            }

            // 1. Try ISO (yyyy-mm-dd)
            if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(s)) {
                const date = new Date(s);
                if (!isNaN(date.getTime())) return date;
            }

            // 2. Try dd/mm/yyyy
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

        const startDate = new Date(dateRange.start + 'T00:00:00');
        const endDate = new Date(dateRange.end + 'T23:59:59');

        const filterByName = (data, rangeStart, rangeEnd) => {
            return data.filter(item => {
                const date = parseDateFlexible(
                    item.deployment_date || item.date_record || item.created_at || item.timestamp,
                    item.month
                );
                return date && date >= rangeStart && date <= rangeEnd;
            });
        };

        const filteredKyc = filterByName(kycData, startDate, endDate);
        const filteredOnboarding = filterByName(onboardingData, startDate, endDate);

        // Normalized Mapping
        const cityMap = new Map();
        const normalize = (str) => {
            const s = (str || 'Unknown').toString().trim().toUpperCase();
            if (s === 'BANGALORE') return 'BENGALURU';
            return s;
        };
        const toDisplay = (str) => {
            const s = str.toLowerCase();
            return s.charAt(0).toUpperCase() + s.slice(1);
        };

        const getUniqueId = (item, idFields) => {
            for (const f of idFields) {
                const val = (item[f] || '').toString().trim().toLowerCase();
                if (val && val.length > 2 && val !== 'null' && val !== 'n/a' && val !== 'nan') return val;
            }
            return null;
        };

        filteredKyc.forEach(item => {
            const cityKey = normalize(item.city);
            if (!cityMap.has(cityKey)) cityMap.set(cityKey, { display: toDisplay(item.city || 'Unknown'), kycRiders: new Set(), loginRiders: new Set() });
            const rid = getUniqueId(item, ['rider_id', 'rider_mobile_number', 'pan_number', 'aadhar_number']);
            if (rid) cityMap.get(cityKey).kycRiders.add(rid);
        });

        filteredOnboarding.forEach(item => {
            const cityKey = normalize(item.city);
            if (!cityMap.has(cityKey)) cityMap.set(cityKey, { display: toDisplay(item.city || 'Unknown'), kycRiders: new Set(), loginRiders: new Set() });
            const rid = getUniqueId(item, ['rider_id_details', 'rider_mobile_number']);
            if (rid) cityMap.get(cityKey).loginRiders.add(rid);
        });

        // Advanced cross-referencing maps
        const riderToClientMap = new Map();
        const sourceToClientMap = new Map();
        
        onboardingData.forEach(item => {
            const rid = getUniqueId(item, ['rider_id_details', 'rider_mobile_number']);
            const cl = item.client && item.client !== 'null' ? item.client : null;
            if (rid && cl) riderToClientMap.set(rid, cl);
            if (item.source_name && cl) sourceToClientMap.set(item.source_name, cl);
        });

        const clientMap = new Map();
        const normalizeClient = (str) => {
            const s = (str || 'Other').toString().trim().toUpperCase();
            if (s === 'BB' || s === 'BB NOW' || s === 'BIGBASKET' || s === 'BIG BASKET') return 'BIGBASKET';
            return s;
        };

        filteredKyc.forEach(item => {
            const rid = getUniqueId(item, ['rider_id', 'rider_mobile_number', 'pan_number', 'aadhar_number']);
            
            // Priority for client attribution:
            // 1. Direct record client
            // 2. Rider ID match (from any FreshLogin record)
            // 3. Source Name match (proxy for client)
            let clientRaw = (item.client && item.client !== 'null') ? item.client : null;
            if (!clientRaw && rid) clientRaw = riderToClientMap.get(rid);
            if (!clientRaw && item.source_name) clientRaw = sourceToClientMap.get(item.source_name);
            
            clientRaw = clientRaw || 'Other';
            const clientKey = normalizeClient(clientRaw);
            
            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { 
                    display: (clientKey === 'BIGBASKET') ? 'Bigbasket' : (clientRaw === 'Other' ? 'Other' : clientRaw), 
                    kycRiders: new Set(), 
                    loginRiders: new Set() 
                });
            }
            if (rid) clientMap.get(clientKey).kycRiders.add(rid);
        });

        filteredOnboarding.forEach(item => {
            const clientRaw = (item.client || 'Other').toString().trim();
            const clientKey = normalizeClient(clientRaw);
            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { 
                    display: (clientKey === 'BIGBASKET') ? 'Bigbasket' : clientRaw, 
                    kycRiders: new Set(), 
                    loginRiders: new Set() 
                });
            }
            const rid = getUniqueId(item, ['rider_id_details', 'rider_mobile_number']);
            if (rid) clientMap.get(clientKey).loginRiders.add(rid);
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

        const totalKyc = new Set(filteredKyc.map(i => getUniqueId(i, ['rider_id', 'rider_mobile_number', 'pan_number', 'aadhar_number'])).filter(Boolean)).size;
        const totalLogin = new Set(filteredOnboarding.map(i => getUniqueId(i, ['rider_id_details', 'rider_mobile_number'])).filter(Boolean)).size;

        return {
            cityStats,
            clientStats,
            totals: {
                kyc: totalKyc,
                login: totalLogin,
                diff: totalKyc - totalLogin,
                conversion: totalKyc > 0 ? ((totalLogin / totalKyc) * 100).toFixed(1) : 0
            }
        };
    }, [kycData, onboardingData, dateRange]);

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
