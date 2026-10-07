// ONE-CALENDAR-1: the planner's Week view, one component for every calendar that offers it.
//
// Seven day columns, an all-day row for things that have a date but no time (holidays, events
// marked all day, residents' working days, a shift with no check-in clock), and an hour grid for
// things with a start and an end (interview times, timed events, a logged shift). The box is the
// planner's constant size and the hours scroll inside it; on open, and whenever the week changes,
// the scroller lands on the week's first timed entry rather than 7 AM (the main app's Interviews
// week opened at 7 AM and hid every interview below the fold, which read as an empty week).
//
// Styling is inline on purpose, like the rest of the foundation: portal CSS is not in the staff
// bundle and staff CSS is not in the portal bundle.
import { useEffect, useRef } from 'react'
import { weekDays, minutesOf, overlapGroups, weekScrollTop } from '../../lib/calendarWeek'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtHour = h => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`)

function tint(hex, a) {
  const h = String(hex || '#1D2567').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function Chip({ item }) {
  const Tag = item.onClick ? 'button' : 'span'
  return (
    <Tag type={item.onClick ? 'button' : undefined} onClick={item.onClick} title={item.title || undefined}
      style={{
        display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box', border: 'none', font: 'inherit',
        background: tint(item.color, 0.18), borderLeft: `3px solid ${item.color || '#1D2567'}`,
        color: item.ink || 'var(--paper-ink)', borderRadius: 4, padding: '1px 5px',
        fontSize: 9.5, fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        cursor: item.onClick ? 'pointer' : 'default',
      }}>{item.label}</Tag>
  )
}

/**
 * `allDayOn(ymd)` and `timedOn(ymd)` return that day's items: { id, label, sublabel?, color, ink?,
 * onClick?, title? } and, for a timed item, `start` / `end` as HH:MM. `onDayClick(ymd)` selects a
 * day from its header; `onEmptyClick(ymd, hhmm)` fires on a click in the empty grid.
 */
export default function CanonicalWeekView({
  weekStart, today, selectedDate = null, allDayOn, timedOn, onDayClick = null, onEmptyClick = null,
  startHour = 7, endHour = 20, hourHeight = 64, ariaLabel = 'Week',
}) {
  const days = weekDays(weekStart)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const scrollRef = useRef(null)
  const timed = days.map(d => (timedOn ? timedOn(d) : []))
  const allDay = days.map(d => (allDayOn ? allDayOn(d) : []))
  const anyAllDay = allDay.some(x => x.length)
  const firstKey = timed.flat().map(i => i.start).sort()[0] || ''

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = weekScrollTop(timed.flat(), { startHour, hourHeight })
    // Only a new week or a new first entry moves the scroller; a re-render never yanks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, firstKey, startHour, hourHeight])

  const col = { display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)' }
  return (
    <div className="pl-calbox" role="grid" aria-label={ariaLabel} style={{ border: '1px solid var(--rule)', borderRadius: 'var(--aspire-radius-control)', overflow: 'hidden' }}>
      <div style={{ ...col, borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
        <div />
        {days.map((d, i) => {
          const isToday = d === today
          const selected = d === selectedDate
          const Tag = onDayClick ? 'button' : 'div'
          return (
            <Tag key={d} type={onDayClick ? 'button' : undefined} onClick={onDayClick ? () => onDayClick(d) : undefined} role="columnheader"
              aria-label={`${DOW[i]} ${Number(d.slice(-2))}${isToday ? ', today' : ''}`}
              style={{ borderLeft: '1px solid var(--rule)', padding: '8px 0', textAlign: 'center', background: selected ? 'rgba(29,37,103,0.04)' : 'transparent', border: 'none', borderLeftStyle: 'solid', font: 'inherit', cursor: onDayClick ? 'pointer' : 'default' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: (selected || isToday) ? 'var(--paper-ink)' : 'var(--paper-muted)' }}>{DOW[i]}</div>
              <div style={{ width: 26, height: 26, borderRadius: '50%', margin: '4px auto 0', background: isToday ? '#1D2567' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: isToday ? '#fff' : 'var(--paper-ink)' }}>
                {Number(d.slice(-2))}
              </div>
            </Tag>
          )
        })}
      </div>

      {anyAllDay && (
        <div style={{ ...col, borderBottom: '1px solid var(--rule)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 5, fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: 'var(--paper-muted)', textTransform: 'uppercase' }}>All day</div>
          {days.map((d, i) => (
            <div key={d} style={{ borderLeft: '1px solid var(--rule)', padding: 4, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 26 }}>
              {allDay[i].slice(0, 3).map(item => <Chip key={item.id} item={item} />)}
              {allDay[i].length > 3 && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--paper-muted)' }}>+{allDay[i].length - 3}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="pl-calbox-scroll" ref={scrollRef}>
        <div style={col}>
          <div>
            {hours.map(h => (
              <div key={h} style={{ height: hourHeight, borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 5, paddingTop: 4, fontSize: 9, color: 'var(--paper-muted)', fontWeight: 600 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>
          {days.map((d, di) => {
            const groups = overlapGroups(timed[di])
            return (
              <div key={d} style={{ borderLeft: '1px solid var(--rule)', position: 'relative', height: hours.length * hourHeight, cursor: onEmptyClick ? 'pointer' : 'default' }}
                onClick={onEmptyClick ? e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const mins = ((e.clientY - rect.top) / (hours.length * hourHeight)) * (endHour - startHour) * 60 + startHour * 60
                  const snapped = Math.floor(mins / 30) * 30
                  onEmptyClick(d, `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`)
                } : undefined}>
                {hours.map(h => (
                  <div key={h} aria-hidden="true" style={{ position: 'absolute', top: (h - startHour) * hourHeight, left: 0, right: 0, height: hourHeight, borderBottom: '1px solid var(--rule)', pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: hourHeight / 2, left: 0, right: 0, borderBottom: '1px dashed var(--rule)' }} />
                  </div>
                ))}
                {groups.flatMap(group => group.map((item, idx) => {
                  // A shift that starts before the first hour, or runs past the last, is clamped to the
                  // grid so its label stays in view; one wholly outside it is not drawn.
                  const s = Math.max(minutesOf(item.start), startHour * 60)
                  const e = Math.min(Math.max(minutesOf(item.end), s + 15), endHour * 60)
                  if (e <= s) return null
                  const top = ((s - startHour * 60) / 60) * hourHeight
                  const height = Math.max(22, ((e - s) / 60) * hourHeight - 2)
                  const colW = `calc((100% - ${group.length * 2 + 2}px) / ${group.length})`
                  const left = `calc(${idx} * (${colW} + 2px) + 2px)`
                  const Tag = item.onClick ? 'button' : 'div'
                  return (
                    <Tag key={item.id} type={item.onClick ? 'button' : undefined} title={item.title || undefined}
                      onClick={item.onClick ? ev => { ev.stopPropagation(); item.onClick() } : undefined}
                      style={{
                        position: 'absolute', top, height, left, width: colW, boxSizing: 'border-box', overflow: 'hidden', textAlign: 'left', font: 'inherit',
                        background: tint(item.color, 0.18), border: `1px solid ${tint(item.color, 0.35)}`, borderLeft: `3px solid ${item.color || '#1D2567'}`,
                        borderRadius: 5, padding: '3px 6px', color: item.ink || 'var(--paper-ink)', cursor: item.onClick ? 'pointer' : 'default',
                        display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.25,
                      }}>
                      <span style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                      {item.sublabel && height >= 34 && <span style={{ fontSize: 9.5, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.sublabel}</span>}
                    </Tag>
                  )
                }))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
