import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  TrendingUp, Users, Truck, Calendar, Activity, 
  ArrowUpRight, ArrowDownRight, RefreshCw, Search, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { clsx } from 'clsx';

const COLORS = ['#6366f1', '#38bdf8', '#a855f7', '#fb7185', '#4ade80'];

const Dashboard = ({ riderData, fleetData, weeklyData, loading, refreshData }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

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

      if (startDate && date < startDate) return acc;
      if (endDate && date > endDate) return acc;

      if (!acc[date]) acc[date] = { date, ev: 0, nonEv: 0, total: 0 };
      
      const delivered = parseInt(curr.delivered, 10) || 0;
      acc[date].total += delivered;
      
      const t1 = String(curr.type1 || '').toUpperCase();
      const t2 = String(curr.type2 || '').toUpperCase();
      
      const isEv1 = t1.includes('EV') && !t1.includes('NON');
      const isEv2 = t2.includes('EV') && !t2.includes('NON');

      if (isEv1 || isEv2) {
        acc[date].ev += delivered;
      } else {
        acc[date].nonEv += delivered;
      }
      return acc;
    }, {});

    return Object.values(grouped)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [riderData, startDate, endDate]);

  const vehicleStatusDist = useMemo(() => {
    // Moved below filteredFleet, will define it after filteredFleet.
    return [];
  }, []);

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
      
      const riderCols = 'delivered,date_record,worker_code,hub_name,city,client,cumulative_order,source,week,month,state';
      const dateVal = item.date_record || item.bike_deployed_date_sd_refund_request || item.bike_return_date_sd_refund_request || item.created_at;
      const parsedDate = parseCustomDate(dateVal);

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
  }, [fleetData]);

  const stats = useMemo(() => {
    let totalOrders = 0;
    const activeCodes = new Set();

    riderData.forEach(r => {
      const delivered = parseInt(r.delivered, 10) || 0;
      const dateStr = r.date_record || '';
      
      let yyyy_mm_dd = '';
      if (dateStr.includes('/')) {
        const [dd, mm, yPart] = dateStr.split('/');
        const yyyy = yPart ? yPart.split(' ')[0] : '2026';
        yyyy_mm_dd = `${yyyy}-${mm}-${dd}`;
      } else if (dateStr) {
        yyyy_mm_dd = dateStr;
      }

      const isWithinDateRange = (!startDate || yyyy_mm_dd >= startDate) && (!endDate || yyyy_mm_dd <= endDate);

      if (isWithinDateRange) {
         totalOrders += delivered;
         if (delivered > 0 && r.worker_code) {
           activeCodes.add(r.worker_code);
         }
      }
    });

    let activeVehicles = 0;
    let returnedVehicles = 0;

    combinedVehicles.forEach(item => {
      const s = item.status?.toLowerCase() || '';
      
      let isDepWithin = false;
      if (item.deployed_obj) {
          const depDateStr = format(item.deployed_obj, 'yyyy-MM-dd');
          isDepWithin = (!startDate || depDateStr >= startDate) && (!endDate || depDateStr <= endDate);
      }
      
      let isRetWithin = false;
      if (item.returned_obj) {
          const retDateStr = format(item.returned_obj, 'yyyy-MM-dd');
          isRetWithin = (!startDate || retDateStr >= startDate) && (!endDate || retDateStr <= endDate);
      }

      if (startDate || endDate) {
          if (s.includes('deploy') && isDepWithin) activeVehicles++;
          if (s.includes('return') && isRetWithin) returnedVehicles++;
      } else {
          if (s.includes('deploy')) activeVehicles++;
          if (s.includes('return')) returnedVehicles++;
      }
    });

    let changeStr = 'All Time';
    if (startDate && endDate && startDate === endDate) changeStr = startDate;
    else if (startDate && endDate) changeStr = `${startDate} to ${endDate}`;
    else if (startDate) changeStr = `Since ${startDate}`;
    else if (endDate) changeStr = `Until ${endDate}`;

    return [
      { label: 'Total Orders', value: totalOrders.toLocaleString(), icon: TrendingUp, change: changeStr, isPositive: true },
      { label: 'Active Riders', value: activeCodes.size.toLocaleString(), icon: Users, change: changeStr, isPositive: true },
      { label: 'Deployed Vehicles', value: activeVehicles.toLocaleString(), icon: Truck, change: changeStr, isPositive: true },
      { label: 'Returned Units', value: returnedVehicles.toLocaleString(), icon: Activity, change: changeStr, isPositive: false },
    ];
  }, [riderData, combinedVehicles, startDate, endDate]);

  const filteredFleet = useMemo(() => {
    return combinedVehicles.filter(item => {
      if (startDate || endDate) {
         let isDepWithin = false;
         if (item.deployed_obj) {
             const depDateStr = format(item.deployed_obj, 'yyyy-MM-dd');
             isDepWithin = (!startDate || depDateStr >= startDate) && (!endDate || depDateStr <= endDate);
         }
         let isRetWithin = false;
         if (item.returned_obj) {
             const retDateStr = format(item.returned_obj, 'yyyy-MM-dd');
             isRetWithin = (!startDate || retDateStr >= startDate) && (!endDate || retDateStr <= endDate);
         }
         if (!isDepWithin && !isRetWithin) return false;
      }
      const searchContent = `${item.vehicle_number} ${item.rider_name} ${item.city} ${item.status}`.toLowerCase();
      return searchContent.includes(searchTerm.toLowerCase());
    });
  }, [combinedVehicles, searchTerm, startDate, endDate]);

  const realVehicleStatusDist = useMemo(() => {
    const counts = filteredFleet.reduce((acc, curr) => {
      const status = curr.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredFleet]);

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
          <p style={{ color: 'var(--text-dim)' }}>Fleet & Rider Performance Metrics</p>
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
          <button className="glass" style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', cursor: 'pointer' }} onClick={refreshData}>
            <RefreshCw size={18} /> Refresh
          </button>
        </div>
      </header>

      <section className="stats-grid">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="stat-card glass">
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
        <div className="chart-card glass">
          <h3>Orders Performance</h3>
          <ResponsiveContainer width="100%" height="90%">
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

        <div className="chart-card glass">
          <h3>Vehicle Status Distribution</h3>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={realVehicleStatusDist} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                {realVehicleStatusDist.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
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
              <AnimatePresence mode="popLayout">
                {filteredFleet.slice(0, 10).map((item) => (
                  <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <td>{item.vehicle_number}</td>
                    <td>{item.rider_name}</td>
                    <td><span className={clsx('status-badge', item.status?.toLowerCase().replace(/\s+/g, '-'))}>{item.status}</span></td>
                    <td>{item.deployed_date || 'N/A'}</td>
                    <td>{item.returned_date || 'N/A'}</td>
                    <td>{item.duration}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </section>
    </motion.div>
  );
};

export default Dashboard;
