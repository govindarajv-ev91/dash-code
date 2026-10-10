import React, { lazy, Suspense, useState } from 'react'
import PageErrorBoundary from './PageErrorBoundary'

const loadFullData = () => import('../FullData.jsx')

export default function FullDataPage({ onboardingData, riderData, loadPage = loadFullData }) {
  const [page, setPage] = useState(() => ({ Component: lazy(loadPage), attempt: 0 }))
  const Page = page.Component

  const retry = () => {
    // React.lazy remembers rejected imports. A retry needs a new lazy instance.
    setPage((previous) => ({ Component: lazy(loadPage), attempt: previous.attempt + 1 }))
  }

  return (
    <PageErrorBoundary key={page.attempt} pageName="Full Data" onRetry={retry}>
      <Suspense fallback={
        <div className="dashboard-container" role="status" aria-live="polite">
          <h2>Full Data</h2>
          <div className="loading-container" style={{ minHeight: 240 }}>
            <span className="loader" aria-hidden="true" />
            <span>Opening Full Data…</span>
          </div>
        </div>
      }>
        <Page onboardingData={onboardingData} riderData={riderData} />
      </Suspense>
    </PageErrorBoundary>
  )
}
