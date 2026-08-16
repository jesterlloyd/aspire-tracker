// api/portal/unit-student-detail.js
//
// UL-PORTAL: the approved detail view for ONE scoped student.
//
// WHY THIS IS A SEPARATE ENDPOINT, AND NOT MORE COLUMNS ON THE ROSTER.
// The roster returns every student in every assigned unit on every page load. Work
// email, personal email, and phone are approved for a Unit Leader to SEE, but they
// do not belong in a bulk payload that the browser holds for the whole session just
// so a drawer can read them later. Sending contact details only when a Unit Leader
// actually opens one student keeps the blast radius of any future roster leak to
// operational fields, and makes each contact-detail read an authorized, auditable
// act against a single student id.
//
// AUTHORIZATION: authorizeStudentForUnitLeader is the single fail-closed gate. The
// unit is derived from the student's own placement, never from the request, so a
// caller cannot name a unit to widen anything. Out of scope, outside the visible
// lifecycle, and nonexistent are all indistinguishable: 404 with no detail.
//
// EXCLUDED BY CONSTRUCTION, not by filtering. This handler never queries interview
// rubrics, readiness survey answers, certificates, uploaded onboarding documents,
// internal staff notes, or the support_needed narrative. The shift-log query below
// selects two columns, and the note column is not one of them.
//
// FILES: this endpoint returns only BOOLEAN availability for the photo and resume.
// It never returns a path, a public URL, or a signed URL. The bytes are reachable
// only through api/portal/unit-student-file-access.js, which mints a short-lived
// signed URL against the private bucket.

import {
  verifyPortalUnitLeaderCaller,
  authorizeStudentForUnitLeader,
} from '../lib/unitLeaderScope.js'
import { parseStoredFileRef } from '../../lib/server/studentFiles.js'
import { normalizeAssignedShift } from '../lib/normalizeAssignedShift.js'

// Display order for a student's active assignments: Primary, then Secondary, then Coverage.
const ROLE_ORDER = { primary: 0, secondary: 1, coverage: 2 }

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// The coordinator-owned rotation row is the canonical window. This sentinel means
// "pending admin review" and must never be rendered as a real date.
const ROTATION_SENTINEL = '1900-01-01'

/** True when the stored reference resolves to a real object in the private bucket. */
function hasFile(stored) {
  const ref = parseStoredFileRef(stored)
  return ref.kind !== 'empty' && ref.kind !== 'unknown'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
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
  // Fail closed, and non-enumerating.
  if (!decision.allowed) return res.status(404).json({ error: 'not_found' })

  const s = decision.student

  // Cohort name, the canonical rotation window, the confirmed preceptor, and a
  // bounded attendance rollup. Each is a narrow read for this one student.
  const [cohort, rotation, preceptor, attendance] = await Promise.all([
    loadCohort(db, s.cohort_id),
    loadRotation(db, s.cohort_school_rotation_id),
    loadPreceptor(db, s.id),
    loadAttendance(db, s.id),
  ])

  return res.status(200).json({
    student: {
      id: s.id,
      first_name: s.first_name,
      preferred_first_name: s.preferred_first_name,
      last_name: s.last_name,
      school: s.school,
      cohort,
      unit_key: decision.unitKey,
      bucket: decision.bucket,
      // Canonical window first; the legacy free-text column is a labelled fallback
      // so a Unit Leader is never shown a date range the coordinator did not set.
      rotation,
      // DEPLOYED shift: the primary preceptor's canonical shift_type (Day/Night/Mid),
      // never the student's shift_availability preference.
      shift: preceptor.shift || null,
      hours: {
        required: s.hours_required ?? null,
        approved: s.approved_hours ?? 0,
        pending: s.pending_hours ?? 0,
      },
      attendance,
      preceptor_name: preceptor.name || s.preceptor_name || null,
      // Every active assignment (Primary, Secondary, Coverage) with role and dates.
      preceptors: preceptor.assignments,
      school_email: s.school_email || null,
      personal_email: s.personal_email || null,
      phone: s.phone || null,
      // Availability only. No path, no URL, signed or otherwise.
      has_photo: hasFile(s.headshot_url),
      has_resume: hasFile(s.resume_url),
    },
  })
}

async function loadCohort(db, cohortId) {
  if (!cohortId) return null
  const { data } = await db
    .from('cohorts').select('id, name, start_date, end_date').eq('id', cohortId).maybeSingle()
  return data || null
}

/**
 * The canonical rotation window, or a labelled legacy fallback.
 * Returns { source: 'canonical', start, end } | { source: 'legacy', text } | null.
 * The sentinel is treated as "not set", never as a date.
 */
async function loadRotation(db, rotationId) {
  if (!rotationId) return null
  const { data } = await db
    .from('cohort_school_rotations')
    .select('rotation_start_date, rotation_end_date')
    .eq('id', rotationId)
    .maybeSingle()
  if (!data) return null
  const { rotation_start_date: start, rotation_end_date: end } = data
  if (!start || !end || start === ROTATION_SENTINEL || end === ROTATION_SENTINEL) return null
  return { source: 'canonical', start, end }
}

/**
 * Every active assignment for the student, mirroring the roster resolution exactly:
 * active rows only, sorted Primary, Secondary, Coverage. NOT maybeSingle, because a
 * student may legitimately hold more than one active assignment.
 *
 * Returns { name, shift, assignments }: name is the primary (or first) preceptor for the
 * single-preceptor projection; shift is the PRIMARY preceptor's canonical shift_type
 * normalized to Day/Night/Mid (never the student's shift_availability preference);
 * assignments is the full [{ name, role, start_date, end_date }] set.
 */
async function loadPreceptor(db, studentId) {
  const { data } = await db
    .from('student_preceptor_assignments')
    .select('role, status, start_date, end_date, preceptors ( full_name, shift_type )')
    .eq('student_id', studentId)
    .eq('status', 'active')
  const assignments = []
  let primaryShift = null
  for (const a of data || []) {
    const name = a.preceptors?.full_name || null
    if (!name) continue
    assignments.push({ name, role: a.role, start_date: a.start_date || null, end_date: a.end_date || null })
    if (a.role === 'primary') primaryShift = a.preceptors?.shift_type || null
  }
  assignments.sort((x, y) => (ROLE_ORDER[x.role] ?? 9) - (ROLE_ORDER[y.role] ?? 9))
  const name = assignments.find(a => a.role === 'primary')?.name || assignments[0]?.name || null
  return { name, shift: normalizeAssignedShift(primaryShift), assignments }
}

/**
 * Attendance rollup: how many shifts are on record and when the most recent one was.
 *
 * Deliberately NOT filtered by review status. The status vocabulary on this table is
 * mixed and the roster does not depend on it either, so a status filter here would be
 * a guess presented as a fact. Two columns are selected; the support narrative is not
 * one of them and cannot be reached from this shape.
 */
async function loadAttendance(db, studentId) {
  const { data, error } = await db
    .from('student_shift_logs')
    .select('shift_date')
    .eq('student_id', studentId)
    .neq('lifecycle_state', 'voided')
    .order('shift_date', { ascending: false })
    .limit(500)
  if (error || !data) return { shifts_recorded: 0, most_recent_shift: null }
  return {
    shifts_recorded: data.length,
    most_recent_shift: data[0]?.shift_date || null,
  }
}
