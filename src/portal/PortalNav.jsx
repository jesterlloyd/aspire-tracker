// ASPIRE MESSAGES, PHASE 5B-ii: Student Portal section navigation.
//
// The Student Portal had no navigation and no router: PortalApp rendered
// StudentPortal directly inside PortalShell as one scrolling page. This adds the
// smallest possible view switch that the existing architecture supports: plain
// state, no routing library, and no URL of its own.
//
// No URL state is introduced deliberately. The portal has never had any, so
// adding a path or query only for Messages would invent a surface that could be
// deep-linked or bypassed. A refresh returns to Home, which is the portal's
// existing behavior rather than a regression.
//
// The nav is passed into PortalShell only by the student branch, so the Unit
// Leader and Academic Partner portals are unchanged.

import { MessageSquare, Home } from 'lucide-react'
import { formatUnread, unreadLabel } from '../lib/messages/messagesConstants'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

export default function PortalNav({ view, onSelect, unread = 0 }) {
  return (
    <nav className="ptl-nav" aria-label="Student Portal sections">
      <button
        type="button"
        className={`ptl-nav-item${view === 'home' ? ' ptl-nav-item-active' : ''}`}
        aria-current={view === 'home' ? 'page' : undefined}
        onClick={() => onSelect?.('home')}
      >
        <Home size={15} aria-hidden="true" />
        Home
      </button>

      <button
        type="button"
        className={`ptl-nav-item${view === 'messages' ? ' ptl-nav-item-active' : ''}`}
        aria-current={view === 'messages' ? 'page' : undefined}
        onClick={() => onSelect?.('messages')}
      >
        <MessageSquare size={15} aria-hidden="true" />
        Messages
        {/* The count itself carries the meaning, and screen-reader text spells it
            out, so unread is never conveyed by color alone. Hidden at zero. */}
        {unread > 0 && (
          <span className="ptl-nav-badge" aria-hidden="true">{formatUnread(unread)}</span>
        )}
        <span style={srOnly}>{unread > 0 ? unreadLabel(unread) : ''}</span>
      </button>
    </nav>
  )
}
