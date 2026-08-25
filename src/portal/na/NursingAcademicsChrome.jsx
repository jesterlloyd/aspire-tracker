// NURSING-ACADEMICS-1: Nursing Academics portal chrome.
//
// The three-tab section navigation, reusing the shared .ptl-nav language (the
// same attached Nightfall taskbar row every portal uses). Two tabs means no
// mobile overflow. The non-content states (loading, empty, error, denied) are
// reused from the Unit Leader chrome exactly as the Academic Partner portal
// already does; no ptl-* class is shared component-to-component beyond that
// established primitive set.

import { LayoutDashboard, HandCoins, ContactRound } from 'lucide-react'
import { PortalNavRefresh } from '../PortalRefresh'

// Product order. Module-local, consumed only by NursingAcademicsNav.
const SECTIONS = [
  { key: 'calendar', label: 'At A Glance', Icon: LayoutDashboard },
  { key: 'community-benefit', label: 'Community Benefit', Icon: HandCoins },
  { key: 'contacts', label: 'Contacts', Icon: ContactRound },
]

/**
 * Section navigation. Real route changes are handled by the caller
 * (PortalApp), so back, forward, and refresh behave like the rest of the app.
 */
export function NursingAcademicsNav({ view, onNavigate }) {
  return (
    <nav className="ptl-nav" aria-label="Nursing Education and Leadership Portal sections">
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
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
