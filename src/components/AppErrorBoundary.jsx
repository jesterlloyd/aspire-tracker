// CHUNK-RELOAD-1 (2026-09-15): the app's only error boundary.
//
// Before this, a render error anywhere, or a code-split chunk that failed to
// load after a deploy, unmounted the whole React tree and left a white page with
// no message and no way on except knowing to refresh. This boundary catches it
// and offers the refresh. Styling is inline on purpose: the boundary must render
// even when a stylesheet is what failed.
import { Component } from 'react'
import { reloadToCurrentVersion, isStaleCodeError, shouldReloadAfterChunkFailure } from '../lib/lazyReload'

const F = 'Plus Jakarta Sans, sans-serif'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  // REFRESH-QUIET-1 (Owner, 2026-09-30: the card "appears all the time"): the usual cause is a new
  // version going live while the tab was open. That case refreshes itself, once per two minutes (the
  // same guard lazyReload uses, so it can never loop); only a real fault, or the same failure right
  // after a refresh, shows the card, and the card now names the error.
  static getDerivedStateFromError(error) {
    return { error, reloading: isStaleCodeError(error) }
  }

  componentDidCatch(error) {
    // The console keeps the stack; the page keeps its manners.
    console.error('[AppErrorBoundary]', error)
    if (!this.state.reloading) return
    if (shouldReloadAfterChunkFailure('app-boundary', window.sessionStorage)) reloadToCurrentVersion(window.location)
    else this.setState({ reloading: false })   // it failed again right after a refresh: show the card
  }

  render() {
    if (!this.state.error) return this.props.children
    // Refreshing to the current version: a plain page for the moment it takes, never the card.
    if (this.state.reloading) return <div aria-busy="true" style={{ minHeight: '100vh', background: '#F4F1EC' }} />
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
            This page could not be shown. Refreshing loads the current version; nothing you
            saved is affected.
          </p>
          <p style={{ margin: '0 0 18px', fontSize: 12, lineHeight: 1.5, color: '#5F6B75', wordBreak: 'break-word' }}>
            If it keeps happening, send this to the program owner: <code style={{ fontSize: 12 }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</code>
          </p>
          <button type="button" onClick={() => reloadToCurrentVersion(window.location)} style={{
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
