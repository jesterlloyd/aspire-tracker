// ASPIRE-COMPASS: Student Portal section navigation.
//
// One navigation component, two presentations driven purely by CSS:
//   - Desktop and tablet (>760px): underline tabs beneath the shell header.
//   - Phone (<=760px): a single fixed bottom bar (Home, Messages, and the
//     stage-aware primary action when one exists). This REPLACES the old
//     separate sticky action bar, so the phone never stacks two persistent
//     bars.
// Destinations are real route changes handled by PortalApp (URL-driven), so
// back, forward, and refresh behave like the rest of the app.

import { MessageSquare, Home, CalendarPlus, Award, UserCircle } from 'lucide-react'
import { formatUnread, unreadLabel } from '../lib/messages/messagesConstants'
import { PortalNavRefresh } from './PortalRefresh'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

const ACTION_ICONS = { 'shift-log': CalendarPlus, certificate: Award }

export default function PortalNav({ view, unread = 0, onHome, onMessages, onProfile, action = null, messagesEnabled = true, profileEnabled = true }) {
  const ActionIcon = action ? (ACTION_ICONS[action.kind] || CalendarPlus) : null
  return (
    <nav className="ptl-nav" aria-label="Student Portal sections">
      {/* WELCOME-TOUR-PORTALS-1: stable anchors for the Welcome Tour. */}
      <button
        type="button"
        className={`ptl-nav-item${view === 'home' ? ' ptl-nav-item-active' : ''}`}
        aria-current={view === 'home' ? 'page' : undefined}
        data-tour="portal-nav-home"
        onClick={() => onHome?.()}
      >
        <Home size={16} aria-hidden="true" />
        <span className="ptl-nav-label">Home</span>
      </button>

      {messagesEnabled && (
        <button
          type="button"
          className={`ptl-nav-item${view === 'messages' ? ' ptl-nav-item-active' : ''}`}
          aria-current={view === 'messages' ? 'page' : undefined}
          data-tour="portal-nav-messages"
          onClick={() => onMessages?.()}
        >
          <span className="ptl-nav-iconwrap">
            <MessageSquare size={16} aria-hidden="true" />
            {/* The count itself carries the meaning, and screen-reader text spells
                it out, so unread is never conveyed by color alone. Hidden at 0. */}
            {unread > 0 && (
              <span className="ptl-nav-badge" aria-hidden="true">{formatUnread(unread)}</span>
            )}
          </span>
          <span className="ptl-nav-label">Messages</span>
          <span style={srOnly}>{unread > 0 ? unreadLabel(unread) : ''}</span>
        </button>
      )}

      {/* STUDENT-PORTAL-PROFILE-1: the student's canonical submitted-profile destination. */}
      {profileEnabled && onProfile && (
        <button
          type="button"
          className={`ptl-nav-item${view === 'profile' ? ' ptl-nav-item-active' : ''}`}
          aria-current={view === 'profile' ? 'page' : undefined}
          data-tour="portal-nav-profile"
          onClick={() => onProfile?.()}
        >
          <UserCircle size={16} aria-hidden="true" />
          <span className="ptl-nav-label">My Profile</span>
        </button>
      )}

      {/* Stage-aware action slot: rendered ONLY in the phone bottom bar (CSS
          hides it on desktop, where the action lives in the Compass band).
          It exists only when the stage genuinely offers one. */}
      {action && (
        action.kind === 'shift-log' ? (
          <a className="ptl-nav-item ptl-nav-action" href={action.href} data-tour="portal-nav-action">
            <ActionIcon size={16} aria-hidden="true" />
            <span className="ptl-nav-label">{action.label}</span>
          </a>
        ) : (
          <button type="button" className="ptl-nav-item ptl-nav-action" data-tour="portal-nav-action" onClick={action.onActivate}>
            <ActionIcon size={16} aria-hidden="true" />
            <span className="ptl-nav-label">{action.label}</span>
          </button>
        )
      )}

      {/* Right-aligned shared Refresh (desktop only; hidden in the phone bottom bar). */}
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
