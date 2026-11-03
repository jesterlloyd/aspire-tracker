// lib/server/ngrpCycleChrono.js
//
// The residency cohort chronology, on its own so the browser can read it (ngrpStates.js does)
// without importing ngrpApplicants.js, which reaches server-only code (Keith's skill runner and
// node:crypto). ngrpApplicants.js re-exports both, so its callers are unchanged.
//
// Cohorts sort by application opening date, then residency start date, then creation, then id;
// a missing date sorts last (an undated cohort can never retroactively exclude anyone from a
// dated one), and the tie-breaks make the comparison total and deterministic.

const LATEST = '9999-12-31'
export function cycleChronoKey(cycle) {
  return [
    cycle?.application_open_date || LATEST,
    cycle?.residency_start_date || LATEST,
    cycle?.created_at || LATEST,
    cycle?.id || '',
  ].join('|')
}

// Strictly earlier in the authoritative chronology.
export function isEarlierCycle(candidateCycle, selectedCycle) {
  return cycleChronoKey(candidateCycle) < cycleChronoKey(selectedCycle)
}
