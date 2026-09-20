// src/lib/evaluation/reviewQueueLoaders.js
//
// REVIEW-RELEASE-1: the data each workflow's queue needs, loaded the way its panel loaded
// it. These are the four panels' load functions lifted out unchanged in what they read
// and through which client (the Owner/Admin RLS SELECT policies for the survey workflows,
// the review-queue endpoint for the Unit Leader release), plus one new loader for the
// pre-rotation Casey-Fink. Each returns the inputs its adapter takes and a detectedAtMs
// captured here, in async context, never during render.
//
// The cohort-wide assignment read is shared by four of the five survey workflows, so it
// is fetched ONCE per detection and handed to each adapter already grouped. That is the
// only structural change from the panels, which each fetched the same rows.

import { supabase } from '../supabase'
import { getStudentPreferredFullName } from '../studentNameFormatters'
import { shiftDrivesState } from '../shiftLifecycle'
import { getReviewQueue } from '../evaluationReviewApi'
import { postNgrpSupport } from '../ngrp/useNgrpData'

const STUDENT_COLUMNS = [
  'id', 'first_name', 'last_name', 'preferred_first_name', 'school', 'program_type',
  'matched_unit_id', 'status', 'approved_hours', 'hours_required', 'pending_hours',
  'personal_email', 'school_email', 'preceptor_id', 'preceptor_email', 'matched_preceptor',
].join(', ')

const ASSIGNMENT_COLUMNS = `
  id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at, notes, timepoint,
  respondent_type, respondent_name, respondent_email,
  evaluation_instruments!inner ( slug )
`

export function slugFor(a) {
  const inst = a?.evaluation_instruments
  const i = Array.isArray(inst) ? inst[0] : inst
  return i?.slug
}

/**
 * Everything the five survey workflows share: the cohort's students (with unit names
 * resolved), every evaluation assignment in the cohort, the preceptor directory, the
 * certificates, the shift metadata, and the required-activity ledger. One read each.
 */
export async function loadCohortEvidence(cohortId) {
  const [sRes, aRes, uRes, pRes] = await Promise.all([
    supabase
      .from('students')
      .select(STUDENT_COLUMNS)
      .eq('cohort_id', cohortId)
      .order('last_name').order('first_name'),
    supabase
      .from('evaluation_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('cohort_id', cohortId),
    supabase
      .from('units')
      .select('id, unit_name'),
    supabase
      .from('preceptors')
      .select('id, full_name, email, unit_name, is_active'),
  ])
  if (sRes.error) throw sRes.error
  if (aRes.error) throw aRes.error
  if (uRes.error) throw uRes.error
  if (pRes.error) throw pRes.error

  const unitNameById = new Map((uRes.data || []).map(u => [u.id, u.unit_name]))
  const students = (sRes.data || []).map(s => ({
    ...s,
    matched_unit_name: unitNameById.get(s.matched_unit_id) || '',
  }))
  const assignments = aRes.data || []
  const preceptors = pRes.data || []

  const allAssignmentsByStudent = new Map()
  for (const a of assignments) {
    if (!a?.student_id) continue
    if (!allAssignmentsByStudent.has(a.student_id)) allAssignmentsByStudent.set(a.student_id, [])
    allAssignmentsByStudent.get(a.student_id).push(a)
  }
  const studentIds = students.map(s => s.id)

  let certificates = []
  if (studentIds.length) {
    const cRes = await supabase
      .from('certificates')
      .select('id, student_id, certificate_number')
      .in('student_id', studentIds)
    if (cRes.error) throw cRes.error
    certificates = cRes.data || []
  }

  // Shift metadata degrades gracefully, as it did in the panels.
  const shiftMeta = new Map()
  let shiftNote = null
  try {
    const shRes = await supabase
      .from('student_shift_logs')
      .select('student_id, shift_date, support_needed, lifecycle_state')
      .eq('cohort_id', cohortId)
    if (shRes.error) throw shRes.error
    for (const log of (shRes.data || [])) {
      if (!shiftDrivesState(log)) continue
      const cur = shiftMeta.get(log.student_id) || { lastShiftDate: null, supportNeeded: false }
      if (log.shift_date && (!cur.lastShiftDate || new Date(log.shift_date) > new Date(cur.lastShiftDate))) {
        cur.lastShiftDate = log.shift_date
      }
      if ((log.support_needed || '').trim()) cur.supportNeeded = true
      shiftMeta.set(log.student_id, cur)
    }
  } catch {
    shiftNote = 'Last shift dates and support-needed flags are unavailable right now.'
  }

  // The required-activity ledger. If the read fails the ASPIRE feedback workflow shows
  // its activities as UNVERIFIED and stays blocked, exactly as the panel did; the
  // endpoint refuses independently regardless.
  let activityByStudent = new Map()
  let ledgerDown = false
  if (studentIds.length) {
    try {
      const actRes = await supabase
        .from('student_activity_completions')
        .select('id, student_id, activity_key, action, completed_at, created_at, recorded_by_name')
        .in('student_id', studentIds)
      if (actRes.error) throw actRes.error
      for (const row of (actRes.data || [])) {
        if (!activityByStudent.has(row.student_id)) activityByStudent.set(row.student_id, [])
        activityByStudent.get(row.student_id).push(row)
      }
    } catch {
      activityByStudent = new Map()
      ledgerDown = true
    }
  }

  // REVIEW-RELEASE-2 (Owner, 2026-09-20): what Residency > Support recorded for these
  // students counts toward the ASPIRE feedback release as well. Secondary source: if the
  // read fails the ledger alone decides, and the card says the Support side is unknown.
  let supportByStudent = new Map()
  let supportDown = false
  if (studentIds.length) {
    const res = await postNgrpSupport('entries_for_students', { student_ids: studentIds })
    if (res.ok) {
      for (const e of (res.entries || [])) {
        if (!supportByStudent.has(e.student_id)) supportByStudent.set(e.student_id, [])
        supportByStudent.get(e.student_id).push(e)
      }
    } else {
      supportDown = true
    }
  }

  const bySlugAndTimepoint = (slug, timepoint) =>
    assignments.filter(a => slugFor(a) === slug && (timepoint == null || a.timepoint === timepoint))

  return {
    students,
    preceptors,
    assignments,
    allAssignmentsByStudent,
    certificates,
    shiftMeta,
    shiftNote,
    activityByStudent,
    ledgerDown,
    supportByStudent,
    supportDown,
    displayName: getStudentPreferredFullName,
    detectedAtMs: Date.now(),
    // Pre-filtered per workflow, so each adapter sees only its own rows, as the panels did.
    forWorkflow: {
      caseyFinkPreRotation: bySlugAndTimepoint('casey_fink_readiness_2024', 'baseline'),
      preceptor: assignments.filter(a => slugFor(a) === 'preceptor_progress' && a.respondent_type === 'preceptor'),
      student: bySlugAndTimepoint('student_preceptor_eval', null),
      caseyFinkPostRotation: bySlugAndTimepoint('casey_fink_readiness_2024', 'post_rotation'),
      postRotation: bySlugAndTimepoint('post_rotation_evaluation', null),
    },
  }
}

/** The Unit Leader release queue, through the existing Owner/Admin endpoint, unfiltered. */
export async function loadUnitLeaderQueue(signal) {
  const res = await getReviewQueue({}, signal)
  if (!res.ok) {
    const err = new Error(res.error || 'request_failed')
    err.status = res.status
    throw err
  }
  return { rows: res.data?.rows || [], detectedAtMs: Date.now() }
}
