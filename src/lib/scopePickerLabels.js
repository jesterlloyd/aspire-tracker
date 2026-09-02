// src/lib/scopePickerLabels.js
//
// SCOPE-PICKER-1: pure label derivation for the header Scope picker.
//
// Separate from the components for the reason this repo already applies to
// rotationCalendarDates.js: exporting non-components from a component file breaks
// fast refresh, and these are the only part of the picker with logic worth testing
// directly.
//
// THE POINT OF THIS MODULE IS TRUTHFULNESS. The residency cohort list can be
// loading, unprovisioned, failed, stale, or genuinely empty, and those are five
// different facts. The picker must never present any of them as a chosen cohort, and
// must never let "unavailable" read as "none configured". That distinction lived
// inside ResidencyCohortPicker's render; it is here now so the PILL and the pane
// cannot drift apart about what is true.

// Residency cohort statuses that mean the cohort is live right now. Drives the green
// dot, which is the same signal accepting_submissions drives on the ASPIRE side.
// NGRP-CYCLE-STATUS-CANON: five of the old nine statuses meant "live"; 'Active' is now
// the single one, matching what an ASPIRE cohort's green dot means.
export const RESIDENCY_OPEN_STATUSES = new Set(['Active'])

/**
 * Is the residency cycle list unusable, as opposed to merely empty?
 * unprovisioned / error / stale are all "we cannot tell you", never "there are none".
 */
export function residencyUnavailable(status) {
  return status === 'unprovisioned' || status === 'error' || status === 'stale'
}

/**
 * The cohort half of the pill for the Residency experience.
 * Never fabricates a cohort name and never presents a failure as an empty list.
 */
export function residencyCohortLabel({ status, cycles = [], activeCycle = null } = {}) {
  if (status === 'loading') return 'Loading cohorts…'
  if (residencyUnavailable(status)) return 'Cohorts unavailable'
  if (cycles.length === 0) return 'No cohorts configured'
  return activeCycle?.name || 'Select cohort'
}

/** Green dot for Residency: a real selected cycle whose status is open. */
export function residencyCohortLive(activeCycle) {
  return Boolean(activeCycle) && RESIDENCY_OPEN_STATUSES.has(activeCycle.status)
}

/** Is the residency label a state rather than a chosen cohort? Dims the pill value. */
export function residencyLabelIsState({ status, cycles = [] } = {}) {
  return residencyUnavailable(status) || status === 'loading' || (status === 'ready' && cycles.length === 0)
}

/**
 * The pill's value line.
 *
 * With one experience the experience name is omitted: a user without residency access
 * has no second term for "Internship" to contrast with, so printing it would assert a
 * distinction they cannot act on. They still see the same SCOPE control with the same
 * anatomy, and the Experience pane still lists their one experience.
 */
export function scopePillValue({ experienceLabel, cohortLabel, multiExperience }) {
  const cohort = cohortLabel || 'Select cohort'
  if (!multiExperience) return cohort
  return `${experienceLabel} · ${cohort}`
}

// ── Residency cohort dates line ──────────────────────────────────────────────
// Lives here rather than in ResidencyCohortList for the reason stated at the top of
// this file: exporting a non-component from a component file breaks fast refresh, and
// this is logic worth testing directly.

const fmtDate = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A date range, with the month written once when both ends share it:
// Dec 10 + Dec 11 -> "Dec 10-11"; Dec 30 + Jan 2 -> "Dec 30 - Jan 2".
export function fmtDateRange(from, to) {
  const a = fmtDate(from)
  if (!a) return null
  const b = fmtDate(to)
  if (!b || b === a) return a
  const monthA = String(a).split(' ')[0]
  return String(b).startsWith(`${monthA} `) ? `${a}-${String(b).split(' ')[1]}` : `${a} - ${b}`
}

// NGRP-CYCLE-STATUS-CANON: the residency row's second line. It read "Apps Nov 9", which
// named the one date the old nine-value status vocabulary did not already restate. Now
// that status says only Planning/Active/Completed/Archived, this line carries the whole
// shape of the cohort: when applications open, when interviews run, when it starts.
//
// Every segment is CONDITIONAL. A cohort mid-configuration has some of these and not
// others, and a missing date must read as absent, never as a blank or a guess.
export function cycleDatesLine(c) {
  return [
    c?.application_open_date && `Opens ${fmtDate(c.application_open_date)}`,
    c?.interview_window_start && `Interviews ${fmtDateRange(c.interview_window_start, c.interview_window_end)}`,
    c?.residency_start_date && `Starts ${fmtDate(c.residency_start_date)}`,
  ].filter(Boolean).join(' \u2022 ')
}
