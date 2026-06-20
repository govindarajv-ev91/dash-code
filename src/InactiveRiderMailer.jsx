import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { format, subDays, isValid } from 'date-fns';
import {
    Mail, Send, Users, AlertTriangle, Check, Search,
    Download, RefreshCcw, CheckCircle, XCircle, Loader, Calendar, MessageSquare, MapPin,
    ChevronLeft, ChevronRight
} from 'lucide-react';
import { fetchPublishedCsv } from './lib/fleetSheetMerge';
import {
    CITY_MAIL_CONFIG_URL,
    parseCityMailConfigCsv,
    resolveCityKey,
  resolveMailConfigForGroup,
  resolveInactiveGroupedMailRecipients,
} from './lib/cityMailConfig';
import {
    fetchAllRentalPending,
    buildRentalPendingByRiderIndex,
    lookupRentalPendingAmount,
} from './lib/rentalPendingDb';
import { parseRentalPendingAmount } from './lib/riderPerformanceReport';
import {
    buildInactiveGroupedMail,
    mapRidersToMailPayload,
} from './lib/inactiveRiderMailerEmail';

const LEADERSHIP_MAIL_TO =
    'sujithra.y@ev91riderz.com,murali.bharath@ev91riderz.com,govindaraj.v@ev91riderz.com';

const INACTIVE_MAILER_URL =
    import.meta.env.VITE_INACTIVE_MAILER_SCRIPT_URL ||
    'https://script.google.com/macros/s/AKfycbwbFWVeiez8kQyI0J0mcQURda6tNit8TN8Vzch1B5W5U_EmPM-4VaxVFwUtv9gkmgIRFw/exec';


const normalizeCity = (city) => {
    if (!city) return 'Unknown';
    let c = city.toString().trim().toUpperCase();

    // Synonyms and Common mappings
    if (c === 'BANGALORE' || c === 'BENGALURU') return 'Bengaluru';
    if (c === 'MYSORE' || c === 'MYSURU') return 'Mysuru';
    if (c === 'MANGALORE' || c === 'MANGALURU') return 'Mangaluru';
    if (c === 'GURGAON' || c === 'GURUGRAM') return 'Gurgaon';
    if (c === 'BELGAUM' || c === 'BELGAVI') return 'Belagavi';
    if (c === 'ROK') return 'Rest of Karnataka';
    if (c === 'ROTN') return 'Rest of Tamil Nadu';

    // Title Case for everything else
    return c.charAt(0) + c.slice(1).toLowerCase();
};

const parseDate = (str) => {
    if (!str || str === 'null') return null;
    try {
        const s = str.toString().trim();
        if (s.includes('/')) {
            const p = s.split('/');
            if (p.length === 3) {
                const d = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
                return isValid(d) ? d : null;
            }
        }
        const d = new Date(s);
        return isValid(d) ? d : null;
    } catch { return null; }
};

const ROWS_PER_PAGE = 100;

const formatRentalPendingDisplay = (value) => {
    const n = parseRentalPendingAmount(value);
    if (n == null) return '-';
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const MultiSelect = ({ label, options, selected, onChange, icon: Icon, color, placeholder = "Search..." }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredOptions = options.filter(opt => 
        opt.toString().toLowerCase().includes(search.toLowerCase())
    );

    const toggleOption = (opt) => {
        const newSelected = selected.includes(opt)
            ? selected.filter(s => s !== opt)
            : [...selected, opt];
        onChange(newSelected);
    };

    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            <div 
                className="glass" 
                style={{ 
                    padding: '0.4rem 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    border: 'none', 
                    cursor: 'pointer', 
                    minWidth: '120px',
                    background: selected.length > 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'
                }} 
                onClick={() => setIsOpen(!isOpen)}
            >
                {Icon && <Icon size={14} style={{ color }} />}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', lineHeight: 1 }}>{label}:</span>
                    <span style={{ fontSize: '0.8rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }}>
                        {selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} Selected`}
                    </span>
                </div>
            </div>

            {isOpen && (
                <div 
                    onClick={e => e.stopPropagation()} 
                    style={{ 
                        position: 'absolute', 
                        top: '100%', 
                        left: 0, 
                        marginTop: '0.5rem', 
                        background: '#1e293b', 
                        border: '1px solid rgba(255,255,255,0.1)', 
                        borderRadius: '8px', 
                        zIndex: 1000, 
                        minWidth: '220px', 
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)', 
                        padding: '0.5rem' 
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.6rem', borderRadius: '6px', marginBottom: '0.5rem' }}>
                        <Search size={12} color="var(--text-dim)" />
                        <input 
                            autoFocus
                            type="text" 
                            placeholder={placeholder}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.75rem', outline: 'none', width: '100%' }}
                        />
                    </div>
                    <div style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                        <div 
                            style={{ 
                                padding: '0.4rem 0.6rem', 
                                fontSize: '0.75rem', 
                                color: selected.length === 0 ? color : '#94a3b8', 
                                background: selected.length === 0 ? 'rgba(255,255,255,0.08)' : 'transparent', 
                                borderRadius: '4px', 
                                cursor: 'pointer',
                                fontWeight: selected.length === 0 ? 600 : 400
                            }}
                            onClick={() => { onChange([]); }}
                        >
                            All {label}
                        </div>
                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '0.25rem 0' }}></div>
                        {filteredOptions.map(opt => (
                            <div 
                                key={opt}
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.6rem', 
                                    padding: '0.4rem 0.6rem', 
                                    fontSize: '0.75rem', 
                                    color: selected.includes(opt) ? '#fff' : '#cbd5e1', 
                                    borderRadius: '4px', 
                                    cursor: 'pointer',
                                    background: selected.includes(opt) ? 'rgba(255,255,255,0.05)' : 'transparent'
                                }}
                                onClick={() => toggleOption(opt)}
                            >
                                <div style={{ 
                                    width: '14px', 
                                    height: '14px', 
                                    border: `1px solid ${selected.includes(opt) ? color : 'rgba(255,255,255,0.3)'}`, 
                                    borderRadius: '3px', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    background: selected.includes(opt) ? color : 'transparent' 
                                }}>
                                    {selected.includes(opt) && <Check size={10} color="#000" strokeWidth={4} />}
                                </div>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const InactiveRiderMailer = ({ riderData, kycData, fleetData, onboardingData, inventoryData, loading }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [sendingAll, setSendingAll] = useState(false);
    const [sendingIds, setSendingIds] = useState(new Set());
    const [sentIds, setSentIds] = useState(new Set());
    const [failedIds, setFailedIds] = useState(new Set());
    const [inactiveDays, setInactiveDays] = useState(5);
    const [selectedMonths, setSelectedMonths] = useState([]);
    const [selectedEmail, setSelectedEmail] = useState('ALL');
    const [selectedEmailIds, setSelectedEmailIds] = useState([]);
    const [selectedCities, setSelectedCities] = useState([]);
    const [selectedClients, setSelectedClients] = useState([]);
    const [ccEmail, setCcEmail] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [cityMailConfig, setCityMailConfig] = useState({ cityKeyByLookup: new Map(), mailByCityKey: new Map(), sheetRows: [] });
    const [rentalPendingRows, setRentalPendingRows] = useState([]);
    const [rentalPendingLoading, setRentalPendingLoading] = useState(true);
    const debounceRef = useRef(null);

    // Fetch City Mail Config
    useEffect(() => {
        const fetchCityConfigs = async () => {
            try {
                const csv = await fetchPublishedCsv(CITY_MAIL_CONFIG_URL);
                setCityMailConfig(parseCityMailConfigCsv(csv));
            } catch (err) {
                console.error('Failed to fetch city configs:', err);
            }
        };
        fetchCityConfigs();
    }, []);

    useEffect(() => {
        setRentalPendingLoading(true);
        fetchAllRentalPending()
            .then((data) => setRentalPendingRows(data || []))
            .catch((err) => {
                console.warn('Rental pending load failed:', err);
                setRentalPendingRows([]);
            })
            .finally(() => setRentalPendingLoading(false));
    }, []);

    const rentalPendingIndex = useMemo(
        () => buildRentalPendingByRiderIndex(rentalPendingRows),
        [rentalPendingRows]
    );

    // Debounce search input — waits 300ms after user stops typing
    const handleSearchChange = useCallback((e) => {
        const val = e.target.value;
        setSearchTerm(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(val);
            setCurrentPage(1);
        }, 300);
    }, []);

    // Build comprehensive lookup from Onboarding + Fleet + Inventory data
    const infoMap = useMemo(() => {
        const map = new Map(); // id -> info object

        const getEntity = (ids) => {
            for (const id of ids) {
                if (id && map.has(id)) return map.get(id);
            }
            return { 
                email: 'N/A', 
                phone: 'N/A', 
                riderId: null,
                workerCode: null,
                linkedIds: new Set()
            };
        };

        const linkEntity = (ids, entity) => {
            ids.forEach(id => {
                if (id) {
                    const lowId = id.toString().trim().toLowerCase();
                    if (lowId && lowId !== 'null' && lowId !== 'n/a') {
                        map.set(lowId, entity);
                        entity.linkedIds.add(lowId);
                    }
                }
            });
        };

        const isValidPhone = (p) => {
            if (!p) return false;
            const digits = p.toString().replace(/\D/g, '');
            if (digits.length < 10) return false;
            if (/^0+$/.test(digits)) return false;
            if (/^1234567890$/.test(digits)) return false;
            return true;
        };

        // 1. Onboarding & Fleet (Base Entity Data)
        onboardingData?.forEach(o => {
            const rid = (o.rider_id_details || '').toString().trim();
            const wc = (o.worker_code || '').toString().trim();
            const ids = [rid.toLowerCase(), wc.toLowerCase()].filter(Boolean);

            const phone = (o.rider_mobile_number || '').toString().trim();
            if (isValidPhone(phone)) {
                ids.push(phone.replace(/\D/g, '').slice(-10).toLowerCase());
            }

            const entity = getEntity(ids);
            const email = (o.email_address || '').toString().trim();
            if (email && email !== 'null' && email !== 'N/A') entity.email = email;
            if (o.rider_mobile_number) entity.phone = o.rider_mobile_number;
            
            if (rid) entity.riderId = rid;
            if (wc) entity.workerCode = wc;

            linkEntity(ids, entity);
        });

        (fleetData || []).forEach(f => {
            const rid = (f.rider_id || '').toString().trim();
            const ids = [rid.toLowerCase()].filter(Boolean);

            const phone = (f.rider_contact_number || '').toString().trim();
            if (isValidPhone(phone)) {
                ids.push(phone.replace(/\D/g, '').slice(-10).toLowerCase());
            }

            const entity = getEntity(ids);
            if (f.rider_contact_number) entity.phone = f.rider_contact_number;
            if (rid && !entity.riderId) entity.riderId = rid;

            linkEntity(ids, entity);
        });

        // 2. Inventory Data (Strict Assignment)
        const inventoryMap = new Map(); // rider_id -> assignment info
        const vehicleToRider = new Map(); // vehregno -> rider_id (to ensure uniqueness)

        (inventoryData || []).forEach(v => {
            const rid = (v.rider_id || '').toString().trim();
            const vno = (v.vehregno || '').toString().trim().toUpperCase();
            if (!rid || !vno) return;

            const status = v.current_status || 'Unknown';
            const statusLow = status.toLowerCase();
            const isDeployed = statusLow.includes('deploy');

            // Store for master check
            vehicleToRider.set(vno, rid.toLowerCase());

            const info = {
                vehicle: vno,
                vehicleStatus: status,
                hubLocation: v.hub_location || 'N/A',
                sdOverall: v.sd_overall || '0',
                model: v.model || 'N/A',
                riderId: rid
            };

            const existing = inventoryMap.get(rid.toLowerCase());
            // If already exists, prefer Deployed over Return
            if (!existing || isDeployed || !existing.vehicleStatus.toLowerCase().includes('deploy')) {
                inventoryMap.set(rid.toLowerCase(), info);
            }
            
            // Also link by composite parts if applicable
            if (rid.includes('_')) {
                rid.split('_').forEach(part => {
                    if (part && !inventoryMap.has(part.toLowerCase())) {
                        inventoryMap.set(part.toLowerCase(), info);
                    }
                });
            }
        });

        return { entityMap: map, inventoryMap, vehicleToRider };
    }, [onboardingData, fleetData, inventoryData]);

    // Find riders inactive for N days
    const inactiveRiders = useMemo(() => {
        if (!riderData?.length) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoffDate = subDays(today, inactiveDays);
        const cutoffStr = format(cutoffDate, 'yyyy-MM-dd');

        const riderMap = new Map();
        riderData.forEach(r => {
            if (!r.worker_code) return;
            const code = r.worker_code.toString().trim();
            const codeLow = code.toLowerCase();

            // 1. Get Entity Info (Email, Phone)
            const entity = infoMap.entityMap.get(codeLow) || {};
            
            // 2. Get Vehicle Info (Strict from Inventory)
            // Try matching by Worker Code, or Rider ID if known
            let assignment = infoMap.inventoryMap.get(codeLow);
            if (!assignment && entity.riderId) {
                assignment = infoMap.inventoryMap.get(entity.riderId.toLowerCase());
            }

            // 3. Enforce Exclusivity (Make sure this rider is the master of that vehicle)
            if (assignment?.vehicle) {
                const masterRiderId = infoMap.vehicleToRider.get(assignment.vehicle);
                const isMaster = masterRiderId === (entity.riderId || code).toLowerCase() || 
                                 (assignment.riderId && masterRiderId === assignment.riderId.toLowerCase());
                if (!isMaster) assignment = null;
            }

            const uniqueKey = (assignment?.riderId || entity.riderId || code).toLowerCase();

            const d = parseDate(r.date_record);
            if (!d) return;
            const dateStr = format(d, 'yyyy-MM-dd');
            const delivered = parseInt(r.delivered, 10) || 0;

            const existing = riderMap.get(uniqueKey);
            if (!existing) {
                riderMap.set(uniqueKey, {
                    worker_code: entity.workerCode || code,
                    riderId: assignment?.riderId || entity.riderId || 'N/A',
                    worker_name: r.worker_name || 'Unknown',
                    city: normalizeCity(r.city),
                    client: r.client || '',
                    mob_number: r.mob_number || entity.phone || '',
                    source: r.source || 'Team',
                    lastActiveDate: delivered > 0 ? dateStr : null,
                    latestRecordDate: dateStr,
                    totalOrders: delivered,
                    assignment: assignment,
                    email: entity.email || 'N/A'
                });
            } else {
                if (dateStr > existing.latestRecordDate) {
                    existing.latestRecordDate = dateStr;
                    existing.worker_name = r.worker_name || existing.worker_name;
                    existing.city = normalizeCity(r.city || existing.city);
                    existing.client = r.client || existing.client;
                    existing.mob_number = r.mob_number || existing.mob_number || entity.phone;
                    existing.source = r.source || existing.source;
                }
                if (delivered > 0 && (!existing.lastActiveDate || dateStr > existing.lastActiveDate)) {
                    existing.lastActiveDate = dateStr;
                }
                existing.totalOrders += delivered;
            }
        });

        const inactive = [];
        riderMap.forEach((info, key) => {
            if (info.totalOrders === 0 && !info.lastActiveDate) return;

            const isInactive = !info.lastActiveDate || info.lastActiveDate < cutoffStr;
            if (!isInactive) return;

            const assignment = info.assignment || {};
            const daysSinceActive = info.lastActiveDate
                ? Math.floor((today - new Date(info.lastActiveDate)) / (1000 * 60 * 60 * 24))
                : 'N/A';

            const isDeployed = (assignment.vehicleStatus || '').toLowerCase().includes('deploy');
            const lookupId = assignment?.riderId || info.riderId || info.worker_code;
            const rentalPendingAmount =
                lookupRentalPendingAmount(rentalPendingIndex, lookupId) ??
                lookupRentalPendingAmount(rentalPendingIndex, info.worker_code);

            inactive.push({
                ...info,
                vehicle: assignment.vehicle || 'N/A',
                vehicleStatus: assignment.vehicleStatus || 'Unknown',
                hubLocation: assignment.hubLocation || 'N/A',
                sdOverall: assignment.sdOverall || '0',
                model: assignment.model || 'N/A',
                daysSinceActive,
                rentalPendingAmount,
                canSend: info.email && info.email !== 'N/A' && info.email.includes('@') && assignment.vehicle && assignment.vehicle !== 'N/A' && isDeployed
            });
        });

        return inactive.sort((a, b) => {
            const da = typeof a.daysSinceActive === 'number' ? a.daysSinceActive : 9999;
            const db = typeof b.daysSinceActive === 'number' ? b.daysSinceActive : 9999;
            return db - da;
        });
    }, [riderData, infoMap, inactiveDays, rentalPendingIndex]);

    const availableFilters = useMemo(() => {
        const months = new Set();
        const cities = new Set();
        const emails = new Set();
        const clients = new Set();

        inactiveRiders.forEach(r => {
            if (r.lastActiveDate) {
                const d = new Date(r.lastActiveDate);
                months.add(format(d, 'yyyy-MM'));
            }
            if (r.city) cities.add(r.city);
            if (r.email && r.email !== 'N/A') emails.add(r.email);
            if (r.client) clients.add(r.client);
        });

        return {
            months: Array.from(months).sort().reverse(),
            cities: Array.from(cities).sort(),
            emails: Array.from(emails).sort(),
            clients: Array.from(clients).sort()
        };
    }, [inactiveRiders]);

    const filtered = useMemo(() => {
        let list = inactiveRiders;
        if (selectedMonths.length > 0) {
            list = list.filter(r => selectedMonths.some(m => r.lastActiveDate?.startsWith(m)));
        }
        if (selectedCities.length > 0) {
            list = list.filter(r => selectedCities.includes(r.city));
        }
        if (selectedClients.length > 0) {
            list = list.filter(r => selectedClients.includes(r.client));
        }
        if (selectedEmail === 'READY') {
            list = list.filter(r => r.canSend);
        } else if (selectedEmail === 'MISSING') {
            list = list.filter(r => !r.canSend);
        }
        if (selectedEmailIds.length > 0) {
            list = list.filter(r => selectedEmailIds.includes(r.email));
        }
        if (debouncedSearch) {
            const term = debouncedSearch.toLowerCase();
            list = list.filter(r =>
                r.worker_code.toLowerCase().includes(term) ||
                r.worker_name.toLowerCase().includes(term) ||
                r.city.toLowerCase().includes(term) ||
                r.client.toLowerCase().includes(term) ||
                (r.email && r.email.toLowerCase().includes(term))
            );
        }
        return list;
    }, [inactiveRiders, debouncedSearch, selectedMonths, selectedCities, selectedClients, selectedEmail, selectedEmailIds]);

    const ridersWithEmail = useMemo(() => filtered.filter(r => r.canSend), [filtered]);

    // Unique email counts
    const uniqueEmailsFiltered = useMemo(() => {
        const emails = new Set();
        filtered.forEach(r => { if (r.email && r.email !== 'N/A') emails.add(r.email); });
        return emails.size;
    }, [filtered]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * ROWS_PER_PAGE;
        return filtered.slice(start, start + ROWS_PER_PAGE);
    }, [filtered, currentPage]);

    const uniqueEmailsPage = useMemo(() => {
        const emails = new Set();
        paginatedRows.forEach(r => { if (r.email && r.email !== 'N/A') emails.add(r.email); });
        return emails.size;
    }, [paginatedRows]);

    // Reset to page 1 when any filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedMonths, selectedCities, selectedClients, selectedEmail, selectedEmailIds, debouncedSearch, inactiveDays]);

    const sendMail = async (rider) => {
        setSendingIds(prev => new Set(prev).add(rider.worker_code + '_mail'));
        try {
            const queryParams = new URLSearchParams({
                email: rider.email,
                name: rider.worker_name,
                riderId: rider.riderId,
                workerCode: rider.worker_code,
                daysInactive: rider.daysSinceActive,
                lastActive: rider.lastActiveDate || 'Never',
                ccEmail: ccEmail
            });

            await fetch(`${INACTIVE_MAILER_URL}?${queryParams.toString()}`, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    email: rider.email,
                    name: rider.worker_name,
                    riderId: rider.riderId,
                    workerCode: rider.worker_code,
                    daysInactive: rider.daysSinceActive,
                    source: rider.source || 'Team',
                    rentalPendingAmount: rider.rentalPendingAmount ?? '',
                    ccEmail: ccEmail
                })
            });

            setSentIds(prev => new Set(prev).add(rider.worker_code + '_mail'));
        } catch (error) {
            setFailedIds(prev => new Set(prev).add(rider.worker_code + '_mail'));
        } finally {
            setSendingIds(prev => {
                const next = new Set(prev);
                next.delete(rider.worker_code + '_mail');
                return next;
            });
        }
    };

    const sendWhatsApp = (rider) => {
        if (!rider.mob_number || rider.mob_number === 'N/A') return;
        const phone = rider.mob_number.toString().replace(/\D/g, '');
        const message = `Hi ${rider.worker_name}, we noticed you haven't completed any deliveries in the past ${rider.daysSinceActive} days. (Code: ${rider.worker_code}). Please contact support if you need help!`;
        window.open(`https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(message)}`, '_blank');
        setSentIds(prev => new Set(prev).add(rider.worker_code + '_wa'));
    };

    const sendGroupedMails = async () => {
        setSendingAll(true);
        const cityGroups = {};

        ridersWithEmail.forEach((r) => {
            const cityKey = resolveCityKey(r.city, cityMailConfig.cityKeyByLookup);
            if (!cityGroups[cityKey]) {
                cityGroups[cityKey] = { cityKey, cityLabel: r.city, riders: [] };
            }
            cityGroups[cityKey].riders.push(r);
        });

        let sentCount = 0;
        let skippedCount = 0;
        const skippedCities = [];

        for (const group of Object.values(cityGroups)) {
            const { cityKey, cityLabel, riders } = group;
            const config = resolveMailConfigForGroup(cityKey, riders, cityMailConfig);
            const sourceEmails = [
                ...new Set(riders.map((r) => r.email).filter((e) => e && e !== 'N/A' && e.includes('@'))),
            ].join(',');

            const { to: toRecipients, cc: ccRecipients } = resolveInactiveGroupedMailRecipients(config, {
                userCc: ccEmail,
                sourceEmails,
                leadershipFallback: LEADERSHIP_MAIL_TO,
            });

            if (!toRecipients) {
                skippedCount++;
                skippedCities.push(cityKey || cityLabel);
                continue;
            }

            const mailRiders = mapRidersToMailPayload(riders);
            const { subject, htmlBody } = buildInactiveGroupedMail({
                city: cityKey || cityLabel,
                daysThreshold: inactiveDays,
                riders: mailRiders,
            });

            try {
                await fetch(INACTIVE_MAILER_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        isGrouped: true,
                        email: toRecipients,
                        ccEmail: ccRecipients,
                        city: cityKey || cityLabel,
                        daysThreshold: inactiveDays,
                        subject,
                        htmlBody,
                        mailTemplateVersion: 2,
                        riders: mailRiders,
                    }),
                });
                sentCount++;
                riders.forEach((r) => setSentIds((prev) => new Set(prev).add(r.worker_code + '_mail')));
            } catch (err) {
                console.error(err);
                skippedCount++;
            }
        }
        setSendingAll(false);
        if (sentCount === 0 && skippedCities.length) {
            window.alert(
                `No mail sent. Missing To email for: ${skippedCities.join(', ')}. Check city mail sheet (City Key / CC Mail Id / To columns).`
            );
        }
    };

    const exportCSV = () => {
        const headers = ['Phone', 'Name', 'Rider ID', 'Worker Code', 'City', 'Hub', 'Client', 'Vehicle', 'Model', 'Status', 'SD', 'Rental Pending Amount', 'Email', 'Days Inactive', 'Last Active'];
        const rows = filtered.map(r => [
            r.mob_number, r.worker_name, r.riderId, r.worker_code, r.city, r.hubLocation, 
            r.client, r.vehicle, r.model, r.vehicleStatus, r.sdOverall,
            r.rentalPendingAmount ?? '',
            r.email, 
            r.daysSinceActive, r.lastActiveDate || 'Never'
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inactive_riders_${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) return <div className="loading-container"><span className="loader"></span></div>;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '0.5rem' }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Inactive Rider Mailer</h1>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', alignItems: 'center' }}>
                            <div className="status-badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 600, padding: '0.3rem 0.8rem' }}>{inactiveRiders.length} Total</div>
                            <div className="status-badge" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', fontWeight: 600, padding: '0.3rem 0.8rem' }}>{filtered.length} Filtered</div>
                            <div className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)', fontWeight: 600, padding: '0.3rem 0.8rem' }}>{ridersWithEmail.length} Ready</div>
                            <div className="status-badge" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', fontWeight: 600, padding: '0.3rem 0.8rem' }}>{uniqueEmailsFiltered} Unique Emails</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none', borderRadius: '10px', background: 'rgba(255,255,255,0.05)' }}>
                            <Mail size={14} style={{ color: 'var(--accent-blue)' }} />
                            <input
                                type="text"
                                placeholder="CC Email (Optional)..."
                                value={ccEmail}
                                onChange={e => setCcEmail(e.target.value)}
                                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '160px', fontSize: '0.8rem' }}
                            />
                        </div>
                        <button onClick={sendGroupedMails} disabled={sendingAll || ridersWithEmail.length === 0} style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', color: '#fff', border: 'none', borderRadius: '10px', cursor: sendingAll ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>
                            {sendingAll ? <Loader size={18} className="spin" /> : <Mail size={18} />} Send Grouped
                        </button>
                        <button onClick={exportCSV} className="glass" style={{ padding: '0.7rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', fontWeight: 600 }}><Download size={18} /> Export</button>
                    </div>
                </div>

                <div className="filter-bar" style={{ display: 'flex', gap: '0.75rem', width: '100%', flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none' }}>
                        <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Days Inactive:</span>
                        <select value={inactiveDays} onChange={e => setInactiveDays(Number(e.target.value))} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}>
                            <option value={3}>3+</option><option value={5}>5+</option><option value={7}>7+</option><option value={10}>10+</option><option value={15}>15+</option>
                        </select>
                    </div>
                    <MultiSelect 
                        label="Month" 
                        options={availableFilters.months} 
                        selected={selectedMonths} 
                        onChange={setSelectedMonths} 
                        icon={Calendar} 
                        color="var(--accent-purple)" 
                        placeholder="Search Month..."
                    />
                    <MultiSelect 
                        label="City" 
                        options={availableFilters.cities} 
                        selected={selectedCities} 
                        onChange={setSelectedCities} 
                        icon={MapPin} 
                        color="var(--accent-blue)" 
                        placeholder="Search City..."
                    />
                    <MultiSelect 
                        label="Client" 
                        options={availableFilters.clients} 
                        selected={selectedClients} 
                        onChange={setSelectedClients} 
                        icon={Users} 
                        color="#22c55e" 
                        placeholder="Search Client..."
                    />
                    <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none' }}>
                        <Mail size={14} style={{ color: 'var(--accent-amber)' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Mail:</span>
                        <select value={selectedEmail} onChange={e => setSelectedEmail(e.target.value)} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}>
                            <option value="ALL">All</option>
                            <option value="READY">Ready</option>
                            <option value="MISSING">Missing</option>
                        </select>
                    </div>
                    <MultiSelect 
                        label="Source" 
                        options={availableFilters.emails} 
                        selected={selectedEmailIds} 
                        onChange={setSelectedEmailIds} 
                        icon={Mail} 
                        color="var(--accent-blue)" 
                        placeholder="Search Source..."
                    />
                    <div className="glass" style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: 'none', marginLeft: 'auto' }}>
                        <Search size={14} style={{ color: 'var(--text-dim)' }} />
                        <input type="text" placeholder="Search..." value={searchTerm} onChange={handleSearchChange} style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '120px', fontSize: '0.8rem' }} />
                    </div>
                </div>
            </header>

            <section className="stats-grid">
                <div className="stat-card glass"><div className="label">Total Inactive</div><div className="value">{inactiveRiders.length.toLocaleString()}</div></div>
                <div className="stat-card glass"><div className="label">Ready to Mail</div><div className="value">{ridersWithEmail.length.toLocaleString()}</div></div>
                <div className="stat-card glass"><div className="label">Unique Emails (Filtered)</div><div className="value" style={{ color: '#a855f7' }}>{uniqueEmailsFiltered}</div></div>
                <div className="stat-card glass"><div className="label">Mails Sent</div><div className="value">{sentIds.size}</div></div>
            </section>

            <div className="table-card glass" style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                <table style={{ fontSize: '0.8rem', width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>#</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Rider ID</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Name</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>City / Hub</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Client</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Vehicle / Model</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status / SD</th>
                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Rental Pending</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left' }}>Contact</th>
                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Inactive Days</th>
                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedRows.length > 0 ? paginatedRows.map((r, i) => (
                            <tr key={r.riderId + r.worker_code} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ padding: '0.6rem 0.75rem' }}>{(currentPage - 1) * ROWS_PER_PAGE + i + 1}</td>
                                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--accent-blue)' }}>{r.riderId}</td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>
                                    <div style={{ fontWeight: 600 }}>{r.worker_name}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.source}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>
                                    <div>{r.city}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.hubLocation}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>{r.client || 'N/A'}</td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>
                                    <div style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>{r.vehicle}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.model}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>
                                    <div style={{ marginBottom: '4px' }}>
                                        <span className="status-badge" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem', background: r.vehicleStatus?.toLowerCase().includes('deploy') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.05)', color: r.vehicleStatus?.toLowerCase().includes('deploy') ? '#22c55e' : 'var(--text-dim)' }}>
                                            {r.vehicleStatus}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)', fontWeight: 600 }}>SD: ₹{r.sdOverall}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                                    {rentalPendingLoading ? (
                                        <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>…</span>
                                    ) : (
                                        <span style={{
                                            fontWeight: 600,
                                            color: parseRentalPendingAmount(r.rentalPendingAmount) > 0 ? '#f59e0b' : 'var(--text-dim)',
                                        }}>
                                            {formatRentalPendingDisplay(r.rentalPendingAmount)}
                                        </span>
                                    )}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem' }}>
                                    <div>{r.mob_number}</div>
                                    <div style={{ fontSize: '0.7rem', color: r.canSend ? '#22c55e' : '#ef4444', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: r.daysSinceActive > 10 ? '#ef4444' : '#f59e0b' }}>{r.daysSinceActive}</div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{r.lastActiveDate || 'Never'}</div>
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                        <button title="Send Email" onClick={() => sendMail(r)} disabled={!r.canSend || sendingIds.has(r.worker_code + '_mail')} style={{ padding: '0.4rem', borderRadius: '6px', cursor: 'pointer', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', color: 'var(--accent-blue)' }}>{sendingIds.has(r.worker_code + '_mail') ? <Loader size={14} className="spin" /> : <Mail size={14} />}</button>
                                        <button title="WhatsApp" onClick={() => sendWhatsApp(r)} style={{ padding: '0.4rem', borderRadius: '6px', cursor: 'pointer', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#22c55e' }}><MessageSquare size={14} /></button>
                                    </div>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan="11" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                                    No inactive riders found for the selected criteria.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span>Showing {((currentPage - 1) * ROWS_PER_PAGE) + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filtered.length)} of {filtered.length.toLocaleString()}</span>
                            <span style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', padding: '0.2rem 0.6rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.75rem' }}>📧 {uniqueEmailsPage} unique email{uniqueEmailsPage !== 1 ? 's' : ''} on this page</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                style={{ padding: '0.4rem 0.7rem', borderRadius: '8px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', opacity: currentPage === 1 ? 0.4 : 1 }}
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', minWidth: '80px', textAlign: 'center' }}>
                                Page {currentPage} / {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                style={{ padding: '0.4rem 0.7rem', borderRadius: '8px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', opacity: currentPage === totalPages ? 0.4 : 1 }}
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}} />
        </motion.div>
    );
};

export default InactiveRiderMailer;
