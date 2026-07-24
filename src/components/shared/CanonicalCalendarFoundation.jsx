export function CanonicalCalendarLayout({ title, description, sidebar, toolbar, children, footer, labelledBy = 'canonical-calendar-title' }) {
  return (
    <section className="canonical-calendar-shell" aria-labelledby={labelledBy}>
      <div className="canonical-calendar-sidebar">
        {sidebar}
      </div>
      <div className="canonical-calendar-main">
        <div className="canonical-calendar-toolbar">
          <div>
            <h3 id={labelledBy} className="canonical-calendar-title">{title}</h3>
            {description && <p className="canonical-calendar-description">{description}</p>}
          </div>
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
