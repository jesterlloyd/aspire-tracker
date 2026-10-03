// lib/server/keith/studentPlacement.js
//
// KEITH-PLACEMENT-TRUTH-1 (Owner, 2026-10-03): a student's recorded placement, by name. Three reads keyed by the one
// student the caller is already allowed to see (the id pins the population). Each read is best
// effort: a failed one reads "Not recorded" for its part rather than failing the whole lookup.
const NOT_RECORDED = 'Not recorded'
export async function placementFor(supabase, student) {
  let assignedUnit = NOT_RECORDED
  if (student?.matched_unit_id) {
    const { data: u } = await supabase.from('units').select('unit_name').eq('id', student.matched_unit_id).maybeSingle()
    if (u?.unit_name) assignedUnit = u.unit_name
  }
  const { data: unitRows } = await supabase
    .from('student_unit_assignments')
    .select('unit_key, role, status')
    .eq('student_id', student.id)
    .in('status', ['planned', 'active'])
  const { data: preceptorRows } = await supabase
    .from('student_preceptor_assignments')
    .select('role, status, start_date, preceptors ( full_name )')
    .eq('student_id', student.id)
    .eq('status', 'active')
  const order = { primary: 0, secondary: 1, additional: 1, coverage: 2 }
  const byRole = (a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9)
  const unitAssignments = (unitRows || []).filter(r => r?.unit_key).sort(byRole).map(r => ({ unit: r.unit_key, role: r.role, status: r.status }))
  const preceptors = (preceptorRows || []).filter(r => r?.preceptors?.full_name).sort(byRole).map(r => ({ name: r.preceptors.full_name, role: r.role }))
  if (assignedUnit === NOT_RECORDED && unitAssignments[0]) assignedUnit = unitAssignments[0].unit
  return {
    assigned_unit: assignedUnit,
    unit_assignments: unitAssignments.length ? unitAssignments : NOT_RECORDED,
    preceptors: preceptors.length ? preceptors : (student?.matched_preceptor ? [{ name: student.matched_preceptor, role: 'primary' }] : NOT_RECORDED),
    note: 'This is the recorded placement. unit_preference_1/2/3 and a rubric\'s suggested_unit are what the student asked for or an interviewer suggested; they are NEVER the assignment.',
  }
}
