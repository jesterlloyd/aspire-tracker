// lib/server/ngrpApplicantProfile.js
//
// RESIDENCY-APPLICANT-PROFILE-1 (Owner, 2026-10-05): the applicant chart's Profile sheet shows
// the alumnus's Contact Information and Personal Information, the same two sections as Student
// Profiles' Profile sheet. The residency roster strips emails to `has_email` on purpose
// (sanitizeStudent), so these details travel only on this one-alumnus read, asked for when a
// chart opens.
//
// Who sees what:
//   - The ASPIRE team: contact and personal details. Editing is decided by the same gates
//     /api/student-update applies: contact by student_manage, personal by admin level.
//   - Talent Acquisition: names always; contact details only once the alumnus has SUBMITTED
//     the Transition Form, which is where they consent to sharing with Talent Acquisition
//     (consent_hr_share). Never date of birth, gender or GPA, and never an edit.
// The last four of the SSN is not on this read for anyone: the residency has no use for it.
import { can, isAdminLevel } from './access.js'
import { fetchSourceCohortsForCycles, isMissingNgrpTable } from './ngrpApplicants.js'
import { TALENT_ACQUISITION } from './ngrpTalentAcquisition.js'

const STUDENT_FIELDS =
  'id, cohort_id, status, first_name, last_name, preferred_first_name, ' +
  'school_email, personal_email, phone, date_of_birth, gender, cumulative_gpa'

// Pure: what one caller may see of one alumnus. Exported for tests.
export function shapeApplicantProfile(student, { audience, profile = null, consented = false } = {}) {
  const names = {
    id: student.id,
    first_name: student.first_name || '',
    last_name: student.last_name || '',
    preferred_first_name: student.preferred_first_name || '',
  }
  const contact = {
    school_email: student.school_email || '',
    personal_email: student.personal_email || '',
    phone: student.phone || '',
  }
  if (audience === TALENT_ACQUISITION) {
    return {
      student: consented ? { ...names, ...contact } : names,
      contactShared: consented,
      personal: false,
      editable: { contact: false, personal: false },
    }
  }
  return {
    student: {
      ...names, ...contact,
      date_of_birth: student.date_of_birth || '',
      gender: student.gender || '',
      cumulative_gpa: student.cumulative_gpa ?? null,
    },
    contactShared: true,
    personal: true,
    editable: { contact: can(profile, 'student_manage'), personal: isAdminLevel(profile) },
  }
}

// { state: 'ok', ...shape } | { state: 'not_found' | 'unprovisioned' | 'error' }
export async function loadApplicantProfile(db, { cycleId, studentId, audience, profile }) {
  const stu = await db.from('students').select(STUDENT_FIELDS).eq('id', studentId).maybeSingle()
  if (stu.error) return { state: 'error' }
  // Only an alumnus on THIS residency cohort's roster: Completed, from one of its source cohorts.
  if (!stu.data || stu.data.status !== 'Completed') return { state: 'not_found' }
  const mapped = await fetchSourceCohortsForCycles(db, [cycleId])
  if (mapped.error) return { state: 'error' }
  if (mapped.provisioned === false) return { state: 'unprovisioned' }
  const cohortIds = (mapped.byCycle.get(cycleId) || []).map(c => c.id)
  if (!cohortIds.includes(stu.data.cohort_id)) return { state: 'not_found' }

  let consented = false
  if (audience === TALENT_ACQUISITION) {
    const cand = await db.from('ngrp_candidates').select('id')
      .eq('cycle_id', cycleId).eq('student_id', studentId).maybeSingle()
    if (cand.error) return isMissingNgrpTable(cand.error) ? { state: 'unprovisioned' } : { state: 'error' }
    if (cand.data) {
      // A submitted form is one with at least one revision; every revision carries the consent.
      const asg = await db.from('ngrp_transition_assignments').select('id')
        .eq('candidate_id', cand.data.id).is('revoked_at', null).gt('revision_count', 0).limit(1)
      if (asg.error && !isMissingNgrpTable(asg.error)) return { state: 'error' }
      consented = !asg.error && (asg.data || []).length > 0
    }
  }
  return { state: 'ok', ...shapeApplicantProfile(stu.data, { audience, profile, consented }) }
}
