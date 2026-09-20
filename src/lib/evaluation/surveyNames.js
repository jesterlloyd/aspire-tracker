// src/lib/evaluation/surveyNames.js
//
// SURVEY-NAMES-1 (Owner, 2026-09-20): the names of the four evaluation instruments, in ONE
// place, read by everything that prints one: the catalog Review & Release shows, the four
// respondent pages, the invitation and reminder emails, the reminder ledger, the Responses
// packet, the Unit Leader and Student portals, and the staff response viewers.
//
// WHY. Until this pass each of those spelled the name itself, so the clipboard said
// "Student's Feedback on ASPIRE" while the student who opened the link read "ASPIRE
// Post-Rotation Evaluation" and the email told them to complete that. A name lives here and
// nowhere else; a surface that needs one calls surveyName() or surveyTitle().
//
// The database's evaluation_instruments.display_name is no longer READ for display: the
// surfaces that used it map the slug through this module and keep the stored value only as
// the fallback for a slug this module does not know. Renaming the stored values is a
// separate, Owner-gated decision (db/audit/survey_display_names_audit.sql lists them).
//
// Slugs are functional keys and never change. This module imports nothing on purpose: it is
// pulled into the public survey pages, the portal chunks and the server templates alike.

/** Instrument slug -> the name the Owner chose. */
export const SURVEY_NAMES = Object.freeze({
  casey_fink_readiness_2024: 'Casey-Fink Readiness for Practice',
  preceptor_progress:        "Preceptor's Assessment of Student Readiness",
  student_preceptor_eval:    "Student's Feedback on Unit and Preceptor",
  post_rotation_evaluation:  "Student's Feedback on ASPIRE",
})

/** The word a timepoint adds to a name. One vocabulary for every surface. */
export const TIMEPOINT_QUALIFIERS = Object.freeze({
  baseline:                'Pre-Rotation',
  early_rotation_baseline: 'Pre-Rotation',
  midpoint:                'Midpoint',
  mid_rotation:            'Midpoint',
  post_rotation:           'Post-Rotation',
  custom:                  'Custom',
})

/**
 * The instruments whose title carries the timepoint. Only Casey-Fink is given twice, and
 * the two administrations are two workflows, so its title says which one. Every other
 * instrument is one timepoint and its title is its name.
 */
export const QUALIFIED_SLUGS = Object.freeze(['casey_fink_readiness_2024'])

/** The name for a slug; `fallback` (a stored display_name) covers a slug not registered here. */
export function surveyName(slug, fallback) {
  return SURVEY_NAMES[slug] || fallback || ''
}

/** The timepoint word a title carries, or null when this instrument's title carries none. */
export function surveyQualifier(slug, timepoint) {
  if (!QUALIFIED_SLUGS.includes(slug)) return null
  return TIMEPOINT_QUALIFIERS[timepoint] || null
}

/** "Casey-Fink Readiness for Practice, Pre-Rotation": the sentence form (emails, meta lines). */
export function surveyTitle(slug, timepoint, fallback) {
  const name = surveyName(slug, fallback)
  const q = surveyQualifier(slug, timepoint)
  return q ? `${name}, ${q}` : name
}

/** "Casey-Fink Readiness for Practice (Pre-Rotation)": the label form the rail and prose use. */
export function surveyLabel(slug, timepoint, fallback) {
  const name = surveyName(slug, fallback)
  const q = surveyQualifier(slug, timepoint)
  return q ? `${name} (${q})` : name
}

/** The qualifier word for any timepoint, falling back to the raw value. */
export function timepointQualifier(timepoint) {
  return TIMEPOINT_QUALIFIERS[timepoint] || timepoint || ''
}
