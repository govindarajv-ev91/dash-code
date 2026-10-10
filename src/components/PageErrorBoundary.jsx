import React, { Component } from 'react'

export default class PageErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.pageName}] Page failed to open`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="dashboard-container">
        <div className="table-card glass" role="alert" style={{ padding: '1.5rem' }}>
          <h2 style={{ margin: '0 0 0.75rem' }}>{this.props.pageName} couldn’t open</h2>
          <p>Please retry. If the problem continues, reload the page.</p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="fsr-export-btn" onClick={this.props.onRetry}>Retry</button>
            <button type="button" className="fsr-export-btn" onClick={() => window.location.reload()}>Reload page</button>
          </div>
          <details style={{ marginTop: '1rem', overflowWrap: 'anywhere' }}>
            <summary>Error details</summary>
            <p>{String(this.state.error?.message || this.state.error)}</p>
          </details>
        </div>
      </div>
    )
  }
}
