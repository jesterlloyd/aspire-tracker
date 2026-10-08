// NURSING-ACADEMICS-1: Nursing Academics portal chrome.
//
// The three-tab section navigation, reusing the shared .ptl-nav language (the
// same attached Nightfall taskbar row every portal uses). Two tabs means no
// mobile overflow. The non-content states (loading, empty, error, denied) are
// reused from the Unit Leader chrome exactly as the Academic Partner portal
// already does; no ptl-* class is shared component-to-component beyond that
// established primitive set.

import { PortalNavRefresh } from '../PortalRefresh'
import { NAV_ICONS, NAV_LABELS, alphabetizeNav } from '../../lib/navigationCanon'

// NA-NAV-ALPHA-1 (Owner, 2026-09-30): the landing section leads, and every other tab follows in
// alphabetical order of the label the reader sees. The order is DERIVED (alphabetizeNav), so a
// tab that is switched on for one grant and not another lands in the same place for everyone,
// and a new tab never needs a position chosen for it.
const HOME_SECTION = { key: 'calendar', label: NAV_LABELS.atAGlance, Icon: NAV_ICONS.atAGlance }
// PORTAL-CONNECT-1 (Owner, 2026-10-07): Contacts and Messages are not tabs any more. They are the
// portal's ASPIRE Connect, opened from the Connect icon in the header (PortalConnect.jsx), as in
// the staff app. "Look at the tabs, they're getting so many."
const SECTIONS = [
  { key: 'community-benefit', label: NAV_LABELS.communityBenefit, Icon: NAV_ICONS.communityBenefit },
]
// PROGRAM-BUDGET (2026-09-27): Program Budget joins the row only for a grant the Owner shared
// the budget with (the server's budget_access), read-only.
const BUDGET_SECTION = { key: 'budget', label: NAV_LABELS.programBudgets, Icon: NAV_ICONS.programBudgets }
// KEITH-THEMES-1: Evaluation joins the row only for a grant the Owner gave evaluation_themes_access.
const EVALUATION_SECTION = { key: 'evaluation', label: NAV_LABELS.evaluation, Icon: NAV_ICONS.evaluation }

/**
 * Section navigation. Real route changes are handled by the caller
 * (PortalApp), so back, forward, and refresh behave like the rest of the app.
 */
export function NursingAcademicsNav({ view, onNavigate, budgetEnabled = false, themesEnabled = false }) {
  const sections = [HOME_SECTION, ...alphabetizeNav([...SECTIONS, ...(themesEnabled ? [EVALUATION_SECTION] : []), ...(budgetEnabled ? [BUDGET_SECTION] : [])])]
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
          <Icon size={16} aria-hidden="true" />
          <span className="ptl-nav-label">{label}</span>
        </button>
      ))}
      <PortalNavRefresh tooltipLabel="Refresh" />
    </nav>
  )
}
