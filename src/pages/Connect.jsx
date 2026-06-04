import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const CONNECT_LAST_TAB_KEY = 'aspire.connect.lastTab'
const VALID_TABS = new Set(['contacts', 'outreach', 'broadcasts'])
import { Users, Send, Megaphone, RefreshCw } from 'lucide-react'
import ContactsView from '../components/connect/ContactsView'
import OutreachView from '../components/connect/OutreachView'
import BroadcastsView from '../components/connect/BroadcastsView'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'

const F = 'DM Sans, sans-serif'

export default function ConnectPage({ cohortId, onNavigateToStudent }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { toasts, removeToast, toast } = useToast()

  // ── Refresh key — increment to trigger re-fetch in active sub-tab ──────────
  // Does NOT clear drafts, recipients, generated results, filters, or session state.
  const [refreshKey, setRefreshKey]   = useState(0)
  const [refreshing,  setRefreshing]  = useState(false)

  const handleRefresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshKey(k => k + 1)
    // Brief loading state — resets after re-fetch cycles complete
    setTimeout(() => setRefreshing(false), 1200)
  }, [refreshing])

  // URL-routed sub-tab — declared first so useEffects below can safely reference it
  const activeSubTab = location.pathname.startsWith('/connect/contacts')
    ? 'contacts'
    : location.pathname.startsWith('/connect/broadcasts')
      ? 'broadcasts'
      : 'outreach'

  // Redirect bare /connect to last active tab (or Contacts as default)
  useEffect(() => {
    if (location.pathname === '/connect') {
      const saved = localStorage.getItem(CONNECT_LAST_TAB_KEY)
      const tab = (saved && VALID_TABS.has(saved)) ? saved : 'contacts'
      navigate(`/connect/${tab}`, { replace: true })
    }
  }, [location.pathname, navigate])

  // Persist active tab so returning to /connect restores workspace
  useEffect(() => {
    if (VALID_TABS.has(activeSubTab)) {
      localStorage.setItem(CONNECT_LAST_TAB_KEY, activeSubTab)
    }
  }, [activeSubTab])

  const btnStyle = key => ({
    height: 32, padding: '0 13px',
    display: 'flex', alignItems: 'center', gap: 6,
    border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: F, fontWeight: 500,
    background: activeSubTab === key ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
    color: activeSubTab === key ? '#fff' : 'var(--text-secondary,#4A5560)',
    transition: 'all 0.12s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 128px)', fontFamily: F }}>

      {/* Page header — elevated workspace treatment */}
      <div style={{ padding: '12px 28px 0', flexShrink: 0 }}>
        {/* Title row — refresh button pinned to far right, same visual level as h1 */}
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{
              margin: 0, fontSize: 24, fontWeight: 700,
              color: 'var(--text-primary,#0E1428)',
              letterSpacing: '-0.02em', lineHeight: 1.2, fontFamily: F,
            }}>
              ASPIRE Connect
            </h1>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.5, fontFamily: F }}>
              Contacts, outreach, and announcements across cohorts.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh Connect data"
            aria-busy={refreshing}
            title="Refresh Connect data"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 7, flexShrink: 0,
              border: '1px solid var(--border-input,rgba(29,37,103,0.10))',
              background: 'var(--bg-input,#fff)',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              color: 'var(--text-secondary,#4A5560)',
              transition: 'background 0.12s, opacity 0.12s',
              opacity: refreshing ? 0.55 : 1,
              marginTop: 2,
            }}
            onMouseEnter={e => { if (!refreshing) e.currentTarget.style.background = '#f3f4f6' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-input,#fff)' }}
          >
            <RefreshCw
              size={14}
              strokeWidth={2}
              style={{ transition: 'transform 0.6s ease', transform: refreshing ? 'rotate(360deg)' : 'none' }}
            />
          </button>
        </div>

        {/* Sub-tab picker */}
        <div style={{ paddingBottom: 12 }}>
          <div style={{
            display: 'flex',
            borderRadius: 7,
            border: '1px solid var(--border-input,rgba(29,37,103,0.10))',
            overflow: 'hidden',
            width: 'fit-content',
          }}>
            <button onClick={() => navigate('/connect/contacts')} style={btnStyle('contacts')}>
              <Users size={13} />
              Contacts
            </button>
            <button onClick={() => navigate('/connect/outreach')} style={btnStyle('outreach')}>
              <Send size={13} />
              Outreach
            </button>
            <button onClick={() => navigate('/connect/broadcasts')} style={btnStyle('broadcasts')}>
              <Megaphone size={13} />
              Broadcasts
            </button>
          </div>
        </div>
      </div>

      {/* Sub-tab content — all three mounted; inactive hidden to preserve form state */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Contacts uses flex+height:100% so its three columns scroll independently */}
        <div style={{ display: activeSubTab === 'contacts' ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <ContactsView refreshKey={refreshKey} />
        </div>
        <div style={{ display: activeSubTab === 'outreach' ? 'block' : 'none' }}>
          <OutreachView cohortId={cohortId} onNavigateToStudent={onNavigateToStudent} toast={toast} refreshKey={refreshKey} />
        </div>
        <div style={{ display: activeSubTab === 'broadcasts' ? 'block' : 'none' }}>
          <BroadcastsView />
        </div>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}
