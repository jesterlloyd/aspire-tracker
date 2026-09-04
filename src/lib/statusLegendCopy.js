// STATUS-LEGEND-AUDIENCE-1: audience-aware copy for the ONE canonical ASPIRE
// Status Legend (StatusLegendPopover). The status NAMES, colors, and ordering
// are canonical everywhere; only the explanatory DESCRIPTIONS adapt to who is
// reading - staff (main app), Academic Partners, Unit Leaders, and Nursing
// Education and Leadership.
//
// Descriptions are keyed BY STATUS VALUE, never by list position: the old
// positional array silently mis-paired descriptions if the status order ever
// changed. External audiences carry no internal workflow terms (no rubric, no
// formal disposition, no Action Center, no Phase 4, no review/moderation
// language). Pure data, no React - node tests import this module directly.

export const LEGEND_TITLE = 'ASPIRE Status Legend'
export const LEGEND_INTRO = 'Follow each student’s progress through the ASPIRE pathway.'

export const LEGEND_AUDIENCES = ['staff', 'academic_partner', 'unit_leader', 'nursing_academic']

// ── Lifecycle status descriptions ────────────────────────────────────────────
const STAFF_STATUS_DESCRIPTIONS = {
  'Pending Outreach':    'The student is listed in the cohort, but ASPIRE outreach has not started.',
  'Form Sent':           'The Student Profile Form has been sent and is awaiting completion.',
  'Form Received':       'The completed Student Profile Form has been received. The student is ready for interview scheduling.',
  'Interview Scheduled': 'An interview appointment has been selected or assigned.',
  'Interviewed':         'The interview is complete, and the result is being reviewed or has been recorded.',
  'Placed':              'The student has been matched with a clinical unit and is preparing to begin the rotation.',
  'Active Rotation':     'The student is currently completing the ASPIRE clinical rotation.',
  'Completed':           'The student has finished the rotation and is completing any remaining evaluation or certificate steps.',
}

// External-facing: plain language, no internal review terminology.
const ACADEMIC_PARTNER_STATUS_DESCRIPTIONS = {
  ...STAFF_STATUS_DESCRIPTIONS,
  'Interviewed': 'The interview is complete, and the result is being finalized or has been recorded.',
  'Completed':   'The student has completed the rotation and may still have final evaluation or certificate steps remaining.',
}

// Placement- and rotation-focused; earlier pathway statuses keep the concise
// canonical copy for continuity.
const UNIT_LEADER_STATUS_DESCRIPTIONS = {
  ...STAFF_STATUS_DESCRIPTIONS,
  'Interviewed': 'The interview is complete, and the student is awaiting or has received a placement decision.',
}

// Nursing Education and Leadership (the NEL portal's Community Benefit report): internal
// Cedars-Sinai leadership reading a fiscal view, so the neutral placement-focused copy,
// with no Action Center reference (a main-app concept they do not use).
const NURSING_ACADEMIC_STATUS_DESCRIPTIONS = UNIT_LEADER_STATUS_DESCRIPTIONS

export const STATUS_DESCRIPTIONS_BY_AUDIENCE = {
  staff: STAFF_STATUS_DESCRIPTIONS,
  academic_partner: ACADEMIC_PARTNER_STATUS_DESCRIPTIONS,
  unit_leader: UNIT_LEADER_STATUS_DESCRIPTIONS,
  nursing_academic: NURSING_ACADEMIC_STATUS_DESCRIPTIONS,
}

// ── Not Proceeding ───────────────────────────────────────────────────────────
// One shared sentence for every audience: the general status plus the fact
// that a more specific outcome may display instead. Internal "formal
// disposition" phrasing stays out of user-facing copy entirely.
export const NOT_PROCEEDING_DESCRIPTION =
  'The student is no longer moving forward in the ASPIRE pathway. A more specific outcome may appear instead of this general status.'

// ── Status color meanings ────────────────────────────────────────────────────
// Color is a supporting signal, never the only signal; every legend row pairs
// the swatch with its label and text. Only the amber row differs by audience:
// staff may reference the Action Center (a main-app concept), Academic
// Partners get the school-facing phrasing, Unit Leaders the neutral one.
const COLOR_ROWS = [
  { key: 'neutral',     label: 'Neutral',     color: '#f9fafb', border: '#e5e7eb', dot: '#9ca3af' },
  { key: 'amber',       label: 'Amber',       color: '#fef3c7', border: '#fcd34d', dot: '#f59e0b' },
  { key: 'red',         label: 'Red',         color: '#fee2e2', border: '#fca5a5', dot: '#dc1e34' },
  { key: 'light_green', label: 'Light Green', color: '#dcfce7', border: '#86efac', dot: '#16a34a' },
  { key: 'solid_green', label: 'Solid Green', color: '#d1fae5', border: '#6ee7b7', dot: '#065f46' },
  { key: 'indigo',      label: 'Indigo',      color: '#e0e7ff', border: '#a5b4fc', dot: '#1D2567' },
  { key: 'muted_red',   label: 'Muted Red',   color: '#fdf2f8', border: '#fbcfe8', dot: '#9d174d' },
]

const SHARED_COLOR_DESCRIPTIONS = {
  neutral:     'The student is in an early stage of the pathway. No urgent issue is identified.',
  red:         'A time-sensitive concern, blocker, or risk requires attention.',
  light_green: 'The student has been placed and is preparing to begin the rotation.',
  solid_green: 'The student is actively completing the rotation.',
  indigo:      'The student has completed the ASPIRE rotation.',
  muted_red:   'The student is no longer moving forward in the pathway.',
}

const COLOR_DESCRIPTIONS_BY_AUDIENCE = {
  staff: {
    ...SHARED_COLOR_DESCRIPTIONS,
    amber: 'Follow-up may be needed. An action item is pending in the Action Center.',
  },
  academic_partner: {
    ...SHARED_COLOR_DESCRIPTIONS,
    amber: 'The student may need follow-up from the student, school, or ASPIRE team.',
  },
  unit_leader: {
    ...SHARED_COLOR_DESCRIPTIONS,
    amber: 'Follow-up may be needed.',
  },
  nursing_academic: {
    ...SHARED_COLOR_DESCRIPTIONS,
    amber: 'Follow-up may be needed.',
  },
}

// Color rows with the audience's description attached.
export function legendColorRows(audience) {
  const descriptions = COLOR_DESCRIPTIONS_BY_AUDIENCE[audience] || COLOR_DESCRIPTIONS_BY_AUDIENCE.staff
  return COLOR_ROWS.map(row => ({ ...row, description: descriptions[row.key] }))
}
