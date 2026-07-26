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

export function CanonicalCalendarLayout({
  title,
  description,
  sidebar,
  toolbar,
  children,
  footer,
  labelledBy = 'canonical-calendar-title',
  titleVisuallyHidden = false,
}) {
  return (
    <section className="canonical-calendar-shell" aria-labelledby={labelledBy}>
      <div className="canonical-calendar-sidebar">
        {sidebar}
      </div>
      <div className="canonical-calendar-main">
        <div className="canonical-calendar-toolbar">
          {title && (
            <h3
              id={labelledBy}
              className={titleVisuallyHidden ? 'ptl-visually-hidden' : 'canonical-calendar-title'}
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
    </section>
  )
}

export function CanonicalCalendarSidebar({ children }) {
  return (
    <div className="canonical-calendar-sidebar-stack">
      {children}
    </div>
  )
}

export function CanonicalCalendarTodayPanel({ dateLabel, summary, emptyLabel, children }) {
  return (
    <section className="canonical-calendar-today" aria-labelledby="canonical-calendar-today-title">
      <div className="canonical-calendar-kicker">Today</div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: '9px', overflow: 'hidden', height: '32px' }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={prevDisabled}
          title={prevTitle}
          aria-label={prevAriaLabel || prevTitle}
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
        style={{ height: '32px', padding: '0 14px', background: 'none', border: '1px solid #e5e7eb', borderRadius: '9px', cursor: 'pointer', fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#374151', transition: 'all 0.15s ease' }}
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
      style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '15px', color: '#1D2567', letterSpacing: '-0.01em' }}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #f3f4f6' }}>
      {days.map((d, i) => (
        <div key={i} style={{ padding: '8px 0', textAlign: 'center', fontFamily: 'DM Sans', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
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
        style={{ height: 88, borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}
      />
    )
  }
  const numColor = (isToday || isSelected) ? '#fff' : (isFuture ? '#c7c2b8' : '#374151')
  return (
    <button
      type="button"
      role="gridcell"
      className="canonical-month-cell"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        height: 88,
        padding: '5px 6px',
        borderRight: '1px solid #f3f4f6',
        borderBottom: '1px solid #f3f4f6',
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
        fontFamily: 'DM Sans', fontWeight: 600, fontSize: 12,
        color: numColor, flexShrink: 0,
      }}>{day}</span>
      {children}
    </button>
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
export function CanonicalActivityChip({ label, live = false, secondary = null, ordinal = null, ariaLabel = null }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%',
    background: live ? '#dcfce7' : '#e8eaf6',
    color: live ? '#166534' : '#1d2567',
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
