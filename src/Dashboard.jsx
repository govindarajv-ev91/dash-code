import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabaseClient';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  TrendingUp, Users, Truck, Calendar, Activity, 
  ArrowUpRight, ArrowDownRight, RefreshCw, Filter, Search, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { clsx } from 'clsx';

const COLORS = ['#6366f1', '#38bdf8', '#a855f7', '#fb7185', '#4ade80'];

const DB_NAME = 'DashFleetDB';
const DB_VERSION = 1;
const STORE_NAME = 'cacheStore';

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
};

const cacheData = async (key, data) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const request = tx.objectStore(STORE_NAME).put(data, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('IDB Cache error', e);
    }
};

const getCachedData = async (key) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return null;
    }
};

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const [riderData, setRiderData] = useState([]);
  const [fleetData, setFleetData] = useState([]);
  const [timeRange, setTimeRange] = useState('All time');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchAllData = async (table) => {
    let allData = [];
    let from = 0;
    const size = 1000;
    const batchSize = 10; // 10 concurrent requests (10,000 rows per batch) for ultimate speed

    while (true) {
       const promises = [];
       for (let i = 0; i < batchSize; i++) {
           const start = from + (i * size);
           promises.push(supabase.from(table).select('*').range(start, start + size - 1));
       }
       const results = await Promise.all(promises);
       
       let hitEnd = false;
       for (const res of results) {
           if (res.error) {
               console.error(`Error in Pagination ${table}:`, res.error);
               hitEnd = true;
               break;
           }
           if (res.data) {
               allData = allData.concat(res.data);
               if (res.data.length < size) {
                   hitEnd = true;
                   break;
               }
           }
       }
       if (hitEnd) break;
       from += (batchSize * size);
    }
    return { data: allData };
  };

  const fetchData = async () => {
    setLoading(true);
    
    const cachedRiders = await getCachedData('rider_metrics');
    const cachedFleet = await getCachedData('fleet_data');
    if (cachedRiders?.length > 0) setRiderData(cachedRiders);
    if (cachedFleet?.length > 0) setFleetData(cachedFleet);
    
    if (cachedRiders?.length > 0 && cachedFleet?.length > 0) {
        setLoading(false); // Instant load UI rendering
    }

    try {
      const [riderRes, fleetRes] = await Promise.all([
        fetchAllData('rider_metrics'),
        fetchAllData('fleet_data')
      ]);
      
      const finalRiderData = riderRes.data || [];
      const finalFleetData = fleetRes.data || [];
      
      setRiderData(finalRiderData);
      setFleetData(finalFleetData);
      
      // Update persistent Cache 
      cacheData('rider_metrics', finalRiderData);
      cacheData('fleet_data', finalFleetData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Process data for charts
  const ordersByDate = useMemo(() => {
    const grouped = riderData.reduce((acc, curr) => {
      let date = curr.date_record;
      if (!date) return acc;
      if (date.includes('/')) {
        const [dd, mm, part] = date.split('/');
        const yyyy = part ? part.split(' ')[0] : '2026';
        date = `${yyyy}-${mm}-${dd}`;
      }
      if (!acc[date]) acc[date] = 0;
      acc[date] += (parseInt(curr.delivered, 10) || 0);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [riderData]);

  const vehicleStatusDist = useMemo(() => {
    const counts = fleetData.reduce((acc, curr) => {
      const status = curr.vehicle_status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [fleetData]);


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

    fleetData.forEach(item => {
      const vNum = item.vehicle_number || 'Unknown Vehicle';
      const rName = item.rider_name || item.rider_id || 'Unknown Rider';
      const key = `${vNum}_${rName}`;
      
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
      
      const dateVal = item.date_record || item.bike_deployed_date_sd_refund_request || item.bike_return_date_sd_refund_request || item.created_at;
      const parsedDate = parseCustomDate(dateVal);

      // Keep track of the actual current status based on latest date
      if (parsedDate && (!record.latest_obj || parsedDate > record.latest_obj)) {
          record.status = rawStatus;
          record.latest_obj = parsedDate;
      } else if (!record.latest_obj && rawStatus) {
          record.status = rawStatus;
      }
      
      if (statusLower.includes('deploy')) {
         if (!record.deployed_obj || (parsedDate && parsedDate > record.deployed_obj)) {
             record.deployed_date = dateVal;
             record.deployed_obj = parsedDate;
         }
      } else if (statusLower.includes('return')) {
         if (!record.returned_obj || (parsedDate && parsedDate > record.returned_obj)) {
             record.returned_date = dateVal;
             record.returned_obj = parsedDate;
         }
      }
    });

    return Array.from(map.values()).map(record => {
       let duration = 'N/A';
       if (record.deployed_obj && record.returned_obj) {
           const diffTime = record.returned_obj - record.deployed_obj;
           if (diffTime >= 0) {
               duration = `${Math.ceil(diffTime / (1000 * 60 * 60 * 24))} Days`;
           } else {
               duration = '0 Days';
           }
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
  }, [fleetData]);

  const stats = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isToday = timeRange === 'Today';

    const targetRiders = isToday ? riderData.filter(r => r.date_record && r.date_record.includes(today)) : riderData;
    const totalOrders = targetRiders.reduce((sum, r) => sum + (parseInt(r.delivered, 10) || parseInt(r.cumulative_order, 10) || 0), 0);
    const totalRiders = new Set(targetRiders.map(r => r.worker_code)).size;

    let activeVehicles = 0;
    let returnedVehicles = 0;

    combinedVehicles.forEach(item => {
      const s = item.status?.toLowerCase() || '';
      const isDep = s.includes('deploy');
      const isRet = s.includes('return');
      
      if (isToday) {
         const isDepToday = item.deployed_obj && format(item.deployed_obj, 'yyyy-MM-dd') === today;
         const isRetToday = item.returned_obj && format(item.returned_obj, 'yyyy-MM-dd') === today;
         if (isDep && isDepToday) activeVehicles++;
         if (isRet && isRetToday) returnedVehicles++;
      } else {
         if (isDep) activeVehicles++;
         if (isRet) returnedVehicles++;
      }
    });

    return [
      { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: TrendingUp, change: isToday ? 'Today' : 'All Time', isPositive: true },
      { label: 'Active Riders', value: totalRiders.toLocaleString(), icon: Users, change: isToday ? 'Today' : 'All Time', isPositive: true },
      { label: 'Deployed Vehicles', value: activeVehicles.toLocaleString(), icon: Truck, change: isToday ? 'Today' : 'All Time', isPositive: true },
      { label: 'Returned Units', value: returnedVehicles.toLocaleString(), icon: Activity, change: isToday ? 'Today' : 'All Time', isPositive: false },
    ];
  }, [riderData, combinedVehicles, timeRange]);

  const filteredFleet = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isToday = timeRange === 'Today';

    return combinedVehicles.filter(item => {
      if (isToday) {
         const isDepToday = item.deployed_obj && format(item.deployed_obj, 'yyyy-MM-dd') === today;
         const isRetToday = item.returned_obj && format(item.returned_obj, 'yyyy-MM-dd') === today;
         if (!isDepToday && !isRetToday) return false;
      }

      const searchContent = `${item.vehicle_number} ${item.rider_name} ${item.city} ${item.status}`.toLowerCase();
      return searchContent.includes(searchTerm.toLowerCase());
    });
  }, [combinedVehicles, searchTerm, timeRange]);

  if (loading) {
    return (
      <div className="loading-container">
        <span className="loader"></span>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="dashboard-container"
    >
      <header className="header">
        <div>
          <h1>Advanced Dashboard</h1>
          <p style={{ color: 'var(--text-dim)' }}>Project: govindarajv-ev91</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            className="glass" 
            style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: timeRange === 'Today' ? 'var(--primary)' : '#fff', cursor: 'pointer', border: timeRange === 'Today' ? '1px solid var(--primary)' : '1px solid transparent' }} 
            onClick={() => setTimeRange(timeRange === 'Today' ? 'All time' : 'Today')}
          >
            <Calendar size={18} />
            {timeRange === 'Today' ? 'Today Only' : 'All Time'}
          </button>
          <button className="glass" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }} onClick={fetchData}>
            <RefreshCw size={18} /> Refresh
          </button>
        </div>
      </header>

      <section className="stats-grid">
        {stats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="stat-card glass"
          >
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
          </motion.div>
        ))}
      </section>

      <div className="charts-grid">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="chart-card glass"
        >
          <h3>Orders Performance</h3>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={ordersByDate}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-dim)" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
              <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={3} dot={{ fill: 'var(--primary)', r: 4 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="chart-card glass"
        >
          <h3>Vehicle Status Distribution</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={vehicleStatusDist}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {vehicleStatusDist.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <motion.section 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="table-card glass"
      >
        <div className="table-header">
          <h3 style={{ fontSize: '1.25rem' }}>Vehicle Fleet Data</h3>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input 
              type="text" 
              placeholder="Search by ID or Status..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.6rem 1rem 0.6rem 2.5rem',
                color: '#fff',
                width: '300px'
              }}
            />
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
              <AnimatePresence mode="popLayout">
                {filteredFleet.slice(0, 10).map((item) => (
                  <motion.tr 
                    key={item.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <td>{item.vehicle_number}</td>
                    <td>{item.rider_name}</td>
                    <td>
                      <span className={clsx('status-badge', item.status?.toLowerCase().replace(/\s+/g, '-'))}>
                        {item.status}
                      </span>
                    </td>
                    <td>{item.deployed_date || 'N/A'}</td>
                    <td>{item.returned_date || 'N/A'}</td>
                    <td>{item.duration}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {filteredFleet.length === 0 && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              No fleet data found for "{searchTerm}"
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
};

export default Dashboard;
