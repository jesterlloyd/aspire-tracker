// CSLINK-SERVICENOW-1: the ServiceNow items behind each CS-Link step, which Step 2 request a
// Cedars-Sinai status calls for, and what a tick writes. Read by the CS-Link Access table
// (AccessTab.jsx), the student side panel, and the two server paths that set a status from the
// student's own answer (student-intake-submit.js, portal/my-profile.js), so a changed URL or
// rule is a one-line fix here. Pure: no React, no browser APIs.

export const SERVICENOW_LINKS = {
  addNonEmployee:        'https://csmc.service-now.com/cssp?id=sc_cat_item&sys_id=de4e4ac81bcff91081329938b04bcb8b',
  updateNonEmployee:     'https://csmc.service-now.com/cssp?id=sc_cat_item&sys_id=6fd298331b36791081329938b04bcb62',
  reactivateNonEmployee: 'https://csmc.service-now.com/cssp?id=sc_cat_item&sys_id=6fd298331b36791081329938b04bcb62',
  csLinkRequest:         'https://csmc.service-now.com/cssp?id=sc_cart',
}

// The Step 2 requests, keyed by the cs_stage1_action value each one stores.
export const STAGE1_REQUESTS = {
  add_non_employee:    { label: 'Add Non-Employee',        href: SERVICENOW_LINKS.addNonEmployee },
  update_non_employee: { label: 'Update Non-Employee',     href: SERVICENOW_LINKS.updateNonEmployee },
  reactivate:          { label: 'Reactivate Non-Employee', href: SERVICENOW_LINKS.reactivateNonEmployee },
}

// Request types stored before CSLINK-SERVICENOW-1. Both were updates, so both read as Update.
const LEGACY_UPDATE_ACTIONS = ['assignment_change', 'extend_end_date']

// New to Cedars-Sinai gets Add; Former and Current Employee or Volunteer get Update and Reactivate.
export function stage1RequestsFor(cedarsStatus) {
  if (cedarsStatus === 'new') return ['add_non_employee']
  if (cedarsStatus === 'former' || cedarsStatus === 'employee') return ['update_non_employee', 'reactivate']
  return []
}

// Which Step 2 request is ticked: the stored action while Submitted is true.
export function tickedStage1Request(student) {
  if (!student?.cs_stage1_submitted) return null
  const action = student.cs_stage1_action
  if (LEGACY_UPDATE_ACTIONS.includes(action)) return 'update_non_employee'
  return STAGE1_REQUESTS[action] ? action : null
}

// An employee row auto-completed before employees went through Step 2. Left exactly as it was.
export const isLegacyNotApplicable = (student) => student?.cs_stage1_action === 'not_applicable'

// What choosing (or reporting) a Cedars-Sinai status resets. Every status starts at Step 2,
// unticked; employees and volunteers no longer skip Steps 2 and 3.
export function stage1ResetFor(cedarsStatus) {
  return {
    cs_stage1_action:    cedarsStatus === 'new' ? 'add_non_employee' : '',
    cs_stage1_submitted: false,
    cs_stage1_complete:  false,
  }
}

// Today as YYYY-MM-DD in the viewer's own time zone. Never toISOString(): that is UTC, which
// is already tomorrow in Los Angeles every evening.
export function todayIsoLocal(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export const CS_TICK_DATE_FIELD = {
  cs_stage1_submitted: 'cs_stage1_submitted_date',
  cs_stage1_complete:  'cs_stage1_complete_date',
  cs_link_requested:   'cs_link_requested_date',
  cs_link_complete:    'cs_link_complete_date',
}

// The fields a tick writes: the box, plus today's date when ticking a box whose date is empty.
// A date already there is kept (a re-tick restores it, and a legacy free-text value is never
// replaced); unticking never clears a date.
export function tickPatch(current, boolField, checked, now = new Date()) {
  const patch = { [boolField]: checked }
  const dateField = CS_TICK_DATE_FIELD[boolField]
  if (checked && dateField && !current?.[dateField]) patch[dateField] = todayIsoLocal(now)
  return patch
}
