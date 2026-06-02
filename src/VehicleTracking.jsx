import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, differenceInDays } from 'date-fns';
import { Search, Filter, MapPin, User, Bike, Calendar, ArrowRight, Clipboard, ChevronDown, ChevronUp, Activity, Package, Clock } from 'lucide-react';
import {
    buildFleetHistoryIndex,
    enrichRiderFromFleetRow,
    normalizeFleetStatus,
    resolveFleetHistoryForRider,
    countFleetSources,
} from './lib/fleetInsightIndex';
import { parseFleetDate } from './lib/fleetDeployReturnExport';
import { extractFleetSource } from './lib/riderPerformanceReport';

const VehicleTracking = ({ fleetData, riderData, loading }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [filterClient, setFilterClient] = useState('All');
    const [filterFleetType, setFilterFleetType] = useState('All');
    const [filterRiderStatus, setFilterRiderStatus] = useState('All');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [expandedRider, setExpandedRider] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'totalOrders', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    const fleetSourceCounts = useMemo(() => countFleetSources(fleetData), [fleetData]);

    const processedRiderData = useMemo(() => {
        if (!riderData || riderData.length === 0) return [];

        const today = new Date();
        const fleetIndex = buildFleetHistoryIndex(fleetData);
        const getParsedDate = (dateStr) => parseFleetDate(dateStr);

        // Process each rider (orders from rider_metrics, deploy/return dates from merged Fleet Data)
        const riderGroups = new Map();
        riderData.forEach(r => {
            if (!r.worker_code) return;
            const existing = riderGroups.get(r.worker_code) || {
                riderId: r.worker_code,
                riderName: r.rider_name || r.worker_name || 'N/A',
                mobile: r.mob_number || '',
                client: r.client || 'N/A',
                sourceName: r.source || 'N/A',
                city: r.city || 'N/A',
                totalOrders: 0,
                lastOrderDate: null,
                fleetCategory: r.type1 || 'Unknown',
                orderRecords: [],
                history: [],
                fleetDataSource: null,
            };

            const deliveredCount = parseInt(r.delivered || 0, 10);
            existing.totalOrders += deliveredCount;
            const d = getParsedDate(r.date_record);
            if (d && (!existing.lastOrderDate || d > existing.lastOrderDate)) {
                existing.lastOrderDate = d;
            }
            if (d) {
                existing.orderRecords.push({ date: d, delivered: deliveredCount });
            }
            if (r.client && r.client !== 'N/A') existing.client = r.client;
            if (r.source && r.source !== 'N/A') existing.sourceName = r.source;
            if (r.city && r.city !== 'N/A') existing.city = r.city;
            if (r.mob_number) existing.mobile = r.mob_number;
            if (r.rider_name || r.worker_name) existing.riderName = r.rider_name || r.worker_name;
            
            const rawType = (r.type1 || '').toString().trim().toUpperCase();
            if (rawType === 'EV' || rawType === 'NON-EV' || rawType === 'NON EV') {
                existing.fleetCategory = rawType.replace('NON EV', 'NON-EV');
            }
            
            riderGroups.set(r.worker_code, existing);
        });

        const results = [];
        riderGroups.forEach((rider, riderId) => {
            const rawHistory = resolveFleetHistoryForRider(
                { workerCode: riderId, mobile: rider.mobile, name: rider.riderName },
                fleetIndex
            );

            if (rawHistory.length) {
                enrichRiderFromFleetRow(rider, rawHistory[rawHistory.length - 1]);
            }

            const finalHistory = [];
            const activeDeployments = new Map();

            rawHistory.forEach(rec => {
                const date = getParsedDate(rec.date_record);
                if (!date) return;
                const vehicleNumberRaw = (rec.vehicle_number || '').toString().trim();
                const vehicleNumberKey = vehicleNumberRaw.toUpperCase();
                if (!vehicleNumberKey) return;

                const status = normalizeFleetStatus(rec.vehicle_status);

                if (status === 'Deployee') {
                    activeDeployments.set(vehicleNumberKey, {
                        vehicleNumber: vehicleNumberRaw,
                        deployeeDate: date,
                        cityName: rec.city_locations || rec.city || rider.city,
                        clientName: rec.client_name || rider.client,
                        sourceName: extractFleetSource(rec) || rider.sourceName,
                        fleetDataSource: rec.data_source,
                    });
                    enrichRiderFromFleetRow(rider, rec);
                } else if (status === 'Return') {
                    const dep = activeDeployments.get(vehicleNumberKey);
                    if (dep) {
                        finalHistory.push({
                            ...dep,
                            returnDate: date,
                            daysOnRoad: differenceInDays(date, dep.deployeeDate),
                            status: 'Returned'
                        });
                        activeDeployments.delete(vehicleNumberKey);
                    }
                }
            });

            // Any remaining active deployments are "Ongoing"
            const ongoingAssignments = Array.from(activeDeployments.values()).map(dep => ({
                ...dep,
                returnDate: null,
                daysOnRoad: differenceInDays(today, dep.deployeeDate),
                status: 'Deployed'
            }));

            const combinedHistory = [...ongoingAssignments, ...finalHistory]
                .map(asgn => {
                    const fromDate = asgn.deployeeDate;
                    const toDate = asgn.returnDate || today;
                    const periodOrders = (rider.orderRecords || []).reduce((sum, rec) => {
                        if (rec.date >= fromDate && rec.date <= toDate) return sum + (rec.delivered || 0);
                        return sum;
                    }, 0);

                    return {
                        ...asgn,
                        periodOrders
                    };
                })
                .sort((a, b) => b.deployeeDate - a.deployeeDate);
            
            const currentAssignment = ongoingAssignments[0] || null;
            const totalOnRoadDays = combinedHistory.reduce((sum, h) => sum + h.daysOnRoad, 0);
            const deployedAssignmentsCount = combinedHistory.filter(h => h.status === 'Deployed').length;
            const returnedAssignmentsCount = combinedHistory.filter(h => h.status === 'Returned').length;
            const averageAssignmentDays = combinedHistory.length > 0 ? Math.round(totalOnRoadDays / combinedHistory.length) : 0;
            
            // Refined Rider Status Logic
            // Active if has a vehicle OR has checked in within last 15 days
            const daysSinceLastOrder = rider.lastOrderDate ? differenceInDays(today, rider.lastOrderDate) : 999;
            const riderActiveStatus = (currentAssignment || daysSinceLastOrder <= 30) ? 'Active' : 'Inactive';
            const statusDetail = riderActiveStatus === 'Inactive' && rider.lastOrderDate ? `${daysSinceLastOrder}d` : '';

            // Determine Fleet Remark (EV vs Non-EV Logic)
            let fleetRemark = rider.fleetCategory || 'Unknown';
            let fleetStatusClass = 'unknown';
            let fleetType = 'UNKNOWN';

            if (rider.fleetCategory === 'EV') {
                if (currentAssignment) {
                    fleetRemark = 'EV';
                    fleetStatusClass = 'ev';
                    fleetType = 'EV';
                } else {
                    // Categorized as EV but no active company vehicle
                    fleetRemark = (riderActiveStatus === 'Active') ? 'Non-EV (Own Bike)' : 'Non-EV (Returned)';
                    fleetStatusClass = 'non-ev';
                    fleetType = 'NON-EV';
                }
            } else if (rider.fleetCategory === 'NON-EV') {
                fleetRemark = 'Non-EV';
                fleetStatusClass = 'non-ev';
                fleetType = 'NON-EV';
            }

            results.push({
                ...rider,
                currentVehicle: currentAssignment ? currentAssignment.vehicleNumber : 'None',
                currentStatus: currentAssignment ? 'Deployed' : 'No Active Vehicle',
                totalOnRoadDays,
                riderActiveStatus,
                statusDetail,
                fleetRemark,
                fleetStatusClass,
                fleetType,
                deployedAssignmentsCount,
                returnedAssignmentsCount,
                averageAssignmentDays,
                assignments: combinedHistory
            });
        });

        return results.sort((a, b) => b.totalOrders - a.totalOrders);
    }, [fleetData, riderData]);

    const clients = useMemo(() => {
        const set = new Set(processedRiderData.map(d => d.client).filter(c => c && c !== 'N/A'));
        return ['All', ...Array.from(set).sort()];
    }, [processedRiderData]);

    const filteredData = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        const fromDate = dateFrom ? new Date(dateFrom) : null;
        const toDate = dateTo ? new Date(dateTo) : null;

        if (toDate) {
            toDate.setHours(23, 59, 59, 999);
        }

        return processedRiderData.filter(item => {
            const matchesSearch =
                s === '' ||
                (item.riderName || '').toLowerCase().includes(s) ||
                (item.riderId || '').toString().toLowerCase().includes(s) ||
                (item.currentVehicle || '').toString().toLowerCase().includes(s);

            const matchesStatus = filterStatus === 'All' || item.currentStatus === filterStatus;
            const matchesClient = filterClient === 'All' || item.client === filterClient;
            const matchesFleet = filterFleetType === 'All' || item.fleetType === filterFleetType;
            const matchesRiderStatus = filterRiderStatus === 'All' || item.riderActiveStatus === filterRiderStatus;
            const matchesDateRange = (!fromDate && !toDate) || item.assignments.some(asgn => {
                const d = asgn.deployeeDate;
                if (!d) return false;
                if (fromDate && d < fromDate) return false;
                if (toDate && d > toDate) return false;
                return true;
            });

            return matchesSearch && matchesStatus && matchesClient && matchesFleet && matchesRiderStatus && matchesDateRange;
        });
    }, [processedRiderData, searchTerm, filterStatus, filterClient, filterFleetType, filterRiderStatus, dateFrom, dateTo]);

    const sortedData = useMemo(() => {
        const sorted = [...filteredData];
        const { key, direction } = sortConfig;
        const dir = direction === 'asc' ? 1 : -1;

        sorted.sort((a, b) => {
            let aVal;
            let bVal;

            switch (key) {
                case 'rider':
                    aVal = (a.riderName || '').toLowerCase();
                    bVal = (b.riderName || '').toLowerCase();
                    break;
                case 'client':
                    aVal = (a.client || '').toLowerCase();
                    bVal = (b.client || '').toLowerCase();
                    break;
                case 'currentVehicle':
                    aVal = (a.currentVehicle || '').toString().toLowerCase();
                    bVal = (b.currentVehicle || '').toString().toLowerCase();
                    break;
                case 'totalOrders':
                    aVal = Number(a.totalOrders || 0);
                    bVal = Number(b.totalOrders || 0);
                    break;
                case 'lastOrderDate':
                    aVal = a.lastOrderDate ? a.lastOrderDate.getTime() : 0;
                    bVal = b.lastOrderDate ? b.lastOrderDate.getTime() : 0;
                    break;
                case 'fleetType':
                    aVal = (a.fleetType || '').toLowerCase();
                    bVal = (b.fleetType || '').toLowerCase();
                    break;
                case 'riderStatus':
                    aVal = (a.riderActiveStatus || '').toLowerCase();
                    bVal = (b.riderActiveStatus || '').toLowerCase();
                    break;
                case 'totalOnRoadDays':
                    aVal = Number(a.totalOnRoadDays || 0);
                    bVal = Number(b.totalOnRoadDays || 0);
                    break;
                case 'history':
                    aVal = Number((a.assignments || []).length);
                    bVal = Number((b.assignments || []).length);
                    break;
                default:
                    aVal = '';
                    bVal = '';
                    break;
            }

            if (aVal < bVal) return -1 * dir;
            if (aVal > bVal) return 1 * dir;
            return 0;
        });

        return sorted;
    }, [filteredData, sortConfig]);

    const summaryStats = useMemo(() => {
        const totalRiders = filteredData.length;
        const totalAssignments = filteredData.reduce((sum, item) => sum + (item.assignments?.length || 0), 0);
        const deployedNow = filteredData.reduce((sum, item) => sum + (item.deployedAssignmentsCount || 0), 0);
        const totalOnRoadDays = filteredData.reduce((sum, item) => sum + (item.totalOnRoadDays || 0), 0);
        return { totalRiders, totalAssignments, deployedNow, totalOnRoadDays };
    }, [filteredData]);

    const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return sortedData.slice(startIndex, startIndex + pageSize);
    }, [sortedData, currentPage, pageSize]);

    const visibleStart = sortedData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const visibleEnd = Math.min(currentPage * pageSize, sortedData.length);

    useEffect(() => {
        setCurrentPage(1);
        setExpandedRider(null);
    }, [
        searchTerm,
        filterStatus,
        filterClient,
        filterFleetType,
        filterRiderStatus,
        dateFrom,
        dateTo,
        sortConfig.key,
        sortConfig.direction,
        pageSize
    ]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    const renderSortArrow = (key) => {
        if (sortConfig.key !== key) return ' ';
        return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
    };

    const getOnRoadTooltip = (item) => {
        if (!item.assignments || item.assignments.length === 0) {
            return 'No assignment history available';
        }

        const lines = item.assignments.map(asgn => {
            const rangeText = `${format(asgn.deployeeDate, 'dd MMM yyyy')} - ${asgn.returnDate ? format(asgn.returnDate, 'dd MMM yyyy') : 'Now'}`;
            return `${asgn.vehicleNumber}: ${asgn.daysOnRoad} days (${asgn.status}) | ${rangeText}`;
        });

        return lines.join('\n');
    };

    const getPerformanceTooltip = (item) => {
        if (!item.assignments || item.assignments.length === 0) {
            return 'No assignment history available';
        }

        const lines = item.assignments.map(asgn => {
            const rangeText = `${format(asgn.deployeeDate, 'dd MMM yyyy')} - ${asgn.returnDate ? format(asgn.returnDate, 'dd MMM yyyy') : 'Till Date'}`;
            return `${asgn.vehicleNumber}: ${asgn.periodOrders || 0} orders | ${rangeText}`;
        });

        return lines.join('\n');
    };

    if (loading) return (
        <div className="loading-container"><span className="loader"></span></div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Rider & Vehicle Insight</h1>
                    <p style={{ color: 'var(--text-dim)' }}>
                        Deploy/return dates from merged Fleet Data ({fleetSourceCounts.total.toLocaleString()} rows:
                        {' '}{fleetSourceCounts.legacy.toLocaleString()} database + {fleetSourceCounts.form.toLocaleString()} new fleet)
                    </p>
                </div>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.9rem', marginBottom: '1rem' }}>
                <div className="glass" style={{ padding: '0.95rem', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255,255,255,0.16)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Total Riders</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{summaryStats.totalRiders}</div>
                </div>
                <div className="glass" style={{ padding: '0.95rem', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255,255,255,0.16)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Total Assignments</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{summaryStats.totalAssignments}</div>
                </div>
                <div className="glass" style={{ padding: '0.95rem', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255,255,255,0.16)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Currently Deployed</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent-blue)' }}>{summaryStats.deployedNow}</div>
                </div>
                <div className="glass" style={{ padding: '0.95rem', background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(255,255,255,0.16)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Total On-Road Days</div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent-green)' }}>{summaryStats.totalOnRoadDays}</div>
                </div>
            </div>

            <div className="filters-container glass" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', width: '100%' }}>
                    <div className="filter-group" style={{ flex: 1, minWidth: '300px' }}>
                        <label className="filter-label">Search Rider / ID / Vehicle</label>
                        {/* Rider Status Filter */}
                        <div className="glass" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Activity size={18} className="text-primary" />
                            <select 
                                value={filterRiderStatus} 
                                onChange={(e) => setFilterRiderStatus(e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', cursor: 'pointer' }}
                            >
                                <option value="All" style={{ background: '#1a1a1a' }}>All Rider Status</option>
                                <option value="Active" style={{ background: '#1a1a1a' }}>Active</option>
                                <option value="Inactive" style={{ background: '#1a1a1a' }}>Inactive</option>
                            </select>
                        </div>

                        {/* Search Bar */}
                        <div className="glass" style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 1rem', gap: '0.75rem', flex: 1 }}>
                            <Search size={18} className="text-dim" />
                            <input 
                                type="text" 
                                placeholder="Search rider name or ID..." 
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

                    <div className="filter-group">
                        <label className="filter-label">Vehicle Status</label>
                        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                            <option value="All">All Status</option>
                            <option value="Deployed">Deployed</option>
                            <option value="No Active Vehicle">No Active Vehicle</option>
                        </select>
                    </div>

                    <div className="filter-group">
                        <label className="filter-label">Fleet Type</label>
                        <select value={filterFleetType} onChange={(e) => setFilterFleetType(e.target.value)}>
                            <option value="All">All Types</option>
                            <option value="EV">EV Riders</option>
                            <option value="NON-EV">Non-EV Riders</option>
                        </select>
                    </div>

                    <div className="filter-group">
                        <label className="filter-label">Date From</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.6rem 1rem', borderRadius: '0.5rem', outline: 'none', minWidth: '180px' }}
                        />
                    </div>

                    <div className="filter-group">
                        <label className="filter-label">Date To</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.6rem 1rem', borderRadius: '0.5rem', outline: 'none', minWidth: '180px' }}
                        />
                    </div>
                </div>
            </div>

            <div className="table-card glass">
                <div className="table-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Activity size={20} className="text-primary" />
                        <h3>Rider-Vehicle Monitor</h3>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-dim)' }}>
                        Showing {visibleStart}-{visibleEnd} of {sortedData.length} records
                    </div>
                </div>
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('rider')}>Rider / ID{renderSortArrow('rider')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('client')}>Client / City{renderSortArrow('client')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('currentVehicle')}>Current Vehicle{renderSortArrow('currentVehicle')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalOrders')}>Performance{renderSortArrow('totalOrders')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('lastOrderDate')}>Last Order Date{renderSortArrow('lastOrderDate')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('fleetType')}>Fleet Type{renderSortArrow('fleetType')}</th>
                                <th>Vehicle Remark</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('riderStatus')}>Rider Status{renderSortArrow('riderStatus')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalOnRoadDays')}>Total On-Road{renderSortArrow('totalOnRoadDays')}</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('history')}>History{renderSortArrow('history')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.map((item) => (
                                <React.Fragment key={item.riderId}>
                                    <tr>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontWeight: 700, color: '#fff' }}>{item.riderName}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <User size={12} />
                                                    {item.riderId}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <div style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{item.client}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <MapPin size={12} /> {item.city}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {item.currentVehicle !== 'None' ? (
                                                    <div className="status-badge deployee" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <Bike size={14} />
                                                        {item.currentVehicle}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>None</span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'help' }}
                                                title={getPerformanceTooltip(item)}
                                            >
                                                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <Package size={14} className="text-primary" />
                                                    {item.totalOrders}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>TOTAL DELIVERED (HOVER FOR RANGE-ORDER)</div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                                                <Calendar size={14} className="text-dim" />
                                                {item.lastOrderDate ? format(item.lastOrderDate, 'dd MMM yyyy') : 'N/A'}
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`status-badge ${item.fleetType === 'EV' ? 'ev' : item.fleetType === 'NON-EV' ? 'non-ev' : 'unknown'}`}>
                                                {item.fleetType}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`status-badge ${item.fleetStatusClass}`}>
                                                {item.fleetRemark}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span className={`status-badge ${item.riderActiveStatus.toLowerCase()}`}>
                                                    {item.riderActiveStatus}
                                                </span>
                                                {item.statusDetail && (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.05)', padding: '2px 4px', borderRadius: '4px' }}>
                                                        {item.statusDetail}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'help' }}
                                                title={getOnRoadTooltip(item)}
                                            >
                                                <div style={{ fontWeight: 700, color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <Clock size={14} />
                                                    {item.totalOnRoadDays} Days
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>ON-ROAD LIFE (HOVER FOR DETAILS)</div>
                                            </div>
                                        </td>
                                        <td>
                                            <button 
                                                onClick={() => setExpandedRider(expandedRider === item.riderId ? null : item.riderId)}
                                                className="glass"
                                                style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: '#fff', fontSize: '0.8rem' }}
                                            >
                                                {item.assignments.length} assignments {expandedRider === item.riderId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                            </button>
                                        </td>
                                    </tr>
                                    <AnimatePresence>
                                        {expandedRider === item.riderId && (
                                            <tr>
                                                <td colSpan="10" style={{ padding: '0', background: 'rgba(255,255,255,0.02)' }}>
                                                    <motion.div 
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        style={{ overflow: 'hidden', padding: '1.5rem' }}
                                                    >
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                                            {item.assignments.map((asgn, i) => (
                                                                <div key={i} className="glass" style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            <Bike size={16} className="text-primary" />
                                                                            {asgn.vehicleNumber}
                                                                        </div>
                                                                        <span className={`status-badge ${asgn.status.toLowerCase()}`}>{asgn.status}</span>
                                                                    </div>
                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                            <span>Duration:</span>
                                                                            <span style={{ color: '#fff' }}>{asgn.daysOnRoad} Days</span>
                                                                        </div>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                            <span>From:</span>
                                                                            <span style={{ color: '#fff' }}>{format(asgn.deployeeDate, 'dd MMM yyyy')}</span>
                                                                        </div>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                            <span>To:</span>
                                                                            <span style={{ color: '#fff' }}>{asgn.returnDate ? format(asgn.returnDate, 'dd MMM yyyy') : 'Now'}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </motion.div>
                                                </td>
                                            </tr>
                                        )}
                                    </AnimatePresence>
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                        <span>Rows per page</span>
                        <select
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                            style={{ minWidth: '90px', padding: '0.4rem 0.65rem' }}
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button
                            className="glass"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{ padding: '0.4rem 0.8rem', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', color: '#fff', opacity: currentPage === 1 ? 0.5 : 1 }}
                        >
                            Prev
                        </button>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', minWidth: '90px', textAlign: 'center' }}>
                            Page {currentPage} / {totalPages}
                        </div>
                        <button
                            className="glass"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            style={{ padding: '0.4rem 0.8rem', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', color: '#fff', opacity: currentPage === totalPages ? 0.5 : 1 }}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default VehicleTracking;
