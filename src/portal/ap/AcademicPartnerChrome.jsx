// AP-PORTAL: Academic Partner portal chrome.
//
// The three-tab section navigation, reusing the shared .ptl-nav language (the same
// attached Nightfall taskbar row the Student and Unit Leader portals use). At three
// tabs there is no mobile "More" overflow, so this is a straight reduction of the
// Unit Leader nav pattern. The non-content states (loading, empty, error, denied) and
// the section heading are reused directly from the Unit Leader chrome rather than
// re-implemented. Messages carries no unread badge in this phase: the Academic
// Partner Messages backend is not authorized yet, so no unread is polled.

import { PortalNavRefresh } from '../PortalRefresh'
import { NAV_ICONS, NAV_LABELS } from '../../lib/navigationCanon'

// Product order, not alphabetical. Module-local (exporting a non-component from a
// component module breaks fast refresh), consumed only by AcademicPartnerNav.
const SECTIONS = [
  { key: 'students',           label: NAV_LABELS.students,          Icon: NAV_ICONS.students },
  { key: 'placement-requests', label: NAV_LABELS.placementRequests, Icon: NAV_ICONS.placementRequests },
  { key: 'messages',           label: NAV_LABELS.messages,          Icon: NAV_ICONS.messages },
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
      {/* WELCOME-TOUR-PORTALS-1: each section carries a stable data-tour anchor. */}
      {SECTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`ptl-nav-item${view === key ? ' ptl-nav-item-active' : ''}`}
          aria-current={view === key ? 'page' : undefined}
          data-tour={`portal-nav-${key}`}
          onClick={() => onNavigate?.(key)}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="ptl-nav-label">{label}</span>
        </button>
      ))}
      {/* Right-aligned shared Refresh (desktop only; hidden in the phone bottom bar). */}
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
