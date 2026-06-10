import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Search, User, Phone, Briefcase, MapPin, Download, 
    X, ChevronRight, Filter, Database, ShieldCheck, 
    Smartphone, FileCheck, ClipboardList, ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';

const formatDateToDDMMYYYY = (dateStr) => {
    if (!dateStr || dateStr === 'N/A') return 'N/A';
    const cleanStr = String(dateStr).trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(cleanStr)) return cleanStr;
    const yyyymmddMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmddMatch) return yyyymmddMatch[3] + '-' + yyyymmddMatch[2] + '-' + yyyymmddMatch[1];
    let targetStr = cleanStr;
    if (cleanStr.includes(',')) {
        const parts = cleanStr.split(',');
        targetStr = parts[parts.length - 1].trim();
    }
    const tokens = targetStr.split(/\s+/);
    if (tokens.length >= 3) {
        const dayPart = tokens[0].replace(/\D/g, '');
        const monthPart = tokens[1].toLowerCase();
        const yearPart = tokens[2].replace(/\D/g, '');
        const monthMap = {
            jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
            apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
            aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
            nov: '11', november: '11', dec: '12', december: '12'
        };
        const monthNum = monthMap[monthPart.substring(0, 3)] || monthMap[monthPart];
        if (dayPart && monthNum && yearPart && yearPart.length === 4) {
            const paddedDay = String(dayPart).padStart(2, '0');
            return paddedDay + '-' + monthNum + '-' + yearPart;
        }
    }
    try {
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return day + '-' + month + '-' + year;
        }
    } catch (e) {}
    return cleanStr;
};

const pickExportValue = (...vals) => {
    for (const v of vals) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s && s.toLowerCase() !== 'n/a' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined') {
            return s;
        }
    }
    return 'N/A';
};

const getLatestFleetRecord = (fleetInfo) => {
    if (!Array.isArray(fleetInfo) || fleetInfo.length === 0) return null;
    return fleetInfo[fleetInfo.length - 1];
};

const getRiderKycExportFields = (rider) => {
    const kyc = rider.kycInfo;
    const onboarding = rider.onboardingInfo;
    const fleet = getLatestFleetRecord(rider.fleetInfo);

    return {
        dob: formatDateToDDMMYYYY(pickExportValue(kyc?.rider_dob, onboarding?.rider_dob, onboarding?.date_of_birth)),
        aadhar: pickExportValue(kyc?.aadhar_number, onboarding?.aadhar_number),
        pan: pickExportValue(kyc?.pan_number, onboarding?.pan_number),
        ifsc: pickExportValue(kyc?.ifsc_code, fleet?.bank_ifsc_code_sd_refund_request),
    };
};

const RiderDetails = ({ fleetData, kycData, onboardingData, riderData, loading }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRider, setSelectedRider] = useState(null);
    const [filterCity, setFilterCity] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    // Merging logic optimized with single pass Map creation
    const mergedData = useMemo(() => {
        // Return blank if critical data sources are missing entirely
        if (!fleetData || !kycData || !onboardingData) return [];

        const riderMap = new Map();

        const getAllIds = (item) => {
            if (!item) return [];
            const fields = [
                'worker_code', 'rider_id', 'rider_id_details', 'rider_mobile_number', 
                'mob_number', 'mobile_number', 'phone', 'contact_number', 'rider_contact_number', 'id'
            ];
            const found = new Set();
            for (const f of fields) {
                const v = item[f];
                if (v === null || v === undefined) continue;
                const s = v.toString().trim().toLowerCase();
                if (s && s !== 'n/a' && s !== 'null' && s !== 'undefined') {
                    found.add(s);
                }
            }
            return Array.from(found);
        };

        const processDataset = (data, source) => {
            if (!Array.isArray(data)) return;
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                const ids = getAllIds(item);
                if (ids.length === 0) continue;
                
                let entry = null;
                // Find existing rider by checking all possible IDs
                for (const idKey of ids) {
                    if (riderMap.has(idKey)) {
                        entry = riderMap.get(idKey);
                        break;
                    }
                }

                if (!entry) {
                    entry = {
                        id: item.rider_id || item.worker_code || ids[0], // Prefer a formal ID for display
                        name: item.rider_name || item.worker_name || item.name || 'N/A',
                        mobile: item.rider_contact_number || item.contact_number || item.rider_mobile_number || item.mob_number || item.mobile_number || item.phone || 'N/A',
                        city: item.city || item.city_locations || item.rider_location || 'Unknown',
                        client: item.client || 'Other',
                        fleetInfo: [],
                        kycInfo: null,
                        onboardingInfo: null,
                        metricsInfo: [],
                        sources: new Set([source]),
                        allIds: new Set(ids)
                    };
                } else {
                    entry.sources.add(source);
                    ids.forEach(id => entry.allIds.add(id));
                    // Update formal ID if it was just a mobile number
                    if (entry.id === ids[0] && (item.rider_id || item.worker_code)) {
                        entry.id = item.rider_id || item.worker_code;
                    }
                    // Use truthy values to update N/A fields
                    if ((entry.name === 'N/A' || !entry.name) && (item.rider_name || item.worker_name || item.name)) {
                        entry.name = item.rider_name || item.worker_name || item.name;
                    }
                    if ((entry.mobile === 'N/A' || !entry.mobile) && (item.rider_contact_number || item.contact_number || item.rider_mobile_number || item.mob_number || item.mobile_number)) {
                        entry.mobile = item.rider_contact_number || item.contact_number || item.rider_mobile_number || item.mob_number || item.mobile_number;
                    }
                    if ((entry.city === 'Unknown' || !entry.city) && (item.city || item.city_locations || item.rider_location)) {
                        entry.city = item.city || item.city_locations || item.rider_location;
                    }
                    if ((entry.client === 'Other' || !entry.client) && item.client) {
                        entry.client = item.client;
                    }
                }

                // Ensure all IDs point to this entry
                entry.allIds.forEach(id => riderMap.set(id, entry));

                if (source === 'fleet') entry.fleetInfo.push(item);
                if (source === 'kyc') entry.kycInfo = item;
                if (source === 'onboarding') entry.onboardingInfo = item;
                if (source === 'metrics') entry.metricsInfo.push(item);
            }
        };

        // Order matters for "filling in" missing fields
        processDataset(riderData, 'analytics'); // Analytics usually has latest name
        processDataset(onboardingData, 'onboarding');
        processDataset(kycData, 'kyc');
        processDataset(fleetData, 'fleet');

        return Array.from(new Set(riderMap.values()));
    }, [fleetData, kycData, onboardingData, riderData]);

    const filteredData = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        const fCity = filterCity;
        
        return mergedData.filter(r => {
            const matchesSearch = s === '' || 
                r.name.toLowerCase().includes(s) ||
                r.id.toLowerCase().includes(s) ||
                r.mobile.toLowerCase().includes(s);
            
            const matchesCity = fCity === 'All' || r.city === fCity;
            return matchesSearch && matchesCity;
        });
    }, [mergedData, searchTerm, filterCity]);

    const cities = useMemo(() => {
        const set = new Set(mergedData.map(d => d.city).filter(c => c && c !== 'Unknown'));
        return ['All', ...Array.from(set).sort()];
    }, [mergedData]);

    // Pagination Logic
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredData.slice(start, start + pageSize);
    }, [filteredData, currentPage, pageSize]);

    const totalPages = Math.ceil(filteredData.length / pageSize);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterCity, pageSize]);

    const handleExport = () => {
        const exportData = filteredData.map(r => {
            const kycFields = getRiderKycExportFields(r);
            return {
                'Rider ID': r.id,
                'Rider Name': r.name,
                'Mobile Number': r.mobile,
                'DATE OF BIRTH': kycFields.dob,
                'AADHAR': kycFields.aadhar,
                'PAN': kycFields.pan,
                'IFSC CODE': kycFields.ifsc,
                'Age': r.kycInfo?.rider_age || 'N/A',
                'City': r.city,
                'Client': r.client,
                'Sources': Array.from(r.sources).join(', '),
                'KYC Status': r.kycInfo ? 'Done' : 'Pending',
                'Onboarding Status': r.onboardingInfo ? 'Done' : 'Pending',
                'Fleet Records': r.fleetInfo.length
            };
        });

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Merged Rider Details");
        XLSX.writeFile(wb, `Rider_Details_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <div className="dashboard-container" style={{ position: 'relative', overflow: 'hidden' }}>
            <header className="header">
                <div>
                    <h1>Rider Master Directory</h1>
                    <p style={{ color: 'var(--text-dim)' }}>Unified data from Fleet, KYC, and Onboarding systems</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="glass" style={{ padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
                        <ClipboardList size={18} />
                        {filteredData.length} Riders Found
                    </div>
                    <button onClick={handleExport} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Download size={18} />
                        Excel Export
                    </button>
                </div>
            </header>

            <div className="filters-container glass" style={{ marginBottom: '2rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} size={18} />
                    <input 
                        type="text" 
                        placeholder="Search by Name, ID or Mobile..." 
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
                        <option value={25} style={{ background: '#1a1a1a' }}>25</option>
                        <option value={50} style={{ background: '#1a1a1a' }}>50</option>
                        <option value={100} style={{ background: '#1a1a1a' }}>100</option>
                    </select>
                </div>
            </div>

            <div className="table-card glass">
                <div className="table-container" style={{ maxHeight: 'calc(100vh - 350px)' }}>
                    <table>
                        <thead>
                            <tr>
                                <th>Rider Details</th>
                                <th>Contact Information</th>
                                <th>Location & Client</th>
                                <th>Data Integrity</th>
                                <th>Status</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.length > 0 ? paginatedData.map(rider => (
                                <tr key={rider.id} onClick={() => setSelectedRider(rider)} style={{ cursor: 'pointer' }}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-color), var(--accent-blue))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <User size={20} color="#fff" />
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 700, color: '#fff' }}>{rider.name}</div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>ID: {rider.id}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)' }}>
                                            <Phone size={14} className="text-primary" />
                                            <span>{rider.mobile}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <MapPin size={14} className="text-primary" />
                                                <span>{rider.city}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Briefcase size={14} className="text-primary" />
                                                <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>{rider.client}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {rider.sources.has('fleet') && <span title="Fleet Data Available" className="status-badge" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>F</span>}
                                            {rider.sources.has('kyc') && <span title="KYC Data Available" className="status-badge" style={{ background: 'rgba(52, 211, 153, 0.1)', color: '#34d399' }}>K</span>}
                                            {rider.sources.has('onboarding') && <span title="Onboarding Data Available" className="status-badge" style={{ background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24' }}>O</span>}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`status-badge ${rider.kycInfo && rider.onboardingInfo ? 'active' : 'unknown'}`}>
                                            {rider.kycInfo && rider.onboardingInfo ? 'Verified' : 'Incomplete'}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <ChevronRight size={18} style={{ color: 'var(--text-dim)' }} />
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                                        No riders found matching your search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                        Showing {Math.min(filteredData.length, (currentPage - 1) * pageSize + 1)} to {Math.min(filteredData.length, currentPage * pageSize)} of {filteredData.length} riders
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

            {/* Rider Detail Sidebar (Drawer) */}
            <AnimatePresence>
                {selectedRider && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedRider(null)}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, backdropFilter: 'blur(4px)' }}
                        />
                        <motion.div 
                            initial={{ x: '100%' }} 
                            animate={{ x: 0 }} 
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '450px', background: '#111827', zIndex: 101, borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}
                        >
                            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <User className="text-primary" />
                                    Rider Details
                                </h3>
                                <button onClick={() => setSelectedRider(null)} className="glass-btn" style={{ padding: '0.5rem', borderRadius: '50%' }}>
                                    <X size={20} />
                                </button>
                            </div>

                            <div style={{ padding: '2rem', overflowY: 'auto', flex: 1 }}>
                                <div className="glass" style={{ padding: '1.5rem', marginBottom: '2rem', textAlign: 'center', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1))' }}>
                                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-color), var(--accent-blue))', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <User size={40} color="#fff" />
                                    </div>
                                    <h2 style={{ margin: '0 0 0.25rem 0' }}>{selectedRider.name}</h2>
                                    <p style={{ color: 'var(--text-dim)', margin: 0 }}>{selectedRider.id}</p>
                                </div>

                                <div style={{ display: 'grid', gap: '1.5rem' }}>
                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Database size={14} /> Core Information
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                            <div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>MOBILE</div>
                                                <div style={{ fontWeight: 600 }}>{selectedRider.mobile}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>CITY</div>
                                                <div style={{ fontWeight: 600 }}>{selectedRider.city}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>CLIENT</div>
                                                <div style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>{selectedRider.client}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>STATUS</div>
                                                <div style={{ fontWeight: 600 }}>{selectedRider.kycInfo && selectedRider.onboardingInfo ? 'Verified' : 'Partial Data'}</div>
                                            </div>
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <ShieldCheck size={14} /> KYC Details
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem' }}>
                                            {selectedRider.kycInfo ? (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>DATE OF BIRTH</div>
                                                        <div style={{ fontWeight: 600, color: 'var(--accent-blue)' }}>{formatDateToDDMMYYYY(selectedRider.kycInfo.rider_dob)}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>AGE</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.kycInfo.rider_age || 'N/A'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>AADHAR</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.kycInfo.aadhar_number || 'N/A'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>PAN</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.kycInfo.pan_number || 'N/A'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>KYC DATE</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.kycInfo.created_at ? new Date(selectedRider.kycInfo.created_at).toLocaleDateString() : 'N/A'}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.85rem' }}>No KYC records found in system</p>
                                            )}
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <Smartphone size={14} /> Onboarding Status
                                        </h4>
                                        <div className="glass" style={{ padding: '1rem' }}>
                                            {selectedRider.onboardingInfo ? (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>ONBOARDING DATE</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.onboardingInfo.date_record || 'N/A'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>HUB</div>
                                                        <div style={{ fontWeight: 600 }}>{selectedRider.onboardingInfo.hub_name || 'N/A'}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p style={{ margin: 0, color: 'var(--accent-red)', fontSize: '0.85rem' }}>No onboarding records found</p>
                                            )}
                                        </div>
                                    </section>

                                    <section>
                                        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
                                            <FileCheck size={14} /> Fleet Assignments
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {selectedRider.fleetInfo.length > 0 ? (
                                                selectedRider.fleetInfo.slice(0, 5).map((fleet, i) => (
                                                    <div key={i} className="glass" style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div>
                                                            <div style={{ fontWeight: 600 }}>{fleet.vehicle_number}</div>
                                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{fleet.date_record}</div>
                                                        </div>
                                                        <span className={`status-badge ${fleet.vehicle_status === 'Deployee' ? 'deployee' : 'return'}`}>
                                                            {fleet.vehicle_status}
                                                        </span>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="glass" style={{ padding: '1rem' }}>
                                                    <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.85rem' }}>No vehicle history found</p>
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>

                            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                                <button 
                                    onClick={handleExport}
                                    className="btn-primary" 
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                                >
                                    <Download size={18} />
                                    Download Rider File
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default RiderDetails;
