// Shared, column-limited Student Portal summary builder. Authorization is
// performed by the calling endpoint; this module only resolves an already
// authorized student-id set into the portal-safe payload.

const STUDENT_COLUMNS = [
  'id', 'cohort_id', 'first_name', 'preferred_first_name', 'last_name',
  'school', 'status', 'unit', 'preceptor_name', 'term_dates',
  'hours_required', 'approved_hours', 'pending_hours',
  'headshot_url', 'phone', 'badge_created',
  // STUDENT-BADGE-1: the coordinator-owned rotation row feeds the badge dates.
  'cohort_school_rotation_id',
].join(', ')

const COHORT_COLUMNS = 'id, name, status, start_date, end_date'

export async function buildStudentPortalSummary(db, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return { students: [] }

  const { data: students, error: sErr } = await db
    .from('students')
    .select(STUDENT_COLUMNS)
    .in('id', studentIds)
  if (sErr) throw new Error('student_lookup_failed')

  const cohortIds = [...new Set((students || []).map(s => s.cohort_id).filter(Boolean))]
  let cohortsById = {}
  if (cohortIds.length > 0) {
    const { data: cohorts, error: cErr } = await db
      .from('cohorts')
      .select(COHORT_COLUMNS)
      .in('id', cohortIds)
    if (cErr) throw new Error('cohort_lookup_failed')
    cohortsById = Object.fromEntries((cohorts || []).map(c => [c.id, c]))
  }

  // STUDENT-BADGE-1: the student's own rotation window from cohort_school_rotations, the same
  // source the Unit Leader and Academic Partner rosters read; the 1900-01-01 sentinel resolves
  // to null. It feeds the badge dates (issued a week before the start, valid through the end
  // month) exactly as the staff badge tool computes them.
  const ROTATION_SENTINEL = '1900-01-01'
  const rotationIds = [...new Set((students || []).map(s => s.cohort_school_rotation_id).filter(Boolean))]
  const rotationById = {}
  if (rotationIds.length > 0) {
    const { data: rotations, error: rErr } = await db
      .from('cohort_school_rotations')
      .select('id, rotation_start_date, rotation_end_date')
      .in('id', rotationIds)
    if (!rErr && rotations) {
      for (const r of rotations) {
        const { rotation_start_date: start, rotation_end_date: end } = r
        rotationById[r.id] = (!start || !end || start === ROTATION_SENTINEL || end === ROTATION_SENTINEL) ? null : { start, end }
      }
    }
  }

  const assignmentsByStudent = {}
  const { data: assignments, error: aErr } = await db
    .from('student_preceptor_assignments')
    .select('student_id, role, status, start_date, preceptor_id, preceptors ( full_name )')
    .in('student_id', studentIds)
    .eq('status', 'active')
  if (!aErr && assignments) {
    for (const assignment of assignments) {
      const current = assignmentsByStudent[assignment.student_id]
      if (!current || assignment.role === 'primary') {
        assignmentsByStudent[assignment.student_id] = {
          role: assignment.role,
          preceptor_name: assignment.preceptors?.full_name || null,
        }
      }
    }
  }

  const unitsByStudent = {}
  const { data: unitRows, error: uErr } = await db
    .from('student_unit_assignments')
    .select('student_id, unit_key, role, status')
    .in('student_id', studentIds)
    .in('status', ['planned', 'active'])
  if (!uErr && unitRows) {
    for (const unit of unitRows) {
      const list = (unitsByStudent[unit.student_id] ||= [])
      if (unit.role === 'primary') list.unshift(unit.unit_key)
      else list.push(unit.unit_key)
    }
  }

  return {
    students: (students || []).map(student => ({
      id: student.id,
      first_name: student.first_name,
      preferred_first_name: student.preferred_first_name,
      last_name: student.last_name,
      school: student.school,
      status: student.status,
      headshot_url: student.headshot_url || null,
      phone: student.phone || null,
      badge_created: student.badge_created === true,
      unit_name: unitsByStudent[student.id]?.[0] || student.unit || null,
      unit_names: unitsByStudent[student.id] || [],
      preceptor_name: assignmentsByStudent[student.id]?.preceptor_name || student.preceptor_name || null,
      term_dates: student.term_dates || null,
      rotation: rotationById[student.cohort_school_rotation_id] || null,
      cohort: cohortsById[student.cohort_id]
        ? {
            id: cohortsById[student.cohort_id].id,
            name: cohortsById[student.cohort_id].name,
            status: cohortsById[student.cohort_id].status,
            start_date: cohortsById[student.cohort_id].start_date,
            end_date: cohortsById[student.cohort_id].end_date,
          }
        : null,
      hours: {
        required: student.hours_required ?? null,
        approved: student.approved_hours ?? 0,
        pending: student.pending_hours ?? 0,
      },
    })),
  }
}
