// NGRP-WORKSPACE-2: pure helpers for Residency > Activity. Data-only module, so
// the calendar component stays component-only and react-refresh is happy.

const dayStr = d => (typeof d === 'string' ? d.split('T')[0] : '')

/**
 * The month the activity calendar opens on: TODAY's month, the same month the
 * mini calendar and the selected day already show (Owner, 2026-09-14). It used to
 * open on the cohort's application-open month, which put Winter 2027 on November
 * while the side panel said September 14. The cohort argument is kept so callers
 * are unchanged; it no longer decides the month.
 *
 * Date-only strings are split, never parsed through Date, so the first of a
 * month does not slide into the previous one west of Greenwich.
 */
export function initialActivityMonth(_cycle, todayStr) {
  const [y, m] = String(dayStr(todayStr) || '').split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  }
  return { year: y, month: m - 1 }
}

// NGRP-ACTIVITY-PARITY-1: the palette the Interviews calendar already uses for
// its event actions, so the two calendars offer the same act in the same colour.
// One definition, imported by both, rather than a hex repeated in two files.
export const EVENT_ACTION = '#6D28D9'
export const EVENT_ACTION_HOVER = '#5B21B6'

// US holidays render as their own chips, distinct from ASPIRE events: they are
// context, not something anyone scheduled, and nothing can be added to them.
export const HOLIDAY_COLOR = '#D97706'

// RESIDENCY-REFLECTION-2 (Owner, 2026-09-14): residents' marked working days,
// coloured by shift. Day blue, Night purple, Mid teal, and a plain slate for a
// resident whose shift is not on the hire record yet. Read by Residency >
// Activity and by the resident's own reflection calendar, so both agree.
export const SHIFT_COLORS = Object.freeze({
  Day: '#2563EB',
  Night: '#7C3AED',
  Mid: '#0F766E',
  Variable: '#6B7280',
  unspecified: '#6B7280',
})
export function shiftColor(shift) {
  return SHIFT_COLORS[shift] || SHIFT_COLORS.unspecified
}

// The month window a cursor covers, as the date-only strings the events endpoint
// and the holiday helper both take.
export function monthRange({ year, month }) {
  const pad = n => String(n).padStart(2, '0')
  const last = new Date(year, month + 1, 0).getDate()
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` }
}
