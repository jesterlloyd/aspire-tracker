// NURSING-ACADEMICS-1: Nursing Academics portal chrome.
//
// The three-tab section navigation, reusing the shared .ptl-nav language (the
// same attached Nightfall taskbar row every portal uses). Two tabs means no
// mobile overflow. The non-content states (loading, empty, error, denied) are
// reused from the Unit Leader chrome exactly as the Academic Partner portal
// already does; no ptl-* class is shared component-to-component beyond that
// established primitive set.

import { LayoutDashboard, HandCoins, ContactRound, MessageSquare } from 'lucide-react'
import { PortalNavRefresh } from '../PortalRefresh'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

// Product order. Module-local, consumed only by NursingAcademicsNav.
const SECTIONS = [
  { key: 'calendar', label: 'At A Glance', Icon: LayoutDashboard },
  { key: 'community-benefit', label: 'Community Benefit', Icon: HandCoins },
  { key: 'contacts', label: 'Contacts', Icon: ContactRound },
]
// NA-PORTAL-UTILITIES-1: Messages joins the row only when the server capability
// reports it enabled (fail-closed before the Owner SQL gate).
const MESSAGES_SECTION = { key: 'messages', label: 'Messages', Icon: MessageSquare }

/**
 * Section navigation. Real route changes are handled by the caller
 * (PortalApp), so back, forward, and refresh behave like the rest of the app.
 */
export function NursingAcademicsNav({ view, onNavigate, messagesEnabled = false, unread = 0 }) {
  const sections = messagesEnabled ? [...SECTIONS, MESSAGES_SECTION] : SECTIONS
  return (
    <nav className="ptl-nav" aria-label="Nursing Education and Leadership Portal sections">
      {sections.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`ptl-nav-item${view === key ? ' ptl-nav-item-active' : ''}`}
          aria-current={view === key ? 'page' : undefined}
          data-tour={`portal-nav-${key}`}
          onClick={() => onNavigate?.(key)}
        >
          {key === 'messages' ? (
            <span className="ptl-nav-iconwrap">
              <Icon size={16} aria-hidden="true" />
              {/* The count carries the meaning and screen-reader text spells it
                  out, so unread is never conveyed by color alone. */}
              {unread > 0 && (
                <span className="ptl-nav-badge" aria-hidden="true">{formatUnread(unread)}</span>
              )}
            </span>
          ) : (
            <Icon size={16} aria-hidden="true" />
          )}
          <span className="ptl-nav-label">{label}</span>
          {key === 'messages' && <span style={srOnly}>{unread > 0 ? unreadLabel(unread) : ''}</span>}
        </button>
      ))}
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
