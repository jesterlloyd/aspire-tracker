import { createPreceptorRequestIdController } from '../../lib/preceptorRequestId.js'

const ROLE_ORDER = { primary: 0, secondary: 1, coverage: 2 }
const ROLE_LABEL = { primary: 'Primary', secondary: 'Secondary', coverage: 'Coverage' }

export function collectStudentAssignments(roster, studentId) {
  const rows = []
  for (const preceptor of roster || []) {
    for (const assignment of preceptor.assignments || []) {
      if (assignment.student_id !== studentId) continue
      const role = String(assignment.role || '').toLowerCase()
      if (!(role in ROLE_ORDER)) continue
      rows.push({
        id: assignment.id,
        student_id: assignment.student_id,
        student_name: assignment.student_name,
        student_unit: assignment.student_unit,
        role,
        role_label: ROLE_LABEL[role],
        start_date: assignment.start_date || null,
        end_date: assignment.end_date || null,
        status: assignment.status,
        preceptor: {
          id: preceptor.id,
          full_name: preceptor.full_name,
          home_unit: preceptor.home_unit,
          shift: preceptor.shift,
        },
      })
    }
  }
  return rows.sort((a, b) =>
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    String(a.preceptor.full_name || '').localeCompare(String(b.preceptor.full_name || '')))
}

export function mutationIntentKey({ action, op, role, assignmentId, preceptorId }) {
  return [action, op || '', role || '', assignmentId || '', preceptorId || ''].join(':')
}

export function buildAssignmentMutationPayload({ action, op, role, studentId, assignmentId, preceptorId }, requestId) {
  if (action === 'change_primary') {
    return {
      action: 'change_primary',
      student_id: studentId,
      preceptor_id: preceptorId,
      request_id: requestId,
    }
  }
  const payload = {
    action: 'set_secondary',
    op,
    role,
    student_id: studentId,
    request_id: requestId,
  }
  if (assignmentId) payload.assignment_id = assignmentId
  if (preceptorId) payload.preceptor_id = preceptorId
  return payload
}

export function createUnitAssignmentMutationController({ mutate, requestIdsFactory } = {}) {
  const makeIds = requestIdsFactory || (() => createPreceptorRequestIdController())
  let activeKey = null
  let ids = null

  const forIntent = (intentKey) => {
    if (activeKey !== intentKey) {
      ids?.reset()
      activeKey = intentKey
      ids = makeIds()
    }
    return ids
  }

  return {
    async submit(intentKey, makePayload) {
      const lifecycle = forIntent(intentKey)
      const requestId = lifecycle.begin()
      if (!requestId) return { ok: false, error: 'submission_in_progress' }
      const result = await mutate(makePayload(requestId))
      if (result.ok) lifecycle.complete()
      else lifecycle.releaseForRetry()
      return result
    },
    reset() {
      ids?.reset()
      ids = null
      activeKey = null
    },
  }
}

export function assignmentErrorMessage(result) {
  if (result?.error === 'submission_in_progress') return 'This assignment change is already being submitted.'
  if (result?.status === 400) return 'The assignment request is incomplete, or the selected preceptor is no longer active.'
  if (result?.status === 403) return 'This assignment cannot be changed. Completed rotations are locked after the 90-day Unit Leader window.'
  if (result?.status === 404) return 'This student or assignment is no longer available in your authorized scope.'
  if (result?.status === 409) return 'The assignment changed, is already active, or conflicts with another request. Refresh and try again.'
  return 'The assignment could not be changed. Please try again.'
}

export function assignmentSuccessMessage(result, role) {
  const label = ROLE_LABEL[role] || 'Preceptor'
  const oldName = result?.old_preceptor_name
  const newName = result?.new_preceptor_name
  const action = result?.action || ''
  if (action.startsWith('end_')) return `${label} assignment for ${oldName || 'the selected preceptor'} ended.`
  if (action.startsWith('add_')) return `${label} added: ${newName || 'assignment updated'}.`
  if (oldName && newName) return `${label} changed from ${oldName} to ${newName}.`
  if (newName) return `${label} assigned: ${newName}.`
  return `${label} assignment updated.`
}

// The current endpoints do not expose the backend's authoritative completion
// timestamp. Only an explicit server-derived flag is reliable enough to lock the UI;
// otherwise the existing RPC remains the authority and a late MS403 is handled above.
export function assignmentWindowIsClosed(student) {
  return student?.assignment_window_closed === true
}
