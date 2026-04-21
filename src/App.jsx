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
import { Layout, BarChart3, ClipboardList, Truck, UserPlus, AlertTriangle, FileBarChart2, Mail, Users } from 'lucide-react'
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
  const [weeklyData, setWeeklyData] = useState([])
  const [kycData, setKycData] = useState([])
  const [onboardingData, setOnboardingData] = useState([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchAllData = async (table, columns = '*') => {
    let allData = [];
    let from = 0;
    const size = 1000;
    const batchSize = 5;

    while (true) {
       const promises = [];
       for (let i = 0; i < batchSize; i++) {
           const start = from + (i * size);
           promises.push(supabase.from(table).select(columns).range(start, start + size - 1));
       }
       const results = await Promise.all(promises);
       
       let hitEnd = false;
       for (const res of results) {
           if (res.error) {
               console.error(`Error ${table}:`, res.error);
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
    const cachedWeekly = await getCachedData('weekly_performance');
    const cachedKyc = await getCachedData('rider_kyc');
    const cachedOnboarding = await getCachedData('rider_onboarding');

    if (cachedRiders) setRiderData(cachedRiders);
    if (cachedFleet) setFleetData(cachedFleet);
    if (cachedWeekly) setWeeklyData(cachedWeekly);
    if (cachedKyc) setKycData(cachedKyc);
    if (cachedOnboarding) setOnboardingData(cachedOnboarding);
    
    if (cachedRiders && cachedFleet) setLoading(false);

    try {
      const riderCols = 'delivered,date_record,worker_code,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2';
      const fleetCols = 'id,vehicle_number,rider_name,rider_id,vehicle_status,date_record,city_locations,bike_deployed_date_sd_refund_request,bike_return_date_sd_refund_request,created_at';
      const weeklyCols = 'inactive_days,date_record';

      const [riderRes, fleetRes, weeklyRes, kycRes, onboardingRes] = await Promise.all([
        fetchAllData('rider_metrics', '*'),
        fetchAllData('fleet_data', fleetCols),
        fetchAllData('weekly_performance', weeklyCols),
        fetchAllData('rider_kyc', '*'),
        fetchAllData('rider_onboarding', '*')
      ]);
      
      setRiderData(riderRes.data || []);
      setFleetData(fleetRes.data || []);
      setWeeklyData(weeklyRes.data || []);
      setKycData(kycRes.data || []);
      setOnboardingData(onboardingRes.data || []);
      
      cacheData('rider_metrics', riderRes.data || []);
      cacheData('fleet_data', fleetRes.data || []);
      cacheData('weekly_performance', weeklyRes.data || []);
      cacheData('rider_kyc', kycRes.data || []);
      cacheData('rider_onboarding', onboardingRes.data || []);
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
          />
        ) : activePage === 'tempparser' ? (
          <TempSourceActive
            riderData={riderData}
            fleetData={fleetData}
            loading={loading}
          />
        ) : (
          <RiderDetails
            fleetData={fleetData}
            kycData={kycData}
            onboardingData={onboardingData}
            riderData={riderData}
            loading={loading}
          />
        )}
      </main>
    </div>
  )
}

export default App
