// src/lib/schoolPlacementForm.js
//
// CANONICAL definition of the ASPIRE Student Placement Request form.
//
// ONE source of truth for the public /school-form (src/components/SchoolFormPage.jsx) and the
// authenticated Academic Partner Placement Requests workspace (src/portal/AcademicPartnerPortal.jsx).
// Both import the copy, the empty state, the validation, the soft-warning generator, and the request
// body builder from here, so the two interfaces CANNOT drift: a change to a label, a rule, or the
// payload happens once and applies to both.
//
// This mirrors the /unit-form <-> Capacity convergence (src/lib/unitParticipationForm.js). The only
// differences between the public and authenticated surfaces are at the EDGES, not in this definition:
//   - School: the public form picks from SCHOOLS; the portal prefills/locks it to the caller's
//     server-authorized school(s). Either way a non-empty school is required.
//   - Identity/provenance: the public form is password-gated and anonymous; the portal derives the
//     authenticated submitting profile and the authorized school SERVER-SIDE. The typed coordinator
//     name/email stay as form data in both (they are contact info, never the authorization identity).
// Those differences live in the two components and their endpoints, not here.

import { PROGRAM_TYPES, SCHOOLS } from './constants.js'
import { WEEKDAYS } from './availability.js'

export { PROGRAM_TYPES, SCHOOLS, WEEKDAYS }

export const PLACEMENT_PAGE_TITLE = 'ASPIRE Student Placement Request Form'

// Minimum clinical hours required per student (hard rule, enforced client and server side).
export const MIN_HOURS_REQUIRED = 90

// Every label, section title, intro line, and placeholder, so both surfaces read identical copy.
export const SCHOOL_PLACEMENT_TEXT = {
  // Section 1: School Information
  schoolSectionTitle: 'School Information',
  schoolLabel: 'School or University Name *',
  schoolPlaceholder: 'Select your school...',
  coordinatorNameLabel: 'Your Name (Placement Coordinator) *',
  coordinatorNamePlaceholder: 'First Last, Title',
  coordinatorEmailLabel: 'Your Email Address *',
  coordinatorEmailPlaceholder: 'coordinator@school.edu',

  // Section 2: Rotation Dates
  rotationSectionTitle: 'Rotation Dates',
  rotationIntro: 'When will your students be at Cedars-Sinai? These dates apply to all students in this submission.',
  rotationStartLabel: 'Rotation Start Date *',
  rotationEndLabel: 'Rotation End Date *',

  // Section 2b: Rotation Availability
  availabilitySectionTitle: 'Rotation Availability',
  availabilityIntro: 'This helps ASPIRE identify possible scheduling conflicts before matching students with preceptors. These constraints apply to your program; individual student availability is collected separately. Availability is considered but cannot be guaranteed.',
  unavailableWeekdaysLabel: 'Weekdays students are generally unavailable (class, lab, or school requirements)',
  minDaysLabel: 'Minimum clinical days per week',
  minDaysPlaceholder: 'e.g. 2',
  weekendsAllowedLabel: 'Weekend rotations allowed?',
  nightsAllowedLabel: 'Night shifts allowed?',
  triStatePlaceholder: 'Select…',
  blackoutLabel: 'School-wide blackout dates or academic breaks (optional)',
  addDateLabel: '+ Add date',
  schedulingNotesLabel: 'Scheduling notes for the ASPIRE team (optional)',
  schedulingNotesPlaceholder: 'e.g. Students attend lecture Mon/Tue mornings; clinical Wed–Fri only.',

  // Section 3: Students
  studentsSectionTitle: 'Students',
  studentLabelPrefix: 'Student',
  removeLabel: 'Remove',
  firstNameLabel: 'First Name *',
  firstNamePlaceholder: 'First',
  lastNameLabel: 'Last Name *',
  lastNamePlaceholder: 'Last',
  schoolEmailLabel: 'School Email *',
  schoolEmailPlaceholder: 'student@school.edu',
  phoneLabel: 'Phone (optional)',
  phonePlaceholder: '(555) 000-0000',
  programTypeLabel: 'Program Type',
  programTypePlaceholder: 'Select...',
  hoursRequiredLabel: 'Hours Required',
  hoursRequiredPlaceholder: 'e.g. 144',
  estimatedGraduationLabel: 'Estimated Graduation Date',
  addStudentLabel: '+ Add Another Student',

  // Section 4: Additional Notes
  additionalNotesLabel: 'Additional notes for the ASPIRE team (optional)',
  additionalNotesPlaceholder: 'Any special scheduling needs, course requirements, or information we should know',
}

// Validation messages, shared so both surfaces speak identically. `scope` lets a caller route the
// message (the public form shows rotation errors inline on the date fields, others at the top).
export const PLACEMENT_MESSAGES = {
  coordinator: 'Please fill in your school and contact information.',
  rotationRequired: 'Both rotation start and end dates are required.',
  rotationOrder: 'Rotation end date must be after the start date.',
  studentsRequired: 'Each student requires a first name, last name, and email.',
  cohortClosed: 'Submissions are not currently open. Please contact the ASPIRE team.',
}

// A blank student row. `_key` is a stable React list key (UI only; never sent to the server).
export function newStudentRow() {
  return {
    _key: `${Date.now()}-${Math.random()}`,
    first_name: '', last_name: '', email: '', phone: '',
    program_type: '', hours_required: '', estimated_graduation_date: '',
  }
}

export function emptyCoordinator() {
  return { school: '', name: '', email: '', notes: '' }
}
export function emptyRotation() {
  return { start_date: '', end_date: '' }
}
export function emptyAvailability() {
  return {
    unavailable_weekdays: [],
    min_days_per_week: '',
    weekends_allowed: null,
    nights_allowed: null,
    blackout_dates: [],
    scheduling_notes: '',
  }
}

// Shared HARD validation. Returns { scope, message } or null when valid. Rules, order, and messages
// are identical for the public form and the portal; the only edge difference (where the school comes
// from) does not change the rule that a school is required.
export function validatePlacementForm({ coordinator, rotation, students, cohortId }) {
  const coord = coordinator || {}
  const rot = rotation || {}
  const rows = students || []

  if (!String(coord.school || '').trim() || !String(coord.name || '').trim() || !String(coord.email || '').trim()) {
    return { scope: 'coordinator', message: PLACEMENT_MESSAGES.coordinator }
  }
  if (!rot.start_date || !rot.end_date) {
    return { scope: 'rotation', message: PLACEMENT_MESSAGES.rotationRequired }
  }
  if (rot.end_date <= rot.start_date) {
    return { scope: 'rotation', message: PLACEMENT_MESSAGES.rotationOrder }
  }
  const invalid = rows.find(r => !String(r.first_name || '').trim() || !String(r.last_name || '').trim() || !String(r.email || '').trim())
  if (invalid) {
    return { scope: 'students', message: PLACEMENT_MESSAGES.studentsRequired }
  }
  const underMin = rows.find(r => (parseInt(r.hours_required) || 0) < MIN_HOURS_REQUIRED)
  if (underMin) {
    return {
      scope: 'students',
      message: `Hours required must be at least ${MIN_HOURS_REQUIRED} for all students. Check the entry for ${underMin.first_name || 'a student'} ${underMin.last_name || ''}.`,
    }
  }
  if (!cohortId) {
    return { scope: 'cohort', message: PLACEMENT_MESSAGES.cohortClosed }
  }
  return null
}

// Non-blocking soft warnings shown in a confirm step before submit. `today` is passed in (the caller
// supplies its locale-aware today), so this stays pure and free of any date/timezone dependency.
export function collectPlacementSoftWarnings({ rotation, students }, today) {
  const rot = rotation || {}
  const rows = students || []
  const warnings = []

  if (rot.start_date && today && rot.start_date < today) {
    warnings.push('The rotation start date is in the past.')
  }
  if (rot.start_date && rot.end_date) {
    const diffDays = (new Date(rot.end_date) - new Date(rot.start_date)) / 86400000
    const weeks = Math.round(diffDays / 7)
    if (diffDays > 0 && (weeks < 4 || weeks > 16)) {
      warnings.push(`The rotation length is ${weeks} week${weeks !== 1 ? 's' : ''}, outside the typical 4-16 week range.`)
    }
  }
  rows.forEach(r => {
    if (r.estimated_graduation_date && rot.end_date && r.estimated_graduation_date < rot.end_date) {
      warnings.push(`${String(r.first_name || '').trim()} ${String(r.last_name || '').trim()}: estimated graduation date is before the rotation end date.`)
    }
  })
  return warnings
}

// The canonical request body. Identical shape for both surfaces. Coordinator name/email/notes are
// carried as form data (contact info). The authenticated endpoint re-derives and re-validates the
// school and cohort SERVER-SIDE and never trusts these values for authorization.
export function buildPlacementBody({ cohortId, cohortName, coordinator, rotation, availability, students }) {
  const av = availability || {}
  return {
    cohortId,
    cohortName,
    coordinator: {
      school: String(coordinator?.school || '').trim(),
      name: String(coordinator?.name || '').trim(),
      email: String(coordinator?.email || '').trim(),
      notes: String(coordinator?.notes || '').trim(),
    },
    rotationStartDate: rotation?.start_date || '',
    rotationEndDate: rotation?.end_date || '',
    availability: {
      unavailable_weekdays: av.unavailable_weekdays,
      min_days_per_week: av.min_days_per_week,
      weekends_allowed: av.weekends_allowed,
      nights_allowed: av.nights_allowed,
      blackout_dates: av.blackout_dates,
      scheduling_notes: av.scheduling_notes,
    },
    students: (students || []).map(r => ({
      first_name: String(r.first_name || '').trim(),
      last_name: String(r.last_name || '').trim(),
      email: String(r.email || '').trim(),
      phone: String(r.phone || '').trim(),
      program_type: r.program_type,
      hours_required: r.hours_required,
      estimated_graduation_date: r.estimated_graduation_date || null,
    })),
  }
}

// Submit-button label, pluralized. `Submit 1 Student` / `Submit 3 Students`.
export function placementSubmitLabel(count) {
  return `Submit ${count} Student${count !== 1 ? 's' : ''}`
}
