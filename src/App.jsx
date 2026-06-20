import React, { useState, useEffect, useCallback, Suspense, lazy, startTransition } from 'react'
import Dashboard from './Dashboard'
import RiderAttendance from './RiderAttendance'
import TempSourceActive from './TempSourceActive'
import DailyMailer from './DailyMailer'
import RiderDetails from './RiderDetails'
import { fetchAllData } from './lib/supabaseFetch'
import { scheduleCacheWrite } from './lib/deferredCache'

const VehicleTracking = lazy(() => import('./VehicleTracking'))
const OnboardingAnalytics = lazy(() => import('./OnboardingAnalytics'))
const ErrorFinder = lazy(() => import('./ErrorFinder'))
const InactiveRiderMailer = lazy(() => import('./InactiveRiderMailer'))
const RiderAttritionMailer = lazy(() => import('./RiderAttritionMailer'))
const VehicleInventory = lazy(() => import('./VehicleInventory'))
const FleetDataViewer = lazy(() => import('./FleetDataViewer'))
const RiderPerformance = lazy(() => import('./RiderPerformance'))
const RiderPaymentUpload = lazy(() => import('./RiderPaymentUpload'))
const PaymentHistory = lazy(() => import('./PaymentHistory'))
const SdPaymentViewer = lazy(() => import('./SdPaymentViewer'))
const IotData = lazy(() => import('./IotData'))
import {
  FLEET_FORM_CACHE_KEY,
  FLEET_FORM_TABLE,
  FLEET_LEGACY_TABLE,
  FLEET_SLIM_COLUMNS,
  FLEET_SLIM_PAGE_SIZE,
  FLEET_FULL_PAGE_SIZE,
} from './lib/fleetDataConfig'
import { mergeFleetSources, splitFleetBySource, tagLegacyFleetRows } from './lib/fleetDataLoad'
import { Layout, BarChart3, ClipboardList, Truck, UserPlus, AlertTriangle, FileBarChart2, Mail, Users, UserX, Database, Radio, PieChart, MapPin, Activity, TrendingDown, Wallet, History, Shield } from 'lucide-react'
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

function PageLoading() {
  return (
    <div className="page-loading" style={{ padding: '2rem', textAlign: 'center', opacity: 0.85 }}>
      Loading page…
    </div>
  )
}

const clearCacheKeys = async (keys) => {
    try {
        const db = await initDB()
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const store = tx.objectStore(STORE_NAME)
            for (const key of keys) store.delete(key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (e) {
        console.error('Clear cache error', e)
    }
}

const RIDER_METRIC_COLS =
  'id,delivered,date_record,worker_code,worker_name,hub_name,city,client,cumulative_order,source,week,month,state,type1,type2,mob_number,fl'

function applyFleetFetchResults(fleetRes, formFleetRes) {
  const dbFleetRows = tagLegacyFleetRows(fleetRes.data)
  const mergedFleetRows = mergeFleetSources(fleetRes.data, formFleetRes.data)
  const formFleetRows = mergedFleetRows.filter((r) => r.data_source !== 'Database')
  return { dbFleetRows, mergedFleetRows, formFleetRows }
}

async function fetchSlimFleetTables() {
  const fleetOpts = {
    pageSize: FLEET_SLIM_PAGE_SIZE,
    deployReturnOnly: true,
  }
  const [fleetRes, formFleetRes] = await Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, FLEET_SLIM_COLUMNS, 'id', fleetOpts),
    fetchAllData(FLEET_FORM_TABLE, FLEET_SLIM_COLUMNS, 'id', {
      pageSize: FLEET_SLIM_PAGE_SIZE,
    }),
  ])
  return { fleetRes, formFleetRes }
}

async function fetchFullFleetTables() {
  const [fleetRes, formFleetRes] = await Promise.all([
    fetchAllData(FLEET_LEGACY_TABLE, '*', 'id', { pageSize: FLEET_FULL_PAGE_SIZE }),
    fetchAllData(FLEET_FORM_TABLE, '*', 'id', { pageSize: FLEET_FULL_PAGE_SIZE }),
  ])
  return { fleetRes, formFleetRes }
}

async function fetchCoreDashboardData({ fullFleet = false } = {}) {
  const riderRes = await fetchAllData('rider_metrics', RIDER_METRIC_COLS, 'id', {
    pageSize: FLEET_SLIM_PAGE_SIZE,
  })
  const { fleetRes, formFleetRes } = fullFleet
    ? await fetchFullFleetTables()
    : await fetchSlimFleetTables()
  return { riderRes, fleetRes, formFleetRes }
}

async function fetchSecondaryTables() {
  return Promise.all([
    fetchAllData('rider_kyc', '*', 'id', { pageSize: 500 }),
    fetchAllData('rider_onboarding', '*', 'id', { pageSize: 500 }),
    fetchAllData('vehicle_inventory', '*', 'id', { pageSize: 500 }),
  ])
}

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [riderData, setRiderData] = useState([])
  const [fleetData, setFleetData] = useState([])
  const [fleetTotalCount, setFleetTotalCount] = useState(0)
  const [fleetFormCount, setFleetFormCount] = useState(0)
  const [weeklyData, setWeeklyData] = useState([])
  const [kycData, setKycData] = useState([])
  const [onboardingData, setOnboardingData] = useState([])
  const [vehicleInventoryData, setVehicleInventoryData] = useState([])
  const [fleetLoading, setFleetLoading] = useState(true)
  const [fleetFullLoading, setFleetFullLoading] = useState(false)
  const [fleetDataFull, setFleetDataFull] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dataUpdatedAt, setDataUpdatedAt] = useState(null)

  const applyFleetToState = useCallback((fleetRes, formFleetRes, { cache = true } = {}) => {
    const { dbFleetRows, mergedFleetRows, formFleetRows } = applyFleetFetchResults(fleetRes, formFleetRes)
    startTransition(() => {
      setFleetData(mergedFleetRows)
      setFleetTotalCount(fleetRes.totalCount ?? fleetRes.data?.length ?? 0)
      setFleetFormCount(formFleetRows.length)
    })
    if (cache) {
      scheduleCacheWrite(() => {
        if (dbFleetRows.length) cacheData('fleet_data', dbFleetRows)
        if (formFleetRows.length) cacheData(FLEET_FORM_CACHE_KEY, formFleetRows)
      })
    }
    return mergedFleetRows
  }, [])

  const loadFullFleet = useCallback(async () => {
    if (fleetFullLoading) return fleetDataFull
    setFleetFullLoading(true)
    try {
      const { fleetRes, formFleetRes } = await fetchFullFleetTables()
      const merged = applyFleetToState(fleetRes, formFleetRes, { cache: false })
      setFleetDataFull(merged)
      setFleetData(merged)
      return merged
    } catch (err) {
      console.error('Full fleet load error:', err)
      return null
    } finally {
      setFleetFullLoading(false)
    }
  }, [fleetFullLoading, fleetDataFull, applyFleetToState])

  const loadSecondaryTables = useCallback(async () => {
    try {
      const [kycRes, onboardingRes, inventoryRes] = await fetchSecondaryTables()
      if (kycRes.data?.length) {
        startTransition(() => setKycData(kycRes.data))
        scheduleCacheWrite(() => cacheData('rider_kyc', kycRes.data))
      }
      if (onboardingRes.data?.length) {
        startTransition(() => setOnboardingData(onboardingRes.data))
        scheduleCacheWrite(() => cacheData('rider_onboarding', onboardingRes.data))
      }
      if (inventoryRes.data?.length) {
        startTransition(() => setVehicleInventoryData(inventoryRes.data))
        scheduleCacheWrite(() => cacheData('vehicle_inventory', inventoryRes.data))
      }
    } catch (err) {
      console.error('Secondary tables load error:', err)
    }
  }, [])

  const fetchData = useCallback(async (options = {}) => {
    const { bypassCache = false, fullFleet = false } = options

    if (bypassCache) {
      setRefreshing(true)
      setFleetLoading(true)
      try {
        await clearCacheKeys(['rider_metrics', 'fleet_data', FLEET_FORM_CACHE_KEY, 'fleet_sheet_data'])
        const { riderRes, fleetRes, formFleetRes } = await fetchCoreDashboardData({ fullFleet })

        if (riderRes.data?.length) {
          startTransition(() => setRiderData(riderRes.data))
          scheduleCacheWrite(() => cacheData('rider_metrics', riderRes.data))
        }

        const merged = applyFleetToState(fleetRes, formFleetRes)
        if (fullFleet) startTransition(() => setFleetDataFull(merged))
        setDataUpdatedAt(new Date())
        setTimeout(() => loadSecondaryTables(), 2500)
      } catch (error) {
        console.error('Refresh error:', error)
      } finally {
        setRefreshing(false)
        setFleetLoading(false)
        setLoading(false)
      }
      return
    }

    setLoading(true)
    setFleetLoading(true)

    const [
      cachedRiders,
      cachedFleet,
      cachedFormFleet,
      cachedWeekly,
      cachedKyc,
      cachedOnboarding,
      cachedInventory,
    ] = await Promise.all([
      getCachedData('rider_metrics'),
      getCachedData('fleet_data'),
      getCachedData(FLEET_FORM_CACHE_KEY),
      getCachedData('weekly_performance'),
      getCachedData('rider_kyc'),
      getCachedData('rider_onboarding'),
      getCachedData('vehicle_inventory'),
    ])

    if (cachedRiders) startTransition(() => setRiderData(cachedRiders))
    if (cachedFleet || cachedFormFleet) {
      const { legacy, form } = splitFleetBySource([
        ...(cachedFleet || []),
        ...(cachedFormFleet || []),
      ])
      startTransition(() => {
        setFleetData([...legacy, ...form])
        setFleetFormCount(form.length)
        setFleetLoading(false)
      })
    }
    if (cachedWeekly) startTransition(() => setWeeklyData(cachedWeekly))
    if (cachedKyc) startTransition(() => setKycData(cachedKyc))
    if (cachedOnboarding) startTransition(() => setOnboardingData(cachedOnboarding))
    if (cachedInventory) startTransition(() => setVehicleInventoryData(cachedInventory))

    if (cachedRiders && cachedFleet) setLoading(false)

    try {
      const [riderRes, slimFleet] = await Promise.all([
        fetchAllData('rider_metrics', RIDER_METRIC_COLS, 'id', { pageSize: FLEET_SLIM_PAGE_SIZE }),
        fetchSlimFleetTables(),
      ])

      if (riderRes.data?.length) {
        startTransition(() => setRiderData(riderRes.data))
        scheduleCacheWrite(() => cacheData('rider_metrics', riderRes.data))
      }

      setLoading(false)

      const { fleetRes, formFleetRes } = slimFleet
      applyFleetToState(fleetRes, formFleetRes)
      setDataUpdatedAt(new Date())

      console.log(
        `Fleet loaded (slim): ${fleetRes.data?.length ?? 0} from ${FLEET_LEGACY_TABLE}, ${formFleetRes.data?.length ?? 0} from ${FLEET_FORM_TABLE}`
      )

      setTimeout(() => loadSecondaryTables(), 2500)
    } catch (error) {
      console.error('Fetch error:', error)
    } finally {
      setLoading(false)
      setFleetLoading(false)
    }
  }, [applyFleetToState, loadSecondaryTables])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fleetPagesNeedingFull = new Set(['fleetdata'])
  useEffect(() => {
    if (fleetPagesNeedingFull.has(activePage) && !fleetDataFull && !fleetFullLoading) {
      loadFullFleet()
    }
  }, [activePage, fleetDataFull, fleetFullLoading, loadFullFleet])

  const displayFleetData = fleetDataFull ?? fleetData

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
            className={`nav-item ${activePage === 'attritionmailer' ? 'active' : ''}`}
            onClick={() => setActivePage('attritionmailer')}
          >
            <TrendingDown size={20} />
            Rider Attrition
          </button>
          <button 
            className={`nav-item ${activePage === 'paymentupload' ? 'active' : ''}`}
            onClick={() => setActivePage('paymentupload')}
          >
            <Wallet size={20} />
            Payment Upload
          </button>
          <button 
            className={`nav-item ${activePage === 'paymenthistory' ? 'active' : ''}`}
            onClick={() => setActivePage('paymenthistory')}
          >
            <History size={20} />
            Payment History
          </button>
          <button 
            className={`nav-item ${activePage === 'sdpayment' ? 'active' : ''}`}
            onClick={() => setActivePage('sdpayment')}
          >
            <Shield size={20} />
            SD & EV Rent
          </button>
          <button 
            className={`nav-item ${activePage === 'iotdata' ? 'active' : ''}`}
            onClick={() => setActivePage('iotdata')}
          >
            <Radio size={20} />
            IoT Data
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
        <Suspense fallback={<PageLoading />}>
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
            fleetLoading={fleetLoading}
            refreshing={refreshing}
            dataUpdatedAt={dataUpdatedAt}
            refreshData={() => fetchData({ bypassCache: true })}
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
        ) : activePage === 'attritionmailer' ? (
          <RiderAttritionMailer
            riderData={riderData}
            fleetData={fleetData}
            onboardingData={onboardingData}
            loading={loading}
          />
        ) : activePage === 'paymentupload' ? (
          <RiderPaymentUpload />
        ) : activePage === 'paymenthistory' ? (
          <PaymentHistory onboardingData={onboardingData} />
        ) : activePage === 'sdpayment' ? (
          <SdPaymentViewer />
        ) : activePage === 'iotdata' ? (
          <IotData
            fleetData={fleetData}
            riderData={riderData}
            loading={loading}
          />
        ) : activePage === 'fleetdata' ? (
          <FleetDataViewer
            fleetData={displayFleetData}
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetFormCount}
            loading={loading || fleetFullLoading}
            fleetFullLoading={fleetFullLoading}
            fleetIsSlim={!fleetDataFull}
            loadFullFleet={loadFullFleet}
            refreshData={() => fetchData({ bypassCache: true, fullFleet: true })}
            defaultTab="data"
          />
        ) : activePage === 'fleetcitysummary' ? (
          <FleetDataViewer
            fleetData={fleetData}
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetFormCount}
            loading={loading}
            refreshData={fetchData}
            defaultTab="citysummary"
          />
        ) : activePage === 'fleetsummary' ? (
          <FleetDataViewer
            fleetData={fleetData}
            riderData={riderData}
            totalCount={fleetTotalCount}
            sheetCount={fleetFormCount}
            loading={loading}
            refreshData={fetchData}
            defaultTab="clientsummary"
          />
        ) : null}
        </Suspense>
      </main>
    </div>
  )
}

export default App
