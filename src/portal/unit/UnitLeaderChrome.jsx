// src/portal/unit/UnitLeaderChrome.jsx
//
// UL-PORTAL: the shared Compass chrome for the Unit Leader Portal.
//
// Navigation, the unit switcher, and the four required non-content states
// (loading, empty, error, permission denied). These are deliberately one module
// so every screen renders the same shapes and the same accessibility behavior.
//
// Presentation reuses the existing ptl-* Compass classes rather than inventing a
// parallel style language, so the Unit Leader Portal inherits the approved shell,
// the responsive breakpoints, and the focus treatment already in portal.css.

import { useEffect, useRef } from 'react'
import {
  Home, ClipboardList, CalendarRange, Users, UserCheck, MessageSquare, Flag, IdCard,
} from 'lucide-react'
import { formatUnread, unreadLabel } from '../../lib/messages/messagesConstants'
import { ALL_UNITS } from './unitLeaderApi'

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}

// Section order is the product's, not alphabetical. Not exported: it is consumed
// only by UnitLeaderNav below, and exporting a non-component breaks fast refresh.
const SECTIONS = [
  { key: 'home',        label: 'Home',                 Icon: Home },
  { key: 'placements',  label: 'Placement Requests',   Icon: ClipboardList },
  { key: 'capacity',    label: 'Capacity',             Icon: CalendarRange },
  { key: 'students',    label: 'Students',             Icon: Users },
  { key: 'preceptors',  label: 'Preceptor Assignments', Icon: UserCheck },
  { key: 'messages',    label: 'Messages',             Icon: MessageSquare },
  { key: 'concern',     label: 'Report a Concern',     Icon: Flag },
  { key: 'profile',     label: 'Profile',              Icon: IdCard },
]

/**
 * Section navigation. Real route changes are handled by the caller, so back,
 * forward, and refresh behave like the rest of the app.
 */
export function UnitLeaderNav({ view, unread = 0, onNavigate }) {
  return (
    <nav className="ptl-nav" aria-label="Unit Leader Portal sections">
      {SECTIONS.map(({ key, label, Icon }) => {
        const active = view === key
        const isMessages = key === 'messages'
        return (
          <button
            key={key}
            type="button"
            className={`ptl-nav-item${active ? ' ptl-nav-item-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate?.(key)}
          >
            {isMessages ? (
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
            {isMessages && <span style={srOnly}>{unread > 0 ? unreadLabel(unread) : ''}</span>}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Unit switcher. Rendered only when more than one unit is assigned, because a
 * single-unit leader has nothing to switch between and the control would be noise.
 *
 * "All assigned units" is a VIEW, not a widening: selecting it omits unit_key from
 * the request, and the server returns exactly the caller's authorized set.
 */
export function UnitSwitcher({ unitKeys = [], value, onChange }) {
  if (unitKeys.length <= 1) return null
  return (
    <div className="ptl-card ptl-unit-switcher">
      <label className="ptl-label" htmlFor="ul-unit-switcher">Viewing</label>
      <select
        id="ul-unit-switcher"
        className="ptl-input"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value={ALL_UNITS}>All assigned units ({unitKeys.length})</option>
        {unitKeys.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
    </div>
  )
}

/** Loading. Announced politely so a screen reader is told, not left silent. */
export function LoadingState({ label = 'Loading' }) {
  return (
    <div className="ptl-card ptl-state ptl-state-loading">
      <div className="ptl-spinner" aria-hidden="true" />
      <p role="status" aria-live="polite">{label}</p>
    </div>
  )
}

/** Empty. Always says what would appear here, never just "nothing found". */
export function EmptyState({ title, detail }) {
  return (
    <div className="ptl-card ptl-state ptl-state-empty">
      <h3 className="ptl-state-title">{title}</h3>
      {detail && <p className="ptl-state-detail">{detail}</p>}
    </div>
  )
}

/** Error, with a retry when the caller can offer one. */
export function ErrorState({ title = 'Something went wrong', detail, onRetry }) {
  return (
    <div className="ptl-card ptl-state ptl-state-error" role="alert">
      <h3 className="ptl-state-title">{title}</h3>
      {detail && <p className="ptl-state-detail">{detail}</p>}
      {onRetry && (
        <button type="button" className="ptl-btn" onClick={onRetry}>Try again</button>
      )}
    </div>
  )
}

/**
 * Permission denied. Distinct from empty on purpose: "you have no assigned units"
 * and "this unit has no students" are different facts and must read differently.
 */
export function DeniedState({
  title = 'No unit access yet',
  detail = 'Your ASPIRE portal access does not include an assigned unit yet. The ASPIRE team assigns units, and this page will fill in once yours is in place.',
}) {
  return (
    <div className="ptl-card ptl-state ptl-state-denied" role="status">
      <h3 className="ptl-state-title">{title}</h3>
      <p className="ptl-state-detail">{detail}</p>
    </div>
  )
}

/**
 * A section heading that also receives focus on navigation, so a keyboard or
 * screen-reader user lands on the new content instead of at the top of the shell.
 */
export function SectionHeading({ children, focusKey }) {
  const ref = useRef(null)
  useEffect(() => {
    // Focus the heading when the section changes, never on every render.
    ref.current?.focus()
  }, [focusKey])
  return (
    <h2 className="ptl-section-title" tabIndex={-1} ref={ref}>{children}</h2>
  )
}

/** A status pill. Text always carries the meaning; color is decoration only. */
export function Pill({ tone = 'neutral', children }) {
  return <span className={`ptl-pill ptl-pill-${tone}`}>{children}</span>
}
