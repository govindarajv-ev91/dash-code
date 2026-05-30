import React, { useState, useEffect } from 'react'
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
import RiderPerformance from './RiderPerformance'
import { fetchFleetSheetCsv, mapGoogleSheetRowsToFleetKeys } from './lib/fleetSheetMerge'
import { fetchAllData } from './lib/supabaseFetch'
import { Layout, BarChart3, ClipboardList, Truck, UserPlus, AlertTriangle, FileBarChart2, Mail, Users, UserX, Database, PieChart, MapPin, Activity } from 'lucide-react'
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
  const [fleetSheetCount, setFleetSheetCount] = useState(0)
  const [weeklyData, setWeeklyData] = useState([])
  const [kycData, setKycData] = useState([])
  const [onboardingData, setOnboardingData] = useState([])
  const [vehicleInventoryData, setVehicleInventoryData] = useState([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true);
    
    const cachedRiders = await getCachedData('rider_metrics');
    const cachedFleet = await getCachedData('fleet_data');
    const cachedSheet = await getCachedData('fleet_sheet_data');
    const cachedWeekly = await getCachedData('weekly_performance');
    const cachedKyc = await getCachedData('rider_kyc');
    const cachedOnboarding = await getCachedData('rider_onboarding');
    const cachedInventory = await getCachedData('vehicle_inventory');

    if (cachedRiders) setRiderData(cachedRiders);
    if (cachedFleet || cachedSheet) {
      const dbRows = (cachedFleet || []).filter(r => (r.data_source || 'Database') !== 'Google Sheet')
      const sheetRows = cachedSheet || (cachedFleet || []).filter(r => r.data_source === 'Google Sheet')
      setFleetData([...dbRows, ...sheetRows])
      setFleetSheetCount(sheetRows.length)
    }
    if (cachedWeekly) setWeeklyData(cachedWeekly);
    if (cachedKyc) setKycData(cachedKyc);
    if (cachedOnboarding) setOnboardingData(cachedOnboarding);
    if (cachedInventory) setVehicleInventoryData(cachedInventory);
    
    if (cachedRiders && cachedFleet) setLoading(false);

    try {
      const riderCols = 'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number,fl';
      const weeklyCols = 'id,inactive_days,date_record';

      // --- STEP 1: PRIORITY FETCH (DASHBOARD ONLY - FAST) ---
      const riderRes = await fetchAllData('rider_metrics', riderCols, null, { useKeyset: false });
      
      if (riderRes.data?.length) {
        setRiderData(riderRes.data);
        cacheData('rider_metrics', riderRes.data);
      }

      setLoading(false); // Dashboard is ready!

      // --- STEP 2: BACKGROUND FETCH (fleet first — large rows, keyset pagination) ---
      const fleetRes = await fetchAllData('fleet_data', '*', 'id', { pageSize: 250 })

      const [kycRes, onboardingRes, inventoryRes] = await Promise.all([
        fetchAllData('rider_kyc', '*', 'id', { pageSize: 250 }),
        fetchAllData('rider_onboarding', '*', 'id', { pageSize: 500 }),
        fetchAllData('vehicle_inventory', '*', 'id', { pageSize: 500 }),
      ])

      const dbFleetRows = (fleetRes.data || []).map((row) => ({
        ...row,
        data_source: 'Database'
      }))

      let sheetFleetRows = []
      try {
        const csvText = await fetchFleetSheetCsv()
        const sampleKeys = dbFleetRows.length ? Object.keys(dbFleetRows[0]) : []
        const { rows, matchedHeaders, totalHeaders } = mapGoogleSheetRowsToFleetKeys(csvText, sampleKeys)
        sheetFleetRows = rows
        console.log(
          `fleet_data: merged ${sheetFleetRows.length} rows from Google Sheet (${matchedHeaders}/${totalHeaders} headers mapped)`
        )
        if (sheetFleetRows.length) cacheData('fleet_sheet_data', sheetFleetRows)
      } catch (sheetErr) {
        console.error('Google Sheet merge failed:', sheetErr)
      }

      const mergedFleetRows = [...dbFleetRows, ...sheetFleetRows]
      setFleetData(mergedFleetRows);
      setFleetTotalCount(fleetRes.totalCount ?? fleetRes.data?.length ?? 0);
      setFleetSheetCount(sheetFleetRows.length);
      if (dbFleetRows.length) cacheData('fleet_data', dbFleetRows);

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
    <div className="app-layout app-layout-auto-sidebar">
      <div className="sidebar-shell">
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
            className={`nav-item ${activePage === 'riderperformance' ? 'active' : ''}`}
            onClick={() => setActivePage('riderperformance')}
          >
            <Activity size={20} />
            Rider Performance
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
          <button 
            className={`nav-item ${activePage === 'fleetcitysummary' ? 'active' : ''}`}
            onClick={() => setActivePage('fleetcitysummary')}
          >
            <MapPin size={20} />
            Fleet Summary
          </button>
          <button 
            className={`nav-item ${activePage === 'fleetsummary' ? 'active' : ''}`}
            onClick={() => setActivePage('fleetsummary')}
          >
            <PieChart size={20} />
            Client Summary
          </button>
        </nav>
        </aside>
      </div>

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
        ) : activePage === 'riderperformance' ? (
          <RiderPerformance
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
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetSheetCount}
            loading={loading}
            refreshData={fetchData}
            defaultTab="data"
          />
        ) : activePage === 'fleetcitysummary' ? (
          <FleetDataViewer
            fleetData={fleetData}
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetSheetCount}
            loading={loading}
            refreshData={fetchData}
            defaultTab="citysummary"
          />
        ) : activePage === 'fleetsummary' ? (
          <FleetDataViewer
            fleetData={fleetData}
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetSheetCount}
            loading={loading}
            refreshData={fetchData}
            defaultTab="clientsummary"
          />
        ) : null}
      </main>
    </div>
  )
}

export default App
