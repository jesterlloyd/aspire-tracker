// WS2.0: extracted verbatim from App.jsx header (Zone 3 - Connect + Action Center + user
// menu). No behavior change. State/handlers/refs remain owned by App.jsx and arrive as
// props. Navigation mechanism preserved exactly (Connect uses the passed react-router
// `navigate`). UserMenu and the floating Keith assistant are unchanged (Keith stays
// floating in App.jsx; it is NOT part of these header actions).
import { MessagesSquare, Library } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import UserMenu from '../UserMenu'
import { useAuth } from '../../contexts/AuthContext'
import { IDLE_UNREAD_POLL_MS, useStaffUnreadCount } from '../../lib/messages/messagesPolling'
import { pinBadgeStyle } from '../../lib/badgeTokens'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'

export default function HeaderActions({
  cohorts, navigate, activeTab, bellRef, setShowActionCenter, showActionCenter, actionBadgeCount,
}) {
  const { isOwner, isAdmin, isInterviewer, userProfile } = useAuth()
  const canViewCatalog = isOwner || isAdmin || isInterviewer
  // ASPIRE MESSAGES: the Connect icon's unread badge follows the Messages
  // authorization gate, which is stricter than the icon's own rule. isAdmin and
  // canEdit are role-only and ignore profile activity, so neither is sufficient:
  // a deactivated Owner would still poll. Same gate as Connect.jsx.
  const canUseMessages = ['owner', 'admin'].includes(userProfile?.role)
    && userProfile?.is_active !== false
  // Reuses the ['messages_staff_unread'] query. React Query serves every
  // observer of one key from a single query, so mounting this alongside the
  // Connect Messages tab adds no second request and no new interval: the tab's
  // 30s observer simply wins while it is mounted, and this 60s cadence applies
  // everywhere else. `enabled` keeps an unauthorized caller from requesting at
  // all.
  const messagesUnread = useStaffUnreadCount({
    enabled: canUseMessages,
    intervalMs: IDLE_UNREAD_POLL_MS,
  })
  // While Action Center is open the bell is the active surface - suppress the route-based
  // Connect/Catalog active treatment so only one nav marker shows at a time. Routing and
  // the current page are unchanged; this is purely the active-marker visual state.
  const connectActive = activeTab === 'connect' && !showActionCenter
  const catalogActive = activeTab === 'catalog' && !showActionCenter
  return (
    <>
      {cohorts.length > 0 && (
        <Tooltip label="ASPIRE Connect" placement="bottom">
        <button
          data-tour="connect"
          // aria-label overrides inner text for the accessible name, so the count
          // belongs in the label itself rather than in hidden text that would
          // never be announced. It carries the TRUE count, not the 99+ cap.
          aria-label={messagesUnread > 0
            ? `ASPIRE Connect, ${unreadLabel(messagesUnread)}`
            : 'ASPIRE Connect'}
          onClick={() => {
            // ASPIRE-CHART approved destination behavior: when unread Messages
            // exist (and the caller may use Messages), the badge's promise is
            // honored - land on Messages. Otherwise restore the last-used
            // Connect subview, which may now include 'messages' for authorized
            // users. Authorization itself is unchanged: Connect.jsx re-gates
            // and the server re-authorizes every Messages read.
            if (canUseMessages && messagesUnread > 0) {
              navigate('/connect/messages')
              return
            }
            const saved = localStorage.getItem('aspire.connect.lastTab')
            const allowed = canUseMessages
              ? ['contacts', 'outreach', 'broadcasts', 'messages']
              : ['contacts', 'outreach', 'broadcasts']
            const tab = allowed.includes(saved) ? saved : 'contacts'
            navigate(`/connect/${tab}`)
          }}
          style={{
            position: 'relative', flexShrink: 0,
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: connectActive ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${connectActive ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius: 8,
            color: connectActive ? '#fff' : 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
            overflow: 'visible',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = connectActive ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
        >
          <MessagesSquare size={15} strokeWidth={1.9} />
          {/* Unread counter, sharing the one pin badge with the Action Center
              bell so the two cannot drift apart again. */}
          {messagesUnread > 0 && (
            <span aria-hidden="true" style={pinBadgeStyle}>
              {formatUnread(messagesUnread)}
            </span>
          )}
          {connectActive && (
            <span style={{
              position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid rgba(255,255,255,0.92)',
              display: 'block',
            }} />
          )}
        </button>
        </Tooltip>
      )}
      {cohorts.length > 0 && canViewCatalog && (
        <Tooltip label="ASPIRE Catalog" placement="bottom">
        <button
          data-tour="catalog"
          aria-label="ASPIRE Catalog"
          onClick={() => navigate('/catalog')}
          style={{
            position: 'relative', flexShrink: 0,
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: catalogActive ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${catalogActive ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius: 8,
            color: catalogActive ? '#fff' : 'rgba(255,255,255,0.75)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s',
            overflow: 'visible',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = catalogActive ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
        >
          <Library size={15} strokeWidth={1.9} />
          {catalogActive && (
            <span style={{
              position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid rgba(255,255,255,0.92)',
              display: 'block',
            }} />
          )}
        </button>
        </Tooltip>
      )}
      {cohorts.length > 0 && (
        <Tooltip label="Action Center" placement="bottom">
        <button
          ref={bellRef}
          id="keith-bell-trigger"
          // ASPIRE-CHART: the accessible name carries the true open-action
          // count (the visual badge caps at 9+), mirroring the Connect icon.
          aria-label={actionBadgeCount > 0
            ? `Action Center, ${actionBadgeCount} open action${actionBadgeCount === 1 ? '' : 's'}`
            : 'Action Center'}
          data-tour="action-center"
          onClick={() => setShowActionCenter(p => !p)}
          style={{
            position:'relative', flexShrink:0, overflow:'visible',
            width:34, height:34, display:'flex', alignItems:'center', justifyContent:'center',
            background: showActionCenter ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)',
            border:`1px solid ${showActionCenter ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.10)'}`,
            borderRadius:8, color: showActionCenter ? '#fff' : 'rgba(255,255,255,0.75)', cursor:'pointer',
            transition:'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.14)'}
          onMouseLeave={e => e.currentTarget.style.background = showActionCenter ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.06)'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {/* Active/open marker - identical to ASPIRE Connect / Catalog (downward triangle under the icon) */}
          {showActionCenter && (
            <span style={{
              position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '6px solid rgba(255,255,255,0.92)',
              display: 'block',
            }} />
          )}
          {/* Same shared pin badge as the ASPIRE Connect icon. Only the color and
              shared styling moved here: the count logic is Action Center's own and
              is deliberately unchanged, so it still caps at 9+, not Messages 99+. */}
          {actionBadgeCount > 0 && (
            <span aria-hidden="true" style={pinBadgeStyle}>
              {actionBadgeCount >= 10 ? '9+' : actionBadgeCount}
            </span>
          )}
        </button>
        </Tooltip>
      )}

      {/* WS2.2b: the standalone Settings gear was removed from the visible header.
          Settings remains reachable via the UserMenu dropdown (→ /settings/general),
          which is the settings/control center. The Settings routes/shell are unchanged.
          (The gear's data-tour="settings" was not referenced by any tour step.)
          ASPIRE Catalog is intentionally NOT rendered yet (Approach B, added later
          when it has an approved scope, data model, and real destination). */}

      <UserMenu />
    </>
  )
}
