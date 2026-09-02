// NGRP-WORKSPACE-2: pure helpers for Residency > Activity. Data-only module, so
// the calendar component stays component-only and react-refresh is happy.

const dayStr = d => (typeof d === 'string' ? d.split('T')[0] : '')

/**
 * The month the activity calendar opens on: the month the cohort's applications
 * open, so the tab lands where the cohort's own year starts rather than on
 * whatever month it happens to be today. Falls back to the current month for a
 * cohort with no open date set.
 *
 * Date-only strings are split, never parsed through Date, so a cohort opening on
 * the first of a month does not slide into the previous one west of Greenwich.
 */
export function initialActivityMonth(cycle, todayStr) {
  const anchor = dayStr(cycle?.application_open_date) || todayStr
  const [y, m] = String(anchor).split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) {
    const [ty, tm] = String(todayStr).split('-').map(Number)
    return { year: ty, month: tm - 1 }
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

// The month window a cursor covers, as the date-only strings the events endpoint
// and the holiday helper both take.
export function monthRange({ year, month }) {
  const pad = n => String(n).padStart(2, '0')
  const last = new Date(year, month + 1, 0).getDate()
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` }
}
