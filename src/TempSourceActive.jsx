import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Filter, BarChart3 } from 'lucide-react';

const MONTHS = [
    { key: 0, label: 'Jan' },
    { key: 1, label: 'Feb' },
    { key: 2, label: 'Mar' },
    { key: 3, label: 'Apr' }
];

const TempSourceActive = ({ riderData, fleetData, loading }) => {
    const [selectedCity, setSelectedCity] = useState('All');
    const [selectedView, setSelectedView] = useState('All');

    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const s = dateStr.toString().trim();
        if (!s) return null;

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
        return d && !isNaN(d.getTime()) ? d : null;
    };

    const riderNameMap = useMemo(() => {
        const map = new Map();
        (fleetData || []).forEach(f => {
            const id = (f.rider_id || f.riderId || '').toString().trim();
            const name = (f.rider_name || f.riderName || '').toString().trim();
            if (id && name && name !== 'N/A') {
                // If multiple names exist for same ID, prefer the most recent one (assuming fleetData is somewhat chronological)
                map.set(id, name);
            }
        });
        return map;
    }, [fleetData]);

    const normalizedRows = useMemo(() => {
        const currentYear = new Date().getFullYear();
        return (riderData || [])
            .map(r => {
                const date = parseDate(r.date_record);
                const wCode = (r.worker_code || '').toString().trim();
                let nameFromData = (r.rider_name || r.riderName || r.name || '').toString().trim();
                const name = (nameFromData && nameFromData !== 'N/A') ? nameFromData : (riderNameMap.get(wCode) || 'N/A');

                return {
                    workerCode: wCode,
                    riderName: name,
                    source: (r.source || r.source_name || 'Unknown').toString().trim() || 'Unknown',
                    client: (r.client || r.client_name || 'N/A').toString().trim() || 'N/A',
                    city: (r.city || r.city_name || 'Unknown').toString().trim() || 'Unknown',
                    delivered: parseInt(r.delivered || 0, 10) || 0,
                    date,
                    year: date ? date.getFullYear() : currentYear,
                    month: date ? date.getMonth() : null
                };
            })
            .filter(r => r.workerCode && r.date && r.year === new Date().getFullYear() && r.delivered > 0 && MONTHS.some(m => m.key === r.month));
    }, [riderData]);

    const cities = useMemo(() => {
        const set = new Set(normalizedRows.map(r => r.city).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [normalizedRows]);

    const filteredRows = useMemo(() => {
        if (selectedCity === 'All') return normalizedRows;
        return normalizedRows.filter(r => r.city === selectedCity);
    }, [normalizedRows, selectedCity]);

    const sourceWise = useMemo(() => {
        const bySource = new Map();
        filteredRows.forEach(row => {
            if (!bySource.has(row.source)) {
                bySource.set(row.source, {
                    source: row.source,
                    Jan: new Set(),
                    Feb: new Set(),
                    Mar: new Set(),
                    Apr: new Set()
                });
            }
            const sourceEntry = bySource.get(row.source);
            if (row.month === 0) sourceEntry.Jan.add(row.workerCode);
            if (row.month === 1) sourceEntry.Feb.add(row.workerCode);
            if (row.month === 2) sourceEntry.Mar.add(row.workerCode);
            if (row.month === 3) sourceEntry.Apr.add(row.workerCode);
        });

        return Array.from(bySource.values())
            .map(s => ({
                source: s.source,
                Jan: s.Jan.size,
                Feb: s.Feb.size,
                Mar: s.Mar.size,
                Apr: s.Apr.size,
                Total: s.Jan.size + s.Feb.size + s.Mar.size + s.Apr.size
            }))
            .sort((a, b) => b.Total - a.Total);
    }, [filteredRows]);

    const cityWise = useMemo(() => {
        const byCity = new Map();
        filteredRows.forEach(row => {
            if (!byCity.has(row.city)) {
                byCity.set(row.city, {
                    city: row.city,
                    Jan: new Set(),
                    Feb: new Set(),
                    Mar: new Set(),
                    Apr: new Set()
                });
            }
            const cityEntry = byCity.get(row.city);
            if (row.month === 0) cityEntry.Jan.add(row.workerCode);
            if (row.month === 1) cityEntry.Feb.add(row.workerCode);
            if (row.month === 2) cityEntry.Mar.add(row.workerCode);
            if (row.month === 3) cityEntry.Apr.add(row.workerCode);
        });

        return Array.from(byCity.values())
            .map(c => ({
                city: c.city,
                Jan: c.Jan.size,
                Feb: c.Feb.size,
                Mar: c.Mar.size,
                Apr: c.Apr.size,
                Total: c.Jan.size + c.Feb.size + c.Mar.size + c.Apr.size
            }))
            .sort((a, b) => b.Total - a.Total);
    }, [filteredRows]);

    const citySourceBreakdown = useMemo(() => {
        const byCitySource = new Map();
        filteredRows.forEach(row => {
            const key = `${row.city}__${row.source}`;
            if (!byCitySource.has(key)) {
                byCitySource.set(key, {
                    city: row.city,
                    source: row.source,
                    Jan: new Set(),
                    Feb: new Set(),
                    Mar: new Set(),
                    Apr: new Set()
                });
            }
            const entry = byCitySource.get(key);
            if (row.month === 0) entry.Jan.add(row.workerCode);
            if (row.month === 1) entry.Feb.add(row.workerCode);
            if (row.month === 2) entry.Mar.add(row.workerCode);
            if (row.month === 3) entry.Apr.add(row.workerCode);
        });

        return Array.from(byCitySource.values())
            .map(e => ({
                city: e.city,
                source: e.source,
                Jan: e.Jan.size,
                Feb: e.Feb.size,
                Mar: e.Mar.size,
                Apr: e.Apr.size,
                Total: e.Jan.size + e.Feb.size + e.Mar.size + e.Apr.size
            }))
            .sort((a, b) => {
                const cityCmp = a.city.localeCompare(b.city);
                if (cityCmp !== 0) return cityCmp;
                return a.source.localeCompare(b.source);
            });
    }, [filteredRows]);

    const clientWise = useMemo(() => {
        const byClient = new Map();
        filteredRows.forEach(row => {
            if (!byClient.has(row.client)) {
                byClient.set(row.client, {
                    client: row.client,
                    Jan: new Set(),
                    Feb: new Set(),
                    Mar: new Set(),
                    Apr: new Set()
                });
            }
            const entry = byClient.get(row.client);
            if (row.month === 0) entry.Jan.add(row.workerCode);
            if (row.month === 1) entry.Feb.add(row.workerCode);
            if (row.month === 2) entry.Mar.add(row.workerCode);
            if (row.month === 3) entry.Apr.add(row.workerCode);
        });

        return Array.from(byClient.values())
            .map(c => ({
                client: c.client,
                Jan: c.Jan.size,
                Feb: c.Feb.size,
                Mar: c.Mar.size,
                Apr: c.Apr.size,
                Total: c.Jan.size + c.Feb.size + c.Mar.size + c.Apr.size
            }))
            .sort((a, b) => b.Total - a.Total);
    }, [filteredRows]);

    const sourceRiderDetails = useMemo(() => {
        const bySourceRider = new Map();
        filteredRows.forEach(row => {
            const monthLabel = MONTHS.find(m => m.key === row.month)?.label || 'N/A';
            const key = `${row.source}__${row.workerCode}__${monthLabel}`;
            if (!bySourceRider.has(key)) {
                bySourceRider.set(key, {
                    source: row.source,
                    workerCode: row.workerCode,
                    riderName: row.riderName,
                    month: monthLabel,
                    client: row.client,
                    city: row.city,
                    totalOrders: 0,
                    workedDaysSet: new Set()
                });
            }

            const entry = bySourceRider.get(key);
            entry.totalOrders += row.delivered || 0;
            if (row.date) entry.workedDaysSet.add(row.date.toISOString().slice(0, 10));

            if ((entry.riderName === 'N/A' || !entry.riderName) && row.riderName && row.riderName !== 'N/A') entry.riderName = row.riderName;
            if ((entry.client === 'N/A' || !entry.client) && row.client && row.client !== 'N/A') entry.client = row.client;
            if ((entry.city === 'Unknown' || !entry.city) && row.city && row.city !== 'Unknown') entry.city = row.city;
        });

        return Array.from(bySourceRider.values())
            .map(e => ({
                source: e.source,
                workerCode: e.workerCode,
                riderName: e.riderName,
                month: e.month,
                client: e.client,
                city: e.city,
                totalOrders: e.totalOrders,
                workedDays: e.workedDaysSet.size
            }))
            .sort((a, b) => {
                const monthOrder = { 'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4 };
                const monthCmp = (monthOrder[a.month] || 99) - (monthOrder[b.month] || 99);
                if (monthCmp !== 0) return monthCmp;
                const sourceCmp = a.source.localeCompare(b.source);
                if (sourceCmp !== 0) return sourceCmp;
                return b.totalOrders - a.totalOrders;
            });
    }, [filteredRows]);

    const exportToCsv = (csvContent, filename) => {
        try {
            console.log(`Exporting ${filename}...`);
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            const fullFileName = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
            link.href = url;
            link.download = fullFileName;

            // Helpful for some browser security models
            link.rel = 'noopener';
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();

            // Small delay before cleanup to ensure trigger
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 100);

            console.log('Export successful');
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Please check console for details.');
        }
    };

    const exportCsv = (rows, filename, firstHeaderKey) => {
        if (!rows || rows.length === 0) {
            alert('No data to export');
            return;
        }
        const headers = [firstHeaderKey, 'Jan', 'Feb', 'Mar', 'Apr', 'Total'];
        const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
        const key = firstHeaderKey.toLowerCase();
        const body = rows.map(r => [r[key], r.Jan, r.Feb, r.Mar, r.Apr, r.Total].map(esc).join(','));
        const csv = [headers.map(esc).join(','), ...body].join('\n');
        exportToCsv(csv, filename);
    };

    const exportCitySourceCsv = () => {
        if (!citySourceBreakdown || citySourceBreakdown.length === 0) {
            alert('No data to export');
            return;
        }
        const headers = ['City', 'Source', 'Jan', 'Feb', 'Mar', 'Apr', 'Total'];
        const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
        const body = citySourceBreakdown.map(r => [r.city, r.source, r.Jan, r.Feb, r.Mar, r.Apr, r.Total].map(esc).join(','));
        const csv = [headers.map(esc).join(','), ...body].join('\n');
        exportToCsv(csv, 'city_source_breakdown');
    };

    const exportSourceRiderDetailsCsv = () => {
        if (!sourceRiderDetails || sourceRiderDetails.length === 0) {
            alert('No data to export');
            return;
        }
        const headers = ['Source', 'Rider ID', 'Rider Name', 'Month', 'Client', 'City', 'Total Orders', 'Worked Days'];
        const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
        const body = sourceRiderDetails.map(r => [
            r.source,
            r.workerCode,
            r.riderName,
            r.month,
            r.client,
            r.city,
            r.totalOrders,
            r.workedDays
        ].map(esc).join(','));
        const csv = [headers.map(esc).join(','), ...body].join('\n');
        exportToCsv(csv, 'source_wise_rider_details');
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Temp Parser - Source Active</h1>
                    <p style={{ color: 'var(--text-dim)' }}>Jan-Apr Source wise active count with city-wise export</p>
                </div>
            </header>

            <div className="filters-container glass" style={{ padding: '1rem 1.5rem' }}>
                <div className="filter-group">
                    <label className="filter-label">City Filter</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Filter size={16} className="text-dim" />
                        <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
                            {cities.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div className="filter-group">
                    <label className="filter-label">Report View</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <BarChart3 size={16} className="text-dim" />
                        <select value={selectedView} onChange={(e) => setSelectedView(e.target.value)}>
                            <option value="All">All Reports</option>
                            <option value="Source Wise">Source Wise Active Count</option>
                            <option value="City Wise">City Wise Active Count</option>
                            <option value="Client Wise">Client Wise Active Count</option>
                            <option value="Deep Breakdown">Deep Breakdown (City -&gt; Source)</option>
                            <option value="Rider Details">Source Wise Rider Details</option>
                        </select>
                    </div>
                </div>
            </div>

            {(selectedView === 'All' || selectedView === 'Source Wise') && (
                <div className="table-card glass">
                    <div className="table-header">
                        <h3>Source Wise Active Count (Jan-Apr)</h3>
                        <button className="glass" onClick={() => exportCsv(sourceWise, 'source_wise_active_count', 'Source')} style={{ padding: '0.4rem 0.8rem', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Download size={14} /> Export Source Wise
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Source</th>
                                    <th>Jan</th>
                                    <th>Feb</th>
                                    <th>Mar</th>
                                    <th>Apr</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sourceWise.length === 0 ? (
                                    <tr><td colSpan="6" style={{ color: 'var(--text-dim)' }}>No data for selected city.</td></tr>
                                ) : sourceWise.map(row => (
                                    <tr key={row.source}>
                                        <td>{row.source}</td>
                                        <td>{row.Jan}</td>
                                        <td>{row.Feb}</td>
                                        <td>{row.Mar}</td>
                                        <td>{row.Apr}</td>
                                        <td>{row.Total}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {(selectedView === 'All' || selectedView === 'City Wise') && (
                <div className="table-card glass">
                    <div className="table-header">
                        <h3>City Wise Active Count (Jan-Apr)</h3>
                        <button className="glass" onClick={() => exportCsv(cityWise, 'city_wise_active_count', 'City')} style={{ padding: '0.4rem 0.8rem', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Download size={14} /> Export City Wise
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>City</th>
                                    <th>Jan</th>
                                    <th>Feb</th>
                                    <th>Mar</th>
                                    <th>Apr</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cityWise.length === 0 ? (
                                    <tr><td colSpan="6" style={{ color: 'var(--text-dim)' }}>No city-wise data for selected filter.</td></tr>
                                ) : cityWise.map(row => (
                                    <tr key={row.city}>
                                        <td>{row.city}</td>
                                        <td>{row.Jan}</td>
                                        <td>{row.Feb}</td>
                                        <td>{row.Mar}</td>
                                        <td>{row.Apr}</td>
                                        <td>{row.Total}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {(selectedView === 'All' || selectedView === 'Client Wise') && (
                <div className="table-card glass">
                    <div className="table-header">
                        <h3>Client Wise Active Count (Jan-Apr)</h3>
                        <button className="glass" onClick={() => exportCsv(clientWise, 'client_wise_active_count', 'Client')} style={{ padding: '0.4rem 0.8rem', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Download size={14} /> Export Client Wise
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Client</th>
                                    <th>Jan</th>
                                    <th>Feb</th>
                                    <th>Mar</th>
                                    <th>Apr</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {clientWise.length === 0 ? (
                                    <tr><td colSpan="6" style={{ color: 'var(--text-dim)' }}>No client-wise data.</td></tr>
                                ) : clientWise.map(row => (
                                    <tr key={row.client}>
                                        <td>{row.client}</td>
                                        <td>{row.Jan}</td>
                                        <td>{row.Feb}</td>
                                        <td>{row.Mar}</td>
                                        <td>{row.Apr}</td>
                                        <td>{row.Total}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {(selectedView === 'All' || selectedView === 'Deep Breakdown') && (
                <div className="table-card glass">
                    <div className="table-header">
                        <h3>Deep Breakdown (A-Z): City -&gt; Source</h3>
                        <button className="glass" onClick={exportCitySourceCsv} style={{ padding: '0.4rem 0.8rem', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Download size={14} /> Export Deep Breakdown
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>City</th>
                                    <th>Source</th>
                                    <th>Jan</th>
                                    <th>Feb</th>
                                    <th>Mar</th>
                                    <th>Apr</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {citySourceBreakdown.length === 0 ? (
                                    <tr><td colSpan="7" style={{ color: 'var(--text-dim)' }}>No detailed data for selected filter.</td></tr>
                                ) : citySourceBreakdown.map((row, idx) => (
                                    <tr key={`${row.city}-${row.source}-${idx}`}>
                                        <td>{row.city}</td>
                                        <td>{row.source}</td>
                                        <td>{row.Jan}</td>
                                        <td>{row.Feb}</td>
                                        <td>{row.Mar}</td>
                                        <td>{row.Apr}</td>
                                        <td>{row.Total}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {(selectedView === 'All' || selectedView === 'Rider Details') && (
                <div className="table-card glass">
                    <div className="table-header">
                        <h3>Source Wise Rider Details (Orders + Worked Days)</h3>
                        <button className="glass" onClick={exportSourceRiderDetailsCsv} style={{ padding: '0.4rem 0.8rem', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Download size={14} /> Export Rider Details
                        </button>
                    </div>
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Source</th>
                                    <th>Rider ID</th>
                                    <th>Rider Name</th>
                                    <th>Month</th>
                                    <th>Client</th>
                                    <th>City</th>
                                    <th>Total Orders</th>
                                    <th>Worked Days</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sourceRiderDetails.length === 0 ? (
                                    <tr><td colSpan="8" style={{ color: 'var(--text-dim)' }}>No rider-level data for selected filter.</td></tr>
                                ) : sourceRiderDetails.map((row, idx) => (
                                    <tr key={`${row.source}-${row.workerCode}-${row.month}-${idx}`}>
                                        <td>{row.source}</td>
                                        <td>{row.workerCode}</td>
                                        <td>{row.riderName}</td>
                                        <td>{row.month}</td>
                                        <td>{row.client}</td>
                                        <td>{row.city}</td>
                                        <td>{row.totalOrders}</td>
                                        <td>{row.workedDays}</td>
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

export default TempSourceActive;
