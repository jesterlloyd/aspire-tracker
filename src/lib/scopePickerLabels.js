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

// SCOPE-DOT-1 (Owner, 2026-09-14): the pill's dot and the rows' status pills read the
// cohort's STATUS, on both experiences and on both surfaces (staff header, Residency
// Portal header). Active is green, Planning is yellow even while it accepts
// submissions (the blue Accepting badge on the row carries that fact), Completed is a
// muted rose, never the alert red the badge counters use. Anything else, including a
// missing cohort or a retired residency value, is the neutral grey. One rule, read by
// the dot and by both lists, so they cannot drift apart.
export const COHORT_STATUS_TONE = Object.freeze({
  Active:    Object.freeze({ dot: '#5DD39E', halo: 'rgba(93,211,158,0.2)',   bg: '#dcfce7', color: '#166534' }),
  Planning:  Object.freeze({ dot: '#F5C451', halo: 'rgba(245,196,81,0.25)',  bg: '#fef3c7', color: '#92400e' }),
  Completed: Object.freeze({ dot: '#E39A9E', halo: 'rgba(227,154,158,0.22)', bg: '#fbe9ea', color: '#9b3b41' }),
  Archived:  Object.freeze({ dot: '#9ca3af', halo: 'none',                   bg: '#f3f4f6', color: '#9ca3af' }),
})
export const NEUTRAL_TONE = Object.freeze({ dot: '#9ca3af', halo: 'none', bg: '#f3f4f6', color: '#6b7280' })

/**
 * DEMO-MODE-1: the demo cohort's tone.
 *
 * Demo mode used to announce itself with a separate amber pill in the header. This is
 * better, and it is the Owner's idea: the scope control ALREADY has a status light, and
 * a viewer has already learned to read it. Green is Active, yellow is Planning, pink is
 * Completed. A fourth colour in the same light says "this scope is different" using
 * vocabulary that is already on screen, instead of adding a second thing to look at.
 *
 * Purple because nothing else in this map is purple, and because it is the one hue no
 * ASPIRE status pill uses, so it cannot be misread as a cohort state.
 *
 * The halo is deliberately stronger than the status tones (0.35 against their 0.2-0.25).
 * The others distinguish one real cohort from another; this one has to be noticeable
 * from across a room, because the cost of missing it is presenting real data believing
 * you are not.
 */
export const DEMO_TONE = Object.freeze({
  dot: '#A855F7', halo: 'rgba(168,85,247,0.35)', bg: '#f3e8ff', color: '#6b21a8',
})

/**
 * The tone the scope light reads.
 *
 * `isDemo` wins over status, because a demo cohort's own status ('Active') is true but
 * is not the thing worth signalling while presenting.
 */
export function cohortStatusTone(status, isDemo = false) {
  if (isDemo) return DEMO_TONE
  return COHORT_STATUS_TONE[status] || NEUTRAL_TONE
}

// Residency cohort statuses that mean the cohort is live right now.
// NGRP-CYCLE-STATUS-CANON: five of the old nine statuses meant "live"; 'Active' is now
// the single one.
// The two experiences the Scope picker offers. The ONE spelling of each program's name:
// the staff header and the Residency Portal's header both read these, so the picker in
// either place names the programs identically.
export const INTERNSHIP_EXPERIENCE = Object.freeze({ id: 'internship', label: 'Internship', sub: 'Senior Clinical Rotation' })
export const RESIDENCY_EXPERIENCE = Object.freeze({ id: 'residency', label: 'Residency', sub: 'New Graduate RN Residency Program (NGRP)' })

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

/**
 * The status the pill's dot reads for the selected cohort or cycle. Null when there
 * is no selection, so the dot is neutral rather than guessing.
 */
export function cohortDotStatus(selected) {
  return selected?.status || null
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
