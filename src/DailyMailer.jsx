import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, subDays, subMonths, parse, isValid } from 'date-fns';
import { 
    Mail, Calendar, MapPin, Briefcase, TrendingUp, 
    TrendingDown, Users, Package, ChevronRight, Copy, Check, Download, Activity, ChevronDown,
    ArrowUpRight, ArrowDownRight, UserPlus
} from 'lucide-react';

// Reliable date parser for DD/MM/YYYY
const parseCustomDate = (str) => {
    if (!str || str === 'null') return null;
    try {
        const parts = str.toString().split('/');
        if (parts.length === 3) {
            const d = new Date(parts[2], parts[1] - 1, parts[0]);
            return isValid(d) ? d : null;
        }
        const d = new Date(str);
        return isValid(d) ? d : null;
    } catch (e) { return null; }
};

const DailyMailer = ({ riderData, loading }) => {
    // Default to Yesterday (D-1) as requested
    const [selectedDate, setSelectedDate] = useState(() => {
        return format(subDays(new Date(), 1), 'yyyy-MM-dd');
    });
    const [viewType, setViewType] = useState('city');
    const [copied, setCopied] = useState(false);
    const [selectedClients, setSelectedClients] = useState(['ALL']);
    const [selectedCities, setSelectedCities] = useState(['ALL']);
    const [openDropdown, setOpenDropdown] = useState(null); // 'client' or 'city'

    // Get unique metadata for filters
    const filterMetadata = useMemo(() => {
        if (!riderData) return { clients: [], cities: [] };
        const clients = new Set();
        const cities = new Set();
        riderData.forEach(r => {
            if (r.client && r.client !== 'null') clients.add(r.client);
            if (r.city && r.city !== 'null') cities.add(r.city);
        });
        return {
            clients: Array.from(clients).sort(),
            cities: Array.from(cities).sort()
        };
    }, [riderData]);

    const processed = useMemo(() => {
        if (!riderData || !Array.isArray(riderData)) return { stats: [], totals: { today: 0, tRiders: 0, new: 0, mOrders: 0, mRiders: 0, mNew: 0, lwOrders: 0, lwRiders: 0, lwNew: 0, lmOrders: 0, lmRiders: 0, lmNew: 0 } };

        try {
            const targetDateObj = new Date(selectedDate);
            if (!isValid(targetDateObj)) return { stats: [], totals: { today: 0, tRiders: 0, new: 0, mOrders: 0, mRiders: 0, mNew: 0, lwOrders: 0, lwRiders: 0, lwNew: 0, lmOrders: 0, lmRiders: 0, lmNew: 0 } };

            const targetStr = format(targetDateObj, 'yyyy-MM-dd');
            const lwStr = format(subDays(targetDateObj, 7), 'yyyy-MM-dd');
            const lmStr = format(subMonths(targetDateObj, 1), 'yyyy-MM-dd');
            const targetMonth = targetDateObj.getMonth();
            const targetYear = targetDateObj.getFullYear();

            const firstOrderMap = new Map();
            const groups = new Map();

            // All riders global map for 'New Rider' detection
            riderData.forEach(r => {
                if (!r.worker_code) return;
                const d = parseCustomDate(r.date_record);
                if (!d) return;
                const dateKey = format(d, 'yyyy-MM-dd');
                const existing = firstOrderMap.get(r.worker_code);
                if (!existing || dateKey < existing) {
                    firstOrderMap.set(r.worker_code, dateKey);
                }
            });

            // Filter data by selected clients AND cities
            const filteredData = riderData.filter(item => {
                const clientMatch = selectedClients.includes('ALL') || selectedClients.includes(item.client);
                const cityMatch = selectedCities.includes('ALL') || selectedCities.includes(item.city);
                return clientMatch && cityMatch;
            });

            // Aggregation pass
            filteredData.forEach(item => {
                const d = parseCustomDate(item.date_record);
                if (!d) return;
                const dateKey = format(d, 'yyyy-MM-dd');
                const riderFirstDate = firstOrderMap.get(item.worker_code);
                
                const isToday = dateKey === targetStr;
                const isLW = dateKey === lwStr;
                const isLM = dateKey === lmStr;
                const inMonth = d.getMonth() === targetMonth && d.getFullYear() === targetYear && d <= targetDateObj;

                if (!isToday && !inMonth && !isLW && !isLM) return;

                const name = (viewType === 'city' ? item.city : item.client) || 'Other';
                if (!groups.has(name)) {
                    groups.set(name, { 
                        name, today: 0, tRiders: new Set(), todayNew: new Set(),
                        mOrders: 0, mRiders: new Set(), mNew: new Set(),
                        lwOrders: 0, lwRiders: new Set(), lwNew: new Set(),
                        lmOrders: 0, lmRiders: new Set(), lmNew: new Set()
                    });
                }

                const g = groups.get(name);
                const amt = parseFloat(item.delivered || 0);

                if (isToday) {
                    g.today += amt;
                    g.tRiders.add(item.worker_code);
                    if (riderFirstDate === targetStr) g.todayNew.add(item.worker_code);
                }
                if (inMonth) {
                    g.mOrders += amt;
                    g.mRiders.add(item.worker_code);
                    // Check if rider's absolute first day was in this month (MTD new)
                    const fd = parseCustomDate(riderFirstDate);
                    if (fd && fd.getMonth() === targetMonth && fd.getFullYear() === targetYear) {
                        g.mNew.add(item.worker_code);
                    }
                }
                if (isLW) {
                    g.lwOrders += amt;
                    g.lwRiders.add(item.worker_code);
                    if (riderFirstDate === lwStr) g.lwNew.add(item.worker_code);
                }
                if (isLM) {
                    g.lmOrders += amt;
                    g.lmRiders.add(item.worker_code);
                    if (riderFirstDate === lmStr) g.lmNew.add(item.worker_code);
                }
            });

            const globalSets = { 
                todayR: new Set(), todayN: new Set(), 
                monthR: new Set(), monthN: new Set(),
                lwR: new Set(), lwN: new Set(),
                lmR: new Set(), lmN: new Set() 
            };
            
            const stats = Array.from(groups.values())
                .map(g => {
                    const res = { 
                        ...g, 
                        tRCount: g.tRiders.size, tNCount: g.todayNew.size,
                        mRCount: g.mRiders.size, mNCount: g.mNew.size,
                        lwRCount: g.lwRiders.size, lwNCount: g.lwNew.size,
                        lmRCount: g.lmRiders.size, lmNCount: g.lmNew.size
                    };
                    g.tRiders.forEach(r => globalSets.todayR.add(r));
                    g.todayNew.forEach(r => globalSets.todayN.add(r));
                    g.mRiders.forEach(r => globalSets.monthR.add(r));
                    g.mNew.forEach(r => globalSets.monthN.add(r));
                    g.lwRiders.forEach(r => globalSets.lwR.add(r));
                    g.lwNew.forEach(r => globalSets.lwN.add(r));
                    g.lmRiders.forEach(r => globalSets.lmR.add(r));
                    g.lmNew.forEach(r => globalSets.lmN.add(r));
                    return res;
                })
                .sort((a, b) => b.today - a.today);

            const totals = {
                today: stats.reduce((acc, curr) => acc + curr.today, 0),
                tRiders: globalSets.todayR.size,
                new: globalSets.todayN.size,
                mOrders: stats.reduce((acc, curr) => acc + curr.mOrders, 0),
                mRiders: globalSets.monthR.size,
                mNew: globalSets.monthN.size,
                lwOrders: stats.reduce((acc, curr) => acc + curr.lwOrders, 0),
                lwRiders: globalSets.lwR.size,
                lwNew: globalSets.lwN.size,
                lmOrders: stats.reduce((acc, curr) => acc + curr.lmOrders, 0),
                lmRiders: globalSets.lmR.size,
                lmNew: globalSets.lmN.size
            };

            // Calculate Variances for Trend
            totals.varOrders = totals.lwOrders > 0 ? ((totals.today - totals.lwOrders) / totals.lwOrders) * 100 : 0;
            totals.varRiders = totals.lwRiders > 0 ? ((totals.tRiders - totals.lwRiders) / totals.lwRiders) * 100 : 0;

            return { stats, totals };
        } catch (err) {
            console.error("DailyMailer logic error:", err);
            return { stats: [], totals: { today: 0, tRiders: 0, new: 0, mOrders: 0, mRiders: 0, mNew: 0, lwOrders: 0, lwRiders: 0, lwNew: 0, lmOrders: 0, lmRiders: 0, lmNew: 0, varOrders: 0, varRiders: 0 } };
        }
    }, [riderData, selectedDate, viewType, selectedClients, selectedCities]);

    const toggleFilter = (type, value) => {
        const current = type === 'client' ? selectedClients : selectedCities;
        const setter = type === 'client' ? setSelectedClients : setSelectedCities;

        if (value === 'ALL') {
            setter(['ALL']);
            return;
        }
        let updated = current.filter(c => c !== 'ALL');
        if (updated.includes(value)) {
            updated = updated.filter(c => c !== value);
            if (updated.length === 0) updated = ['ALL'];
        } else {
            updated.push(value);
        }
        setter(updated);
    };

    const handleCopy = () => {
        const text = `Daily Performance Matrix - ${selectedDate}\n` +
            `Filters: ${selectedClients.join(',')} | ${selectedCities.join(',')}\n\n` +
            `Name\tT-O\tT-R\tT-N\tM-O\tM-R\tM-N\tLW-O\tLW-R\tLW-N\tLM-O\tLM-R\tLM-N\n` +
            processed.stats.map(s => {
                return `${s.name}\t${s.today}\t${s.tRCount}\t${s.tNCount}\t${s.mOrders}\t${s.mRCount}\t${s.mNCount}\t${s.lwOrders}\t${s.lwRCount}\t${s.lwNCount}\t${s.lmOrders}\t${s.lmRCount}\t${s.lmNCount}`;
            }).join('\n');
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Daily Performance Mailer</h1>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <span className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-blue)' }}>D-1 Performance</span>
                    </div>
                </div>
                <div className="flex-gap" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {/* City Multi-Select */}
                    <div style={{ position: 'relative' }}>
                        <button 
                            onClick={() => setOpenDropdown(openDropdown === 'city' ? null : 'city')}
                            className="glass" 
                            style={{ 
                                padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px', cursor: 'pointer', minWidth: '160px', justifyContent: 'space-between'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <MapPin size={16} className="text-primary" />
                                <span style={{ fontSize: '0.9rem' }}>
                                    {selectedCities.includes('ALL') ? 'All Cities' : `${selectedCities.length} Cities`}
                                </span>
                            </div>
                            <ChevronDown size={16} />
                        </button>
                        {openDropdown === 'city' && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass dropdown-menu">
                                <div className={`dropdown-item ${selectedCities.includes('ALL') ? 'active' : ''}`} onClick={() => toggleFilter('city', 'ALL')}>Select All</div>
                                <div className="dropdown-divider" />
                                {filterMetadata.cities.map(city => (
                                    <div key={city} className={`dropdown-item ${selectedCities.includes(city) ? 'active' : ''}`} onClick={() => toggleFilter('city', city)}>
                                        {city} {selectedCities.includes(city) && <Check size={14} />}
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </div>

                    {/* Client Multi-Select */}
                    <div style={{ position: 'relative' }}>
                        <button 
                            onClick={() => setOpenDropdown(openDropdown === 'client' ? null : 'client')}
                            className="glass" 
                            style={{ 
                                padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                color: '#fff', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px', cursor: 'pointer', minWidth: '160px', justifyContent: 'space-between'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Briefcase size={16} className="text-secondary" />
                                <span style={{ fontSize: '0.9rem' }}>
                                    {selectedClients.includes('ALL') ? 'All Clients' : `${selectedClients.length} Clients`}
                                </span>
                            </div>
                            <ChevronDown size={16} />
                        </button>
                        {openDropdown === 'client' && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass dropdown-menu">
                                <div className={`dropdown-item ${selectedClients.includes('ALL') ? 'active' : ''}`} onClick={() => toggleFilter('client', 'ALL')}>Select All</div>
                                <div className="dropdown-divider" />
                                {filterMetadata.clients.map(client => (
                                    <div key={client} className={`dropdown-item ${selectedClients.includes(client) ? 'active' : ''}`} onClick={() => toggleFilter('client', client)}>
                                        {client} {selectedClients.includes(client) && <Check size={14} />}
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </div>

                    <div className="view-toggle glass" style={{ padding: '0.25rem' }}>
                        <button className={viewType === 'city' ? 'active' : ''} onClick={() => setViewType('city')}>City</button>
                        <button className={viewType === 'client' ? 'active' : ''} onClick={() => setViewType('client')}>Client</button>
                    </div>
                    <div className="glass" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Calendar size={18} className="text-primary" />
                        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="date-input" style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none' }} />
                    </div>
                    <button className="btn-export" onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary-color)', color: '#fff', border: 'none', padding: '0.6rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? 'Copied' : 'Copy Report'}
                    </button>
                </div>
            </header>

            <section className="stats-grid">
                <div className="stat-card glass">
                    <div className="flex-between" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                        <Package size={20} style={{ color: 'var(--accent-blue)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: processed.totals.varOrders >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {processed.totals.varOrders >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            {Math.abs(processed.totals.varOrders).toFixed(1)}% vs LW
                        </div>
                    </div>
                    <div>
                        <div className="label">Total Orders</div>
                        <div className="value">{processed.totals.today.toLocaleString()}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                        <Users size={20} style={{ color: 'var(--accent-purple)' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: processed.totals.varRiders >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {processed.totals.varRiders >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            {Math.abs(processed.totals.varRiders).toFixed(1)}% vs LW
                        </div>
                    </div>
                    <div>
                        <div className="label">Active Riders</div>
                        <div className="value">{processed.totals.tRiders.toLocaleString()}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                        <UserPlus size={20} style={{ color: 'var(--accent-green)' }} />
                        <span className="status-badge" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--accent-green)', fontSize: '0.7rem' }}>New Joiners</span>
                    </div>
                    <div>
                        <div className="label">Today New Riders</div>
                        <div className="value">{processed.totals.new.toLocaleString()}</div>
                    </div>
                </div>

                <div className="stat-card glass">
                    <div className="flex-between" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                        <TrendingUp size={20} style={{ color: '#ff7eb3' }} />
                        <span className="status-badge" style={{ background: 'rgba(255, 126, 179, 0.1)', color: '#ff7eb3', fontSize: '0.7rem' }}>Monthly Goal</span>
                    </div>
                    <div>
                        <div className="label">MTD Total Orders</div>
                        <div className="value">{processed.totals.mOrders.toLocaleString()}</div>
                    </div>
                </div>
            </section>

            <div className="table-card glass" style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                <div className="table-container">
                    <table style={{ fontSize: '0.75rem', width: '100%', minWidth: '1400px', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                <th rowSpan="2" style={{ textAlign: 'left', minWidth: '150px', borderRight: '1px solid rgba(255,255,255,0.1)' }}>{viewType === 'city' ? 'City' : 'Client'}</th>
                                <th colSpan="3" style={{ textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)', color: 'var(--accent-blue)' }}>TODAY (D-1)</th>
                                <th colSpan="3" style={{ textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)', color: 'var(--accent-purple)', background: 'rgba(59, 130, 246, 0.05)' }}>MONTH MTD</th>
                                <th colSpan="3" style={{ textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)', color: 'var(--accent-green)' }}>LW SAME DAY</th>
                                <th colSpan="3" style={{ textAlign: 'center', color: '#ff7eb3' }}>LM SAME DATE</th>
                            </tr>
                            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Orders</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total R</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.1)' }}>New</th>
                                
                                <th style={{ textAlign: 'right', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.03)' }}>Orders</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.03)' }}>Total R</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.03)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>New</th>
                                
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Orders</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total R</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.1)' }}>New</th>
                                
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Orders</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total R</th>
                                <th style={{ textAlign: 'right', padding: '0.5rem' }}>New</th>
                            </tr>
                        </thead>
                        <tbody>
                            {processed.stats.length > 0 ? (
                                <>
                                    {/* Grand Total Row - Only shown if more than one item */}
                                    {processed.stats.length > 1 && (
                                        <tr style={{ background: 'rgba(255, 215, 0, 0.05)', borderBottom: '2px solid rgba(255, 215, 0, 0.2)' }}>
                                            <td style={{ fontWeight: 800, padding: '0.75rem', borderRight: '1px solid rgba(255,255,255,0.1)', color: '#ffd700' }}>GRAND TOTAL</td>
                                            
                                            <td style={{ textAlign: 'right', fontWeight: 800, color: '#fff' }}>{processed.totals.today.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-dim)' }}>{processed.totals.tRiders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 800, borderRight: '1px solid rgba(255,255,255,0.1)' }}>{processed.totals.new.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: 'var(--accent-purple)', fontWeight: 800, background: 'rgba(59, 130, 246, 0.05)' }}>{processed.totals.mOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)', background: 'rgba(59, 130, 246, 0.05)' }}>{processed.totals.mRiders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-purple)', background: 'rgba(59, 130, 246, 0.05)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>{processed.totals.mNew.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: 'var(--accent-green)', fontWeight: 800 }}>{processed.totals.lwOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{processed.totals.lwRiders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-green)', fontWeight: 800, borderRight: '1px solid rgba(255,255,255,0.1)' }}>{processed.totals.lwNew.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: '#ff7eb3', fontWeight: 800 }}>{processed.totals.lmOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{processed.totals.lmRiders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: '#ff7eb3', fontWeight: 800 }}>{processed.totals.lmNew.toLocaleString()}</td>
                                        </tr>
                                    )}
                                    
                                    {processed.stats.map((s, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ fontWeight: 600, padding: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.1)' }}>{s.name}</td>
                                            
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{s.today.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{s.tRCount.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 600, borderRight: '1px solid rgba(255,255,255,0.1)' }}>{s.tNCount.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: 'var(--accent-purple)', fontWeight: 600, background: 'rgba(59, 130, 246, 0.03)' }}>{s.mOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)', background: 'rgba(59, 130, 246, 0.03)' }}>{s.mRCount.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-purple)', background: 'rgba(59, 130, 246, 0.03)', borderRight: '1px solid rgba(255,255,255,0.1)' }}>{s.mNCount.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>{s.lwOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{s.lwRCount.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--accent-green)', fontWeight: 600, borderRight: '1px solid rgba(255,255,255,0.1)' }}>{s.lwNCount.toLocaleString()}</td>
                                            
                                            <td style={{ textAlign: 'right', color: '#ff7eb3' }}>{s.lmOrders.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{s.lmRCount.toLocaleString()}</td>
                                            <td style={{ textAlign: 'right', color: '#ff7eb3', fontWeight: 600 }}>{s.lmNCount.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </>
                            ) : (
                                <tr>
                                    <td colSpan="13" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                                        No data matching selected filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                .dropdown-menu {
                    position: absolute; top: 110%; left: 0; width: 240px; 
                    max-height: 300px; overflow-y: auto; z-index: 100; padding: 0.5rem;
                    background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 0 10px 25px rgba(0,0,0,0.5); border-radius: 8px;
                }
                .dropdown-divider { height: 1px; background: rgba(255,255,255,0.1); margin: 0.5rem 0; }
                .dropdown-item { 
                    padding: 0.5rem; cursor: pointer; border-radius: 4px; fontSize: 0.85rem; 
                    display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;
                }
                .dropdown-item:hover { background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); }
                .dropdown-item.active { background: rgba(59, 130, 246, 0.2); color: #fff; font-weight: 600; }
                .view-toggle button {
                    background: transparent; border: none; color: var(--text-dim);
                    padding: 0.4rem 1rem; border-radius: 6px; cursor: pointer;
                    font-weight: 600; font-size: 0.85rem; transition: all 0.2s;
                }
                .view-toggle button.active {
                    background: var(--primary-color); color: #fff;
                }
                .date-input::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
                .dropdown-menu::-webkit-scrollbar { width: 4px; }
                .dropdown-menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
            `}} />
        </motion.div>
    );
};

export default DailyMailer;
