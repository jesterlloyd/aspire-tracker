// MASTHEAD-LOCKSCREEN-1: which events earn a chip on the masthead, and what the
// chip says. Pure and shared, so the staff card and the portal card can never
// disagree about the rule.
//
// THE RULE (Owner, 2026-09-04): a chip is an event the author explicitly chose
// to show in the masthead, OR a milestone, and it is inside the next
// MASTHEAD_WINDOW_DAYS days. Nothing else. The old card surfaced the single
// "next milestone" however far away it was, and "in 67 days" is not something
// the masthead should be saying; the calendar is one click away for that.
//
// The flag is still the show_on_welcome column. The label changed to "Show in
// Masthead" because that is what it does now; the column did not, so every
// event already flagged carries straight over.
import { eventOnDate, eventColor, formatEventWhen } from './aspireEvents.js'

export const MASTHEAD_WINDOW_DAYS = 14

/** Whole days between two local 'YYYY-MM-DD' strings. */
export function daysBetween(fromStr, toStr) {
  const a = new Date(`${fromStr}T00:00:00`)
  const b = new Date(`${toStr}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** 'YYYY-MM-DD' plus n days, local. */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The "when" half of a chip. Today keeps the time (the chip is about now);
 * everything further out is a distance, because a date the reader has to
 * work out is not a glance.
 */
export function chipWhen(days, ev) {
  if (days <= 0) return formatEventWhen(ev)
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

/** Whether an event has asked to be on the masthead at all. */
export function isMastheadCandidate(ev) {
  return !!(ev && (ev.show_on_welcome || ev.is_milestone))
}

/**
 * The first day within the window on which the event occurs, as a whole-day
 * distance from today, or -1 when it does not occur inside the window. Walks
 * the window day by day so recurring and multi-day events are handled by the
 * same occurrence rule the calendar uses, not by a second one.
 */
export function daysUntil(ev, today, windowDays = MASTHEAD_WINDOW_DAYS) {
  for (let d = 0; d <= windowDays; d++) {
    if (eventOnDate(ev, addDays(today, d))) return d
  }
  return -1
}

/**
 * The chips. Milestones lead, then everything else by distance, then by start
 * time. Each item is { key, dot, text, days, milestone }: dot is the colour the
 * calendar already gives the event, text is "Title · when".
 */
export function mastheadItems(events, today, windowDays = MASTHEAD_WINDOW_DAYS) {
  const out = []
  for (const ev of events || []) {
    if (!isMastheadCandidate(ev)) continue
    const days = daysUntil(ev, today, windowDays)
    if (days < 0) continue
    out.push({
      key: ev.id ?? `${ev.title}-${ev.start_at}`,
      dot: eventColor(ev),
      text: `${ev.title} · ${chipWhen(days, ev)}`,
      days,
      milestone: !!ev.is_milestone,
      startAt: String(ev.start_at || ''),
    })
  }
  out.sort((a, b) => {
    if (a.milestone !== b.milestone) return a.milestone ? -1 : 1
    if (a.days !== b.days) return a.days - b.days
    return a.startAt.localeCompare(b.startAt)
  })
  return out.map(({ startAt, ...item }) => item)   // eslint-disable-line no-unused-vars
}

/** Today's US holidays as chips: they are "Events Today" by definition. */
export function holidayItems(holidays) {
  return (holidays || []).map(h => ({ key: `holiday-${h.name}`, dot: '#D97706', text: `${h.name} · US Holiday`, days: 0, milestone: false }))
}
