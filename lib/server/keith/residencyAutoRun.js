// lib/server/keith/residencyAutoRun.js
//
// KEITH-AUTO-1 (Owner, 2026-11-02): Keith scores a résumé and assesses the Transition Form's
// statements on his own, so the candidate score Talent Acquisition reads is never waiting on
// someone to press Score or Assess. Owner's words: score résumés "whenever a new one is
// uploaded", by staff, Talent Acquisition or the alumnus; assess the statement on every submit
// and revise. Both stay on Sonnet, the route every existing score was made on, so old and new
// numbers sit on one scale.
//
// The sweep (api/cron/keith-residency-auto.js, every 10 minutes) reads the rosters of the
// residency cohorts in Planning or Active and does, in this order:
//   1. résumés: the CURRENT résumé of every alumnus on a roster, when Keith has not read it. A
//      résumé that only lives on the student record is adopted as a version first, exactly as the
//      drawer's Score now does (adoptRecordResume), because a score belongs to one exact file.
//   2. statements: every applicant with a statement to read (an uploaded Personal Statement, else
//      a submitted form; STATEMENT-SOURCE-1), with no assessment, or one whose inputs changed
//      since (a revision, a new statement file, a new résumé score, new feedback: the
//      fingerprint). An alumnus with only the document is enrolled in the cohort first, the way
//      Log Group Activity enrolls one, because an assessment belongs to a candidate row.
//      An applicant whose résumé is about to be scored waits one run, so Keith reads both.
//
// It never retries what cannot succeed (an unreadable file), retries a failed call after
// RETRY_AFTER_MS and at most MAX_TRIES times per file, and stops at MAX_CALLS Keith calls or the
// time budget; whoever is left goes on the next run. Pausing it is the Skills' own switches in
// Settings > Keith > Skills (review-resume, assess-candidate), as for KEITH-CHECKIN-1's sweep.
// REAL rows only: the cron hands in a populationDb client.
import { reviewState } from '../../../src/lib/documents/resumeReviewModel.js'
import { hasSubmittedForm } from '../ngrpTalentAcquisition.js'
import { fetchCycles, loadApplicantsPayload } from '../ngrpApplicants.js'
import { digestCycles } from '../../../src/lib/ngrp/residencyDigestModel.js'
import { loadResumeStatuses } from '../resumeStatus.js'
import { adoptRecordResume } from '../studentDocuments.js'
import { scoreResumeVersion, scoringAvailability } from '../resumeReview.js'
import { loadCandidateScores, assessCandidate, assessmentAvailability, statementVersions } from '../ngrpCandidateScores.js'
import { enrollStudents } from '../ngrpSupportLog.js'

export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000
export const MAX_TRIES = 3
export const MAX_CALLS = 6
export const TIME_BUDGET_MS = 240_000   // of the function's 300 seconds
// A failure that a second try cannot fix: the file is unreadable or gone, or the Skill refused.
const PERMANENT = /^(unreadable_|file_unavailable$|skill_off$|skill_denied$|not_enabled$|form_not_submitted$|no_statement$|not_on_roster$)/

const STUDENT_FIELDS = 'id, cohort_id, resume_url, first_name, preferred_first_name, aspire_cohort, status'

/**
 * The students whose current résumé Keith should read now. Pure.
 * @param statuses  loadResumeStatuses' map, keyed by student id
 * @param reviews   every résumé review of these students: { id, student_id, document_version_id, status, error_reason, requested_at }
 */
export function resumeTargets({ studentIds = [], statuses = {}, reviews = [], nowMs = Date.now() } = {}) {
  const byId = new Map(reviews.map(r => [r.id, r]))
  const out = []
  for (const id of studentIds) {
    const s = statuses?.[id]
    if (!s) continue
    if (s.key === 'unscored') { out.push({ studentId: id, reason: 'new' }); continue }
    if (s.key !== 'failed') continue
    const last = byId.get(s.reviewId)
    if (!last) continue
    if (PERMANENT.test(String(last.error_reason || ''))) continue
    const tries = reviews.filter(r => r.document_version_id === last.document_version_id
      && (r.status === 'failed' || reviewState(r, nowMs) === 'failed')).length
    if (tries >= MAX_TRIES) continue
    if (nowMs - Date.parse(last.requested_at) < RETRY_AFTER_MS) continue
    out.push({ studentId: id, reason: 'retry' })
  }
  return out
}

/**
 * The applicants whose statements Keith should assess now. Pure.
 * @param scores  loadCandidateScores' byCandidate map
 * @param waitFor student ids whose résumé is due but was left for the next run
 */
export function assessmentTargets({ candidates = [], scores = new Map(), waitFor = new Set(), nowMs = Date.now() } = {}) {
  const out = []
  for (const c of candidates) {
    if (waitFor.has(c.student_id)) continue
    const sc = scores.get(c.id)
    if (!sc) continue
    // A statement to read: the uploaded Personal Statement, else the submitted form.
    if (!sc.statementSource && !(c.assignment_id && hasSubmittedForm(c.form_status))) continue
    const last = sc.lastRun
    if (last?.status === 'assessing') continue
    if (last?.status === 'failed') {
      if (PERMANENT.test(String(last.errorReason || ''))) continue
      if (nowMs - Date.parse(last.requestedAt) < RETRY_AFTER_MS) continue
    }
    if (!sc.assessment) { out.push({ candidateId: c.id, reason: 'new' }); continue }
    if (sc.assessment.stale) out.push({ candidateId: c.id, reason: 'changed' })
  }
  return out
}

/**
 * One run. `complete` is injected by tests. Returns counts only (cron_runs.details holds no PII).
 */
export async function sweep(db, storage, { nowMs = Date.now(), complete, maxCalls = MAX_CALLS, budgetMs = TIME_BUDGET_MS } = {}) {
  const started = Date.now()
  const counts = { cohorts: 0, resumes_due: 0, resumes_scored: 0, resumes_failed: 0, assessments_due: 0, assessed: 0, assess_failed: 0, left_for_next_run: 0 }
  let calls = 0
  const spent = () => calls >= maxCalls || Date.now() - started > budgetMs

  const [resumeOn, assessOn] = await Promise.all([
    scoringAvailability(db, null, { system: true }),
    assessmentAvailability(db, null, { system: true }),
  ])
  if (!resumeOn.available && !assessOn.available) return { ...counts, skipped: 'skills_off' }

  const cyclesRes = await fetchCycles(db)
  if (cyclesRes.error) throw new Error('cycles read failed')

  for (const cycle of digestCycles(cyclesRes.cycles || [])) {
    const payload = await loadApplicantsPayload(db, cycle.id)
    if (payload.state !== 'ok') throw new Error(`applicants for ${cycle.id}: ${payload.state}`)
    counts.cohorts++
    const studentIds = (payload.students || []).map(s => s.id)
    if (!studentIds.length) continue

    const statuses = await loadResumeStatuses(db, studentIds, nowMs)
    if (!statuses) throw new Error('résumé status read failed')
    // Résumés due that this run had no time for: their statements wait for the next run too.
    // A résumé someone is scoring by hand right now counts as left over too.
    const leftOver = new Set(studentIds.filter(id => statuses[id]?.key === 'scoring'))

    if (resumeOn.available) {
      const rv = await db.from('resume_reviews').select('id, student_id, document_version_id, status, error_reason, requested_at').in('student_id', studentIds)
      if (rv.error) throw new Error(`reviews: ${rv.error.message}`)
      const due = resumeTargets({ studentIds, statuses, reviews: rv.data || [], nowMs })
      counts.resumes_due += due.length
      if (due.length) {
        const st = await db.from('students').select(STUDENT_FIELDS).in('id', due.map(d => d.studentId))
        if (st.error) throw new Error(`students: ${st.error.message}`)
        const byId = new Map((st.data || []).map(s => [s.id, s]))
        for (const d of due) {
          const student = byId.get(d.studentId)
          if (!student) continue
          if (spent()) { counts.left_for_next_run++; leftOver.add(student.id); continue }
          const nowIso = new Date().toISOString()
          // A record that names a missing file adopts nothing; the statement goes ahead without it.
          const adopted = await adoptRecordResume(db, storage, { student, actorId: null, nowIso })
          if (adopted.error || adopted.notFound || !adopted.versionId) { counts.resumes_failed++; continue }
          calls++
          const r = await scoreResumeVersion(db, storage, { student, versionId: adopted.versionId, system: true, nowIso, ...(complete ? { complete } : {}) })
          r.ok ? counts.resumes_scored++ : counts.resumes_failed++
        }
      }
    }

    if (assessOn.available) {
      // An alumnus who uploaded a Personal Statement but has no candidate row yet is enrolled, so
      // there is a row to assess; the payload is read again to include them.
      let cur = payload
      const enrolled = new Set((payload.candidates || []).map(c => c.student_id))
      const docs = await statementVersions(db, studentIds.filter(id => !enrolled.has(id)))
      if (docs.size) {
        const en = await enrollStudents(db, { cycleId: cycle.id, studentIds: [...docs.keys()] })
        if (en.error) throw new Error(`enroll: ${en.error.message}`)
        cur = await loadApplicantsPayload(db, cycle.id)
        if (cur.state !== 'ok') throw new Error(`applicants for ${cycle.id}: ${cur.state}`)
      }
      // Read the scores again: a résumé scored above moves the fingerprint.
      const sc = await loadCandidateScores(db, { candidates: cur.candidates || [], students: cur.students || [] }, nowMs)
      if (sc.error) throw new Error('candidate scores read failed')
      if (!sc.provisioned) continue
      const due = assessmentTargets({ candidates: cur.candidates || [], scores: sc.byCandidate, waitFor: leftOver, nowMs })
      counts.assessments_due += due.length
      for (const d of due) {
        if (spent()) { counts.left_for_next_run++; continue }
        calls++
        const a = await assessCandidate(db, { cycleId: cycle.id, candidateId: d.candidateId, system: true, storage, ...(complete ? { complete } : {}) })
        a.ok ? counts.assessed++ : counts.assess_failed++
      }
    }
  }
  return counts
}
