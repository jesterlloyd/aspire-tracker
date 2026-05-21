// loadedUpdatedAt — optional OCC guard: the updated_at value the caller had when
// they last loaded this student.  When supplied, the API adds
// .eq('updated_at', loadedUpdatedAt) to the WHERE clause; a 409 response means
// another user (or tab) saved while this user was editing.
export async function updateStudent(studentId, fields, loadedUpdatedAt) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action: 'update',
      student_id: studentId,
      fields,
      loaded_updated_at: loadedUpdatedAt || null,
    }),
  })
  const data = await res.json()
  if (res.status === 409) {
    const err = new Error('CONFLICT')
    err.conflict = true
    err.currentUpdatedAt = data.current_updated_at
    throw err
  }
  if (!res.ok) throw new Error(data.error || 'Update failed')
  return data.data  // full updated row including fresh updated_at
}

export async function updateStudentStatus(studentId, status, declineReason) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'update_status', student_id: studentId, status, decline_reason: declineReason || null }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Status update failed')
  return data.data
}

export async function logStudentEvent(studentId, cohortId, eventType, notes, createdBy) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'log_event', student_id: studentId, cohort_id: cohortId, event_type: eventType, notes: notes || '', created_by: createdBy || 'System' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Event log failed')
  return true
}
