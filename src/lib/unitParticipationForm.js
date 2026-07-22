// src/lib/unitParticipationForm.js
//
// CANONICAL definition of the Unit Availability / Placement Capacity form.
//
// ONE source of truth for the public /unit-form (src/components/UnitFormPage.jsx) and the
// Unit Leader Portal Capacity screen (src/portal/UnitLeaderPortal.jsx). Both import the
// options, the labels and helper text, the empty state, the validation, and the request
// body builder from here, so the two interfaces CANNOT drift: a change to a choice, a
// label, or a rule happens once and applies to both.
//
// Both submit to the SAME canonical write (api/lib/unitResponseUpsert.js -> units +
// unit_cohort_responses), which is exactly what the staff "At a Glance -> Placement
// Capacity" panel reads. The only difference is identity: the public form collects the
// submitter's name and email; the portal derives them from the authenticated profile and
// its endpoint rejects those keys. That single difference is expressed by the
// `requireIdentity` / `includeIdentity` flags below, not by a second form definition.

export const SUBMITTER_ROLES = [
  'Associate Director',
  'Acting Associate Director',
  'Executive Director',
  'Assistant Nurse Manager',
  'NPD Practitioner',
  'Clinical Nurse Specialist',
  'Charge Nurse',
  'Other',
]

// Shift PREFERENCE for hosting (distinct from a preceptor's deployed shift_type). This is
// the canonical set for this form; do not reuse the divergent SHIFT_OPTIONS in constants.js.
export const SHIFT_PREFERENCE_OPTIONS = [
  'Day Shift',
  'Night Shift',
  'Mid Shift',
  'Either / No Preference',
]

export const ALUMNI_HIRED_OPTIONS = [['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']]
export const ALUMNI_OUTCOME_OPTIONS = [
  ['successful', 'Successful'], ['mixed', 'Mixed'], ['would_not_hire_again', 'Would not hire again'],
]
export const WOULD_CONSIDER_OPTIONS = [['yes', 'Yes'], ['no', 'No'], ['maybe', 'Maybe']]

// Every label, helper line, and placeholder, so both forms read identical copy.
export const PARTICIPATION_TEXT = {
  unitLabel: 'Select Your Unit or Department',
  nameLabel: 'Your Name',
  emailLabel: 'Your Email Address',
  roleLabel: 'Your Role',
  rolePlaceholder: 'Select your role…',
  slotsLabel: 'Number of students your unit can host this cohort',
  slotsPlaceholder: 'Enter 0 if unable to host',
  slotsHelp: 'Enter 0 if your unit is unable to host students this cycle.',
  reasonLabel: 'Reason for not hosting this cycle (optional)',
  reasonPlaceholder: 'Help us understand the context so we can plan better. Anything you share stays internal.',
  shiftLabel: 'Shift preference',
  shiftPlaceholder: 'Select a preference…',
  preceptorsLabel: 'Preferred preceptors (optional)',
  preceptorsPlaceholder: "Optional, you can leave this blank if preceptor assignments aren't finalized yet.",
  ngrpLabel: 'Does your unit plan to hire new graduate RNs for the upcoming NGRP cohort?',
  ngrpReasonLabel: 'Why not? (required)',
  ngrpReasonPlaceholder: 'e.g. staffing freeze, budget constraints, recent hire cohort not yet onboarded',
  alumniIntro: "Share your experience if you'd like. This helps us understand the long-term impact of the program.",
  alumniHiredLabel: 'Has your unit ever hired an ASPIRE participant into the NGRP?',
  alumniOutcomeLabel: 'How was the experience?',
  alumniNotesLabel: "Anything you'd like to share? (optional)",
  alumniNotesPlaceholder: 'e.g. how the student transitioned, standout qualities, lessons learned',
  wouldConsiderLabel: 'Would you consider hiring an ASPIRE alumnus in the future?',
  considerationsLabel: 'Any other considerations or requirements? (optional)',
  considerationsPlaceholder: 'e.g. scheduling requirements, dress code, skill level preferences, anything else we should know',
}

export function emptyParticipation() {
  return {
    unit_name: '',
    submitter_name: '',
    submitter_email: '',
    submitter_role: '',
    slots_offered: '',
    shift_preference: '',
    preferred_preceptors: '',
    considerations: '',
    reason_for_zero: '',
    hiring_ngrp: null,
    hiring_ngrp_reason: '',
    has_fired_alumni: '',
    alumni_outcome: '',
    alumni_notes: '',
    would_consider_alumni: '',
  }
}

export function participationSlots(form) {
  return Number.parseInt(form.slots_offered, 10) || 0
}
export function isHostingParticipation(form) {
  return participationSlots(form) > 0
}

// Shared client-side validation. requireIdentity is true for the public form (which
// collects name and email) and false for the portal (identity comes from the profile).
// Returns an error string, or null when the form is valid.
export function validateParticipation(form, { requireIdentity = true } = {}) {
  if (!form.unit_name) return 'Please select your unit or department.'
  if (requireIdentity && !String(form.submitter_name || '').trim()) return 'Please enter your name.'
  if (requireIdentity && !String(form.submitter_email || '').trim()) return 'Please enter your email address.'
  if (!form.submitter_role) return 'Please select your role.'
  if (form.slots_offered === '') return 'Please enter the number of slots (enter 0 if not hosting).'
  if (form.hiring_ngrp === null) return 'Please answer the NGRP hiring question.'
  return null
}

// Whether the submit button should be enabled (all always-required fields present).
export function participationReady(form, { requireIdentity = true } = {}) {
  if (!form.unit_name) return false
  if (requireIdentity && (!form.submitter_name || !form.submitter_email)) return false
  if (!form.submitter_role) return false
  if (form.slots_offered === '') return false
  return true
}

// The canonical request body. includeIdentity is true for the public endpoint; the portal
// endpoint derives name and email from the profile and REJECTS those keys, so the portal
// passes includeIdentity: false.
export function buildParticipationBody(form, { includeIdentity = true } = {}) {
  const body = {
    unit_name: form.unit_name,
    submitter_role: form.submitter_role,
    slots_offered: form.slots_offered,
    shift_preference: form.shift_preference,
    preferred_preceptors: form.preferred_preceptors,
    considerations: form.considerations,
    reason_for_zero: form.reason_for_zero,
    hiring_ngrp: form.hiring_ngrp,
    hiring_ngrp_reason: form.hiring_ngrp_reason,
    has_fired_alumni: form.has_fired_alumni,
    alumni_outcome: form.alumni_outcome,
    alumni_notes: form.alumni_notes,
    would_consider_alumni: form.would_consider_alumni,
  }
  if (includeIdentity) {
    body.submitter_name = form.submitter_name
    body.submitter_email = form.submitter_email
  }
  return body
}
