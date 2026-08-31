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
export const RESIDENCY_OPEN_STATUSES = new Set([
  'Accepting Interest', 'Application Open', 'Interviews', 'Offers', 'Residency Active',
])

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
