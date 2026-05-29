import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import Dashboard from './Dashboard'
import RiderAttendance from './RiderAttendance'
import VehicleTracking from './VehicleTracking'
import OnboardingAnalytics from './OnboardingAnalytics'
import ErrorFinder from './ErrorFinder'
import TempSourceActive from './TempSourceActive'
import DailyMailer from './DailyMailer'
import RiderDetails from './RiderDetails'
import InactiveRiderMailer from './InactiveRiderMailer'
import VehicleInventory from './VehicleInventory'
import FleetDataViewer from './FleetDataViewer'
import { Layout, BarChart3, ClipboardList, Truck, UserPlus, AlertTriangle, FileBarChart2, Mail, Users, UserX, Database } from 'lucide-react'
import './index.css'

const DB_NAME = 'DashFleetDB'
const DB_VERSION = 1
const STORE_NAME = 'cacheStore'

const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (e) => {
            const db = e.target.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
            }
        }
    })
}

const cacheData = async (key, data) => {
    try {
        const db = await initDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const request = tx.objectStore(STORE_NAME).put(data, key)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    } catch (e) { console.error('Cache error', e) }
}

const getCachedData = async (key) => {
    try {
        const db = await initDB()
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const request = tx.objectStore(STORE_NAME).get(key)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    } catch (e) { return null }
}

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [riderData, setRiderData] = useState([])
  const [fleetData, setFleetData] = useState([])
  const [fleetTotalCount, setFleetTotalCount] = useState(0)
  const [weeklyData, setWeeklyData] = useState([])
  const [kycData, setKycData] = useState([])
  const [onboardingData, setOnboardingData] = useState([])
  const [vehicleInventoryData, setVehicleInventoryData] = useState([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchAllData = async (table, columns = '*', orderBy = null) => {
    let allData = [];
    let from = 0;
    const size = 1000;
    let consecutiveErrors = 0;
    let totalCount = null;
    const sortColumn = orderBy || 'id';

    console.log(`Starting fetch for ${table}...`);

    try {
      const { count, error: countError } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      if (countError) throw countError;
      totalCount = count ?? 0;
      console.log(`${table}: DB total count (head query) =`, totalCount);
    } catch (countErr) {
      console.error(`Count query failed for ${table}:`, countErr);
    }

    while (true) {
      if (totalCount !== null && from >= totalCount) break;

      try {
        let query = supabase.from(table).select(columns);
        query = query.order(sortColumn, { ascending: true });
        
        const { data, error } = await query.range(from, from + size - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData.push(...data);
          consecutiveErrors = 0; // Reset on success
          from += data.length;
          
          // Optional: log progress for very large tables
          if (from % 10000 === 0) console.log(`${table}: Fetched ${from} rows...`);

          if (data.length < size && (totalCount === null || from >= totalCount)) break;
        } else {
          // If total count is unknown or we've reached expected rows, stop.
          // Otherwise retry the same window a few times before giving up.
          if (totalCount === null || from >= totalCount) break;
          throw new Error(`Empty page for ${table} at offset ${from} before reaching expected total ${totalCount}`);
        }
      } catch (err) {
        console.error(`Error fetching ${table} at ${from}:`, err);
        consecutiveErrors++;
        
        if (consecutiveErrors > 3) {
          console.error(`Giving up on ${table} after 3 retries.`);
          break;
        }
        
        // Wait 1s before retrying
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (totalCount !== null && allData.length !== totalCount) {
      console.warn(`${table}: fetched ${allData.length} rows but expected ${totalCount}. This usually means API errors/timeouts OR RLS/permissions are limiting visible rows.`);
    }
    return { data: allData, totalCount };
  };

  const fetchData = async () => {
    setLoading(true);
    
    const cachedRiders = await getCachedData('rider_metrics');
    const cachedFleet = await getCachedData('fleet_data');
    const cachedWeekly = await getCachedData('weekly_performance');
    const cachedKyc = await getCachedData('rider_kyc');
    const cachedOnboarding = await getCachedData('rider_onboarding');
    const cachedInventory = await getCachedData('vehicle_inventory');

    if (cachedRiders) setRiderData(cachedRiders);
    if (cachedFleet) setFleetData(cachedFleet);
    if (cachedWeekly) setWeeklyData(cachedWeekly);
    if (cachedKyc) setKycData(cachedKyc);
    if (cachedOnboarding) setOnboardingData(cachedOnboarding);
    if (cachedInventory) setVehicleInventoryData(cachedInventory);
    
    if (cachedRiders && cachedFleet) setLoading(false);

    try {
      const riderCols = 'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number';
      const weeklyCols = 'id,inactive_days,date_record';

      // --- STEP 1: PRIORITY FETCH (DASHBOARD ONLY - FAST) ---
      const riderRes = await fetchAllData('rider_metrics', riderCols, null);
      
      if (riderRes.data?.length) {
        setRiderData(riderRes.data);
        cacheData('rider_metrics', riderRes.data);
      }

      setLoading(false); // Dashboard is ready!

      // --- STEP 2: BACKGROUND FETCH (ALL SECONDARY TABLES + FULL FLEET DATA) ---
      const [fleetRes, kycRes, onboardingRes, inventoryRes] = await Promise.all([
        fetchAllData('fleet_data', '*'),
        fetchAllData('rider_kyc', '*'),
        fetchAllData('rider_onboarding', '*'),
        fetchAllData('vehicle_inventory', '*')
      ]);

      setFleetData(fleetRes.data || []);
      setFleetTotalCount(fleetRes.totalCount ?? fleetRes.data?.length ?? 0);
      if (fleetRes.data?.length) cacheData('fleet_data', fleetRes.data);

      if (kycRes.data) {
        setKycData(kycRes.data);
        cacheData('rider_kyc', kycRes.data);
      }

      if (onboardingRes.data) {
        setOnboardingData(onboardingRes.data);
        cacheData('rider_onboarding', onboardingRes.data);
      }

      if (inventoryRes.data) {
        setVehicleInventoryData(inventoryRes.data);
        cacheData('vehicle_inventory', inventoryRes.data);
      }
      
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Layout className="text-primary" />
          <span>FleetPro</span>
        </div>
        <nav className="nav-links">
          <button 
            className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActivePage('dashboard')}
          >
            <BarChart3 size={20} />
            Dashboard
          </button>
          <button 
            className={`nav-item ${activePage === 'attendance' ? 'active' : ''}`}
            onClick={() => setActivePage('attendance')}
          >
            <ClipboardList size={20} />
            Rider Attendance
          </button>
          <button 
            className={`nav-item ${activePage === 'tracking' ? 'active' : ''}`}
            onClick={() => setActivePage('tracking')}
          >
            <Truck size={20} />
            Vehicle Tracking
          </button>
          <button 
            className={`nav-item ${activePage === 'onboarding' ? 'active' : ''}`}
            onClick={() => setActivePage('onboarding')}
          >
            <UserPlus size={20} />
            Onboarding Analytics
          </button>
          <button 
            className={`nav-item ${activePage === 'errorfinder' ? 'active' : ''}`}
            onClick={() => setActivePage('errorfinder')}
          >
            <AlertTriangle size={20} />
            Error Finder
          </button>
          <button 
            className={`nav-item ${activePage === 'dailymailer' ? 'active' : ''}`}
            onClick={() => setActivePage('dailymailer')}
          >
            <Mail size={20} />
            Daily Mailer
          </button>
          <button 
            className={`nav-item ${activePage === 'tempparser' ? 'active' : ''}`}
            onClick={() => setActivePage('tempparser')}
          >
            <FileBarChart2 size={20} />
            Temp Parser
          </button>
          <button 
            className={`nav-item ${activePage === 'riderdetails' ? 'active' : ''}`}
            onClick={() => setActivePage('riderdetails')}
          >
            <Users size={20} />
            Rider Details
          </button>
          <button 
            className={`nav-item ${activePage === 'inactivemailer' ? 'active' : ''}`}
            onClick={() => setActivePage('inactivemailer')}
          >
            <UserX size={20} />
            Inactive Mailer
          </button>
          <button 
            className={`nav-item ${activePage === 'fleetdata' ? 'active' : ''}`}
            onClick={() => setActivePage('fleetdata')}
          >
            <Database size={20} />
            Fleet Data
          </button>
        </nav>
      </aside>

      <main className="main-content">
        {activePage === 'dashboard' ? (
          <Dashboard 
            riderData={riderData} 
            fleetData={fleetData} 
            weeklyData={weeklyData} 
            loading={loading}
            refreshData={fetchData}
          />
        ) : activePage === 'attendance' ? (
          <RiderAttendance 
            riderData={riderData} 
            loading={loading} 
          />
        ) : activePage === 'tracking' ? (
          <VehicleTracking 
            fleetData={fleetData}
            riderData={riderData}
            loading={loading}
          />
        ) : activePage === 'onboarding' ? (
          <OnboardingAnalytics
            kycData={kycData}
            onboardingData={onboardingData}
            fleetData={fleetData}
            riderData={riderData}
            loading={loading}
          />
        ) : activePage === 'errorfinder' ? (
          <ErrorFinder
            fleetData={fleetData}
            riderData={riderData}
            loading={loading}
          />
        ) : activePage === 'dailymailer' ? (
          <DailyMailer
            riderData={riderData}
            loading={loading}
            refreshData={fetchData}
          />
        ) : activePage === 'tempparser' ? (
          <TempSourceActive
            riderData={riderData}
            fleetData={fleetData}
            loading={loading}
          />
        ) : activePage === 'riderdetails' ? (
          <RiderDetails
            fleetData={fleetData}
            kycData={kycData}
            onboardingData={onboardingData}
            riderData={riderData}
            loading={loading}
          />
        ) : activePage === 'inactivemailer' ? (
          <InactiveRiderMailer
            riderData={riderData}
            kycData={kycData}
            fleetData={fleetData}
            onboardingData={onboardingData}
            inventoryData={vehicleInventoryData}
            loading={loading}
          />
        ) : activePage === 'fleetdata' ? (
          <FleetDataViewer
            fleetData={fleetData}
            totalCount={fleetTotalCount}
            loading={loading}
            refreshData={fetchData}
          />
        ) : null}
      </main>
    </div>
  )
}

export default App
