// AP-PORTAL: Academic Partner portal chrome.
//
// The three-tab section navigation, reusing the shared .ptl-nav language (the same
// attached Nightfall taskbar row the Student and Unit Leader portals use). At three
// tabs there is no mobile "More" overflow, so this is a straight reduction of the
// Unit Leader nav pattern. The non-content states (loading, empty, error, denied) and
// the section heading are reused directly from the Unit Leader chrome rather than
// re-implemented. Messages carries no unread badge in this phase: the Academic
// Partner Messages backend is not authorized yet, so no unread is polled.

import { Users, ClipboardList, MessageSquare } from 'lucide-react'

// Product order, not alphabetical. Module-local (exporting a non-component from a
// component module breaks fast refresh), consumed only by AcademicPartnerNav.
const SECTIONS = [
  { key: 'students',           label: 'Students',           Icon: Users },
  { key: 'placement-requests', label: 'Placement Requests', Icon: ClipboardList },
  { key: 'messages',           label: 'Messages',           Icon: MessageSquare },
]

/**
 * Section navigation. Real route changes are handled by the caller (PortalApp),
 * so back, forward, and refresh behave like the rest of the app. Same responsive
 * behavior as the other portal navs: an attached row on desktop, the fixed bottom
 * bar on phones (via .ptl-nav in portal.css).
 */
export function AcademicPartnerNav({ view, onNavigate }) {
  return (
    <nav className="ptl-nav" aria-label="Academic Partner Portal sections">
      {SECTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`ptl-nav-item${view === key ? ' ptl-nav-item-active' : ''}`}
          aria-current={view === key ? 'page' : undefined}
          onClick={() => onNavigate?.(key)}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="ptl-nav-label">{label}</span>
        </button>
      ))}
    </nav>
  )
}
