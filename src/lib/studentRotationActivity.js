import { supabase } from './supabase.js'
export {
  ACTIVE_LOG_LIFECYCLES,
  isVisibleShiftLog,
  reconcileStudentRotationActivity,
  groupStudentActivityByDate,
} from './studentRotationActivityCore.js'

async function portalRequest(path, options = {}) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) return { ok: false, error: 'unauthorized' }
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, error: body.error || `http_${response.status}` }
    return { ok: true, ...body }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export function fetchMyRotationActivity() {
  return portalRequest('/api/portal/my-rotation-activity')
}

export function saveMyPlannedShift({ planId = null, studentId, shiftDate, preceptorName }) {
  return portalRequest('/api/portal/my-rotation-activity', {
    method: 'POST',
    body: JSON.stringify({
      action: planId ? 'update' : 'create',
      ...(planId ? { plan_id: planId } : { student_id: studentId }),
      shift_date: shiftDate,
      preceptor_name: preceptorName,
    }),
  })
}

export function cancelMyPlannedShift(planId) {
  return portalRequest('/api/portal/my-rotation-activity', {
    method: 'POST',
    body: JSON.stringify({ action: 'cancel', plan_id: planId }),
  })
}
