// src/lib/placement/suggestionConfig.js
//
// KEITH-PLACEMENT-1 (2026-09-29): every number the placement suggestions use, in one file. Change a
// weight here and nowhere else. The hard rules are code (candidatePlacements.js); these only score
// the candidates that passed them.
//
//   score = preference[rank] + experienceFit x fit - preceptorLoad x load
//
// The preference steps are a whole point apart and experienceFit is below 1, so Keith's fit can
// reorder candidates at the SAME preference rank (or among units the student did not pick), and
// can never lift a 2nd choice over a 1st. preceptorCap is the Owner's rule (2026-09-29): one active
// primary student per preceptor per cohort.

export const PLACEMENT_WEIGHTS = Object.freeze({
  preference: Object.freeze({ 1: 3, 2: 2, 3: 1, none: 0 }),
  experienceFit: 0.8,
  preceptorLoad: 0.25,
})

export const PLACEMENT_RULES = Object.freeze({
  preceptorCap: 1,     // active primary students per preceptor per cohort
  explainTop: 5,       // Keith reads the best 5 rule-passing units per student (2 preceptors each at most), then 3 are kept
  suggest: 3,          // candidates shown: the suggestion, and 2 more behind Swap
})
