// lib/server/certificates/loadCertificateDisplayFields.js
//
// ASPIRE-CERT-COMPLETION-TEMPLATE-1 - the ONE canonical resolver of the Certificate of
// Completion's dynamic display fields, shared by all three download endpoints (student portal,
// tokenized, Owner/Admin). Read-only: it never creates a certificate, assigns a number, or
// touches certificate_sequences. Callers keep full ownership of authorization; this runs only
// AFTER the caller has resolved an issued, unlocked certificates row it is allowed to serve.
//
// Canonical sources:
//   - Student name:   students.first_name / preferred_first_name / last_name via
//                     getStudentPreferredFullName (same resolution the app uses everywhere)
//   - Certificate ID: certificates.certificate_number, passed through verbatim
//   - Clinical unit:  units.unit_name via students.matched_unit_id (the single canonical
//                     matched unit; the data model has no multi-unit assignment)
//   - Rotation dates: cohort_school_rotations via students.cohort_school_rotation_id;
//                     the 1900-01-01 sentinel and half-known windows render as "-"
//   - Hours:          evaluation_assignments.approved_hours_at_completion for the gating
//                     assignment (the approved-hours snapshot frozen when the student
//                     completed the certificate-gating survey), falling back to the live
//                     students.approved_hours only when the snapshot is absent
//   - Issued date:    certificates.certificate_unlocked_at (never rotation end or download date)

import { getStudentPreferredFullName } from '../../../src/lib/studentNameFormatters.js'
import { formatRotationDateRange, formatHoursCompleted, formatIssuedDate } from './certificateFields.js'

// db: a service-role supabase client. cert: the resolved certificates row, needing
// student_id, certificate_number, certificate_unlocked_at, evaluation_assignment_id.
// Returns the display-field bundle, or null when the student row is missing.
export async function loadCertificateDisplayFields(db, cert) {
  const { data: student, error: studentErr } = await db
    .from('students')
    .select('first_name, last_name, preferred_first_name, matched_unit_id, cohort_school_rotation_id, approved_hours')
    .eq('id', cert.student_id)
    .single()
  if (studentErr || !student) return null

  const [unitRes, rotationRes, assignmentRes] = await Promise.all([
    student.matched_unit_id
      ? db.from('units').select('unit_name').eq('id', student.matched_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    student.cohort_school_rotation_id
      ? db.from('cohort_school_rotations').select('rotation_start_date, rotation_end_date')
          .eq('id', student.cohort_school_rotation_id).maybeSingle()
      : Promise.resolve({ data: null }),
    cert.evaluation_assignment_id
      ? db.from('evaluation_assignments').select('approved_hours_at_completion')
          .eq('id', cert.evaluation_assignment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const rotation = rotationRes.data || null
  const snapshotHours = assignmentRes.data?.approved_hours_at_completion

  return {
    studentName: getStudentPreferredFullName(student),
    lastName: student.last_name,
    certificateNumber: cert.certificate_number,
    clinicalUnit: unitRes.data?.unit_name || null,
    rotationDates: rotation
      ? formatRotationDateRange(rotation.rotation_start_date, rotation.rotation_end_date)
      : null,
    hoursCompleted: formatHoursCompleted(
      snapshotHours !== null && snapshotHours !== undefined ? snapshotHours : student.approved_hours
    ),
    issuedDate: formatIssuedDate(cert.certificate_unlocked_at),
  }
}
