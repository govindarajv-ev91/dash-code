import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, differenceInDays } from 'date-fns';
import { Search, MapPin, User, Bike, Calendar, ChevronDown, ChevronUp, Activity, Package, Clock, Phone } from 'lucide-react';
import {
    buildFleetHistoryIndex,
    enrichRiderFromFleetRow,
    normalizeFleetStatus,
    resolveFleetHistoryForRider,
    countFleetSources,
    extractRiderIdAliases,
    normalizeInsightPhone,
    buildCurrentDeployLookup,
    lookupCurrentDeploy,
} from './lib/fleetInsightIndex';
import { parseFleetDate, vehiclePartitionKey } from './lib/fleetDeployReturnExport';
import { extractFleetSource, getCurrentlyDeployedAssignments, normalizeRiderIdKey } from './lib/riderPerformanceReport';
import { fetchEv91RiderDetails } from './lib/ev91RiderPerformance';
import { riderInsightIdentityKeys } from './lib/ev91RiderVehicleInsight';

function pickCanonicalRiderKey(workerCode) {
    const aliases = [...extractRiderIdAliases(workerCode)];
    if (!aliases.length) return normalizeRiderIdKey(workerCode) || String(workerCode || '').trim();
    const withPrefix = aliases.find((a) => /^[A-Z]{2,5}\d+$/i.test(a));
    if (withPrefix) return withPrefix.toUpperCase();
    return aliases.sort((a, b) => b.length - a.length)[0];
}

function phonesMatchSearch(mobile, searchRaw) {
    const searchDigits = (searchRaw || '').replace(/\D/g, '');
    if (!searchDigits) return false;
    const phone = normalizeInsightPhone(mobile);
    if (!phone) return false;
    if (searchDigits.length >= 10) return phone === searchDigits.slice(-10);
    return phone.includes(searchDigits) || searchDigits.includes(phone);
}

const VehicleTracking = ({
    fleetData,
    riderData,
    loading,
    includeEv91Api = false,
    pageTitle = 'Rider & Vehicle Insight',
    pageSubtitle = null,
}) => {
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
    const [ev91DetailsById, setEv91DetailsById] = useState(new Map());
    const [ev91ApiLoading, setEv91ApiLoading] = useState(includeEv91Api);
    const [ev91ApiError, setEv91ApiError] = useState('');

    useEffect(() => {
        if (!includeEv91Api) {
            setEv91DetailsById(new Map());
            setEv91ApiLoading(false);
            setEv91ApiError('');
            return;
        }
        let cancelled = false;
        setEv91ApiLoading(true);
        setEv91ApiError('');
        fetchEv91RiderDetails()
            .then((map) => {
                if (!cancelled) setEv91DetailsById(map || new Map());
            })
            .catch((err) => {
                console.warn('EV91 rider-details for monitor failed:', err);
                if (!cancelled) {
                    setEv91DetailsById(new Map());
                    setEv91ApiError(err?.message || 'EV91 rider details unavailable');
                }
            })
            .finally(() => {
                if (!cancelled) setEv91ApiLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [includeEv91Api]);

    const fleetSourceCounts = useMemo(() => countFleetSources(fleetData), [fleetData]);

    const currentlyDeployedAssignments = useMemo(
        () => getCurrentlyDeployedAssignments(fleetData || [], new Date()),
        [fleetData]
    );

    const currentDeployLookup = useMemo(
        () => buildCurrentDeployLookup(currentlyDeployedAssignments),
        [currentlyDeployedAssignments]
    );

    const baseProcessedRiderData = useMemo(() => {
        const today = new Date();
        const fleetIndex = buildFleetHistoryIndex(fleetData);
        const getParsedDate = (dateStr) => parseFleetDate(dateStr);
        const aliasToGroupKey = new Map();

        const resolveGroupKey = (workerCode) => {
            const aliases = [...extractRiderIdAliases(workerCode)];
            for (const alias of aliases) {
                if (aliasToGroupKey.has(alias)) return aliasToGroupKey.get(alias);
            }
            const canonical = pickCanonicalRiderKey(workerCode);
            for (const alias of aliases) aliasToGroupKey.set(alias, canonical);
            if (canonical) aliasToGroupKey.set(canonical, canonical);
            return canonical;
        };

        const riderGroups = new Map();
        for (const r of riderData || []) {
            if (!r.worker_code) continue;
            const groupKey = resolveGroupKey(r.worker_code);
            if (!groupKey) continue;

            const existing = riderGroups.get(groupKey) || {
                riderId: pickCanonicalRiderKey(r.worker_code) || r.worker_code,
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
                fromMetrics: true,
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

            const nextId = pickCanonicalRiderKey(r.worker_code);
            if (nextId && nextId.length >= String(existing.riderId || '').length) {
                existing.riderId = nextId;
            }

            riderGroups.set(groupKey, existing);
        }

        // Include currently deployed fleet riders missing from rider_metrics
        for (const assignment of currentlyDeployedAssignments) {
            const groupKey = resolveGroupKey(assignment.riderId) || normalizeInsightPhone(assignment.mobile);
            if (!groupKey) continue;
            if (riderGroups.has(groupKey)) continue;

            const phone = normalizeInsightPhone(assignment.mobile);
            let alreadyPresent = false;
            if (phone) {
                for (const rider of riderGroups.values()) {
                    if (normalizeInsightPhone(rider.mobile) === phone) {
                        alreadyPresent = true;
                        break;
                    }
                }
            }
            if (alreadyPresent) continue;

            riderGroups.set(groupKey, {
                riderId: assignment.riderId || groupKey,
                riderName: assignment.riderName || 'N/A',
                mobile: assignment.mobile || '',
                client: assignment.client || 'N/A',
                sourceName: assignment.source || 'N/A',
                city: assignment.city || 'N/A',
                totalOrders: 0,
                lastOrderDate: null,
                fleetCategory: 'EV',
                orderRecords: [],
                history: [],
                fleetDataSource: null,
                fromMetrics: false,
            });
        }

        const results = [];

        riderGroups.forEach((rider, groupKey) => {
            const rawHistory = resolveFleetHistoryForRider(
                { workerCode: rider.riderId, mobile: rider.mobile, name: rider.riderName },
                fleetIndex
            );

            if (rawHistory.length) {
                enrichRiderFromFleetRow(rider, rawHistory[rawHistory.length - 1]);
            }

            const finalHistory = [];
            const activeDeployments = new Map();

            rawHistory.forEach((rec) => {
                const date = getParsedDate(rec.date_record);
                if (!date) return;
                const vehicleNumberRaw = (rec.vehicle_number || '').toString().trim();
                const vehicleNumberKey = vehiclePartitionKey(vehicleNumberRaw) || vehicleNumberRaw.toUpperCase();
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
                            status: 'Returned',
                        });
                        activeDeployments.delete(vehicleNumberKey);
                    }
                }
            });

            // Authoritative current deploy: vehicle-centric fleet allotment
            const liveDeploy = lookupCurrentDeploy(currentDeployLookup, {
                workerCode: rider.riderId,
                mobile: rider.mobile,
            });

            if (liveDeploy) {
                enrichRiderFromFleetRow(rider, {
                    rider_name: liveDeploy.riderName,
                    client_name: liveDeploy.client,
                    city_locations: liveDeploy.city,
                    rider_contact_number: liveDeploy.mobile,
                    source_name: liveDeploy.source,
                });
                if (liveDeploy.mobile && !normalizeInsightPhone(rider.mobile)) {
                    rider.mobile = liveDeploy.mobile;
                }
            }

            const ongoingAssignments = [];
            for (const dep of activeDeployments.values()) {
                const vKey = vehiclePartitionKey(dep.vehicleNumber);
                const stillLive =
                    liveDeploy && vehiclePartitionKey(liveDeploy.vehicleNumber) === vKey;
                if (!stillLive) continue;
                ongoingAssignments.push({
                    ...dep,
                    returnDate: null,
                    daysOnRoad: differenceInDays(today, dep.deployeeDate),
                    status: 'Deployed',
                });
            }

            if (liveDeploy && ongoingAssignments.length === 0) {
                ongoingAssignments.push({
                    vehicleNumber: liveDeploy.vehicleNumber,
                    deployeeDate: liveDeploy.deployDate || today,
                    cityName: liveDeploy.city || rider.city,
                    clientName: liveDeploy.client || rider.client,
                    sourceName: liveDeploy.source || rider.sourceName,
                    returnDate: null,
                    daysOnRoad:
                        liveDeploy.allotmentDays ??
                        differenceInDays(today, liveDeploy.deployDate || today),
                    status: 'Deployed',
                });
            }

            const combinedHistory = [...ongoingAssignments, ...finalHistory]
                .map((asgn) => {
                    const fromDate = asgn.deployeeDate;
                    const toDate = asgn.returnDate || today;
                    const periodOrders = (rider.orderRecords || []).reduce((sum, rec) => {
                        if (rec.date >= fromDate && rec.date <= toDate) return sum + (rec.delivered || 0);
                        return sum;
                    }, 0);

                    return {
                        ...asgn,
                        periodOrders,
                    };
                })
                .sort((a, b) => b.deployeeDate - a.deployeeDate);

            const currentAssignment = liveDeploy
                ? {
                      vehicleNumber: liveDeploy.vehicleNumber,
                      deployeeDate: liveDeploy.deployDate,
                  }
                : null;
            const totalOnRoadDays = combinedHistory.reduce((sum, h) => sum + h.daysOnRoad, 0);
            const deployedAssignmentsCount = currentAssignment ? 1 : 0;
            const returnedAssignmentsCount = combinedHistory.filter((h) => h.status === 'Returned').length;
            const averageAssignmentDays =
                combinedHistory.length > 0 ? Math.round(totalOnRoadDays / combinedHistory.length) : 0;

            const daysSinceLastOrder = rider.lastOrderDate ? differenceInDays(today, rider.lastOrderDate) : 999;
            const riderActiveStatus = currentAssignment || daysSinceLastOrder <= 30 ? 'Active' : 'Inactive';
            const statusDetail =
                riderActiveStatus === 'Inactive' && rider.lastOrderDate ? `${daysSinceLastOrder}d` : '';

            let fleetRemark = rider.fleetCategory || 'Unknown';
            let fleetStatusClass = 'unknown';
            let fleetType = 'UNKNOWN';

            if (currentAssignment) {
                fleetRemark = 'EV';
                fleetStatusClass = 'ev';
                fleetType = 'EV';
            } else if (rider.fleetCategory === 'EV') {
                fleetRemark = riderActiveStatus === 'Active' ? 'Non-EV (Own Bike)' : 'Non-EV (Returned)';
                fleetStatusClass = 'non-ev';
                fleetType = 'NON-EV';
            } else if (rider.fleetCategory === 'NON-EV') {
                fleetRemark = 'Non-EV';
                fleetStatusClass = 'non-ev';
                fleetType = 'NON-EV';
            }

            results.push({
                ...rider,
                groupKey,
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
                assignments: combinedHistory,
            });
        });

        return results.sort((a, b) => b.totalOrders - a.totalOrders);
    }, [fleetData, riderData, currentlyDeployedAssignments, currentDeployLookup]);

    const processedRiderData = useMemo(() => {
        if (!includeEv91Api || !ev91DetailsById?.size) return baseProcessedRiderData;

        const lookup = new Map();
        for (const row of baseProcessedRiderData) {
            for (const key of riderInsightIdentityKeys({
                publicRiderId: row.ev91PublicId || row.riderId,
                clientRiderId: row.riderId,
                phone: row.mobile,
            })) {
                lookup.set(key, row);
            }
        }

        const merged = baseProcessedRiderData.map((row) => {
            const detail =
                ev91DetailsById.get(row.riderId) ||
                ev91DetailsById.get(row.ev91PublicId) ||
                (row.mobile ? ev91DetailsById.get(row.mobile) : null) ||
                (row.mobile ? ev91DetailsById.get(normalizeInsightPhone(row.mobile)) : null);
            if (!detail) return row;

            const assigned = (detail.assignedVehicleId || '').toString().trim();
            const hasAssignedVehicle = assigned && !/not\s*assign/i.test(assigned);
            const next = {
                ...row,
                ev91PublicId: detail.publicRiderID || row.ev91PublicId || '',
                riderName: row.riderName && row.riderName !== 'N/A' ? row.riderName : detail.name || row.riderName,
                mobile: row.mobile || detail.phone || row.mobile,
                client: row.client && row.client !== 'N/A' ? row.client : detail.clientName || row.client,
                city: row.city && row.city !== 'N/A' ? row.city : detail.city || row.city,
                sourceName: row.sourceName && row.sourceName !== 'N/A' ? row.sourceName : detail.source || row.sourceName,
            };
            if (next.currentVehicle === 'None' && hasAssignedVehicle) {
                next.currentVehicle = assigned;
                next.currentStatus = 'Deployed';
                next.fleetRemark = 'EV';
                next.fleetStatusClass = 'ev';
                next.fleetType = 'EV';
            }
            if (detail.isActive === false && next.riderActiveStatus === 'Active' && next.currentVehicle === 'None') {
                next.riderActiveStatus = 'Inactive';
            }
            return next;
        });

        const seenPublic = new Set(
            merged.map((r) => (r.ev91PublicId || '').toString().trim()).filter(Boolean)
        );

        for (const detail of ev91DetailsById.values()) {
            const publicId = (detail.publicRiderID || '').toString().trim();
            if (!publicId || seenPublic.has(publicId)) continue;

            const keys = riderInsightIdentityKeys({
                publicRiderId: publicId,
                clientRiderId: detail.clientRiderId,
                phone: detail.phone,
            });
            if (keys.some((k) => lookup.has(k))) continue;

            seenPublic.add(publicId);
            const assigned = (detail.assignedVehicleId || '').toString().trim();
            const hasVehicle = assigned && !/not\s*assign/i.test(assigned);
            const groupKey = publicId;
            merged.push({
                riderId: detail.clientRiderId || publicId,
                ev91PublicId: publicId,
                riderName: detail.name || 'N/A',
                mobile: detail.phone || '',
                client: detail.clientName || 'N/A',
                sourceName: detail.source || 'N/A',
                city: detail.city || 'N/A',
                totalOrders: 0,
                lastOrderDate: null,
                fleetCategory: detail.needEvRental ? 'EV' : 'Unknown',
                orderRecords: [],
                history: [],
                fleetDataSource: 'EV91 API',
                fromMetrics: false,
                fromEv91Api: true,
                groupKey,
                currentVehicle: hasVehicle ? assigned : 'None',
                currentStatus: hasVehicle ? 'Deployed' : 'No Active Vehicle',
                totalOnRoadDays: 0,
                riderActiveStatus: detail.isActive === false ? 'Inactive' : 'Active',
                statusDetail: '',
                fleetRemark: hasVehicle || detail.needEvRental ? 'EV' : 'Unknown',
                fleetStatusClass: hasVehicle || detail.needEvRental ? 'ev' : 'unknown',
                fleetType: detail.needEvRental ? 'EV' : 'UNKNOWN',
                deployedAssignmentsCount: hasVehicle ? 1 : 0,
                returnedAssignmentsCount: 0,
                averageAssignmentDays: 0,
                assignments: [],
            });
        }

        return merged.sort((a, b) => b.totalOrders - a.totalOrders);
    }, [baseProcessedRiderData, includeEv91Api, ev91DetailsById]);

    const clients = useMemo(() => {
        const set = new Set(processedRiderData.map((d) => d.client).filter((c) => c && c !== 'N/A'));
        return ['All', ...Array.from(set).sort()];
    }, [processedRiderData]);

    const filteredData = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        const fromDate = dateFrom ? new Date(dateFrom) : null;
        const toDate = dateTo ? new Date(dateTo) : null;

        if (toDate) {
            toDate.setHours(23, 59, 59, 999);
        }

        return processedRiderData.filter((item) => {
            const matchesSearch =
                s === '' ||
                (item.riderName || '').toLowerCase().includes(s) ||
                (item.riderId || '').toString().toLowerCase().includes(s) ||
                (item.currentVehicle || '').toString().toLowerCase().includes(s) ||
                (item.mobile || '').toLowerCase().includes(s) ||
                phonesMatchSearch(item.mobile, searchTerm);

            const matchesStatus = filterStatus === 'All' || item.currentStatus === filterStatus;
            const matchesClient = filterClient === 'All' || item.client === filterClient;
            const matchesFleet = filterFleetType === 'All' || item.fleetType === filterFleetType;
            const matchesRiderStatus =
                filterRiderStatus === 'All' || item.riderActiveStatus === filterRiderStatus;
            const matchesDateRange =
                (!fromDate && !toDate) ||
                item.assignments.some((asgn) => {
                    const d = asgn.deployeeDate;
                    if (!d) return false;
                    if (fromDate && d < fromDate) return false;
                    if (toDate && d > toDate) return false;
                    return true;
                });

            return (
                matchesSearch &&
                matchesStatus &&
                matchesClient &&
                matchesFleet &&
                matchesRiderStatus &&
                matchesDateRange
            );
        });
    }, [
        processedRiderData,
        searchTerm,
        filterStatus,
        filterClient,
        filterFleetType,
        filterRiderStatus,
        dateFrom,
        dateTo,
    ]);

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

        const deployedVehicles = new Set();
        for (const item of filteredData) {
            if (item.currentStatus === 'Deployed' && item.currentVehicle && item.currentVehicle !== 'None') {
                const key =
                    vehiclePartitionKey(item.currentVehicle) || String(item.currentVehicle).toUpperCase();
                if (key) deployedVehicles.add(key);
            }
        }

        const hasActiveFilters =
            Boolean(searchTerm.trim()) ||
            filterStatus !== 'All' ||
            filterClient !== 'All' ||
            filterFleetType !== 'All' ||
            filterRiderStatus !== 'All' ||
            Boolean(dateFrom) ||
            Boolean(dateTo);

        // Unfiltered: use vehicle-centric fleet allotment (same as Fleet Current Deployed).
        // Filtered: unique deployed vehicles in the visible rider set.
        const deployedNow = hasActiveFilters
            ? deployedVehicles.size
            : currentlyDeployedAssignments.length;

        const totalOnRoadDays = filteredData.reduce((sum, item) => sum + (item.totalOnRoadDays || 0), 0);
        return { totalRiders, totalAssignments, deployedNow, totalOnRoadDays };
    }, [
        filteredData,
        searchTerm,
        filterStatus,
        filterClient,
        filterFleetType,
        filterRiderStatus,
        dateFrom,
        dateTo,
        currentlyDeployedAssignments,
    ]);

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
        pageSize,
    ]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleSort = (key) => {
        setSortConfig((prev) => {
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

        const lines = item.assignments.map((asgn) => {
            const rangeText = `${format(asgn.deployeeDate, 'dd MMM yyyy')} - ${asgn.returnDate ? format(asgn.returnDate, 'dd MMM yyyy') : 'Now'}`;
            return `${asgn.vehicleNumber}: ${asgn.daysOnRoad} days (${asgn.status}) | ${rangeText}`;
        });

        return lines.join('\n');
    };

    const getPerformanceTooltip = (item) => {
        if (!item.assignments || item.assignments.length === 0) {
            return 'No assignment history available';
        }

        const lines = item.assignments.map((asgn) => {
            const rangeText = `${format(asgn.deployeeDate, 'dd MMM yyyy')} - ${asgn.returnDate ? format(asgn.returnDate, 'dd MMM yyyy') : 'Till Date'}`;
            return `${asgn.vehicleNumber}: ${asgn.periodOrders || 0} orders | ${rangeText}`;
        });

        return lines.join('\n');
    };

    if (loading || (includeEv91Api && ev91ApiLoading && !baseProcessedRiderData.length && !fleetData?.length))
        return (
            <div className="loading-container">
                <span className="loader"></span>
            </div>
        );

    const resolvedSubtitle =
        pageSubtitle ??
        `Deploy/return dates from merged Fleet Data (${fleetSourceCounts.total.toLocaleString()} rows: ${fleetSourceCounts.legacy.toLocaleString()} database + ${fleetSourceCounts.form.toLocaleString()} new fleet)${includeEv91Api ? ' · EV91 Rider Details API merged' : ''}`;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
            <header className="header">
                <div>
                    <h1>{pageTitle}</h1>
                    <p style={{ color: 'var(--text-dim)' }}>{resolvedSubtitle}</p>
                    {ev91ApiError ? (
                        <p style={{ color: '#fbbf24', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                            EV91 API: {ev91ApiError} — showing Fleet / metrics data only.
                        </p>
                    ) : null}
                </div>
            </header>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gap: '0.9rem',
                    marginBottom: '1rem',
                }}
            >
                <div
                    className="glass"
                    style={{
                        padding: '0.95rem',
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255,255,255,0.16)',
                    }}
                >
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Total Riders
                    </div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{summaryStats.totalRiders}</div>
                </div>
                <div
                    className="glass"
                    style={{
                        padding: '0.95rem',
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255,255,255,0.16)',
                    }}
                >
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Total Assignments
                    </div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{summaryStats.totalAssignments}</div>
                </div>
                <div
                    className="glass"
                    style={{
                        padding: '0.95rem',
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255,255,255,0.16)',
                    }}
                >
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Currently Deployed
                    </div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent-blue)' }}>
                        {summaryStats.deployedNow}
                    </div>
                </div>
                <div
                    className="glass"
                    style={{
                        padding: '0.95rem',
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255,255,255,0.16)',
                    }}
                >
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Total On-Road Days
                    </div>
                    <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent-green)' }}>
                        {summaryStats.totalOnRoadDays}
                    </div>
                </div>
            </div>

            <div className="filters-container glass" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', width: '100%' }}>
                    <div className="filter-group" style={{ flex: 1, minWidth: '300px' }}>
                        <label className="filter-label">Search Rider / ID / Phone / Vehicle</label>
                        <div
                            className="glass"
                            style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                        >
                            <Activity size={18} className="text-primary" />
                            <select
                                value={filterRiderStatus}
                                onChange={(e) => setFilterRiderStatus(e.target.value)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#fff',
                                    outline: 'none',
                                    cursor: 'pointer',
                                }}
                            >
                                <option value="All" style={{ background: '#1a1a1a' }}>
                                    All Rider Status
                                </option>
                                <option value="Active" style={{ background: '#1a1a1a' }}>
                                    Active
                                </option>
                                <option value="Inactive" style={{ background: '#1a1a1a' }}>
                                    Inactive
                                </option>
                            </select>
                        </div>

                        <div
                            className="glass"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0.5rem 1rem',
                                gap: '0.75rem',
                                flex: 1,
                            }}
                        >
                            <Search size={18} className="text-dim" />
                            <input
                                type="text"
                                placeholder="Search rider name, ID, phone, or vehicle..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#fff',
                                    width: '100%',
                                    outline: 'none',
                                }}
                            />
                        </div>
                    </div>

                    <div className="filter-group">
                        <label className="filter-label">Client</label>
                        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                            {clients.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
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
                            style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                padding: '0.6rem 1rem',
                                borderRadius: '0.5rem',
                                outline: 'none',
                                minWidth: '180px',
                            }}
                        />
                    </div>

                    <div className="filter-group">
                        <label className="filter-label">Date To</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: '#fff',
                                padding: '0.6rem 1rem',
                                borderRadius: '0.5rem',
                                outline: 'none',
                                minWidth: '180px',
                            }}
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
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('rider')}>
                                    Rider / ID / Phone{renderSortArrow('rider')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('client')}>
                                    Client / City{renderSortArrow('client')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('currentVehicle')}>
                                    Current Vehicle{renderSortArrow('currentVehicle')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalOrders')}>
                                    Performance{renderSortArrow('totalOrders')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('lastOrderDate')}>
                                    Last Order Date{renderSortArrow('lastOrderDate')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('fleetType')}>
                                    Fleet Type{renderSortArrow('fleetType')}
                                </th>
                                <th>Vehicle Remark</th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('riderStatus')}>
                                    Rider Status{renderSortArrow('riderStatus')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('totalOnRoadDays')}>
                                    Total On-Road{renderSortArrow('totalOnRoadDays')}
                                </th>
                                <th style={{ cursor: 'pointer' }} onClick={() => handleSort('history')}>
                                    History{renderSortArrow('history')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.map((item) => (
                                <React.Fragment key={item.groupKey || item.riderId}>
                                    <tr>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontWeight: 700, color: '#fff' }}>{item.riderName}</div>
                                                <div
                                                    style={{
                                                        fontSize: '0.75rem',
                                                        color: 'var(--text-dim)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}
                                                >
                                                    <User size={12} />
                                                    {item.riderId}
                                                </div>
                                                {item.mobile ? (
                                                    <div
                                                        style={{
                                                            fontSize: '0.75rem',
                                                            color: 'var(--accent-blue)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                        }}
                                                    >
                                                        <Phone size={12} />
                                                        {item.mobile}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <div style={{ fontWeight: 600, color: 'var(--accent-purple)' }}>
                                                    {item.client}
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: '0.75rem',
                                                        color: 'var(--text-dim)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                    }}
                                                >
                                                    <MapPin size={12} /> {item.city}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {item.currentVehicle !== 'None' ? (
                                                    <div
                                                        className="status-badge deployee"
                                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                                    >
                                                        <Bike size={14} />
                                                        {item.currentVehicle}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                                        None
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '2px',
                                                    cursor: 'help',
                                                }}
                                                title={getPerformanceTooltip(item)}
                                            >
                                                <div
                                                    style={{
                                                        fontWeight: 700,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                    }}
                                                >
                                                    <Package size={14} className="text-primary" />
                                                    {item.totalOrders}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                                                    TOTAL DELIVERED (HOVER FOR RANGE-ORDER)
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    color: '#fff',
                                                }}
                                            >
                                                <Calendar size={14} className="text-dim" />
                                                {item.lastOrderDate
                                                    ? format(item.lastOrderDate, 'dd MMM yyyy')
                                                    : 'N/A'}
                                            </div>
                                        </td>
                                        <td>
                                            <span
                                                className={`status-badge ${item.fleetType === 'EV' ? 'ev' : item.fleetType === 'NON-EV' ? 'non-ev' : 'unknown'}`}
                                            >
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
                                                <span
                                                    className={`status-badge ${item.riderActiveStatus.toLowerCase()}`}
                                                >
                                                    {item.riderActiveStatus}
                                                </span>
                                                {item.statusDetail && (
                                                    <span
                                                        style={{
                                                            fontSize: '0.7rem',
                                                            color: 'var(--text-dim)',
                                                            background: 'rgba(255,255,255,0.05)',
                                                            padding: '2px 4px',
                                                            borderRadius: '4px',
                                                        }}
                                                    >
                                                        {item.statusDetail}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '2px',
                                                    cursor: 'help',
                                                }}
                                                title={getOnRoadTooltip(item)}
                                            >
                                                <div
                                                    style={{
                                                        fontWeight: 700,
                                                        color: 'var(--accent-blue)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                    }}
                                                >
                                                    <Clock size={14} />
                                                    {item.totalOnRoadDays} Days
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                                                    ON-ROAD LIFE (HOVER FOR DETAILS)
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <button
                                                onClick={() =>
                                                    setExpandedRider(
                                                        expandedRider === (item.groupKey || item.riderId)
                                                            ? null
                                                            : item.groupKey || item.riderId
                                                    )
                                                }
                                                className="glass"
                                                style={{
                                                    padding: '0.4rem 0.8rem',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    color: '#fff',
                                                    fontSize: '0.8rem',
                                                }}
                                            >
                                                {item.assignments.length} assignments{' '}
                                                {expandedRider === (item.groupKey || item.riderId) ? (
                                                    <ChevronUp size={14} />
                                                ) : (
                                                    <ChevronDown size={14} />
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                    <AnimatePresence>
                                        {expandedRider === (item.groupKey || item.riderId) && (
                                            <tr>
                                                <td
                                                    colSpan="10"
                                                    style={{ padding: '0', background: 'rgba(255,255,255,0.02)' }}
                                                >
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        style={{ overflow: 'hidden', padding: '1.5rem' }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'grid',
                                                                gridTemplateColumns:
                                                                    'repeat(auto-fill, minmax(280px, 1fr))',
                                                                gap: '1rem',
                                                            }}
                                                        >
                                                            {item.assignments.map((asgn, i) => (
                                                                <div
                                                                    key={i}
                                                                    className="glass"
                                                                    style={{
                                                                        padding: '1rem',
                                                                        background: 'rgba(255,255,255,0.03)',
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            justifyContent: 'space-between',
                                                                            marginBottom: '0.5rem',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                fontWeight: 700,
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '6px',
                                                                            }}
                                                                        >
                                                                            <Bike size={16} className="text-primary" />
                                                                            {asgn.vehicleNumber}
                                                                        </div>
                                                                        <span
                                                                            className={`status-badge ${asgn.status.toLowerCase()}`}
                                                                        >
                                                                            {asgn.status}
                                                                        </span>
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '0.8rem',
                                                                            color: 'var(--text-dim)',
                                                                            display: 'flex',
                                                                            flexDirection: 'column',
                                                                            gap: '4px',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                            }}
                                                                        >
                                                                            <span>Duration:</span>
                                                                            <span style={{ color: '#fff' }}>
                                                                                {asgn.daysOnRoad} Days
                                                                            </span>
                                                                        </div>
                                                                        <div
                                                                            style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                            }}
                                                                        >
                                                                            <span>From:</span>
                                                                            <span style={{ color: '#fff' }}>
                                                                                {format(asgn.deployeeDate, 'dd MMM yyyy')}
                                                                            </span>
                                                                        </div>
                                                                        <div
                                                                            style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                            }}
                                                                        >
                                                                            <span>To:</span>
                                                                            <span style={{ color: '#fff' }}>
                                                                                {asgn.returnDate
                                                                                    ? format(
                                                                                          asgn.returnDate,
                                                                                          'dd MMM yyyy'
                                                                                      )
                                                                                    : 'Now'}
                                                                            </span>
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
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '1rem 1.5rem',
                        borderTop: '1px solid var(--border-color)',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: 'var(--text-dim)',
                            fontSize: '0.85rem',
                        }}
                    >
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
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{
                                padding: '0.4rem 0.8rem',
                                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                color: '#fff',
                                opacity: currentPage === 1 ? 0.5 : 1,
                            }}
                        >
                            Prev
                        </button>
                        <div
                            style={{
                                fontSize: '0.85rem',
                                color: 'var(--text-dim)',
                                minWidth: '90px',
                                textAlign: 'center',
                            }}
                        >
                            Page {currentPage} / {totalPages}
                        </div>
                        <button
                            className="glass"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            style={{
                                padding: '0.4rem 0.8rem',
                                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                color: '#fff',
                                opacity: currentPage === totalPages ? 0.5 : 1,
                            }}
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
