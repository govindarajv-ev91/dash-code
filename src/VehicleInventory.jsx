import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Search, Database, Download, Filter, 
    ChevronRight, ChevronLeft, X, Truck, 
    Calendar, User, MapPin, Activity
} from 'lucide-react';
import * as XLSX from 'xlsx';

const VehicleInventory = ({ inventoryData, loading }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCity, setFilterCity] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [selectedVehicle, setSelectedVehicle] = useState(null);

    const filteredData = useMemo(() => {
        if (!inventoryData) return [];
        const s = searchTerm.toLowerCase().trim();
        return inventoryData.filter(item => {
            const matchesSearch = s === '' || 
                (item.vehregno || '').toLowerCase().includes(s) ||
                (item.chassis_number || '').toLowerCase().includes(s) ||
                (item.rider_name || '').toLowerCase().includes(s) ||
                (item.rider_id || '').toLowerCase().includes(s);
            
            const matchesCity = filterCity === 'All' || item.city === filterCity;
            return matchesSearch && matchesCity;
        });
    }, [inventoryData, searchTerm, filterCity]);

    const cities = useMemo(() => {
        const set = new Set(inventoryData.map(d => d.city).filter(Boolean));
        return ['All', ...Array.from(set).sort()];
    }, [inventoryData]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredData.slice(start, start + pageSize);
    }, [filteredData, currentPage, pageSize]);

    const totalPages = Math.ceil(filteredData.length / pageSize);

    const handleExport = () => {
        const ws = XLSX.utils.json_to_sheet(filteredData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Vehicle Inventory");
        XLSX.writeFile(wb, `Vehicle_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <div className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Vehicle Inventory</h1>
                    <p style={{ color: 'var(--text-dim)' }}>Comprehensive fleet asset management & tracking</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="glass" style={{ padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
                        <Truck size={18} />
                        {filteredData.length} Units Listed
                    </div>
                    <button onClick={handleExport} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Download size={18} />
                        Export Inventory
                    </button>
                </div>
            </header>

            <div className="filters-container glass" style={{ marginBottom: '2rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} size={18} />
                    <input 
                        type="text" 
                        placeholder="Search by Reg No, Chassis, Rider Name..." 
                        style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 3rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '12px', color: '#fff', outline: 'none' }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="filter-group">
                    <label className="filter-label" style={{ marginBottom: '4px', display: 'block' }}>City</label>
                    <select 
                        value={filterCity} 
                        onChange={(e) => setFilterCity(e.target.value)}
                        style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '12px', color: '#fff', outline: 'none', minWidth: '180px' }}
                    >
                        {cities.map(c => <option key={c} value={c} style={{ background: '#1a1a1a' }}>{c}</option>)}
                    </select>
                </div>
                <div className="filter-group">
                    <label className="filter-label" style={{ marginBottom: '4px', display: 'block' }}>Show</label>
                    <select 
                        value={pageSize} 
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '12px', color: '#fff', outline: 'none', minWidth: '100px' }}
                    >
                        {[25, 50, 100].map(v => <option key={v} value={v} style={{ background: '#1a1a1a' }}>{v}</option>)}
                    </select>
                </div>
            </div>

            <div className="table-card glass">
                <div className="table-container" style={{ maxHeight: 'calc(100vh - 350px)' }}>
                    <table>
                        <thead>
                            <tr>
                                <th>Vehicle Detail</th>
                                <th>Ownership & OEM</th>
                                <th>Assignment</th>
                                <th>Financials</th>
                                <th>Status</th>
                                <th>Inventory IDs</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.length > 0 ? paginatedData.map(item => (
                                <tr key={item.id} onClick={() => setSelectedVehicle(item)} style={{ cursor: 'pointer' }}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(251, 191, 36, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Truck size={20} className="text-amber-400" />
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 700, color: '#fff' }}>{item.vehregno || 'UNREGISTERED'}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{item.model}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ fontSize: '0.85rem' }}>{item.oem}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{item.ownership_type}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.rider_name || 'Unassigned'}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>ID: {item.rider_id || 'N/A'}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--accent-green)' }}>{item.sd_overall || '0'}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{item.financer}</div>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`status-badge ${item.current_status?.toLowerCase().includes('active') ? 'active' : 'unknown'}`}>
                                            {item.current_status || 'Unknown'}
                                        </span>
                                    </td>
                                    <td>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            B:{item.b_no} | C:{item.c_no}
                                        </div>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <ChevronRight size={18} style={{ color: 'var(--text-dim)' }} />
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                                        No inventory records found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                        Showing {Math.min(filteredData.length, (currentPage - 1) * pageSize + 1)} to {Math.min(filteredData.length, currentPage * pageSize)} of {filteredData.length} records
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button 
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            className="glass-btn" 
                            style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', opacity: currentPage === 1 ? 0.3 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', fontWeight: 600 }}>
                            Page {currentPage} of {totalPages || 1}
                        </div>
                        <button 
                            disabled={currentPage >= totalPages}
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            className="glass-btn" 
                            style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', opacity: currentPage >= totalPages ? 0.3 : 1, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {selectedVehicle && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={() => setSelectedVehicle(null)}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, backdropFilter: 'blur(4px)' }}
                        />
                        <motion.div 
                            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '500px', background: '#0f172a', zIndex: 101, borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}
                        >
                            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <Database className="text-amber-400" />
                                    Asset Profile
                                </h3>
                                <button onClick={() => setSelectedVehicle(null)} className="glass-btn" style={{ padding: '0.5rem', borderRadius: '50%' }}>
                                    <X size={20} />
                                </button>
                            </div>

                            <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
                                <div className="glass" style={{ padding: '1.5rem', marginBottom: '2rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(245, 158, 11, 0.1))' }}>
                                    <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'rgba(251, 191, 36, 0.2)', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Truck size={40} className="text-amber-400" />
                                    </div>
                                    <h2 style={{ margin: '0 0 0.25rem 0' }}>{selectedVehicle.vehregno}</h2>
                                    <p style={{ color: 'var(--text-dim)', margin: 0 }}>Chassis: {selectedVehicle.chassis_number}</p>
                                </div>

                                <div style={{ display: 'grid', gap: '1.5rem' }}>
                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Activity size={14} /> Basic Specs
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>MODEL</div><div style={{ fontWeight: 600 }}>{selectedVehicle.model}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>OEM</div><div style={{ fontWeight: 600 }}>{selectedVehicle.oem}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>OWNERSHIP</div><div style={{ fontWeight: 600 }}>{selectedVehicle.ownership_type}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>CITY</div><div style={{ fontWeight: 600 }}>{selectedVehicle.city}</div></div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <User size={14} /> Rider Assignment
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>RIDER NAME</div><div style={{ fontWeight: 600 }}>{selectedVehicle.rider_name || 'N/A'}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>RIDER ID</div><div style={{ fontWeight: 600 }}>{selectedVehicle.rider_id || 'N/A'}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>CONTACT</div><div style={{ fontWeight: 600 }}>{selectedVehicle.rider_contact || 'N/A'}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>HUB LOCATION</div><div style={{ fontWeight: 600 }}>{selectedVehicle.hub_location || 'N/A'}</div></div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Activity size={14} /> Status & Aging
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>CURRENT STATUS</div><div style={{ fontWeight: 600 }}>{selectedVehicle.current_status}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>LIVE DATE</div><div style={{ fontWeight: 600 }}>{selectedVehicle.live_date}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>AGING (DAYS)</div><div style={{ fontWeight: 600 }}>{selectedVehicle.aging}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>WORKING</div><div style={{ fontWeight: 600 }}>{selectedVehicle.working}</div></div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Database size={14} /> Financials & SD
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>SD OVERALL</div><div style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{selectedVehicle.sd_overall}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>SD PAID</div><div style={{ fontWeight: 600, color: 'var(--accent-green)' }}>{selectedVehicle.sd_paid}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>SD PENDING</div><div style={{ fontWeight: 600, color: 'var(--accent-red)' }}>{selectedVehicle.sd_pending}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>FINANCER</div><div style={{ fontWeight: 600 }}>{selectedVehicle.financer}</div></div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Filter size={14} /> Logistics
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>WH DEP</div><div style={{ fontWeight: 600 }}>{selectedVehicle.warehouse_dep}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>WH RETURN</div><div style={{ fontWeight: 600 }}>{selectedVehicle.warehouse_return}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>B NO</div><div style={{ fontWeight: 600 }}>{selectedVehicle.b_no}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>C NO</div><div style={{ fontWeight: 600 }}>{selectedVehicle.c_no}</div></div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Activity size={14} /> Remarks
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem' }}>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)' }}>{selectedVehicle.remarks || 'No remarks available.'}</p>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default VehicleInventory;
