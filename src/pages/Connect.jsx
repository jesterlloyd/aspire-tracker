import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const CONNECT_LAST_TAB_KEY = 'aspire.connect.lastTab'
// ASPIRE-MESSAGES-P4B2B-II: 'messages' joins the existing URL-derived tab model.
// Automations keeps its historical '/connect/broadcasts' slug, unchanged.
const VALID_TABS = new Set(['contacts', 'outreach', 'messages', 'broadcasts'])
import { Users, Send, Activity, MessageSquare } from 'lucide-react'
import ContactsView from '../components/connect/ContactsView'
import OutreachView from '../components/connect/OutreachView'
import AutomationView from '../components/connect/AutomationView'
import MessagesWorkspace from '../components/connect/messages/MessagesWorkspace'
import { useAuth } from '../contexts/AuthContext'
import { formatUnread, unreadLabel } from '../lib/messages/messagesConstants'
import { ACTIVE_POLL_MS, IDLE_UNREAD_POLL_MS, useStaffUnreadCount } from '../lib/messages/messagesPolling'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { RefreshHint } from '../components/UnifiedNav'
import WorkspaceBackLink from '../components/ui/WorkspaceBackLink'
import SegmentedTabs from '../components/ui/SegmentedTabs'

const F = 'Plus Jakarta Sans, sans-serif'

export default function ConnectPage({ cohortId, onNavigateToStudent, refreshRef, backPath = '/aggregate', backLabel = 'At a Glance' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { toasts, removeToast, toast } = useToast()

  // ── Refresh key - increment to trigger re-fetch in active sub-tab ──────────
  // Does NOT clear drafts, recipients, generated results, filters, or session state.
  const [refreshKey, setRefreshKey]   = useState(0)
  const [refreshing,  setRefreshing]  = useState(false)

  const handleRefresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshKey(k => k + 1)
    setTimeout(() => setRefreshing(false), 1200)
  }, [refreshing])

  // Register with the App-level ref so the toolbar RefreshHint can call soft-refresh
  useEffect(() => {
    if (refreshRef) refreshRef.current = handleRefresh
  }, [refreshRef, handleRefresh])

  // ASPIRE-MESSAGES-P4B2B-II: Messages is visible only to an ACTIVE Owner or
  // Admin. useAuth's canEdit/isAdmin are role-only, so neither is sufficient on
  // its own; is_active must be checked too. This mirrors the server's
  // is_active_owner_or_admin() (which treats a legacy null as active) and never
  // uses is_staff(). Client hiding is not a security boundary: every Messages API
  // enforces the same rule server-side.
  const { userProfile } = useAuth()
  const canUseMessages = ['owner', 'admin'].includes(userProfile?.role)
    && userProfile?.is_active !== false

  // URL-routed sub-tab - declared first so useEffects below can safely reference it
  const rawSubTab = location.pathname.startsWith('/connect/contacts')
    ? 'contacts'
    : location.pathname.startsWith('/connect/messages')
      ? 'messages'
      : location.pathname.startsWith('/connect/broadcasts')
        ? 'broadcasts'
        : 'outreach'
  // An unauthorized visitor to /connect/messages never resolves to Messages, so
  // the workspace is never mounted and no Messages API is ever requested.
  const activeSubTab = (rawSubTab === 'messages' && !canUseMessages) ? 'contacts' : rawSubTab

  // Redirect bare /connect to last active tab (or Contacts as default). A stored
  // 'messages' tab is ignored for an unauthorized user, so they can never be sent
  // to an inaccessible tab.
  useEffect(() => {
    if (location.pathname === '/connect') {
      const saved = localStorage.getItem(CONNECT_LAST_TAB_KEY)
      const allowed = saved && VALID_TABS.has(saved) && (saved !== 'messages' || canUseMessages)
      navigate(`/connect/${allowed ? saved : 'contacts'}`, { replace: true })
    }
  }, [location.pathname, navigate, canUseMessages])

  // An unauthorized direct visit to /connect/messages is redirected once to an
  // allowed tab. The guard is the path, not the resolved tab, so this cannot loop.
  useEffect(() => {
    if (rawSubTab === 'messages' && !canUseMessages) {
      navigate('/connect/contacts', { replace: true })
    }
  }, [rawSubTab, canUseMessages, navigate])

  // Persist active tab so returning to /connect restores workspace. Messages is
  // stored only for an authorized user.
  useEffect(() => {
    if (VALID_TABS.has(activeSubTab) && (activeSubTab !== 'messages' || canUseMessages)) {
      localStorage.setItem(CONNECT_LAST_TAB_KEY, activeSubTab)
    }
  }, [activeSubTab, canUseMessages])

  // Tab unread badge. Polls at 30s while Messages is active and 60s otherwise,
  // pauses while the document is hidden, and refreshes on focus. `enabled` keeps
  // an unauthorized user from requesting the endpoint at all.
  const messagesUnread = useStaffUnreadCount({
    enabled: canUseMessages,
    intervalMs: activeSubTab === 'messages' ? ACTIVE_POLL_MS : IDLE_UNREAD_POLL_MS,
  })

  const tabs = [
    { key: 'contacts', label: 'Contacts', Icon: Users, path: '/connect/contacts' },
    { key: 'outreach', label: 'Outreach', Icon: Send, path: '/connect/outreach' },
    canUseMessages ? {
      key: 'messages',
      label: 'Messages',
      Icon: MessageSquare,
      path: '/connect/messages',
      badge: messagesUnread > 0 ? formatUnread(messagesUnread) : null,
      srLabel: messagesUnread > 0 ? unreadLabel(messagesUnread) : '',
    } : null,
    { key: 'broadcasts', label: 'Automations', Icon: Activity, path: '/connect/broadcasts' },
  ].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 128px)', fontFamily: F }}>

      {/* Page header. LAYOUT-SHELL-CONSISTENCY-1: 20px horizontal inset matches the primary tabs. */}
      <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
        {/* Return control (left) + refresh (right) - on the page background, no utility bar. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <WorkspaceBackLink path={backPath} label={backLabel} />
          <RefreshHint onClick={handleRefresh} tooltipLabel="Refresh Connect data" loading={refreshing} />
        </div>
        <div style={{ marginBottom: 12 }}>
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

        {/* Sub-tab picker */}
        <div style={{ paddingBottom: 12 }}>
          <SegmentedTabs
            label="ASPIRE Connect sections"
            items={tabs}
            value={activeSubTab}
            onChange={key => navigate(tabs.find(tab => tab.key === key)?.path || '/connect/contacts')}
          />
        </div>
      </div>

      {/* Sub-tab content - all three mounted; inactive hidden to preserve form state */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Contacts uses flex+height:100% so its three columns scroll independently */}
        <div style={{ display: activeSubTab === 'contacts' ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <ContactsView refreshKey={refreshKey} />
        </div>
        <div style={{ display: activeSubTab === 'outreach' ? 'block' : 'none' }}>
          {/* OUTREACH-ATTACHMENTS-1: cohort is a HARD draft boundary. Keying the
              composer by cohort remounts it on a switch, so no subject, body, CC
              or attachment can survive into another cohort - and no in-flight
              autosave can flush the old cohort's content into the new cohort's
              key. Recipient-scoped restore inside one cohort is unchanged. */}
          <OutreachView key={cohortId || 'no-cohort'} cohortId={cohortId} onNavigateToStudent={onNavigateToStudent} toast={toast} refreshKey={refreshKey} />
        </div>
        {/* Messages mounts only for an authorized active Owner/Admin. Like the
            other sub-tabs it stays mounted while hidden, so search, filters,
            pagination, selection, and the reply draft survive tab switches. */}
        {canUseMessages && (
          <div style={{ display: activeSubTab === 'messages' ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <MessagesWorkspace refreshKey={refreshKey} onOpenStudent={onNavigateToStudent} />
          </div>
        )}
        <div style={{ display: activeSubTab === 'broadcasts' ? 'block' : 'none' }}>
          <AutomationView active={activeSubTab === 'broadcasts'} cohortId={cohortId} toast={toast} refreshKey={refreshKey} />
        </div>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  )
}
