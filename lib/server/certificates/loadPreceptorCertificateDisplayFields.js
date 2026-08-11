// lib/server/certificates/loadPreceptorCertificateDisplayFields.js
//
// PRECEPTOR-CERT-1 - the ONE canonical resolver of the Certificate of
// Appreciation's dynamic display fields, shared by every download surface
// (tokenized preceptor download, Owner/Admin download). Read-only: it never
// creates a certificate, assigns a number, or touches certificate_sequences.
// Callers keep full ownership of authorization; this runs only AFTER the
// caller has resolved a preceptor_certificates row it is allowed to serve.
//
// Canonical sources (database state is authoritative; the template PDF is a
// rendering asset, never a data source):
//   - Preceptor name:  preceptors.full_name - the verified professional name.
//                      No credentials field exists in the model, so none are
//                      rendered; credentials are optional by product rule and
//                      never inferred from free text.
//   - Certificate ID:  preceptor_certificates.certificate_number, verbatim.
//   - Clinical unit:   units.unit_name via preceptors.unit_id (canonical),
//                      falling back to the stored preceptors.unit_name.
//   - Rotation dates:  cohort_school_rotations via the QUALIFYING assignment's
//                      student (students.cohort_school_rotation_id); the
//                      1900-01-01 sentinel and half-known windows resolve to
//                      null - the caller fails safe rather than guessing.
//   - Student/cohort:  the cohort label (cohorts.name + " Cohort") - data
//                      minimization: no student-identifying information is
//                      placed on the certificate.
//   - Issue date:      preceptor_certificates.certificate_unlocked_at.
//
// Returns { fields, missing }: `missing` lists required display values that
// could not be resolved canonically. A non-empty `missing` means the caller
// must surface a recoverable certificate-generation exception instead of
// producing an inaccurate certificate.

import { formatRotationDateRange, formatIssuedDate } from './certificateFields.js'

// db: a service-role supabase client. cert: the resolved preceptor_certificates
// row, needing preceptor_id, cohort_id, qualifying_assignment_id,
// certificate_number, certificate_unlocked_at.
export async function loadPreceptorCertificateDisplayFields(db, cert) {
  const [precRes, cohortRes, assignmentRes] = await Promise.all([
    db.from('preceptors').select('full_name, unit_id, unit_name').eq('id', cert.preceptor_id).maybeSingle(),
    db.from('cohorts').select('name').eq('id', cert.cohort_id).maybeSingle(),
    db.from('evaluation_assignments').select('student_id').eq('id', cert.qualifying_assignment_id).maybeSingle(),
  ])
  const prec = precRes.data
  if (!prec) return { fields: null, missing: ['preceptor'] }

  // Unit: canonical units row first, stored label second.
  let clinicalUnit = ''
  if (prec.unit_id) {
    const { data: unit } = await db.from('units').select('unit_name').eq('id', prec.unit_id).maybeSingle()
    clinicalUnit = (unit?.unit_name || '').trim()
  }
  if (!clinicalUnit) clinicalUnit = (prec.unit_name || '').trim()

  // Rotation window: the qualifying student's canonical rotation record.
  let rotationDates = null
  const studentId = assignmentRes.data?.student_id
  if (studentId) {
    const { data: student } = await db
      .from('students').select('cohort_school_rotation_id').eq('id', studentId).maybeSingle()
    if (student?.cohort_school_rotation_id) {
      const { data: rot } = await db
        .from('cohort_school_rotations')
        .select('rotation_start_date, rotation_end_date')
        .eq('id', student.cohort_school_rotation_id)
        .maybeSingle()
      // formatRotationDateRange returns null for the 1900-01-01 sentinel and
      // half-known windows - exactly the fail-safe contract we want.
      rotationDates = formatRotationDateRange(rot?.rotation_start_date, rot?.rotation_end_date)
    }
  }

  // Cohort label, e.g. "Fall 2026 Cohort" - stable forever, zero student PII.
  const cohortName = (cohortRes.data?.name || '').trim()
  const studentOrCohort = cohortName
    ? (/cohort$/i.test(cohortName) ? cohortName : `${cohortName} Cohort`)
    : null

  const preceptorName = (prec.full_name || '').trim()
  const issueDate = formatIssuedDate(cert.certificate_unlocked_at)

  const missing = []
  if (!preceptorName) missing.push('preceptor_name')
  if (!clinicalUnit) missing.push('clinical_unit')
  if (!rotationDates) missing.push('rotation_dates')
  if (!studentOrCohort) missing.push('student_or_cohort')
  if (!cert.certificate_number) missing.push('certificate_id')
  if (!issueDate) missing.push('issue_date')

  return {
    fields: {
      certificateId:   cert.certificate_number,
      preceptorName,
      clinicalUnit,
      rotationDates,
      studentOrCohort,
      issueDate,
    },
    missing,
  }
}
