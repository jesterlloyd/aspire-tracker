import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const CONNECT_LAST_TAB_KEY = 'aspire.connect.lastTab'
const VALID_TABS = new Set(['contacts', 'outreach', 'broadcasts'])
import { Users, Send, Megaphone } from 'lucide-react'
import ContactsView from '../components/connect/ContactsView'
import OutreachView from '../components/connect/OutreachView'
import BroadcastsView from '../components/connect/BroadcastsView'

const F = 'DM Sans, sans-serif'

export default function ConnectPage({ cohortId, onNavigateToStudent }) {
  const navigate = useNavigate()
  const location = useLocation()

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
      <div style={{ padding: '24px 28px 0', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', marginBottom: 20,
        }}>
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
          {/* Right-aligned action buttons reserved for future stages */}
        </div>

        {/* Sub-tab picker — mirrors RotationTab's pill-group shape exactly */}
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
          <ContactsView />
        </div>
        <div style={{ display: activeSubTab === 'outreach' ? 'block' : 'none' }}>
          <OutreachView cohortId={cohortId} onNavigateToStudent={onNavigateToStudent} />
        </div>
        <div style={{ display: activeSubTab === 'broadcasts' ? 'block' : 'none' }}>
          <BroadcastsView />
        </div>
      </div>

    </div>
  )
}
