// api/portal/unit-student-shifts.js
//
// UL-PORTAL: role-safe logged shifts + clinical-hours totals for ONE student, for the Clinical
// Hours section of the Unit Leader student profile drawer.
//
// AUTHORIZATION. verifyPortalUnitLeaderCaller then authorizeStudentForUnitLeader re-derive the
// caller's active unit scope and confirm the SELECTED student is inside it, on THIS request.
// The student id is an identifier, not authority: an out-of-scope (or non-existent) id answers
// 404, non-enumerating. The fact that a student appeared in On Campus Now is never trusted.
//
// THE FIELD ALLOWLIST IS THE POINT. student_shift_logs carries private free text a Unit Leader
// must never receive: support_needed (the private support narrative), learning_highlight (the
// student's own reflection), review_reason, unit_override_reason, preceptor_override_note,
// admin_notes, reviewed_by/reviewed_at, exception_flags. SAFE_COLUMNS is an explicit allowlist,
// so a column added later is excluded by default. Totals come from the authorized student
// record (hours_required / approved_hours / pending_hours), the same canonical source the
// staff profile uses.

import {
  verifyPortalUnitLeaderCaller,
  authorizeStudentForUnitLeader,
} from '../lib/unitLeaderScope.js'

const MAX_ROWS = 500

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// Explicit allowlist. Quantitative + status only; never a free-text or internal-review column.
const SAFE_COLUMNS = ['id', 'shift_date', 'total_hours', 'unit_name', 'preceptor_name', 'shift_type', 'status'].join(', ')

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

  const { db, scopes } = auth
  const studentId = typeof req.query?.student_id === 'string' ? req.query.student_id : null
  if (!isUuid(studentId)) return res.status(400).json({ error: 'invalid_student_id' })

  let decision
  try {
    decision = await authorizeStudentForUnitLeader(db, scopes, studentId)
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }
  if (!decision.allowed) return res.status(404).json({ error: 'not_found' })

  const s = decision.student
  const { data, error } = await db
    .from('student_shift_logs')
    .select(SAFE_COLUMNS)
    .eq('student_id', studentId)
    // STUDENT-SHIFT-LOG-MANAGEMENT-1: withdrawn entries count toward nothing
    // and are not shown on this role-scoped surface.
    .neq('lifecycle_state', 'voided')
    .order('shift_date', { ascending: false })
    .limit(MAX_ROWS)
  if (error) return res.status(500).json({ error: 'internal_error' })

  const shifts = (data || []).map(r => ({
    id: r.id,
    shift_date: r.shift_date,
    total_hours: r.total_hours ?? null,
    unit_name: r.unit_name || null,
    preceptor_name: r.preceptor_name || null,
    shift_type: r.shift_type || null,
    status: r.status || null,
  }))

  return res.status(200).json({
    hours: {
      required: s.hours_required ?? null,
      approved: s.approved_hours ?? 0,
      pending: s.pending_hours ?? 0,
    },
    shifts,
  })
}
