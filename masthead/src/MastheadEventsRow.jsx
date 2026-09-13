// MASTHEAD-LOCKSCREEN-1 / EVENT-AUDIENCE-2: the events row along the bottom of
// the masthead.
//
// Every operational item on the card lives here, as a chip: the chips are the
// one material element the Owner kept, and everything that is not a chip is
// big and bare. The row exists only when something qualifies (see
// src/lib/mastheadEvents.js for the rule); on a quiet day there is no row at
// all, Open Calendar included (Owner, 2026-09-04: the pill without an event
// was noise).
//
// The label tells the truth about distance. "Events Today" stands before the
// chips that are today; "Upcoming" before the ones that are not. A chip eleven
// days out under a label that says Today was the Owner's own catch.
export default function MastheadEventsRow({ items = [], calendar = null }) {
  const list = items || []
  if (list.length === 0) return null
  const today = list.filter(it => it.today)
  const upcoming = list.filter(it => !it.today)
  const chip = it => (
    <span key={it.key} className="mast-evchip">
      <span className="mast-evdot" style={{ background: it.dot }} aria-hidden />
      {it.text}
    </span>
  )
  return (
    <div className="mast-today-line">
      {today.length > 0 && <span className="mast-today-label">Events Today</span>}
      {today.map(chip)}
      {upcoming.length > 0 && <span className="mast-today-label">Upcoming</span>}
      {upcoming.map(chip)}
      {calendar && (
        <button type="button" className="mast-cal-btn mast-cal-btn-inline" onClick={calendar.onClick}>
          {calendar.label || 'Open Calendar'}
        </button>
      )}
    </div>
  )
}
