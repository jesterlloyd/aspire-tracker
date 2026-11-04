// The Student Portal invitation, as Settings > Users & Access sends it (/api/invite-portal-user,
// role student). Shared by Residency's Add Alumnus and Student Profiles' + Add
// (RESIDENCY-PROFILES-TOOLBAR-1), so the two cannot drift.
import { supabase } from './supabase'

export async function sendStudentPortalInvite({ studentId, email, fullName }) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/invite-portal-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ role: 'student', email, full_name: fullName, student_id: studentId }),
  })
  return res.status === 200 || res.status === 201 ? { ok: true } : { ok: false, status: res.status }
}
