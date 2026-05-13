export async function updateStudent(studentId, fields) {
  const res = await fetch('/api/student-update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'update', student_id: studentId, fields }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Update failed')
  return data.data
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
