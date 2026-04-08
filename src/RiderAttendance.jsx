import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import { Layout, Users, ClipboardList, MapPin, Briefcase, Filter, Calendar, Search, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';

const MultiSelect = ({ options, selectedValues, onChange, label, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const filteredOptions = options.filter(opt => 
        opt.toLowerCase().includes(searchTerm.toLowerCase()) && opt !== 'All'
    );

    const toggleOption = (opt) => {
        if (selectedValues.includes(opt)) {
            onChange(selectedValues.filter(v => v !== opt));
        } else {
            onChange([...selectedValues, opt]);
        }
    };

    return (
        <div className="filter-group" style={{ position: 'relative' }}>
            <label className="filter-label">{label}</label>
            <div 
                className="select-trigger glass" 
                onClick={() => setIsOpen(!isOpen)}
                style={{ 
                    padding: '0.6rem 1rem', 
                    borderRadius: '0.5rem', 
                    cursor: 'pointer', 
                    minWidth: '200px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-color)',
                    color: '#fff'
                }}
            >
                <span style={{ fontSize: '0.9rem', color: selectedValues.length ? '#fff' : 'var(--text-dim)' }}>
                    {selectedValues.length === 0 ? placeholder : 
                     selectedValues.length === options.length - 1 ? `All ${label}s` :
                     `${selectedValues.length} Selected`}
                </span>
                <Filter size={14} />
            </div>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div 
                            style={{ position: 'fixed', inset: 0, zIndex: 998 }} 
                            onClick={() => setIsOpen(false)} 
                        />
                        <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            style={{ 
                                position: 'absolute', 
                                top: '100%', 
                                left: 0, 
                                marginTop: '0.5rem',
                                width: '250px',
                                maxHeight: '300px',
                                overflowY: 'auto',
                                zIndex: 999,
                                background: 'var(--bg-dark)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '0.75rem',
                                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
                                padding: '0.5rem'
                            }}
                        >
                            <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                                <input 
                                    type="text" 
                                    placeholder={`Search ${label}...`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                        width: '100%',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '6px',
                                        padding: '0.4rem 0.6rem 0.4rem 2rem',
                                        color: '#fff',
                                        fontSize: '0.85rem'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onChange(options.filter(o => o !== 'All')); }}
                                    style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                                >Select All</button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onChange([]); }}
                                    style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}
                                >Clear</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {filteredOptions.map(opt => (
                                    <div 
                                        key={opt}
                                        onClick={(e) => { e.stopPropagation(); toggleOption(opt); }}
                                        style={{ 
                                            padding: '0.5rem', 
                                            borderRadius: '6px', 
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            background: selectedValues.includes(opt) ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                                            transition: 'background 0.2s'
                                        }}
                                    >
                                        <div style={{ 
                                            width: '16px', 
                                            height: '16px', 
                                            border: '1px solid var(--border-color)', 
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: selectedValues.includes(opt) ? 'var(--primary)' : 'transparent'
                                        }}>
                                            {selectedValues.includes(opt) && <Check size={12} color="#fff" />}
                                        </div>
                                        <span style={{ fontSize: '0.85rem', color: selectedValues.includes(opt) ? '#fff' : 'var(--text-dim)' }}>{opt}</span>
                                    </div>
                                ))}
                                {filteredOptions.length === 0 && <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>No items found</div>}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

const RiderAttendance = ({ riderData, loading }) => {
    const [activeTab, setActiveTab] = useState('summary');
    const [selectedWeek, setSelectedWeek] = useState('All');
    const [selectedStates, setSelectedStates] = useState([]);
    const [selectedMonth, setSelectedMonth] = useState('All');
    const [detailFilter, setDetailFilter] = useState(null);

    const handleCellClick = (type, rowKey, colKey) => {
        setDetailFilter({ type, rowKey, colKey });
        setActiveTab('detailed');
    };

    const weeks = useMemo(() => {
        const set = new Set(riderData.map(r => r.week).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [riderData]);

    const states = useMemo(() => {
        const set = new Set(riderData.map(r => r.state).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [riderData]);

    const months = useMemo(() => {
        const set = new Set(riderData.map(r => r.month).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [riderData]);

    const processedData = useMemo(() => {
        if (loading) return [];

        const now = new Date();
        now.setHours(0,0,0,0);
        const riderMap = new Map();

        // Filter by week, states, and month
        const filtered = riderData.filter(r => {
            if (selectedWeek !== 'All' && r.week !== selectedWeek) return false;
            if (selectedStates.length > 0 && !selectedStates.includes(r.state)) return false;
            if (selectedMonth !== 'All' && r.month !== selectedMonth) return false;
            return true;
        });

        // Find latest activity for each worker
        filtered.forEach(r => {
            const delivered = parseInt(r.delivered || 0, 10);
            if (delivered <= 0) return;

            const current = riderMap.get(r.worker_code) || { 
                latestDate: new Date(0), 
                state: r.state, 
                client: r.client, 
                source: r.source 
            };

            let d;
            const dateStr = r.date_record;
            if (dateStr?.includes('/')) {
                const [dd, mm, yPart] = dateStr.split('/');
                const yyyy = yPart ? yPart.split(' ')[0] : '2026';
                d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
            } else {
                d = new Date(dateStr);
            }

            if (d && !isNaN(d.getTime()) && d > current.latestDate) {
                current.latestDate = d;
                current.state = r.state;
                current.client = r.client;
                current.source = r.source;
            }
            riderMap.set(r.worker_code, current);
        });

        // Assign buckets
        const statuses = [];
        riderMap.forEach((val, key) => {
            const diffTime = Math.abs(now - val.latestDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            let status = 'Active';
            if (diffDays > 15) status = '15+ days inactive';
            else if (diffDays > 10) status = '10+ days inactive';
            else if (diffDays > 7) status = '7+ days inactive';
            else if (diffDays > 5) status = '5+ days inactive';
            else if (diffDays > 3) status = '3+ days inactive';
            else status = 'Active';

            statuses.push({ ...val, worker_code: key, status });
        });

        return statuses;
    }, [riderData, selectedWeek, selectedStates, selectedMonth, loading]);

    const pivotData = useMemo(() => {
        const statePivot = {};
        const clientPivot = {};
        const sourcePivot = {};

        const statusOrder = ['10+ days inactive', '15+ days inactive', '3+ days inactive', '5+ days inactive', '7+ days inactive', 'Active'];
        const allStates = new Set();
        const allClients = new Set();
        const allSources = new Set();

        processedData.forEach(item => {
            const { state, client, source, status } = item;
            if (state) allStates.add(state);
            if (client) allClients.add(client);
            if (source) allSources.add(source);

            // State Pivot Logic
            if (!statePivot[status]) statePivot[status] = {};
            statePivot[status][state || 'Unknown'] = (statePivot[status][state || 'Unknown'] || 0) + 1;

            // Client Pivot Logic
            if (!clientPivot[status]) clientPivot[status] = {};
            clientPivot[status][client || 'Unknown'] = (clientPivot[status][client || 'Unknown'] || 0) + 1;

            // Source Pivot Logic
            if (!sourcePivot[source || 'Unknown']) sourcePivot[source || 'Unknown'] = {};
            sourcePivot[source || 'Unknown'][status] = (sourcePivot[source || 'Unknown'][status] || 0) + 1;
        });

        return {
            statePivot,
            clientPivot,
            sourcePivot,
            statusOrder,
            allStates: Array.from(allStates).sort(),
            allClients: Array.from(allClients).sort(),
            allSources: Array.from(allSources).sort()
        };
    }, [processedData]);

    if (loading) return (
        <div className="loading-container">
            <span className="loader"></span>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Rider Attendance</h1>
                    <p style={{ color: 'var(--text-dim)' }}>Performance & Inactivity Monitoring</p>
                </div>
            </header>

            <div className="tabs-container">
                <div className={`tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>Summary</div>
                <div className={`tab ${activeTab === 'detailed' ? 'active' : ''}`} onClick={() => setActiveTab('detailed')}>Detailed SOP View</div>
            </div>

            {activeTab === 'summary' && (
                <>
                    <div className="filters-container">
                        <div className="filter-group">
                            <label className="filter-label">Select Month</label>
                            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
                                {months.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div className="filter-group">
                            <label className="filter-label">Select Week</label>
                            <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)}>
                                {weeks.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                        </div>
                        <MultiSelect 
                            label="State"
                            placeholder="Select States"
                            options={states}
                            selectedValues={selectedStates}
                            onChange={setSelectedStates}
                        />
                    </div>

                    <div className="attendance-grid">
                        {/* State Wise Pivot */}
                        <div className="table-card glass">
                            <div className="table-header"><h3>State Wise Status</h3></div>
                            <div className="pivot-table-container">
                                <table className="pivot-table">
                                    <thead>
                                        <tr>
                                            <th>Status</th>
                                            {pivotData.allStates.map(s => <th key={s}>{s}</th>)}
                                            <th className="grand-total">Grand Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pivotData.statusOrder.map(status => {
                                            let rowTotal = 0;
                                            return (
                                                <tr key={status}>
                                                    <td>{status}</td>
                                                    {pivotData.allStates.map(s => {
                                                        const val = pivotData.statePivot[status]?.[s] || 0;
                                                        rowTotal += val;
                                                        return (
                                                            <td 
                                                                key={s} 
                                                                onClick={() => val > 0 && handleCellClick('state', status, s)}
                                                                style={{ cursor: val > 0 ? 'pointer' : 'default', color: val > 0 ? 'var(--primary)' : 'inherit' }}
                                                            >
                                                                {val || ''}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="grand-total">{rowTotal}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Client Wise Pivot */}
                        <div className="table-card glass">
                            <div className="table-header"><h3>Client Wise Status</h3></div>
                            <div className="pivot-table-container">
                                <table className="pivot-table">
                                    <thead>
                                        <tr>
                                            <th>Status</th>
                                            {pivotData.allClients.map(c => <th key={c}>{c}</th>)}
                                            <th className="grand-total">Grand Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pivotData.statusOrder.map(status => {
                                            let rowTotal = 0;
                                            return (
                                                <tr key={status}>
                                                    <td>{status}</td>
                                                    {pivotData.allClients.map(c => {
                                                        const val = pivotData.clientPivot[status]?.[c] || 0;
                                                        rowTotal += val;
                                                        return (
                                                            <td 
                                                                key={c}
                                                                onClick={() => val > 0 && handleCellClick('client', status, c)}
                                                                style={{ cursor: val > 0 ? 'pointer' : 'default', color: val > 0 ? 'var(--primary)' : 'inherit' }}
                                                            >
                                                                {val || ''}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="grand-total">{rowTotal}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Source Wise Pivot */}
                        <div className="table-card glass">
                            <div className="table-header"><h3>Source Wise Status</h3></div>
                            <div className="pivot-table-container">
                                <table className="pivot-table">
                                    <thead>
                                        <tr>
                                            <th>Source</th>
                                            {pivotData.statusOrder.map(s => <th key={s}>{s}</th>)}
                                            <th className="grand-total">Grand Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pivotData.allSources.map(source => {
                                            let rowTotal = 0;
                                            return (
                                                <tr key={source}>
                                                    <td>{source}</td>
                                                    {pivotData.statusOrder.map(s => {
                                                        const val = pivotData.sourcePivot[source]?.[s] || 0;
                                                        rowTotal += val;
                                                        return (
                                                            <td 
                                                                key={s}
                                                                onClick={() => val > 0 && handleCellClick('source', source, s)}
                                                                style={{ cursor: val > 0 ? 'pointer' : 'default', color: val > 0 ? 'var(--primary)' : 'inherit' }}
                                                            >
                                                                {val || ''}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="grand-total">{rowTotal}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'detailed' && (
                <div className="table-card glass" style={{ marginTop: '1rem' }}>
                    <div className="table-header">
                        <div>
                            <h3>Detailed SOP Listing</h3>
                            {detailFilter && (
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                                    Filtering by: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                                        {detailFilter.type === 'source' 
                                            ? `${detailFilter.rowKey} → ${detailFilter.colKey}` 
                                            : `${detailFilter.colKey} → ${detailFilter.rowKey}`}
                                    </span>
                                </p>
                            )}
                        </div>
                        <button 
                            className="glass" 
                            style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                            onClick={() => setDetailFilter(null)}
                        >
                            <X size={16} /> Clear Drill-down
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Worker Code</th>
                                    <th>State</th>
                                    <th>Client</th>
                                    <th>Source</th>
                                    <th>Status</th>
                                    <th>Last Active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {processedData
                                    .filter(item => {
                                        if (!detailFilter) return true;
                                        if (detailFilter.type === 'state') return item.state === detailFilter.colKey && item.status === detailFilter.rowKey;
                                        if (detailFilter.type === 'client') return item.client === detailFilter.colKey && item.status === detailFilter.rowKey;
                                        if (detailFilter.type === 'source') return item.source === detailFilter.rowKey && item.status === detailFilter.colKey;
                                        return true;
                                    })
                                    .map((rider) => (
                                        <tr key={rider.worker_code}>
                                            <td style={{ fontWeight: 600 }}>{rider.worker_code}</td>
                                            <td>{rider.state}</td>
                                            <td>{rider.client}</td>
                                            <td>{rider.source || 'N/A'}</td>
                                            <td>
                                                <span className={`status-badge ${rider.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                                    {rider.status}
                                                </span>
                                            </td>
                                            <td>{rider.latestDate ? format(rider.latestDate, 'dd/MM/yyyy') : 'N/A'}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </motion.div>
    );
};

export default RiderAttendance;
