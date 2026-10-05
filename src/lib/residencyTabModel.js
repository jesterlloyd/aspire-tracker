// src/lib/residencyTabModel.js
//
// RESIDENCY-TAB-1: the words and groupings on the Student Portal's Residency tab. Pure, so the
// page and its tests read one set of rules.

export const FORM_WORDS = {
  not_sent: { label: 'Not sent yet', tone: 'off', note: 'Your ASPIRE team sends it to your email when the application window is near.' },
  sent: { label: 'Waiting for you', tone: 'warn', note: 'It is in your email. Open the link there to fill it in.' },
  opened: { label: 'Started', tone: 'warn', note: 'You opened it. Finish it from the link in your email.' },
  in_progress: { label: 'In progress', tone: 'warn', note: 'Your answers are saved. Finish it from the link in your email.' },
  submitted: { label: 'Submitted', tone: 'ok', note: 'Thank you. You can still revise it from the link in your email until the deadline.' },
}
export const formWords = status => FORM_WORDS[status] || FORM_WORDS.not_sent

export const SUPPORT_LABELS = {
  resume_review: 'Résumé Review',
  town_hall: 'Town Hall',
  interview_bootcamp: 'Interview Bootcamp',
  placement_advising: 'Placement Advising',
}
// One line per activity: how many times, and the latest date.
export function supportSummary(entries = []) {
  const by = new Map()
  for (const e of entries) {
    const cur = by.get(e.activity) || { activity: e.activity, label: SUPPORT_LABELS[e.activity] || e.activity, count: 0, last: null }
    cur.count += 1
    if (!cur.last || e.occurred_on > cur.last) cur.last = e.occurred_on
    by.set(e.activity, cur)
  }
  return Object.keys(SUPPORT_LABELS).map(k => by.get(k)).filter(Boolean)
}

// The residency events from the portal calendar feed: application dates, Town Halls and the
// interview window, from today on, soonest first.
export const RESIDENCY_EVENT_TYPES = Object.freeze(['ngrp_open', 'ngrp_deadline', 'town_hall', 'interview_window'])
export function upcomingResidencyEvents(events = [], today) {
  return events
    .filter(e => RESIDENCY_EVENT_TYPES.includes(e.event_type) && localToday(new Date(e.end_at || e.start_at)) >= today)
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
    .slice(0, 8)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// A calendar date (YYYY-MM-DD) as "Oct 5, 2026", by the calendar, never a time zone.
export function dayLabel(day) {
  const [y, m, d] = String(day || '').split('-').map(Number)
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : ''
}
export function rangeLabel(start, end) {
  if (!end || end === start) return dayLabel(start)
  return `${dayLabel(start)} to ${dayLabel(end)}`
}
// The viewer's own today, YYYY-MM-DD.
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
