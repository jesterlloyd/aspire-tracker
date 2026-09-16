// Shared, column-limited Student Portal summary builder. Authorization is
// performed by the calling endpoint; this module only resolves an already
// authorized student-id set into the portal-safe payload.

// STUDENT-PORTAL-PRECEPTOR-CONTACT-1: shared pure rules for the preceptor
// contact rows and the Connect unit leadership copied on Email Preceptor.
import { orderPreceptorContacts } from '../../src/lib/placementContacts.js'
import { selectUnitLeadershipCc } from '../../src/lib/placementLeadership.js'

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
  const assignmentRowsByStudent = {}
  const { data: assignments, error: aErr } = await db
    .from('student_preceptor_assignments')
    .select('student_id, role, status, start_date, preceptor_id, preceptors ( id, full_name, email, phone )')
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
      ;(assignmentRowsByStudent[assignment.student_id] ||= []).push({
        role: assignment.role,
        preceptor: assignment.preceptors,
      })
    }
  }

  // STUDENT-PORTAL-PRECEPTOR-CONTACT-1: a preceptor row without a phone takes
  // the phone from its ASPIRE Connect profile (the contact with the same email).
  // Only the student's own active preceptors are looked up.
  // Both the stored spelling and its lowercase form are matched: Connect keeps
  // mixed-case addresses, and PostgREST's in() filter is case-sensitive.
  const preceptorEmails = [...new Set(Object.values(assignmentRowsByStudent).flat()
    .map(r => String(r.preceptor?.email || '').trim()).filter(Boolean)
    .flatMap(e => [e, e.toLowerCase()]))]
  const profilePhoneByEmail = {}
  if (preceptorEmails.length > 0) {
    const { data: profiles, error: pErr } = await db
      .from('contacts')
      .select('email, phone')
      .in('email', preceptorEmails)
      .not('phone', 'is', null)
    if (!pErr && profiles) {
      for (const c of profiles) {
        const key = String(c.email || '').trim().toLowerCase()
        if (key && c.phone && !profilePhoneByEmail[key]) profilePhoneByEmail[key] = c.phone
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

  // STUDENT-PORTAL-PRECEPTOR-CONTACT-1: ASPIRE Connect Unit Leader contacts are
  // the leadership source (not the legacy unit_leaders table). One read for the
  // whole student set; selectUnitLeadershipCc narrows it to each student's own
  // unit(s) and to AD / ANM / NPD-P / CNS titles, exposing name, title, email.
  let leadershipContacts = []
  if ((students || []).length > 0) {
    const { data: leaders, error: lErr } = await db
      .from('contacts')
      .select('full_name, preferred_name, category, role, email, unit_name, related_units, is_active')
      .in('category', ['Unit Leader', 'Unit Leadership'])
      .eq('is_active', true)
    if (!lErr && leaders) leadershipContacts = leaders
  }
  const studentUnits = (student) => (unitsByStudent[student.id]?.length
    ? unitsByStudent[student.id]
    : [student.unit].filter(Boolean))

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
      preceptors: orderPreceptorContacts(assignmentRowsByStudent[student.id], profilePhoneByEmail),
      unit_leadership: selectUnitLeadershipCc(leadershipContacts, studentUnits(student)),
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
