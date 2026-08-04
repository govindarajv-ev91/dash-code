import React, { useState, useMemo, useDeferredValue, useEffect, useCallback } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  TrendingUp, Users, Truck, Calendar, Activity, 
  ArrowUpRight, ArrowDownRight, RefreshCw, Search, X
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import {
  toMetricDateKey,
  selectOverviewOrderRows,
} from './lib/mergeRiderMetrics';
import { buildMasterSheetRows, filterMasterSheetRows } from './lib/fleetMasterSheet';
import { parseFleetDate } from './lib/fleetDeployReturnExport';
import { getFleetDeployReturnCounts } from './lib/riderPerformanceReport';
import {
  fetchEv91MisData,
  fetchAllEv91MisData,
  summarizeCurrentStatusRows,
  currentStatusDistributionSeries,
  countOverallDeployReturnInRange,
  EV91_WEBAPP_CUTOVER_DATE,
  EV91_FLEET_DATA_UNTIL_DATE,
} from './lib/ev91MisApi';
import { fetchEv91OverallStatusAll } from './lib/ev91EvLookup';

const COLORS = ['#6366f1', '#38bdf8', '#a855f7', '#fb7185', '#4ade80'];
const FLEET_TABLE_LIMIT = 10;

function countFleetDeployReturnEvents(masterRows) {
  let deployed = 0
  let returned = 0
  const seen = new Set()
  for (const row of masterRows || []) {
    const key = `${row.vehicleNumber}|${format(row.date, 'yyyy-MM-dd')}|${row.vehicleStatus}`
    if (seen.has(key)) continue
    seen.add(key)
    if (row.vehicleStatus === 'Deployee') deployed++
    else if (row.vehicleStatus === 'Return') returned++
  }
  return { deployed, returned }
}

function buildOrderDailyIndex(rows) {
  const byDate = new Map();
  const ridersByDate = new Map();

  for (const curr of rows || []) {
    const date = toMetricDateKey(curr.date_record);
    if (!date) continue;

    const delivered = parseInt(curr.delivered, 10) || 0;
    if (!byDate.has(date)) byDate.set(date, { date, ev: 0, nonEv: 0, total: 0 });
    const bucket = byDate.get(date);
    bucket.total += delivered;

    const t1 = String(curr.type1 || '').toUpperCase();
    const t2 = String(curr.type2 || '').toUpperCase();
    const isEv1 = t1.includes('EV') && !t1.includes('NON');
    const isEv2 = t2.includes('EV') && !t2.includes('NON');
    if (isEv1 || isEv2) bucket.ev += delivered;
    else bucket.nonEv += delivered;

    if (delivered > 0 && curr.worker_code) {
      if (!ridersByDate.has(date)) ridersByDate.set(date, new Set());
      ridersByDate.get(date).add(curr.worker_code);
    }
  }

  return { byDate, ridersByDate };
}

const Dashboard = ({ riderData, fleetData, weeklyData, loading, refreshData }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [ev91StatusSummary, setEv91StatusSummary] = useState(null);
  const [ev91StatusLoading, setEv91StatusLoading] = useState(true);
  const [ev91StatusError, setEv91StatusError] = useState('');
  const [ev91OverallRows, setEv91OverallRows] = useState([]);
  const [ev91OverallLoading, setEv91OverallLoading] = useState(true);
  const deferredRiderData = useDeferredValue(riderData);
  const deferredFleetData = useDeferredValue(fleetData);
  const deferredSearch = useDeferredValue(searchTerm);

  const loadEv91CurrentStatus = useCallback(async () => {
    setEv91StatusLoading(true);
    setEv91StatusError('');
    try {
      const page = await fetchEv91MisData('current-status', { limit: 1, offset: 0 });
      let summary = summarizeCurrentStatusRows(page.data, page.summary);
      const hasAny =
        (summary.deployed || 0) + (summary.returned || 0) + (summary.yetNotDeployed || 0) > 0;
      if (!hasAny) {
        const all = await fetchAllEv91MisData('current-status');
        summary = summarizeCurrentStatusRows(all.data, all.summary);
      }
      setEv91StatusSummary(summary);
    } catch (err) {
      console.warn('EV91 current-status load failed:', err);
      setEv91StatusSummary(null);
      setEv91StatusError(err?.message || 'Failed to load EV91 current status');
    } finally {
      setEv91StatusLoading(false);
    }
  }, []);

  const loadEv91OverallStatus = useCallback(async () => {
    setEv91OverallLoading(true);
    try {
      const result = await fetchEv91OverallStatusAll({ force: false });
      setEv91OverallRows(result.data || []);
    } catch (err) {
      console.warn('EV91 overall-status load failed:', err);
      setEv91OverallRows([]);
    } finally {
      setEv91OverallLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEv91CurrentStatus();
    loadEv91OverallStatus();
  }, [loadEv91CurrentStatus, loadEv91OverallStatus]);

  // Effective filter: one date filled = that single day (not open-ended range).
  const filterFrom = startDate || endDate || ''
  const filterTo = endDate || startDate || ''

  const overviewOrderRows = useMemo(
    () => selectOverviewOrderRows(deferredRiderData),
    [deferredRiderData]
  );

  const overviewOrdersFromUpload = useMemo(
    () => (deferredRiderData || []).some((r) => r?._data_source === 'order_upload'),
    [deferredRiderData]
  );

  const orderDailyIndex = useMemo(
    () => buildOrderDailyIndex(overviewOrderRows),
    [overviewOrderRows]
  );

  const ordersByDate = useMemo(() => {
    const out = [];
    for (const bucket of orderDailyIndex.byDate.values()) {
      const date = bucket.date;
      if (filterFrom && date < filterFrom) continue;
      if (filterTo && date > filterTo) continue;
      out.push(bucket);
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [orderDailyIndex, filterFrom, filterTo]);

  const masterSheetRows = useMemo(
    () => buildMasterSheetRows(deferredFleetData),
    [deferredFleetData]
  );

  const fleetSnapshot = useMemo(
    () => getFleetDeployReturnCounts(deferredFleetData, new Date()),
    [deferredFleetData]
  );

  const combinedVehicles = useMemo(() => {
    const map = new Map();

    const parseCustomDate = (dateStr) => {
      if (!dateStr) return null;
      if (dateStr.includes('/')) {
        const [dd, mm, part] = dateStr.split('/');
        if (!part) return null;
        const yyyy = part.split(' ')[0] || new Date().getFullYear();
        const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
        return isNaN(d.getTime()) ? null : d;
      }
      if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        let d;
        if (parts[0].length === 4) d = new Date(dateStr);
        else d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
        return isNaN(d.getTime()) ? null : d;
      }
      const plainDate = new Date(dateStr);
      return isNaN(plainDate.getTime()) ? null : plainDate;
    };

    deferredFleetData.forEach(item => {
      const vNum = item.vehicle_number || 'Unknown Vehicle';
      const rName = item.rider_name || item.rider_id || 'Unknown Rider';
      const key = vNum; 
      
      if (!map.has(key)) {
        map.set(key, {
            id: item.id || key,
            vehicle_number: vNum,
            rider_name: rName,
            city: item.city_locations,
            deployed_date: null,
            returned_date: null,
            deployed_obj: null,
            returned_obj: null,
            status: item.vehicle_status || 'Unknown',
            latest_obj: null
        });
      }
      
      const record = map.get(key);
      const rawStatus = item.vehicle_status || '';
      const statusLower = rawStatus.toLowerCase();

      // Use created_at (ISO timestamp) for reliable ordering of latest status
      const createdAt = item.created_at ? new Date(item.created_at) : null;
      if (createdAt && (!record.latest_obj || createdAt > record.latest_obj)) {
          record.status = rawStatus;
          record.latest_obj = createdAt;
      } else if (!record.latest_obj && rawStatus) {
          record.status = rawStatus;
      }

      // Track deployed/returned dates from dedicated date columns
      const deployDateVal = item.bike_deployed_date_sd_refund_request;
      const returnDateVal = item.bike_return_date_sd_refund_request;
      const eventDate = parseFleetDate(item.date_record);
      const deployParsed = parseCustomDate(deployDateVal) || (statusLower.includes('deploy') ? eventDate : null);
      const returnParsed = parseCustomDate(returnDateVal) || (statusLower === 'return' ? eventDate : null);

      if (statusLower.includes('deploy')) {
         const parsedDate = deployParsed || createdAt;
         if (!record.deployed_obj || (parsedDate && parsedDate > record.deployed_obj)) {
             record.deployed_date = item.date_record || deployDateVal || item.created_at;
             record.deployed_obj = parsedDate;
         }
      } else if (statusLower.includes('return')) {
         const parsedDate = returnParsed || createdAt;
         if (!record.returned_obj || (parsedDate && parsedDate > record.returned_obj)) {
             record.returned_date = item.date_record || returnDateVal || item.created_at;
             record.returned_obj = parsedDate;
         }
      }
    });

    return Array.from(map.values()).map(record => {
       let duration = 'N/A';
       if (record.deployed_obj && record.returned_obj) {
           const diffTime = record.returned_obj - record.deployed_obj;
           if (diffTime >= 0) duration = `${Math.ceil(diffTime / (1000 * 60 * 60 * 24))} Days`;
           else duration = '0 Days';
       } else if (record.deployed_obj) {
           const diffTime = new Date() - record.deployed_obj;
           duration = `${Math.floor(diffTime / (1000 * 60 * 60 * 24))} Days (Active)`;
       }
       return { ...record, duration };
    }).sort((a,b) => {
       const timeA = a.deployed_obj ? a.deployed_obj.getTime() : 0;
       const timeB = b.deployed_obj ? b.deployed_obj.getTime() : 0;
       return timeB - timeA;
    });
  }, [deferredFleetData]);

  const stats = useMemo(() => {
    let totalOrders = 0;
    const activeCodes = new Set();

    for (const [date, bucket] of orderDailyIndex.byDate) {
      if (filterFrom && date < filterFrom) continue;
      if (filterTo && date > filterTo) continue;
      totalOrders += bucket.total;
      const riders = orderDailyIndex.ridersByDate.get(date);
      if (riders) riders.forEach((code) => activeCodes.add(code));
    }

    let activeVehicles = 0;
    let returnedVehicles = 0;
    let vehicleSource = 'fleet'; // fleet | api | mixed

    if (!filterFrom && !filterTo) {
      activeVehicles = fleetSnapshot.deployed;
      returnedVehicles = fleetSnapshot.returned;
      vehicleSource = 'fleet';
    } else {
      const rangeFrom = filterFrom;
      const rangeTo = filterTo;

      // Before cutover → fleet master Deployee/Return
      const fleetFrom = rangeFrom;
      const fleetTo =
        rangeTo < EV91_WEBAPP_CUTOVER_DATE ? rangeTo : EV91_FLEET_DATA_UNTIL_DATE;
      if (fleetFrom <= fleetTo) {
        const fleetSlice = filterMasterSheetRows(masterSheetRows, {
          city: 'All',
          startDate: fleetFrom,
          endDate: fleetTo,
        });
        const fleetCounts = countFleetDeployReturnEvents(fleetSlice);
        activeVehicles += fleetCounts.deployed;
        returnedVehicles += fleetCounts.returned;
      }

      // On/after cutover → EV91 Overall Status API (status date in range)
      const apiFrom =
        rangeFrom > EV91_WEBAPP_CUTOVER_DATE ? rangeFrom : EV91_WEBAPP_CUTOVER_DATE;
      const apiTo = rangeTo;
      if (apiFrom <= apiTo) {
        const apiCounts = countOverallDeployReturnInRange(ev91OverallRows, {
          startDate: apiFrom,
          endDate: apiTo,
        });
        activeVehicles += apiCounts.deployed;
        returnedVehicles += apiCounts.returned;
        vehicleSource = fleetFrom <= fleetTo ? 'mixed' : 'api';
      } else {
        vehicleSource = 'fleet';
      }
    }

    let dateStr = 'All Time';
    if (filterFrom && filterTo && filterFrom === filterTo) dateStr = filterFrom;
    else if (filterFrom && filterTo) dateStr = `${filterFrom} to ${filterTo}`;
    else if (filterFrom) dateStr = `Since ${filterFrom}`;
    else if (filterTo) dateStr = `Until ${filterTo}`;

    let vehicleChange = dateStr;
    if (vehicleSource === 'api') vehicleChange = `${dateStr} · EV91 API`;
    else if (vehicleSource === 'mixed') vehicleChange = `${dateStr} · Fleet+API`;
    else if (filterFrom || filterTo) vehicleChange = `${dateStr} · Fleet`;
    if (ev91OverallLoading && (filterFrom || filterTo) && filterTo >= EV91_WEBAPP_CUTOVER_DATE) {
      vehicleChange = `${vehicleChange} · loading…`;
    }

    return [
      { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: TrendingUp, change: dateStr, isPositive: true },
      { label: 'Active Riders', value: activeCodes.size.toLocaleString(), icon: Users, change: dateStr, isPositive: true },
      {
        label: 'Deployed Vehicles',
        value: activeVehicles.toLocaleString(),
        icon: Truck,
        change: vehicleChange,
        isPositive: true,
      },
      {
        label: 'Returned Units',
        value: returnedVehicles.toLocaleString(),
        icon: Activity,
        change: vehicleChange,
        isPositive: false,
      },
    ];
  }, [
    orderDailyIndex,
    masterSheetRows,
    fleetSnapshot,
    filterFrom,
    filterTo,
    ev91OverallRows,
    ev91OverallLoading,
  ]);

  const filteredFleet = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const out = [];
    for (const item of combinedVehicles) {
      if (filterFrom || filterTo) {
        const rangeFrom = filterFrom || filterTo;
        const rangeTo = filterTo || filterFrom;
        let isDepWithin = false;
        if (item.deployed_obj) {
          const depDateStr = format(item.deployed_obj, 'yyyy-MM-dd');
          isDepWithin = depDateStr >= rangeFrom && depDateStr <= rangeTo;
        }
        let isRetWithin = false;
        if (item.returned_obj) {
          const retDateStr = format(item.returned_obj, 'yyyy-MM-dd');
          isRetWithin = retDateStr >= rangeFrom && retDateStr <= rangeTo;
        }
        if (!isDepWithin && !isRetWithin) continue;
      }
      if (q) {
        const searchContent = `${item.vehicle_number} ${item.rider_name} ${item.city} ${item.status}`.toLowerCase();
        if (!searchContent.includes(q)) continue;
      }
      out.push(item);
      if (out.length >= FLEET_TABLE_LIMIT) break;
    }
    return out;
  }, [combinedVehicles, deferredSearch, filterFrom, filterTo]);

  const realVehicleStatusDist = useMemo(
    () => currentStatusDistributionSeries(ev91StatusSummary),
    [ev91StatusSummary]
  );

  if (loading && riderData.length === 0) {
    return (
      <div className="loading-container">
        <span className="loader"></span>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-container">
      <header className="header">
        <div>
          <h1>General Overview</h1>
          <p style={{ color: 'var(--text-dim)' }}>
            Fleet & Rider Performance Metrics
            {overviewOrdersFromUpload ? (
              <span style={{ marginLeft: 8, color: 'var(--accent-blue)' }}>
                · Orders from Order Upload only (days not uploaded are hidden)
              </span>
            ) : (
              <span style={{ marginLeft: 8 }}>· Orders from rider_metrics</span>
            )}
            <span style={{ marginLeft: 8 }}>
              · Deploy/Return: fleet before {EV91_WEBAPP_CUTOVER_DATE}, EV91 Overall Status API from{' '}
              {EV91_WEBAPP_CUTOVER_DATE}
            </span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <Calendar size={18} style={{ color: 'var(--text-dim)' }} />
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
            />
            <span style={{ color: 'var(--text-dim)' }}>to</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none' }}
            />
            {(startDate || endDate) && (
              <button onClick={() => { setStartDate(''); setEndDate(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '0 0.5rem' }}>
                <X size={16} />
              </button>
            )}
          </div>
          <button className="glass" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }} onClick={() => refreshData?.()}>
            <RefreshCw size={18} /> Refresh
          </button>
        </div>
      </header>

      <section className="stats-grid">
        {stats.map((stat, i) => (
          <div key={stat.label} className="stat-card glass">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <stat.icon size={24} style={{ color: COLORS[i % COLORS.length] }} />
              <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: stat.isPositive ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {stat.change} {stat.isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              </div>
            </div>
            <div>
              <div className="label">{stat.label}</div>
              <div className="value">{stat.value}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="charts-grid">
        <div className="chart-card glass">
          <h3>Orders Performance</h3>
          {overviewOrdersFromUpload && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Showing uploaded order dates only — not rider_metrics fill-in days
            </p>
          )}
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ordersByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" name="EV Orders" dataKey="ev" stroke="#4ade80" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" name="Non-EV Orders" dataKey="nonEv" stroke="#f43f5e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card glass">
          <h3>Vehicle Status Distribution</h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            EV91 Current Vehicle Status · Deployed / Returned / Not yet to deploy
            {ev91StatusLoading ? ' · Loading…' : ''}
            {ev91StatusError ? ` · ${ev91StatusError}` : ''}
          </p>
          <div style={{ height: '300px', width: '100%' }}>
            {ev91StatusLoading && realVehicleStatusDist.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                Loading EV91 status…
              </div>
            ) : realVehicleStatusDist.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                No current-status data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={realVehicleStatusDist}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    nameKey="name"
                  >
                    {realVehicleStatusDist.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <section className="table-card glass">
        <div className="table-header">
          <h3 style={{ fontSize: '1.25rem' }}>Vehicle Fleet Data</h3>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input type="text" placeholder="Search by ID or Status..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 1rem 0.6rem 2.5rem', color: '#fff', width: '300px' }} />
          </div>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Vehicle No.</th>
                <th>Rider Name</th>
                <th>Status</th>
                <th>Deployed Date</th>
                <th>Return Date</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {filteredFleet.map((item) => (
                <tr key={item.id}>
                  <td>{item.vehicle_number}</td>
                  <td>{item.rider_name}</td>
                  <td><span className={clsx('status-badge', item.status?.toLowerCase().replace(/\s+/g, '-'))}>{item.status}</span></td>
                  <td>{item.deployed_date || 'N/A'}</td>
                  <td>{item.returned_date || 'N/A'}</td>
                  <td>{item.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </motion.div>
  );
};

export default Dashboard;
