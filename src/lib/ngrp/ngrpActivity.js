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
