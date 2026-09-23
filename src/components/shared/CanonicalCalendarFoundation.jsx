// src/components/shared/CanonicalCalendarFoundation.jsx
//
// The single visual source of truth for every ASPIRE calendar. The main-app
// Interviews calendar (src/components/InterviewCalendar.jsx) and the Unit Leader
// rotation calendar (src/portal/unit/UnitRotationCalendar.jsx) both render through
// these primitives, so their toolbar, weekday header, and month grid share one look
// rather than two hand-tuned imitations.
//
// STYLING IS INLINE ON PURPOSE. Every value below is copied verbatim from the
// main-app calendar's existing inline styles, so a component that adopts a primitive
// gets pixel-identical output. That is why the main app can converge onto these
// without any visual change: the primitive emits exactly what it emitted before.
//
// ROLE-SAFETY IS THE CALLER'S JOB. These primitives are presentation only. They hold
// no data, no authorization, and no staff controls. What a role may render inside a
// cell (a staff capacity card, or a Unit Leader activity chip) is passed as children.
//
// PLANNER-CALENDAR-1: the desk-planner chrome and the three papers live in the stylesheet
// below. It is imported HERE rather than added to index.css or portal.css, because a
// stylesheet a component imports travels into whichever bundle pulls the component in.
// That is what lets one paper serve the staff app and the portals at the same time, which
// the inline-style rule above was written to work around.

import './plannerCalendar.css'
import { useTheme } from '../../contexts/ThemeContext'

/**
 * PLANNER-CALENDAR-1: the shell can be a desk planner.
 *
 * `paper` opts an app calendar into the canonical Classic planner. Classic always uses
 * the approved Interview treatment; `appearance="auto"` swaps that same structure to
 * the connected Modern surface. Portals pass `appearance="modern"` until they gain their
 * own Appearance settings. Every value lives in `plannerCalendar.css`, which this file
 * imports so it reaches the staff bundle and the portal bundles alike.
 *
 * A caller that passes no `paper` keeps the plain shell. This lets non-calendar timeline
 * consumers adopt the shared structure without implicitly opting into Classic material.
 */
export function CanonicalCalendarLayout({
  title,
  description,
  sidebar,
  toolbar,
  children,
  footer,
  labelledBy = 'canonical-calendar-title',
  titleVisuallyHidden = false,
  paper = null,
  appearance = 'auto',
}) {
  const { style } = useTheme()
  const isModern = appearance === 'modern' || (appearance === 'auto' && style === 'modern')
  const main = (
    <div className="canonical-calendar-main">
      <div className="canonical-calendar-toolbar">
        {title && (
          <h3
            id={labelledBy}
            className={titleVisuallyHidden ? 'pl-sr-only' : 'canonical-calendar-title'}
          >
            {title}
          </h3>
        )}
        {description && !titleVisuallyHidden && (
          <p className="canonical-calendar-description">{description}</p>
        )}
        {toolbar}
      </div>
      {children}
      {footer}
    </div>
  )

  if (isModern || !paper) {
    return (
      <section
        className={`canonical-calendar-shell${isModern ? ' canonical-calendar-modern' : ''}`}
        data-calendar-style={isModern ? 'modern' : 'plain'}
        aria-labelledby={labelledBy}
      >
        <div className="canonical-calendar-sidebar">
          {sidebar}
        </div>
        {main}
      </section>
    )
  }

  return (
    <div className="pl-planner" data-paper="slate" data-calendar-style="classic">
      <div className="pl-spread">
        <section className="canonical-calendar-shell" aria-labelledby={labelledBy}>
          {/* The notepad. The rings straddle the sheet's TOP EDGE, so they are a sibling
              of the sheet inside the wrapper that carries the page stack, never a child
              of the sheet, which would clip them. */}
          <div className="pl-padwrap material-pagestack material-pagestack-bound">
            <span className="pl-rings" aria-hidden="true"><i /><i /></span>
            <div className="pl-sheet canonical-calendar-sidebar">
              {sidebar}
            </div>
          </div>
          {/* The calendar sheet. Nothing holds it down. */}
          <div className="pl-holder material-pagestack">
            <div className="pl-sheet canonical-calendar-main">
              <div className="canonical-calendar-toolbar">
                {title && (
                  <h3
                    id={labelledBy}
                    className={titleVisuallyHidden ? 'pl-sr-only' : 'canonical-calendar-title'}
                  >
                    {title}
                  </h3>
                )}
                {description && !titleVisuallyHidden && (
                  <p className="canonical-calendar-description">{description}</p>
                )}
                {toolbar}
              </div>
              {children}
              {footer}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export function CanonicalCalendarSidebar({ children }) {
  return (
    <div className="canonical-calendar-sidebar-stack">
      {children}
    </div>
  )
}

/**
 * `kicker` names the day being shown. It defaults to "Today" so every existing caller is
 * unchanged, but a panel that follows a SELECTION has to be able to say so: it was
 * labelled "Today" above whatever date the reader had picked (PLANNER-CALENDAR-1).
 * `.pl-daypanel` is what lets it scroll inside a planner's fixed-height notepad.
 */
export function CanonicalCalendarTodayPanel({ dateLabel, summary, emptyLabel, children, kicker = 'Today' }) {
  return (
    <section className="canonical-calendar-today pl-daypanel" aria-labelledby="canonical-calendar-today-title">
      <div className="canonical-calendar-kicker">{kicker}</div>
      <h4 id="canonical-calendar-today-title" className="canonical-calendar-today-date">{dateLabel}</h4>
      {summary && <p className="canonical-calendar-today-summary">{summary}</p>}
      {children || (
        <div className="canonical-calendar-empty">
          {emptyLabel}
        </div>
      )}
    </section>
  )
}

/**
 * The grouped previous / next segmented control plus a Today button, exactly as the
 * main-app Interviews toolbar renders it. Previous and next sit together in one
 * bordered pill; Today sits beside them. Disabled state dims a nav button and drops
 * its pointer without changing the group's geometry.
 */
export function CanonicalCalendarNav({
  onPrev,
  onNext,
  onToday,
  prevTitle = 'Previous',
  nextTitle = 'Next',
  prevAriaLabel,
  nextAriaLabel,
  todayLabel = 'Today',
  prevDisabled = false,
  nextDisabled = false,
}) {
  return (
    <div className="pl-nav" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div className="pl-nav-group" style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: '9px', overflow: 'hidden', height: '32px' }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={prevDisabled}
          title={prevTitle}
          aria-label={prevAriaLabel || prevTitle}
          className="pl-nav-btn"
          style={{ width: '34px', height: '32px', background: 'none', border: 'none', borderRight: '1px solid #e5e7eb', cursor: prevDisabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: prevDisabled ? '#d1d5db' : '#374151', transition: 'background 0.15s ease' }}
          onMouseEnter={e => { if (!prevDisabled) e.currentTarget.style.background = '#f9fafb' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          title={nextTitle}
          aria-label={nextAriaLabel || nextTitle}
          className="pl-nav-btn"
          style={{ width: '34px', height: '32px', background: 'none', border: 'none', cursor: nextDisabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: nextDisabled ? '#d1d5db' : '#374151', transition: 'background 0.15s ease' }}
          onMouseEnter={e => { if (!nextDisabled) e.currentTarget.style.background = '#f9fafb' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <button
        type="button"
        onClick={onToday}
        className="pl-nav-today"
        style={{ height: '32px', padding: '0 14px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '9px', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: '12px', color: '#374151', transition: 'all 0.15s ease' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = '#d1d5db' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = '#e5e7eb' }}
      >{todayLabel}</button>
    </div>
  )
}

/** The centered month/year title, matching the main-app toolbar's centre group. */
export function CanonicalCalendarMonthTitle({ children, ariaLive }) {
  return (
    <span
      aria-live={ariaLive}
      className="pl-cal-title"
      // Navy on a dark sheet measured 1.18:1, and 15px reads as a caption on a planner.
      // Both are tokens with the shipped values as fallbacks, so a calendar that has not
      // adopted paper renders exactly as it did.
      style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 'var(--pl-title-size, 15px)', color: 'var(--paper-ink, #1D2567)', letterSpacing: '-0.01em' }}
    >
      {children}
    </span>
  )
}

/**
 * The weekday header row: seven equal columns, uppercase, matching the main-app
 * month grid. Sunday-first by default, which is the main app's week start.
 */
export function CanonicalWeekdayHeader({ days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--rule, #f3f4f6)' }}>
      {days.map((d, i) => (
        // `var(--paper-muted, #6b7280)`: inside a planner the header reads the paper's own
        // quiet ink, and outside one the fallback is the exact literal it used to carry,
        // so the five calendars that have not adopted paper are pixel identical.
        <div key={i} style={{ padding: '8px 0', textAlign: 'center', fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--paper-muted, #6b7280)' }}>
          {d}
        </div>
      ))}
    </div>
  )
}

/**
 * One month-grid day cell frame, matching the main-app cell: fixed 88px height, hair
 * borders, a round day-number badge that fills navy for today and the selected day,
 * and a navy left rail when selected. Cell content (a staff capacity card, a Unit
 * Leader's activity chips) is passed as children. An out-of-month cell is an inert
 * grey placeholder, exactly as the main app renders it.
 *
 * Rendered as a <button> so keyboard users get activation for free; the main app's
 * own cell stays a <div> and is not affected, because the main app does not consume
 * this primitive (its cells carry staff-only interactions).
 */
export function CanonicalMonthCell({
  day,
  isOtherMonth = false,
  isToday = false,
  isSelected = false,
  isFuture = false,
  ariaLabel,
  onClick,
  children,
}) {
  if (isOtherMonth) {
    return (
      <div
        role="gridcell"
        aria-hidden="true"
        style={{ height: 'var(--pl-cell-h, 88px)', minHeight: 0, borderRight: '1px solid var(--rule, #f3f4f6)', borderBottom: '1px solid var(--rule, #f3f4f6)', background: 'var(--pl-cell-out, #fafafa)' }}
      />
    )
  }
  const numColor = (isToday || isSelected) ? '#fff' : (isFuture ? 'var(--pl-cell-future, #c7c2b8)' : 'var(--paper-ink, #374151)')
  return (
    <button
      type="button"
      role="gridcell"
      className="canonical-month-cell"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        // `var(--pl-cell-h, 88px)`: inside a planner the CSS sets 100% so the grid divides
        // a constant box by its row count; everywhere else the 88px that shipped.
        height: 'var(--pl-cell-h, 88px)',
        minHeight: 0,
        padding: '5px 6px',
        borderRight: '1px solid var(--rule, #f3f4f6)',
        borderBottom: '1px solid var(--rule, #f3f4f6)',
        borderTop: '1px solid transparent',
        borderLeft: isSelected ? '3px solid #1D2567' : '1px solid transparent',
        background: isSelected ? 'rgba(29,37,103,0.04)' : 'transparent',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden', position: 'relative',
        textAlign: 'left', font: 'inherit', width: '100%',
      }}
    >
      <span style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%',
        background: (isToday || isSelected) ? '#1D2567' : 'transparent',
        fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: 12,
        color: numColor, flexShrink: 0,
      }}>{day}</span>
      {children}
    </button>
  )
}

/**
 * A US federal holiday on a month cell.
 *
 * CALENDAR-HOLIDAY-CANON: amber, deliberately NOT any event colour. A holiday is context
 * nobody scheduled, and a chip in an event colour reads as something the program put
 * there. It is also not a button, because there is nothing to open.
 *
 * The styling is copied verbatim from the Interviews calendar's inline holiday chip, so a
 * calendar adopting this primitive matches what already shipped rather than approximating
 * it. Inline styles, no class, because portal CSS is not in the staff bundle and staff CSS
 * is not in the portal bundle: a shared class here would silently render unstyled on one
 * side or the other.
 */
export function CanonicalHolidayChip({ name, observed = false }) {
  const title = observed ? `${name} (observed) \u00b7 US Holiday` : `${name} \u00b7 US Holiday`
  return (
    <div
      title={title}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
        background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 4,
        padding: '1px 5px', cursor: 'default', maxWidth: '100%',
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#D97706', flexShrink: 0 }} />
      <span style={{
        fontFamily: 'Plus Jakarta Sans', fontSize: 9, fontWeight: 600, color: '#92400E',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{name}</span>
    </div>
  )
}

/**
 * A dense activity chip for a month cell, matching the main-app interviewer chip's
 * radius and density. Navy on a light wash by default; a live variant uses the
 * on-shift green already established in the Unit Leader calendar.
 *
 * Optional `secondary` (e.g. "with Susie") and `ordinal` (a small numeric badge) extend the
 * chip for the Unit Leader calendar; when both are absent it renders exactly as before, so the
 * Interviews calendar and any label-only caller are unchanged. `ariaLabel`, when provided,
 * carries the full accessible meaning ("Jordan Cruz with Susie, fourth logged shift") while the
 * compact visual (initials + secondary + ordinal badge) can truncate on narrow cells.
 */
/**
 * `color` tints the chip by the thing it represents, which is how the Interviews calendar
 * already draws an ASPIRE event: the colour comes from the event's TYPE. Passing none
 * keeps the exact navy-on-wash chip every current caller renders.
 */
export function CanonicalActivityChip({ label, live = false, secondary = null, ordinal = null, ariaLabel = null, color = null }) {
  const tint = (hex, a) => {
    const h = String(hex).replace('#', '')
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%',
    background: color ? tint(color, 0.14) : (live ? '#dcfce7' : '#e8eaf6'),
    color: color ? 'var(--paper-ink, #1d2567)' : (live ? '#166534' : '#1d2567'),
    borderLeft: color ? `3px solid ${color}` : undefined,
    boxShadow: live ? 'inset 0 0 0 1px #86efac' : 'none',
    fontSize: 9, fontWeight: 700, letterSpacing: '0.02em',
    padding: '1px 5px', borderRadius: 4, lineHeight: 1.4, whiteSpace: 'nowrap',
  }
  // Label-only callers (Interviews) keep the exact prior output.
  if (secondary == null && ordinal == null) return <span style={base}>{label}</span>
  return (
    <span style={base} title={ariaLabel || undefined} aria-label={ariaLabel || undefined}>
      <span style={{ flexShrink: 0 }}>{label}</span>
      {secondary && (
        <span aria-hidden="true" style={{ fontWeight: 500, color: live ? '#15803d' : '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{secondary}</span>
      )}
      {ordinal != null && (
        <span aria-hidden="true" style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 12, height: 12, padding: '0 3px', borderRadius: 999,
          background: live ? '#166534' : '#1d2567', color: '#fff', fontSize: 8, fontWeight: 700, lineHeight: 1,
        }}>{ordinal}</span>
      )}
    </span>
  )
}
