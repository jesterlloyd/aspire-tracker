// src/lib/studentUnitAssignmentsApi.js
//
// MULTI-UNIT-STUDENT-PLACEMENTS-2: client access to a student's unit
// assignments. READS go straight through supabase-js under RLS (Owner/Admin
// SELECT policy on student_unit_assignments); every WRITE goes through the
// server endpoint, which re-verifies authority and refuses when the sync
// migration is missing ('migration_required').

import { supabase } from './supabase'

/** All assignment rows for a student, primary first, then newest first. */
export async function listStudentUnitAssignments(studentId) {
  const { data, error } = await supabase
    .from('student_unit_assignments')
    .select('id, unit_id, unit_key, role, status, start_date, end_date, notes, ended_at, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message, assignments: [] }
  const rows = [...(data || [])].sort((a, b) => {
    const liveRank = (r) => (r.status === 'active' ? 0 : r.status === 'planned' ? 1 : 2)
    const roleRank = (r) => (r.role === 'primary' ? 0 : 1)
    return liveRank(a) - liveRank(b) || roleRank(a) - roleRank(b)
  })
  return { ok: true, assignments: rows }
}

/** POST an action to the management endpoint. Returns { ok, error?, ... }. */
export async function manageStudentUnitAssignment(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return { ok: false, error: 'session_expired' }
    const res = await fetch('/api/student-unit-assignments-manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: data?.error || `http_${res.status}`, detail: data?.detail }
    return { ok: true, ...data }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}
