// CHUNK-RELOAD-1 (2026-09-15): the app's only error boundary.
//
// Before this, a render error anywhere, or a code-split chunk that failed to
// load after a deploy, unmounted the whole React tree and left a white page with
// no message and no way on except knowing to refresh. This boundary catches it
// and offers the refresh. Styling is inline on purpose: the boundary must render
// even when a stylesheet is what failed.
import { Component } from 'react'

const F = 'Plus Jakarta Sans, sans-serif'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    // The console keeps the stack; the page keeps its manners.
    console.error('[AppErrorBoundary]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{
        minHeight: '100vh', background: '#F4F1EC', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box', fontFamily: F,
      }}>
        <div style={{
          maxWidth: 440, width: '100%', background: '#fff', borderRadius: 'var(--aspire-radius-card, 12px)', padding: '26px 28px',
          boxShadow: '0 1px 2px rgba(29,37,103,0.06), 0 8px 24px rgba(29,37,103,0.08)',
        }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#191919' }}>
            ASPIRE Intelligence needs a refresh
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 13.5, lineHeight: 1.6, color: '#4A5560' }}>
            This page could not be shown. That usually means the app was updated while this
            tab was open. Refreshing loads the current version; nothing you saved is affected.
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{
            height: 38, padding: '0 18px', borderRadius: 'var(--aspire-radius-control, 10px)', border: 0, background: '#1D2567',
            color: '#fff', fontFamily: F, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          }}>
            Refresh
          </button>
        </div>
      </div>
    )
  }
}
