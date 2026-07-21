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

import { useEffect, useRef, useState } from 'react'
import {
  Home, ClipboardList, CalendarRange, Users, UserCheck, MessageSquare, IdCard,
  MoreHorizontal, ClipboardCheck, Bell,
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
  { key: 'home',          label: 'Home',                    Icon: Home },
  { key: 'messages',      label: 'Messages',                Icon: MessageSquare },
  { key: 'evaluations',   label: 'Evaluations',             Icon: ClipboardCheck },
  { key: 'placements',    label: 'Placement Requests',      Icon: ClipboardList },
  { key: 'capacity',      label: 'Capacity',                Icon: CalendarRange },
  { key: 'preceptors',    label: 'Preceptor Assignments',   Icon: UserCheck },
  { key: 'profile',       label: 'Profile',                 Icon: IdCard },
  { key: 'notifications', label: 'Notification preferences', Icon: Bell },
  // Students left the primary bar and now lives inside Home. The route survives:
  // /portal/unit/students still renders the same roster on its own.
  { key: 'students',      label: 'Students',                Icon: Users },
]

/**
 * Section navigation. Real route changes are handled by the caller, so back,
 * forward, and refresh behave like the rest of the app.
 *
 * UL-POLISH P0: on phones the eight sections overflowed the fixed bottom bar
 * and truncated mid-word. Narrow widths now show five slots (Home, Students,
 * Placements, Messages, More); More opens an accessible bottom sheet with the
 * remaining four sections. Desktop keeps the full tab row.
 */
// LOCKED ORDER, at EVERY width: Home, Messages, Evaluations, then More. Report a
// Concern is no longer a section: it was always a Messages conversation with
// destination 'aspire', so it is an action inside Messages rather than a tab.
const PRIMARY_KEYS = ['home', 'messages', 'evaluations']
const MORE_KEYS = ['placements', 'capacity', 'preceptors', 'profile', 'notifications']

function NavItem({ section, active, unread, onNavigate }) {
  const { key, label, Icon } = section
  const isMessages = key === 'messages'
  return (
    <button
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
}

/** The More bottom sheet: a real dialog with focus trap, Escape, and return. */
function MoreSheet({ view, onNavigate, onClose, returnFocusRef }) {
  const panelRef = useRef(null)
  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => panelRef.current?.querySelector('button')?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll('button'))
      if (els.length === 0) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prev?.focus) prev.focus()
    }
  }, [onClose, returnFocusRef])

  return (
    <>
      <div className="ptl-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="ptl-sheet" role="dialog" aria-modal="true" aria-label="More sections">
        <p className="ptl-sheet-title">More</p>
        {SECTIONS.filter(sec => MORE_KEYS.includes(sec.key)).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className="ptl-sheet-item"
            aria-current={view === key ? 'page' : undefined}
            onClick={() => onNavigate?.(key)}
          >
            <Icon size={18} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
    </>
  )
}

export function UnitLeaderNav({ view, unread = 0, onNavigate }) {
  // ONE nav at every width. The desktop branch used to render all eight sections while
  // narrow screens got a five-slot bar plus More; that divergence is why the same portal
  // felt like two products. Four primary destinations now, everywhere.
  //
  // The sheet remembers WHICH section it was opened on, so a section change hides it by
  // derivation rather than by a setState in an effect.
  const [moreFor, setMoreFor] = useState(null)
  const moreBtnRef = useRef(null)
  const moreOpen = moreFor === view
  const moreActive = MORE_KEYS.includes(view)

  return (
    <>
      <nav className="ptl-nav" aria-label="Unit Leader Portal sections">
        {SECTIONS.filter(sec => PRIMARY_KEYS.includes(sec.key))
          // Render in the LOCKED order, not the declaration order of SECTIONS.
          .sort((a, b) => PRIMARY_KEYS.indexOf(a.key) - PRIMARY_KEYS.indexOf(b.key))
          .map(sec => (
            <NavItem key={sec.key} section={sec} active={view === sec.key}
              unread={unread} onNavigate={onNavigate} />
          ))}
        <button
          ref={moreBtnRef}
          type="button"
          className={`ptl-nav-item${moreActive ? ' ptl-nav-item-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setMoreFor(moreOpen ? null : view)}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
          <span className="ptl-nav-label">More</span>
        </button>
      </nav>
      {moreOpen && (
        <MoreSheet view={view} returnFocusRef={moreBtnRef}
          onNavigate={(k) => { setMoreFor(null); onNavigate?.(k) }}
          onClose={() => setMoreFor(null)} />
      )}
    </>
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
  // UL-POLISH P0: a single-unit leader has nothing to switch between, but the
  // unit still deserves to be visible. Static context line instead of a dead
  // control; the compact switcher appears only with two or more units.
  if (unitKeys.length === 0) return null
  if (unitKeys.length === 1) {
    return <p className="ptl-unit-context">Unit · <b>{unitKeys[0]}</b></p>
  }
  return (
    <div className="ptl-unit-switcher">
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

/**
 * UL-POLISH P2: a three-row shimmer for screens whose table layout is known.
 * The announcement stays a polite live region; the shimmer is decoration.
 */
export function TableSkeleton({ label = 'Loading' }) {
  return (
    <div className="ptl-card ptl-state ptl-skel-table">
      <div className="ptl-skel ptl-skel-line" aria-hidden="true" />
      <div className="ptl-skel ptl-skel-line" aria-hidden="true" />
      <div className="ptl-skel ptl-skel-line" aria-hidden="true" />
      <p role="status" aria-live="polite" className="ptl-visually-hidden">{label}</p>
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
    // UL-POLISH P0: mark the focus as programmatic so the ring can be
    // suppressed deterministically. A CSS-only :focus:not(:focus-visible) rule
    // is not enough: Chromium matches :focus-visible for this programmatic
    // focus, so the ring painted a box around the title on every navigation.
    const el = ref.current
    if (!el) return undefined
    el.dataset.programmaticFocus = 'true'
    el.focus()
    const clear = () => { delete el.dataset.programmaticFocus }
    el.addEventListener('blur', clear, { once: true })
    return () => { el.removeEventListener('blur', clear); clear() }
  }, [focusKey])
  return (
    <h2 className="ptl-section-title" tabIndex={-1} ref={ref}>{children}</h2>
  )
}

/** A status pill. Text always carries the meaning; color is decoration only. */
export function Pill({ tone = 'neutral', children }) {
  return <span className={`ptl-pill ptl-pill-${tone}`}>{children}</span>
}
