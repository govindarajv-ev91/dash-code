import React, { useState, useEffect, useCallback, Suspense, lazy, startTransition, useRef, useDeferredValue } from 'react'
import Dashboard from './Dashboard'
import RiderAttendance from './RiderAttendance'
import TempSourceActive from './TempSourceActive'
import DailyMailer from './DailyMailer'
import RiderDetails from './RiderDetails'
import IotUploadPasswordDialog from './components/IotUploadPasswordDialog'
import FullDataPage from './components/FullDataPage'
import AccountMenu from './components/AccountMenu'
import SidebarNavigation from './components/SidebarNavigation'
import { fetchAllData } from './lib/supabaseFetch'
import { scheduleCacheWrite } from './lib/deferredCache'
import {
  fetchRiderOnboardingRows,
  clearRiderOnboardingMemoryCache,
} from './lib/riderOnboardingDb'

const VehicleTracking = lazy(() => import('./VehicleTracking'))
const OnboardingAnalytics = lazy(() => import('./OnboardingAnalytics'))
const ErrorFinder = lazy(() => import('./ErrorFinder'))
const InactiveRiderMailer = lazy(() => import('./InactiveRiderMailer'))
const RiderAttritionMailer = lazy(() => import('./RiderAttritionMailer'))
const VehicleInventory = lazy(() => import('./VehicleInventory'))
const FleetDataViewer = lazy(() => import('./FleetDataViewer'))
const RiderPerformance = lazy(() => import('./RiderPerformance'))
const RiderPaymentUpload = lazy(() => import('./RiderPaymentUpload'))
const DeployedRentalPending = lazy(() => import('./DeployedRentalPending'))
const OrderUpload = lazy(() => import('./OrderUpload'))
const OrderHistory = lazy(() => import('./OrderHistory'))
const PaymentHistory = lazy(() => import('./PaymentHistory'))
const SdPaymentViewer = lazy(() => import('./SdPaymentViewer'))
const IotData = lazy(() => import('./IotData'))
const EvEnvironmentalImpact = lazy(() => import('./EvEnvironmentalImpact'))
const Ev91DbData = lazy(() => import('./Ev91DbData'))
const Ev91RiderPerformance = lazy(() => import('./Ev91RiderPerformance'))
const Ev91OnboardingPending = lazy(() => import('./Ev91OnboardingPending'))
const Ev91FlPending = lazy(() => import('./Ev91FlPending'))
const Ev91EvLookup = lazy(() => import('./Ev91EvLookup'))
const Ev91DeployReturnSummary = lazy(() => import('./Ev91DeployReturnSummary'))
const Ev91OperationalStatus = lazy(() => import('./Ev91OperationalStatus'))
const Ev91ClientPeriodTrend = lazy(() => import('./Ev91ClientPeriodTrend'))
const Ev91Vehicles = lazy(() => import('./Ev91Vehicles'))
const Ev91SdWallet = lazy(() => import('./Ev91SdWallet'))
const BigQueryDeployReturn = lazy(() => import('./BigQueryDeployReturn'))
const ServiceSchedule = lazy(() => import('./ServiceSchedule'))
const SourceWiseData = lazy(() => import('./SourceWiseData'))
const SourceMaster = lazy(() => import('./SourceMaster'))
import {
  FLEET_FORM_CACHE_KEY,
  FLEET_FORM_TABLE,
  FLEET_LEGACY_TABLE,
  FLEET_SLIM_COLUMNS,
  FLEET_SLIM_PAGE_SIZE,
  FLEET_FULL_PAGE_SIZE,
} from './lib/fleetDataConfig'
import { mergeFleetSources, splitFleetBySource, tagLegacyFleetRows } from './lib/fleetDataLoad'
import { fetchAllOrderUploads, clearOrderUploadCache } from './lib/orderUploadDb'
import { mergeRiderMetricSources } from './lib/mergeRiderMetrics'

/** Bump when merge shape changes (e.g. FL=1 IC-only rows) so old caches are ignored. */
const RIDER_MERGED_CACHE_KEY = 'rider_metrics_merged_v4'
import { clearIotRiderOrderCache } from './lib/iotDataDb'
import { Layout } from 'lucide-react'
import './index.css'

const EV91_PAGES = new Set([
  'ev91-current',
  'ev91-overall',
  'ev91-mapping',
  'ev91-riders',
  'ev91-insight',
  'ev91-performance',
  'ev91-onboarding',
  'ev91-fl-pending',
  'ev91-evlookup',
  'ev91-summary',
  'ev91-operational',
  'ev91-client-period-trend',
  'ev91-sources',
  'ev91-vehicles',
  'ev91-sd',
  'ev91-iotupload',
])
const EV91_ENDPOINT_BY_PAGE = {
  'ev91-current': 'current-status',
  'ev91-overall': 'overall-status',
  'ev91-mapping': 'client-mapping-history',
  'ev91-riders': 'rider-details',
}

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
    } catch { return null }
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

async function fetchCoreDashboardData({ fullFleet = false, onOrdersLoaded } = {}) {
  const [riderRes, uploadRows] = await Promise.all([
    fetchAllData('rider_metrics', RIDER_METRIC_COLS, 'id', {
      pageSize: FLEET_SLIM_PAGE_SIZE,
    }),
    fetchAllOrderUploads({ force: true }).then((rows) => {
      onOrdersLoaded?.(rows)
      return rows
    }).catch((err) => {
      console.warn('order_upload_data load skipped:', err?.message || err)
      return []
    }),
  ])
  const mergedRiders = mergeRiderMetricSources(riderRes.data || [], uploadRows || [])
  const { fleetRes, formFleetRes } = fullFleet
    ? await fetchFullFleetTables()
    : await fetchSlimFleetTables()
  return {
    riderRes: { ...riderRes, data: mergedRiders, metricsCount: riderRes.data?.length ?? 0, uploadCount: uploadRows?.length ?? 0 },
    uploadRows,
    fleetRes,
    formFleetRes,
  }
}

async function fetchSecondaryTables() {
  const [kycRes, onboardingRows, inventoryRes] = await Promise.all([
    fetchAllData('rider_kyc', '*', 'id', { pageSize: 500 }),
    fetchRiderOnboardingRows({ force: true, full: true }),
    fetchAllData('vehicle_inventory', '*', 'id', { pageSize: 500 }),
  ])
  return [
    kycRes,
    { data: onboardingRows, totalCount: onboardingRows.length },
    inventoryRes,
  ]
}

const ACTIVE_PAGE_STORAGE_KEY = 'fleetpro-active-page'
const FLEET_PAGES_NEEDING_FULL = new Set(['fleetdata', 'tracking', 'ev91-insight'])

function getSavedActivePage() {
  try {
    const savedPage = window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) || 'dashboard'
    return savedPage === 'ev91-iotupload' ? 'dashboard' : savedPage
  } catch {
    return 'dashboard'
  }
}

// Keep report work out of the urgent sidebar selection update.
const DashboardContent = React.memo(function DashboardContent({
  activePage,
  riderData,
  fleetData,
  weeklyData,
  loading,
  fetchData,
  displayFleetData,
  fleetLoading,
  refreshing,
  dataUpdatedAt,
  kycData,
  onboardingData,
  vehicleInventoryData,
  refreshOrdersAfterUpload,
  fleetTotalCount,
  fleetFormCount,
  fleetFullLoading,
  fleetDataFull,
  loadFullFleet,
  user,
  isAdmin,
}) {
  return (
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
        fleetData={displayFleetData}
        riderData={riderData}
        loading={loading || fleetLoading}
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
    ) : activePage === 'deployedrental' ? (
      <DeployedRentalPending />
    ) : activePage === 'orderupload' ? (
      <OrderUpload onOrdersSaved={refreshOrdersAfterUpload} />
    ) : activePage === 'orderhistory' ? (
      <OrderHistory />
    ) : activePage === 'paymenthistory' ? (
      <PaymentHistory onboardingData={onboardingData} />
    ) : activePage === 'sdpayment' ? (
      <SdPaymentViewer />
    ) : activePage === 'iotdata' || activePage === 'ev91-iotupload' ? (
      <IotData
        key={activePage}
        uploadEnabled={activePage === 'ev91-iotupload'}
        fleetData={fleetData}
        riderData={riderData}
        vehicleInventoryData={vehicleInventoryData}
        loading={loading}
      />
    ) : activePage === 'evimpact' ? (
      <EvEnvironmentalImpact
        vehicleInventoryData={vehicleInventoryData}
        loading={loading}
      />
    ) : activePage === 'fulldata' ? (
      <FullDataPage onboardingData={onboardingData} riderData={riderData} />
    ) : activePage === 'sourcewise' ? (
      <SourceWiseData onboardingData={onboardingData} />
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
    ) : activePage === 'serviceschedule' ? (
      <ServiceSchedule />
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
    ) : activePage === 'bigquery' ? (
      <BigQueryDeployReturn
        fleetData={displayFleetData}
        loading={loading || fleetLoading}
        fleetFullLoading={fleetFullLoading}
        fleetIsSlim={!fleetDataFull}
        loadFullFleet={loadFullFleet}
        onboardingData={onboardingData}
      />
    ) : activePage === 'ev91-performance' ? (
      <Ev91RiderPerformance
        riderData={riderData}
        onboardingData={onboardingData}
        loading={loading}
        refreshing={refreshing}
        dataUpdatedAt={dataUpdatedAt}
        refreshData={() => fetchData({ bypassCache: true })}
      />
    ) : activePage === 'ev91-onboarding' ? (
      <Ev91OnboardingPending
        riderData={riderData}
        onboardingData={onboardingData}
        loading={loading}
        refreshing={refreshing}
        dataUpdatedAt={dataUpdatedAt}
        refreshData={() => fetchData({ bypassCache: true })}
      />
    ) : activePage === 'ev91-fl-pending' ? (
      <Ev91FlPending />
    ) : activePage === 'ev91-evlookup' ? (
      <Ev91EvLookup
        riderData={riderData}
        loading={loading}
        refreshing={refreshing}
        dataUpdatedAt={dataUpdatedAt}
        refreshData={() => fetchData({ bypassCache: true })}
      />
    ) : activePage === 'ev91-summary' ? (
      <Ev91DeployReturnSummary riderData={riderData} loading={loading} />
    ) : activePage === 'ev91-operational' ? (
      <Ev91OperationalStatus />
    ) : activePage === 'ev91-client-period-trend' ? (
      <Ev91ClientPeriodTrend riderData={riderData} onboardingData={onboardingData} />
    ) : activePage === 'ev91-sources' ? (
      <SourceMaster canManage={!!user && !!isAdmin} />
    ) : activePage === 'ev91-vehicles' ? (
      <Ev91Vehicles />
    ) : activePage === 'ev91-sd' ? (
      <Ev91SdWallet />
    ) : activePage === 'ev91-insight' ? (
      <VehicleTracking
        fleetData={displayFleetData}
        riderData={riderData}
        loading={loading || fleetLoading}
        includeEv91Api
        pageTitle="Rider & Vehicle Insight"
        pageSubtitle="Fleet + EV91 API · Rider-Vehicle Monitor with deploy/return history"
      />
    ) : EV91_PAGES.has(activePage) ? (
      <Ev91DbData
        endpoint={EV91_ENDPOINT_BY_PAGE[activePage]}
        onboardingData={onboardingData}
      />
    ) : null}
    </Suspense>
  )
})

function App({ user, onSignOut, signingOut, signOutError, isAdmin }) {
  const [activePage, setActivePage] = useState(getSavedActivePage)
  const renderedPage = useDeferredValue(activePage)
  const pagePending = renderedPage !== activePage
  const [iotUploadPasswordOpen, setIotUploadPasswordOpen] = useState(false)
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
  const lastSecondaryFetchRef = useRef(0)

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage)
    } catch {
      return
    }
  }, [activePage])

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

  const applyOrdersToState = useCallback((rows) => {
    // Let the overview show complete orders while the larger metrics/fleet
    // requests continue, instead of keeping an old cached date cutoff on screen.
    startTransition(() => setRiderData((existing) => mergeRiderMetricSources(
      existing.filter((row) => row?._data_source !== 'order_upload'), rows,
    )))
    return rows
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

  const loadSecondaryTables = useCallback(async ({ force = false } = {}) => {
    const now = Date.now()
    if (!force && now - lastSecondaryFetchRef.current < 30_000) return
    lastSecondaryFetchRef.current = now

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
      setDataUpdatedAt(new Date())
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
        await clearCacheKeys([
          RIDER_MERGED_CACHE_KEY,
          'rider_metrics',
          'order_upload_data',
          'fleet_data',
          FLEET_FORM_CACHE_KEY,
          'fleet_sheet_data',
          'rider_kyc',
          'rider_onboarding',
          'vehicle_inventory',
        ])
        clearRiderOnboardingMemoryCache()
        clearOrderUploadCache()
        clearIotRiderOrderCache()
        const { riderRes, uploadRows, fleetRes, formFleetRes } = await fetchCoreDashboardData({ fullFleet, onOrdersLoaded: applyOrdersToState })

        if (riderRes.data?.length) {
          startTransition(() => setRiderData(riderRes.data))
          scheduleCacheWrite(() => {
            cacheData(RIDER_MERGED_CACHE_KEY, riderRes.data)
            if (uploadRows?.length) cacheData('order_upload_data', uploadRows)
          })
        }

        const merged = applyFleetToState(fleetRes, formFleetRes)
        if (fullFleet) startTransition(() => setFleetDataFull(merged))
        setDataUpdatedAt(new Date())
        void loadSecondaryTables({ force: true })
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
      cachedUploads,
      cachedFleet,
      cachedFormFleet,
      cachedWeekly,
      cachedKyc,
      cachedOnboarding,
      cachedInventory,
    ] = await Promise.all([
      getCachedData(RIDER_MERGED_CACHE_KEY),
      getCachedData('order_upload_data'),
      getCachedData('fleet_data'),
      getCachedData(FLEET_FORM_CACHE_KEY),
      getCachedData('weekly_performance'),
      getCachedData('rider_kyc'),
      getCachedData('rider_onboarding'),
      getCachedData('vehicle_inventory'),
    ])

    if (cachedRiders) {
      startTransition(() => setRiderData(cachedRiders))
    } else if (cachedUploads?.length) {
      startTransition(() => setRiderData(mergeRiderMetricSources([], cachedUploads)))
    }
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
      const [riderRes, uploadRows, slimFleet] = await Promise.all([
        fetchAllData('rider_metrics', RIDER_METRIC_COLS, 'id', { pageSize: FLEET_SLIM_PAGE_SIZE }),
        fetchAllOrderUploads({ force: true }).then(applyOrdersToState).catch((err) => {
          console.warn('order_upload_data load skipped:', err?.message || err)
          return []
        }),
        fetchSlimFleetTables(),
      ])

      const mergedRiders = mergeRiderMetricSources(riderRes.data || [], uploadRows || [])
      if (mergedRiders.length) {
        startTransition(() => setRiderData(mergedRiders))
        scheduleCacheWrite(() => {
          cacheData(RIDER_MERGED_CACHE_KEY, mergedRiders)
          if (uploadRows?.length) cacheData('order_upload_data', uploadRows)
        })
      }

      setLoading(false)

      const { fleetRes, formFleetRes } = slimFleet
      applyFleetToState(fleetRes, formFleetRes)
      setDataUpdatedAt(new Date())

      console.log(
        `Fleet loaded (slim): ${fleetRes.data?.length ?? 0} from ${FLEET_LEGACY_TABLE}, ${formFleetRes.data?.length ?? 0} from ${FLEET_FORM_TABLE} · orders: ${riderRes.data?.length ?? 0} metrics + ${uploadRows?.length ?? 0} uploads → ${mergedRiders.length} merged`
      )

      void loadSecondaryTables({ force: true })
    } catch (error) {
      console.error('Fetch error:', error)
    } finally {
      setLoading(false)
      setFleetLoading(false)
    }
  }, [applyFleetToState, applyOrdersToState, loadSecondaryTables])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Keep rider_onboarding / kyc / inventory fresh while the app stays open
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadSecondaryTables({ force: true })
    }
    const intervalId = setInterval(refresh, 90_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadSecondaryTables])

  const refreshOrdersAfterUpload = useCallback(async (uploadedRows) => {
    clearIotRiderOrderCache()

    const hasPatch = Array.isArray(uploadedRows) && uploadedRows.length > 0

    const syncMerged = async (uploadRows) => {
      const riderRes = await fetchAllData('rider_metrics', RIDER_METRIC_COLS, 'id', {
        pageSize: FLEET_SLIM_PAGE_SIZE,
      })
      const merged = mergeRiderMetricSources(riderRes.data || [], uploadRows || [])
      startTransition(() => setRiderData(merged))
      scheduleCacheWrite(() => {
        cacheData(RIDER_MERGED_CACHE_KEY, merged)
        if (uploadRows?.length) cacheData('order_upload_data', uploadRows)
      })
      setDataUpdatedAt(new Date())
      return merged
    }

    try {
      // saveOrderUploadRows already patches a complete cache. Reuse it instead
      // of pulling all orders and rider metrics twice after every file.
      if (!hasPatch) clearOrderUploadCache()
      const uploadRows = await fetchAllOrderUploads()
      await syncMerged(uploadRows)
      console.info(`[orders] refreshed after upload: ${uploadRows?.length ?? 0} uploads`)
    } catch (err) {
      console.warn('Refresh after order upload failed:', err?.message || err)
    }
  }, [])

  useEffect(() => {
    if (FLEET_PAGES_NEEDING_FULL.has(activePage) && !fleetDataFull && !fleetFullLoading) {
      loadFullFleet()
    }
  }, [activePage, fleetDataFull, fleetFullLoading, loadFullFleet])

  const displayFleetData = fleetDataFull ?? fleetData
  const openEv91IotUpload = useCallback(() => {
    if (user && isAdmin) {
      setIotUploadPasswordOpen(false)
      setActivePage('ev91-iotupload')
      return
    }
    setIotUploadPasswordOpen(true)
  }, [user, isAdmin])

  return (
    <div className="app-layout app-layout-auto-sidebar">
      {iotUploadPasswordOpen && (
        <IotUploadPasswordDialog
          onDismiss={() => setIotUploadPasswordOpen(false)}
          onUnlock={() => {
            setIotUploadPasswordOpen(false)
            setActivePage('ev91-iotupload')
          }}
        />
      )}
      <div className="sidebar-shell">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <Layout className="text-primary" />
            <span>FleetPro</span>
          </div>
          {user ? <AccountMenu user={user} onSignOut={onSignOut} signingOut={signingOut} signOutError={signOutError} isAdmin={isAdmin} />
            : <a className="public-admin-link" href="#admin">Admin sign in</a>}
          <SidebarNavigation
            activePage={activePage}
            onSelectPage={setActivePage}
            onIotUpload={openEv91IotUpload}
            isAdmin={isAdmin}
          />
        </aside>
      </div>

      <main aria-busy={pagePending} className={`main-content${renderedPage === 'ev91-client-period-trend' ? ' ev91-client-trend-main' : ''}`}>
        {pagePending && <div className="page-navigation-status" role="status">Opening page...</div>}
        <DashboardContent
          activePage={renderedPage}
          riderData={riderData}
          fleetData={fleetData}
          weeklyData={weeklyData}
          loading={loading}
          fetchData={fetchData}
          displayFleetData={displayFleetData}
          fleetLoading={fleetLoading}
          refreshing={refreshing}
          dataUpdatedAt={dataUpdatedAt}
          kycData={kycData}
          onboardingData={onboardingData}
          vehicleInventoryData={vehicleInventoryData}
          refreshOrdersAfterUpload={refreshOrdersAfterUpload}
          fleetTotalCount={fleetTotalCount}
          fleetFormCount={fleetFormCount}
          fleetFullLoading={fleetFullLoading}
          fleetDataFull={fleetDataFull}
          loadFullFleet={loadFullFleet}
          user={user}
          isAdmin={isAdmin}
        />
      </main>
    </div>
  )
}

export default App
