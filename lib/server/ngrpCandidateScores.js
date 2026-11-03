// lib/server/ngrpCandidateScores.js
//
// CANDIDATE-SCORE-1 (Owner, 2026-11-01): the candidate score Talent Acquisition reads when it
// pairs applicants with hiring units for an interview. The arithmetic is the app's
// (src/lib/ngrp/candidateScoreModel.js); this module gathers what it reads:
//   - unit fit:  the units they rotated in (placement, the form's answer, feedback rotation units)
//                against the units they ranked (the staff ranking when there is one);
//   - feedback:  the six competency ratings from their LATEST preceptor feedback, counted only
//                once the Transition Form is submitted (FEEDBACK-CONSENT-1);
//   - résumé:    Keith's composite for their CURRENT résumé (resumeStatus);
//   - statement: Keith's three ratings from the latest assessment in ngrp_candidate_assessments.
//
// STATEMENT-SOURCE-1 (Owner, 2026-11-02): what Keith rates as the statement is the alumnus's
// uploaded Personal Statement (the CURRENT version in their Documents) when there is one, and the
// Transition Form's interest and strengths statements otherwise. So any alumnus with either is
// assessed, form or no form; preceptor feedback still reaches Keith only once the form is
// submitted (FEEDBACK-CONSENT-1).
//
// The roster attaches a score to every candidate (`loadCandidateScores`, a secondary read: any
// failure leaves the roster without scores, never without the roster). `assessCandidate` runs the
// assess-candidate Skill for ONE applicant, who must be on that cohort's roster and have submitted
// the form or uploaded a Personal Statement, because a statement is what Keith rates.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { runKeithSkill, loadSkill } from './keith/runKeithSkill.js'
import { authorizeSkillForCaller } from './keith/skillAuthorization.js'
import { skillMode } from '../../src/lib/keith/provenanceModel.js'
import { candidateScore, rotatedUnits } from '../../src/lib/ngrp/candidateScoreModel.js'
import { preferencesOf, effectiveEligibility } from './ngrpPool.js'
import { hasSubmittedForm } from './ngrpTalentAcquisition.js'
import { shapePreceptorFeedback, PRECEPTOR_FEEDBACK_FORM_TYPE } from './ngrpPreceptorFeedback.js'
import { loadResumeStatuses } from './resumeStatus.js'
import { loadApplicantsPayload } from './ngrpApplicants.js'
import { extractResumeText } from './keith/resumeExtract.js'
import { redactContactDetails, truncateForInference } from './keith/resumeRedaction.js'

export const SKILL_SLUG = 'assess-candidate'
const TABLE = 'ngrp_candidate_assessments'
const FIELDS = 'id, candidate_id, status, statement, statement_total, statement_note, summary, strengths, considerations, interview_focus, recommendation, fingerprint, provenance_id, error_reason, requested_at, assessed_at, statement_source:record_sent->>statementSource'
export const STATEMENT_DOC_TYPE = 'personal_statement'
const MAX_STATEMENT_CHARS = 12000
// A row still 'assessing' this long after it was asked for reads as failed (closing the page never
// loses a run, and a run that died never spins forever).
export const ASSESSING_STALE_MS = 4 * 60 * 1000

const missingTable = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))
const FAIL_REASONS = {
  off: 'skill_off', denied: 'skill_denied', invalid_output: 'invalid_output',
  upstream_rate_limited: 'rate_limited', upstream_error: 'upstream_error', upstream_timeout: 'upstream_timeout',
}

// Submitted preceptor feedback, shaped by the same allowlist Talent Acquisition reads, by student.
async function feedbackByStudent(db, studentIds) {
  if (!studentIds.length) return new Map()
  const r = await db.from('evaluation_responses').select('student_id, submitted_at, timepoint, responses')
    .eq('form_type', PRECEPTOR_FEEDBACK_FORM_TYPE).in('student_id', studentIds).not('submitted_at', 'is', null)
  if (r.error) throw r.error
  const grouped = new Map()
  for (const row of r.data || []) {
    if (!grouped.has(row.student_id)) grouped.set(row.student_id, [])
    grouped.get(row.student_id).push(row)
  }
  return new Map([...grouped].map(([id, rows]) => [id, shapePreceptorFeedback(rows)]))
}

// What the score reads for one candidate, and the fingerprint of it. An assessment made against a
// different fingerprint is out of date: something Keith read has changed since.
// FIT-RULES-2: the units hiring this cohort, for unit fit. An active unit on the cohort's hiring
// list is hiring (capacity is never 0). null on a failed read, which unit fit reads as "unknown"
// and scores by the rule before FIT-RULES-2.
export async function hiringUnitsFor(db, cycleId) {
  if (!cycleId) return null
  const r = await db.from('ngrp_cycle_units').select('unit_name, is_active').eq('cycle_id', cycleId)
  if (r.error) return null
  return (r.data || []).filter(u => u.unit_name && u.is_active !== false).map(u => u.unit_name)
}

// The CURRENT Personal Statement version of each student, keyed by student id. A failed read is
// an empty map: the form's statements stand in, never no score.
export async function statementVersions(db, studentIds) {
  const out = new Map()
  if (!studentIds.length) return out
  const r = await db.from('student_documents').select('student_id, current_version_id')
    .eq('doc_type', STATEMENT_DOC_TYPE).in('student_id', studentIds)
  if (r.error) return out
  for (const d of r.data || []) if (d.current_version_id) out.set(d.student_id, d.current_version_id)
  return out
}

// What Keith would read as the statement: 'document', 'form', or null when there is neither.
export function statementSourceFor(candidate, statementVersionId) {
  if (statementVersionId) return 'document'
  return candidate && hasSubmittedForm(candidate.form_status) && candidate.assignment_id ? 'form' : null
}

export function scoreInputs(candidate, student, feedback = [], resume = null, hiring = null, statementVersionId = null) {
  const latest = feedback.length ? feedback[feedback.length - 1] : null
  const consent = hasSubmittedForm(candidate.form_status)
  const input = {
    preferences: preferencesOf(candidate),
    rotated: rotatedUnits({
      // PRECEPTED-UNITS-1: every unit on the record and every unit on the form counts.
      preceptedUnit: student?.precepted_units?.length ? student.precepted_units : (student?.precepted_unit || null),
      formPreceptedUnit: candidate.form_precepted_units?.length ? candidate.form_precepted_units : (candidate.form_precepted_unit || null),
      feedbackUnits: feedback.map(f => f.rotationUnit).filter(Boolean),
    }),
    ratings: latest ? latest.competencies.map(c => c.rating).filter(n => n != null) : [],
    consent,
    resumeComposite: resume && (resume.key === 'scored' || resume.key === 'sent') && Number.isFinite(Number(resume.score)) ? Number(resume.score) : null,
    eligibility: effectiveEligibility(candidate),
    hiring,
  }
  // The hiring list is the app's rule, not something Keith reads, so it is not in the fingerprint.
  const fingerprint = createHash('sha256').update(JSON.stringify({
    p: input.preferences, u: input.rotated, f: consent ? input.ratings : [], r: input.resumeComposite, v: candidate.form_revision_count || 0,
    s: statementVersionId || null,
  })).digest('hex').slice(0, 32)
  return { input, fingerprint }
}

function publicAssessment(row, fingerprint, now) {
  if (!row) return null
  const timedOut = row.status === 'assessing' && now - Date.parse(row.requested_at) > ASSESSING_STALE_MS
  return {
    id: row.id,
    status: timedOut ? 'failed' : row.status,
    errorReason: timedOut ? 'timed_out' : (row.error_reason || null),
    statement: row.statement || null,
    statementTotal: row.statement_total ?? null,
    statementNote: row.statement_note || null,
    summary: row.summary || null,
    strengths: row.strengths || [],
    considerations: row.considerations || [],
    interviewFocus: row.interview_focus || [],
    recommendation: row.recommendation || null,
    provenanceId: row.provenance_id || null,
    requestedAt: row.requested_at || null,
    assessedAt: row.assessed_at || null,
    statementSource: row.statement_source === 'document' || row.statement_source === 'form' ? row.statement_source : null,
    stale: row.status === 'assessed' && Boolean(row.fingerprint) && row.fingerprint !== fingerprint,
  }
}

export function resumeProvenanceFor(input, resume) {
  return input?.resumeComposite != null ? (resume?.provenanceId || null) : null
}

// One score per candidate, keyed by candidate id. { provisioned, byCandidate } or { error }.
// `provisioned` says whether the assessment table exists; before it, the score stands on the
// three factors the app computes and nobody is offered Assess.
export async function loadCandidateScores(db, { candidates = [], students = [], hiring = null } = {}, now = Date.now()) {
  const byCandidate = new Map()
  if (!candidates.length) return { provisioned: true, byCandidate }
  const studentById = new Map(students.map(s => [s.id, s]))
  const studentIds = [...new Set(candidates.map(c => c.student_id).filter(Boolean))]
  const [feedback, resumes, rows, statements] = await Promise.all([
    feedbackByStudent(db, studentIds),
    loadResumeStatuses(db, studentIds, now),
    db.from(TABLE).select(FIELDS).in('candidate_id', candidates.map(c => c.id)).order('requested_at', { ascending: false }),
    statementVersions(db, studentIds),
  ])
  let provisioned = true
  if (rows.error) {
    if (!missingTable(rows.error)) return { error: rows.error }
    provisioned = false
  }
  const latestBy = new Map()
  const assessedBy = new Map()
  for (const r of rows.data || []) {
    if (!latestBy.has(r.candidate_id)) latestBy.set(r.candidate_id, r)
    if (r.status === 'assessed' && !assessedBy.has(r.candidate_id)) assessedBy.set(r.candidate_id, r)
  }
  for (const c of candidates) {
    const statementVersionId = statements.get(c.student_id) || null
    const { input, fingerprint } = scoreInputs(c, studentById.get(c.student_id), feedback.get(c.student_id) || [], resumes?.[c.student_id] || null, hiring, statementVersionId)
    const assessed = assessedBy.get(c.id) || null
    const latest = latestBy.get(c.id) || null
    const score = candidateScore({ ...input, statementRatings: assessed?.statement || null })
    byCandidate.set(c.id, {
      ...score,
      // RESIDENCY-KEITH-2: Keith's résumé review, when its composite is one of the factors, so the
      // chip can say Keith had a hand in the number (the résumé chip's own mark).
      resumeProvenanceId: resumeProvenanceFor(input, resumes?.[c.student_id]),
      // STATEMENT-SOURCE-1: what Keith would read now, so the screen can offer Assess without a form.
      statementSource: statementSourceFor(c, statementVersionId),
      assessment: publicAssessment(assessed, fingerprint, now),
      // The run in flight or the one that failed, when it is newer than the last good one.
      lastRun: latest && latest !== assessed ? publicAssessment(latest, fingerprint, now) : null,
    })
  }
  return { provisioned, byCandidate }
}

export async function assessmentAvailability(db, actor, { system = false } = {}) {
  try {
    const skill = await loadSkill(db, SKILL_SLUG)
    if (!skill || skillMode(skill) === 'off') return { available: false, reason: 'skill_off' }
    if (system) return { available: true }
    const ok = authorizeSkillForCaller(skill, { profileId: actor?.id, role: actor?.role, isOwner: actor?.is_owner === true }).ok
    return ok ? { available: true } : { available: false, reason: 'skill_denied' }
  } catch {
    return { available: false, reason: 'skill_off' }
  }
}

// What Keith reads about one applicant. Preceptor feedback is the allowlisted shape (no preceptor,
// no confidential comment to the ASPIRE team); the résumé is Keith's own review, never the file.
function applicantRecord(candidate, student, feedback, review, input, score, statementSource) {
  // FEEDBACK-CONSENT-1: preceptor feedback reaches Keith only once the form is submitted.
  const latest = input.consent && feedback.length ? feedback[feedback.length - 1] : null
  return {
    firstName: student.preferred_first_name || student.first_name || null,
    rankedUnits: input.preferences,
    aspireUnits: input.rotated,
    unitFit: score.factors.find(f => f.key === 'unit_fit')?.detail || null,
    eligibility: input.eligibility,
    interest: candidate.interest || null,
    preceptorFeedback: latest ? {
      period: latest.period, rotationUnit: latest.rotationUnit,
      competencies: latest.competencies.map(c => ({ competency: c.label, rating: c.ratingLabel, comment: c.comment })),
      strengthsObserved: latest.narrative.strengths, areasForDevelopment: latest.narrative.development,
      transitionReadiness: latest.readiness.transitionReadiness, unitEndorsement: latest.readiness.unitEndorsement,
      bestFitEnvironment: latest.readiness.bestFitEnvironment,
    } : (input.consent ? 'No preceptor feedback on file' : 'Preceptor feedback is not shared until the Transition Form is submitted'),
    resumeReview: review ? {
      score: review.score, readiness: review.readiness, summary: review.summary, strengths: review.strengths || [],
    } : 'Résumé not scored yet',
    statementSource: statementSource === 'document' ? 'document' : 'form',
  }
}

/**
 * Assess one applicant. Returns { ok, assessment, score } or { ok: false, status, error }.
 * `complete` and `loadPayload` are injected by tests; production never passes them.
 * `system` is KEITH-AUTO-1's sweep: no caller to authorize, the off switch still applies.
 */
// The current Personal Statement as text, redacted like a résumé. { text } or { reason }.
async function readStatementDocument(db, storage, studentId, versionId) {
  const v = await db.from('student_document_versions').select('id, document_id, storage_bucket, storage_path').eq('id', versionId).maybeSingle()
  if (v.error || !v.data) return { reason: 'file_unavailable' }
  const d = await db.from('student_documents').select('student_id, doc_type').eq('id', v.data.document_id).maybeSingle()
  if (d.error || !d.data || d.data.student_id !== studentId || d.data.doc_type !== STATEMENT_DOC_TYPE) return { reason: 'file_unavailable' }
  const dl = await storage.from(v.data.storage_bucket).download(v.data.storage_path)
  if (dl.error || !dl.data) return { reason: 'file_unavailable' }
  const extracted = await extractResumeText(Buffer.from(await dl.data.arrayBuffer()))
  if (!extracted.ok) return { reason: `unreadable_${extracted.reason || 'file'}` }
  const { text } = truncateForInference(redactContactDetails(extracted.text).text, MAX_STATEMENT_CHARS)
  return { text }
}

export async function assessCandidate(db, { cycleId, candidateId, actor, system = false, complete, storage = db.storage, nowIso = new Date().toISOString(), loadPayload = loadApplicantsPayload }) {
  const avail = await assessmentAvailability(db, actor, { system })
  if (!avail.available) return { ok: false, status: 409, error: avail.reason }
  const payload = await loadPayload(db, cycleId)
  if (payload.state !== 'ok') return { ok: false, status: payload.state === 'cycle_not_found' ? 404 : 500, error: payload.state }
  const candidate = payload.candidates.find(c => c.id === candidateId)
  const student = candidate && payload.students.find(s => s.id === candidate.student_id)
  if (!candidate || !student) return { ok: false, status: 404, error: 'not_on_roster' }
  const versionId = (await statementVersions(db, [student.id])).get(student.id) || null
  const formSubmitted = hasSubmittedForm(candidate.form_status) && Boolean(candidate.assignment_id)
  if (!versionId && !formSubmitted) return { ok: false, status: 409, error: 'no_statement' }

  const [rev, feedbackMap, resumes, reviewRes, hiring] = await Promise.all([
    formSubmitted
      ? db.from('ngrp_transition_revisions').select('payload').eq('assignment_id', candidate.assignment_id)
        .eq('revision_number', candidate.form_revision_count).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    feedbackByStudent(db, [student.id]),
    loadResumeStatuses(db, [student.id]),
    db.from('resume_reviews').select('score, readiness, summary, strengths, scored_at').eq('student_id', student.id)
      .in('status', ['scored', 'sent']).order('scored_at', { ascending: false }).limit(1),
    hiringUnitsFor(db, cycleId),
  ])
  if (formSubmitted && (rev.error || !rev.data)) return { ok: false, status: 500, error: 'internal_error', cause: rev.error }
  const feedback = feedbackMap.get(student.id) || []
  const { input, fingerprint } = scoreInputs(candidate, student, feedback, resumes?.[student.id] || null, hiring, versionId)
  const score = candidateScore(input)
  // The uploaded Personal Statement first; the form's statements when there is none, or when the
  // file cannot be read and the form can stand in.
  let source = 'form'
  let statements = null
  let unreadable = null
  if (versionId) {
    const doc = await readStatementDocument(db, storage, student.id, versionId)
    if (doc.text) { source = 'document'; statements = { personalStatement: doc.text } } else unreadable = doc.reason
  }
  if (!statements && formSubmitted) {
    const ri = rev.data.payload?.residency_interest || {}
    statements = { interest: ri.interest_statement || null, strengths: ri.strengths_statement || null }
  }
  const record = applicantRecord(candidate, student, feedback, reviewRes.data?.[0] || null, input, score, source)

  const ins = await db.from(TABLE).insert({
    candidate_id: candidate.id, status: 'assessing', fingerprint, record_sent: record,
    requested_by: actor?.id || null, requested_at: nowIso,
  }).select('id').maybeSingle()
  if (ins.error) return { ok: false, status: missingTable(ins.error) ? 409 : 500, error: missingTable(ins.error) ? 'not_enabled' : 'internal_error', cause: ins.error }
  const id = ins.data.id
  const fail = async (reason, status = 502) => {
    await db.from(TABLE).update({ status: 'failed', error_reason: reason }).eq('id', id)
    return { ok: false, status, error: reason }
  }
  if (!statements) return fail(unreadable || 'file_unavailable', 422)

  const run = await runKeithSkill(db, SKILL_SLUG, {
    applicant: { value: record, refs: [{ type: 'student_record', id: student.id }] },
    statements: { value: statements, refs: [{ type: 'student_record', id: student.id }] },
  }, {
    actor, ...(system ? { system: true } : {}), entity: { id },
    ...(complete ? { complete } : {}),
  })
  if (!run.ok) return fail(FAIL_REASONS[run.reason] || run.reason || 'upstream_error', run.status || 502)
  const o = run.output
  const done = await db.from(TABLE).update({
    status: 'assessed', statement: o.statement, statement_total: o.statementTotal, statement_note: o.statementNote,
    summary: o.summary, strengths: o.strengths, considerations: o.considerations, interview_focus: o.interviewFocus,
    recommendation: o.recommendation, provenance_id: run.provenanceId || null, assessed_at: new Date().toISOString(), error_reason: null,
  }).eq('id', id)
  if (done.error) return { ok: false, status: 500, error: 'internal_error', cause: done.error }
  const row = await db.from(TABLE).select(FIELDS).eq('id', id).maybeSingle()
  const assessment = publicAssessment(row.data, fingerprint, Date.now())
  return { ok: true, assessment, score: { ...candidateScore({ ...input, statementRatings: o.statement }), resumeProvenanceId: resumeProvenanceFor(input, resumes?.[student.id]), statementSource: source, assessment, lastRun: null } }
}
