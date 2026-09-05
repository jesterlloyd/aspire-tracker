// MASTHEAD-LOCKSCREEN-1: the events row along the bottom of the masthead.
//
// Every operational item on the card lives here, as a chip: the chips are the
// one material element the Owner kept, and everything that is not a chip is
// big and bare. The label and the chips appear only when something qualifies
// (see src/lib/mastheadEvents.js for the rule); the Open Calendar pill is the
// row's constant, rightmost, and the only thing left on a quiet day.
export default function MastheadEventsRow({ items = [], calendar = null }) {
  const list = items || []
  if (list.length === 0 && !calendar) return null
  return (
    <div className="mast-today-line">
      {list.length > 0 && <span className="mast-today-label">Events Today</span>}
      {list.map(it => (
        <span key={it.key} className={`mast-evchip${it.milestone ? ' mast-evchip-milestone' : ''}`}>
          <span className="mast-evdot" style={{ background: it.dot }} aria-hidden />
          {it.text}
        </span>
      ))}
      {calendar && (
        <button type="button" className="mast-cal-btn mast-cal-btn-inline" onClick={calendar.onClick}>
          {calendar.label || 'Open Calendar'}
        </button>
      )}
    </div>
  )
}
