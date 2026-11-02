// lib/server/ngrpPlacementUnits.js
//
// PRECEPTED-UNITS-1 (Owner, 2026-11-02): the units an alumnus precepted on, by their placement
// record. Read by the Residency roster (ngrpApplicants.js) and the Student Portal's application
// profile (api/portal/my-residency.js). Its own file so the portal endpoint does not load the roster.
import { assignmentUnits } from '../../src/lib/ngrp/preceptedUnits.js'

// student id -> unit names from student_unit_assignments. A failed read (or the table missing)
// is an empty map: the roster then shows the primary placement alone, as it did before.
export async function placementUnitsByStudent(db, studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))]
  const out = new Map()
  if (!ids.length) return out
  try {
    const r = await db.from('student_unit_assignments').select('student_id, unit_key, role, status, start_date').in('student_id', ids)
    if (r.error) return out
    const grouped = new Map()
    for (const row of r.data || []) {
      if (!grouped.has(row.student_id)) grouped.set(row.student_id, [])
      grouped.get(row.student_id).push(row)
    }
    for (const [id, rows] of grouped) out.set(id, assignmentUnits(rows))
  } catch { /* the primary placement still shows */ }
  return out
}
